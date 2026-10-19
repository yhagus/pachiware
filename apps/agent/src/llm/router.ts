import { cachedTokensOf } from "./usage.js";
import { providerRequest } from "./retry.js";
import { readAnswer } from "./answer.js";
import { repositories, decryptSecret, type Profile } from "@pachiware/db";
import { CacheService, tenantKey } from "../cache/redis.js";
import { skillRegistry, textIn, configuredLanguage, audit } from "@pachiware/skills";
import type { ChatMessage, ContentPart, LLMRequestOptions, LLMResponse } from "./types.js";
import type { ToolCall } from "@pachiware/skills";
import { providerBaseUrl, providerHeaders, formatHeaders, apiFormatOf, isProvider, PROVIDERS, DEFAULT_MODELS, ANTHROPIC_TEST_MODEL } from "./providers.js";

const textOf = (content: ChatMessage["content"]) => typeof content === "string" || content === null ? content || "" : content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
const hasImages = (messages: ChatMessage[]) => messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image"));
const withoutImages = (messages: ChatMessage[]) => messages.map((m) => (Array.isArray(m.content) ? { ...m, content: textOf(m.content) } : m));
export const openAIContent = (content: ChatMessage["content"]) => !Array.isArray(content) ? content || "" : content.map((p) =>
  p.type === "text" ? p : { type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.data}` } });
export const responsesContent = (content: ChatMessage["content"]) => !Array.isArray(content) ? content || "" : content.map((p) =>
  p.type === "text" ? { type: "input_text", text: p.text } : { type: "input_image", image_url: `data:${p.mediaType};base64,${p.data}` });
// Claude reads images best when they come before the text.
export const anthropicBlocks = (content: ChatMessage["content"]): any[] => !Array.isArray(content) ? (content ? [{ type: "text", text: content }] : []) : [
  ...content.filter((p) => p.type === "image").map((p) => ({ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } })),
  ...content.filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text"),
];
const anthropicModelOf = (config: any): string => config?.anthropicModel || (config?.defaultProvider === "anthropic" && config?.defaultModel) || DEFAULT_MODELS.anthropic!;
// Low enough that actions are repeatable; a tenant's own value wins.
export const DEFAULT_TEMPERATURE = 0.2;
// The most Profiles one request may reach: the bot's own and two fallbacks after it.
const MAX_CHAIN = 3;
const CACHED = { cache_control: { type: "ephemeral" } };
const markLast = (blocks: any[]) => blocks.map((b, i) => (i === blocks.length - 1 ? { ...b, ...CACHED } : b));
// A message's later blocks (the current turn merged into it) come after the mark, so it still ends the cached history.
const markLastBlock = (message: any) => {
  if (!message) return;
  if (typeof message.content === "string") message.content = message.content ? [{ type: "text", text: message.content }] : [];
  const last = message.content.at(-1);
  if (last && (last.type !== "text" || last.text)) message.content[message.content.length - 1] = { ...last, ...CACHED };
};
// A response cut at the output limit is "length" whatever else it holds: its text is unfinished and any tool call in it may be.
const finishOf = (cut: boolean, toolCalls: ToolCall[]): LLMResponse["finishReason"] => (cut ? "length" : toolCalls.length > 0 ? "tool_calls" : "stop");
// Some servers open a streamed answer's text with the model's reasoning in a <think> block, often empty; it is never the reply.
const withoutThink = (text: string | null | undefined) => text?.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "") || null;
// A Chat Completions answer that says the model called a tool ("tool_calls", or "tool_use" from proxies) yet holds neither the call nor text.
const lostCall = (choice: any) => /^tool/.test(choice?.finish_reason ?? "") && !choice?.message?.tool_calls?.length && !withoutThink(choice?.message?.content);
// Chat Completions servers that dropped a tool call unless they streamed, by base URL and model; asked streaming from then on, until restart.
const streamsOnly = new Set<string>();

export class LLMRouter {
  private async getActiveTenantConfig(tenantId: string) {
    try {
      let cached = await CacheService.get<any>(tenantKey(tenantId, "agent:config"));
      if (!cached) {
        cached = await repositories().agentConfig.get(tenantId);
        if (cached) {
          await CacheService.set(tenantKey(tenantId, "agent:config"), cached, 120);
        }
      }
      if (!cached) throw new Error("Tenant agent configuration not found");
      const decrypted = { ...cached };
      for (const provider of PROVIDERS) decrypted[`${provider}ApiKey`] = cached[`${provider}ApiKeyEncrypted`] ? decryptSecret(cached[`${provider}ApiKeyEncrypted`]) : null;
      return decrypted;
    } catch {
      throw new Error("Unable to load tenant LLM configuration");
    }
  }

  // An integration may point at a profile (one provider + one model). It overrides the tenant default for that integration only.
  private async getBotProfile(tenantId: string, botId?: string) {
    if (!botId) return null;
    return repositories().profiles.getForBot(tenantId, botId);
  }

  // A profile declares image input. A tenant default has no flag, so only an Anthropic default can learn it, from the models endpoint.
  async acceptsImages(tenantId: string, botId?: string): Promise<boolean> {
    const profile = await this.getBotProfile(tenantId, botId);
    if (profile) return profile.acceptsImages;
    const config = await this.getActiveTenantConfig(tenantId);
    if (config.defaultProvider !== "anthropic" || !config.anthropicApiKey) return false;
    const model = anthropicModelOf(config);
    const cacheKey = tenantKey(tenantId, `llm:image-input:${model}`);
    const cached = await CacheService.get<boolean>(cacheKey);
    if (cached !== null) return cached;
    try {
      const res = await fetch(`${providerBaseUrl("anthropic", config.anthropicBaseUrl)}/models/${encodeURIComponent(model)}`, { headers: providerHeaders("anthropic", config.anthropicApiKey), signal: AbortSignal.timeout(10000) });
      if (!res.ok) return false;
      const supported = (await res.json())?.capabilities?.image_input?.supported === true;
      await CacheService.set(cacheKey, supported, 3600);
      return supported;
    } catch { return false; }
  }

  /**
   * Main completion method dispatching to the configured or requested provider.
   */
  async complete(
    messages: ChatMessage[],
    options: LLMRequestOptions
  ): Promise<LLMResponse> {
    const tenantConfig = await this.getActiveTenantConfig(options.tenantId);
    const profile = options.provider ? null : await this.getBotProfile(options.tenantId, options.botId);
    const started = performance.now();
    let answered = await this.answerWith(profile, tenantConfig, messages, options);
    let answeredBy = profile;
    // A failed Profile hands the same request to its fallback, and that one to its own, up to MAX_CHAIN Profiles in all.
    const tried = new Set(profile ? [profile.id] : []);
    while (answered.response.finishReason === "error" && answeredBy?.fallbackProfileId && tried.size < MAX_CHAIN && !(options.deadline !== undefined && Date.now() >= options.deadline)) {
      const next = await repositories().profiles.getForTenant(options.tenantId, answeredBy.fallbackProfileId);
      if (!next || tried.has(next.id)) break;
      tried.add(next.id);
      const blind = !next.acceptsImages && hasImages(messages);
      answered = await this.answerWith(next, tenantConfig, blind ? withoutImages(messages) : messages, options);
      if (blind && answered.response.finishReason !== "error") answered.response = { ...answered.response, imagesRejected: true };
      answeredBy = next;
    }
    const { response, provider, model } = answered;
    if (response.finishReason !== "error") {
      if (profile && answeredBy && answeredBy.id !== profile.id) await audit(options, "profile_fallback", { from: profile.id, to: answeredBy.id, profiles: tried.size });
      await repositories().usage.record({ tenantId: options.tenantId, botId: options.botId || null, type: "llm_tokens", provider, model, promptTokens: response.usage?.promptTokens || 0, completionTokens: response.usage?.completionTokens || 0, metadata: { cachedTokens: response.usage?.cachedTokens || 0, latencyMs: Math.round(performance.now() - started), ...(answeredBy ? { profileId: answeredBy.id } : {}) } });
    }
    return response;
  }

  /** One request answered by a profile, or by the tenant default when there is none; a 400 on images is retried without them. */
  private async answerWith(profile: Profile | null, tenantConfig: any, messages: ChatMessage[], options: LLMRequestOptions) {
    let dbConfig = tenantConfig;
    const format = profile ? apiFormatOf(profile.provider, profile.apiFormat) : "chat_completions";
    if (profile) {
      if (!isProvider(profile.provider)) throw new Error("Unsupported profile provider");
      const key = profile.apiKeyEncrypted ? decryptSecret(profile.apiKeyEncrypted) : null;
      dbConfig = { ...dbConfig, defaultProvider: profile.provider, defaultModel: profile.model, [`${profile.provider}ApiKey`]: key, [`${profile.provider}BaseUrl`]: profile.baseUrl, [`${profile.provider}Model`]: profile.model };
    }
    const provider = options.provider || dbConfig.defaultProvider;
    const resolved = { ...options, temperature: options.temperature ?? dbConfig.temperature ?? DEFAULT_TEMPERATURE, maxTokens: options.maxTokens ?? dbConfig.maxTokens, language: configuredLanguage({ language: options.language }, dbConfig) };
    const call = (list: ChatMessage[], opts: LLMRequestOptions = resolved) => {
      switch (provider) {
        case "anthropic": return this.callAnthropic(list, opts, dbConfig);
        case "custom":
          if (format === "messages") return this.callAnthropic(list, opts, { ...dbConfig, anthropicApiKey: dbConfig.customApiKey, anthropicBaseUrl: dbConfig.customBaseUrl, anthropicModel: dbConfig.customModel }, "custom");
          if (format === "responses") return this.callResponses(list, opts, dbConfig);
          return this.callCustomOpenAI(list, opts, dbConfig);
        case "openai": return this.callOpenAI(list, opts, dbConfig);
        default: throw new Error("Unsupported tenant LLM provider");
      }
    };
    let response = await call(messages);
    // A 400 on a request with images is most likely the model refusing them: one retry without, so the text still gets answered.
    if (response.httpStatus === 400 && hasImages(messages)) {
      const retry = await call(withoutImages(messages));
      if (retry.finishReason !== "error") response = { ...retry, imagesRejected: true };
    }
    // A 400 on a request with tool_choice is most likely a server that does not support it: the same Profile is asked once more
    // without tools before the request counts as failed and moves to a fallback.
    if (response.httpStatus === 400 && resolved.toolChoice) {
      const { tools: _tools, toolChoice: _choice, ...bare } = resolved;
      response = await call(messages, bare);
    }
    return { response, provider, model: options.model || dbConfig[`${provider}Model`] || dbConfig.defaultModel };
  }

  /**
   * Calls standard OpenAI Chat Completions API.
   */
  private async callOpenAI(
    messages: ChatMessage[],
    options: LLMRequestOptions,
    dbConfig?: any
  ): Promise<LLMResponse> {
    const apiKey = dbConfig?.openaiApiKey;
    const baseUrl = providerBaseUrl("openai", dbConfig?.openaiBaseUrl);
    const model = options.model || dbConfig?.openaiModel || dbConfig?.defaultModel || DEFAULT_MODELS.openai;

    if (!apiKey) {
      return this.handleMissingApiKey("openai", messages, options);
    }

    const formattedMessages = messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool",
          tool_call_id: m.toolCallId,
          content: textOf(m.content),
        };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: m.content,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return {
        role: m.role,
        content: openAIContent(m.content),
      };
    });

    const body: any = {
      model,
      messages: formattedMessages,
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: options.maxTokens ?? 4096,
      stream: false,
    };

    // Routes requests of one conversation to the same cache; only OpenAI itself is known to accept the field.
    if (options.cacheKey && new URL(baseUrl).hostname === "api.openai.com") body.prompt_cache_key = options.cacheKey;

    if (options.tools && options.tools.length > 0) {
      body.tools = skillRegistry.toOpenAITools(options.tools);
      if (options.toolChoice) body.tool_choice = options.toolChoice;
    }

    try {
      const response = await providerRequest(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      }, options.deadline);

      if (!response.ok) return this.rejected(response.status, messages, options);

      const data = await readAnswer("chat_completions", response);
      const choice = data.choices[0];
      const toolCalls: ToolCall[] = [];

      if (choice.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments);
          } catch {
            parsedArgs = { raw: tc.function.arguments };
          }
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: parsedArgs,
          });
        }
      }

      return {
        content: choice.message?.content || null,
        toolCalls,
        finishReason: finishOf(choice.finish_reason === "length", toolCalls),
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
              cachedTokens: cachedTokensOf(data.usage),
            }
          : undefined,
      };
    } catch (err: any) {
      console.warn("LLM provider request failed.");
      return this.handleFallback("Provider request failed", messages, options);
    }
  }

  /**
   * Calls Anthropic Messages API, or a BYOK server that speaks it (`as` "custom").
   */
  private async callAnthropic(
    messages: ChatMessage[],
    options: LLMRequestOptions,
    dbConfig?: any,
    as: "anthropic" | "custom" = "anthropic"
  ): Promise<LLMResponse> {
    const apiKey = dbConfig?.anthropicApiKey;
    const baseUrl = providerBaseUrl("anthropic", dbConfig?.anthropicBaseUrl);
    const model = options.model || anthropicModelOf(dbConfig);

    if (!apiKey) {
      return this.handleMissingApiKey(as, messages, options);
    }

    const systemBlocks: any[] = [];
    const anthropicMessages: any[] = [];

    // Consecutive user turns become one message, with tool_result blocks first as the API requires.
    const pushUser = (blocks: any[]) => {
      const last = anthropicMessages.at(-1);
      if (last?.role !== "user") return void anthropicMessages.push({ role: "user", content: blocks });
      const merged = [...(typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content), ...blocks];
      last.content = [...merged.filter((b) => b.type === "tool_result"), ...merged.filter((b) => b.type !== "tool_result")];
    };

    for (const [i, m] of messages.entries()) {
      if (m.role === "system") {
        const text = textOf(m.content).trim();
        if (text) systemBlocks.push({ type: "text", text });
      } else if (m.role === "tool") {
        pushUser([{ type: "tool_result", tool_use_id: m.toolCallId, content: textOf(m.content) }]);
      } else if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const contentBlocks: any[] = [];
        if (m.content) {
          contentBlocks.push({ type: "text", text: textOf(m.content) });
        }
        for (const tc of m.toolCalls) {
          contentBlocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        anthropicMessages.push({ role: "assistant", content: contentBlocks });
      } else if (m.role === "assistant") {
        anthropicMessages.push({ role: "assistant", content: textOf(m.content) });
      } else if (anthropicMessages.at(-1)?.role === "user" || Array.isArray(m.content)) {
        pushUser(anthropicBlocks(m.content));
      } else {
        anthropicMessages.push({ role: "user", content: m.content || "" });
      }
      if (i === options.historyEnd) markLastBlock(anthropicMessages.at(-1));
    }

    // No temperature: current Claude models reject a non-default one. The cache marks cover the stable prefix (tools, system, then stored history).
    const body: any = {
      model,
      system: systemBlocks.length ? markLast(systemBlocks) : undefined,
      messages: anthropicMessages,
      max_tokens: options.maxTokens ?? 4096,
      stream: false,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = markLast(skillRegistry.toAnthropicTools(options.tools));
      if (options.toolChoice) body.tool_choice = { type: options.toolChoice };
    }

    try {
      const response = await providerRequest(`${baseUrl}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...formatHeaders(as, "messages", apiKey) },
        body: JSON.stringify(body),
      }, options.deadline);

      if (!response.ok) return this.rejected(response.status, messages, options);

      const data = await readAnswer("messages", response);
      const toolCalls: ToolCall[] = [];
      let textContent = "";

      for (const block of data.content || []) {
        if (block.type === "text") {
          textContent += block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input || {},
          });
        }
      }

      return {
        content: textContent || null,
        toolCalls,
        finishReason: finishOf(data.stop_reason === "max_tokens", toolCalls),
        usage: data.usage
          ? {
              promptTokens: data.usage.input_tokens,
              completionTokens: data.usage.output_tokens,
              totalTokens: data.usage.input_tokens + data.usage.output_tokens,
              cachedTokens: cachedTokensOf(data.usage),
            }
          : undefined,
      };
    } catch (err: any) {
      console.warn("LLM provider request failed.");
      return this.handleFallback("Provider request failed", messages, options);
    }
  }

  /**
   * Calls a custom OpenAI-compatible endpoint.
   */
  private async callCustomOpenAI(
    messages: ChatMessage[],
    options: LLMRequestOptions,
    dbConfig?: any
  ): Promise<LLMResponse> {
    const apiKey = dbConfig?.customApiKey;
    const baseUrl = providerBaseUrl("custom", dbConfig?.customBaseUrl);
    const model = options.model || dbConfig?.customModel || "gpt-4o";

    if (!apiKey) {
      return this.handleMissingApiKey("custom", messages, options);
    }
    if (!baseUrl) {
      return { content: textIn(options.language).providerNoBaseUrl, toolCalls: [], finishReason: "error" };
    }

    // Reuse OpenAI wire format
    const formattedMessages = messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool",
          tool_call_id: m.toolCallId,
          content: textOf(m.content),
        };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: m.content,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return {
        role: m.role,
        content: openAIContent(m.content),
      };
    });

    const body: any = {
      model,
      messages: formattedMessages,
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: options.maxTokens ?? 4096,
      stream: false,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = skillRegistry.toOpenAITools(options.tools);
      if (options.toolChoice) body.tool_choice = options.toolChoice;
    }

    // Streaming is only for a server known to drop tool calls otherwise; it is asked for usage, which a stream leaves out by default.
    const server = `${baseUrl}|${model}`;
    const send = (stream: boolean) => providerRequest(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(stream ? { ...body, stream, stream_options: { include_usage: true } } : body),
    }, options.deadline);

    try {
      const response = await send(streamsOnly.has(server));

      if (!response.ok) return this.rejected(response.status, messages, options);

      let data = await readAnswer("chat_completions", response);
      if (lostCall(data.choices?.[0]) && !streamsOnly.has(server)) {
        const again = await send(true);
        if (again.ok) {
          data = await readAnswer("chat_completions", again);
          if (!lostCall(data.choices?.[0])) streamsOnly.add(server);
        }
      }
      const choice = data.choices[0];
      if (lostCall(choice)) return this.handleFallback("Provider answered a tool call without it", messages, options);
      const toolCalls: ToolCall[] = [];

      if (choice.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments);
          } catch {
            parsedArgs = { raw: tc.function.arguments };
          }
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: parsedArgs,
          });
        }
      }

      return {
        content: withoutThink(choice.message?.content),
        toolCalls,
        finishReason: finishOf(choice.finish_reason === "length", toolCalls),
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
              cachedTokens: cachedTokensOf(data.usage),
            }
          : undefined,
      };
    } catch (err: any) {
      console.warn("LLM provider request failed.");
      return this.handleFallback("Provider request failed", messages, options);
    }
  }

  /**
   * Calls a BYOK server that speaks the OpenAI Responses API. Stateless: each turn resends the conversation and asks the server not to store it.
   */
  private async callResponses(messages: ChatMessage[], options: LLMRequestOptions, dbConfig?: any): Promise<LLMResponse> {
    const apiKey = dbConfig?.customApiKey;
    const baseUrl = providerBaseUrl("custom", dbConfig?.customBaseUrl);
    const model = options.model || dbConfig?.customModel || "gpt-4o";
    if (!apiKey) return this.handleMissingApiKey("custom", messages, options);
    if (!baseUrl) return { content: textIn(options.language).providerNoBaseUrl, toolCalls: [], finishReason: "error" };

    const input: any[] = [];
    for (const m of messages) {
      if (m.role === "tool") input.push({ type: "function_call_output", call_id: m.toolCallId, output: textOf(m.content) });
      else if (m.role === "assistant") {
        const text = textOf(m.content);
        if (text) input.push({ role: "assistant", content: text });
        for (const tc of m.toolCalls ?? []) input.push({ type: "function_call", call_id: tc.id, name: tc.name, arguments: JSON.stringify(tc.arguments) });
      } else input.push({ role: m.role, content: responsesContent(m.content) });
    }
    const body: any = { model, input, temperature: options.temperature ?? DEFAULT_TEMPERATURE, max_output_tokens: options.maxTokens ?? 4096, store: false, stream: false };
    // Responses function tools are flat, and strict by default; the skill schemas are not written for strict mode.
    if (options.tools && options.tools.length > 0) {
      body.tools = skillRegistry.toOpenAITools(options.tools).map((t: any) => ({ type: "function", ...t.function, strict: false }));
      if (options.toolChoice) body.tool_choice = options.toolChoice;
    }

    try {
      const response = await providerRequest(`${baseUrl}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...providerHeaders("custom", apiKey) },
        body: JSON.stringify(body),
      }, options.deadline);
      if (!response.ok) return this.rejected(response.status, messages, options);

      const data = await readAnswer("responses", response);
      const toolCalls: ToolCall[] = [];
      let text = "";
      for (const item of data.output || []) {
        if (item.type === "message") text += (item.content || []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");
        else if (item.type === "function_call") {
          let args = {};
          try { args = JSON.parse(item.arguments); } catch { args = { raw: item.arguments }; }
          toolCalls.push({ id: item.call_id, name: item.name, arguments: args });
        }
      }
      return {
        content: text || null,
        toolCalls,
        finishReason: finishOf(data.status === "incomplete" && data.incomplete_details?.reason === "max_output_tokens", toolCalls),
        usage: data.usage
          ? { promptTokens: data.usage.input_tokens, completionTokens: data.usage.output_tokens, totalTokens: data.usage.total_tokens ?? data.usage.input_tokens + data.usage.output_tokens, cachedTokens: cachedTokensOf(data.usage) }
          : undefined,
      };
    } catch {
      console.warn("LLM provider request failed.");
      return this.handleFallback("Provider request failed", messages, options);
    }
  }

  // The answers below are what the person reads when no model could answer, so they come in the place's configured language.
  private handleMissingApiKey(
    providerName: string,
    messages: ChatMessage[],
    options: LLMRequestOptions
  ): LLMResponse {
    return { content: textIn(options.language).providerNoKey(providerName), toolCalls: [], finishReason: "error" };
  }

  private rejected(status: number, messages: ChatMessage[], options: LLMRequestOptions): LLMResponse {
    console.warn(`LLM provider rejected the request (${status}).`);
    return { ...this.handleFallback("Provider request failed", messages, options), httpStatus: status };
  }

  private handleFallback(
    errorReason: string,
    messages: ChatMessage[],
    options: LLMRequestOptions
  ): LLMResponse {
    return { content: textIn(options.language).providerFailed, toolCalls: [], finishReason: "error" };
  }

  static async testOpenAI(apiKey: string, baseUrl?: string): Promise<{ success: boolean; message: string; modelCount?: number }> {
    const url = providerBaseUrl("openai", baseUrl);
    try {
      const res = await fetch(`${url}/models`, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      if (!res.ok) {
        return { success: false, message: `OpenAI rejected credentials (${res.status}).` };
      }
      const data = await res.json();
      return { success: true, message: `Successfully connected to OpenAI API`, modelCount: data.data?.length };
    } catch (err: any) {
      return { success: false, message: `Network error connecting to OpenAI: ${err.message}` };
    }
  }

  static async testAnthropic(apiKey: string, baseUrl?: string): Promise<{ success: boolean; message: string }> {
    const url = providerBaseUrl("anthropic", baseUrl);
    try {
      const res = await fetch(`${url}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: ANTHROPIC_TEST_MODEL,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
      if (!res.ok) {
        return { success: false, message: `Anthropic rejected credentials (${res.status}).` };
      }
      return { success: true, message: `Successfully authenticated with Anthropic Messages API` };
    } catch (err: any) {
      return { success: false, message: `Network error connecting to Anthropic: ${err.message}` };
    }
  }

  static async testCustom(apiKey: string, baseUrl?: string): Promise<{ success: boolean; message: string; modelCount?: number }> {
    const url = providerBaseUrl("custom", baseUrl);
    if (!url) return { success: false, message: "A custom provider needs a base URL." };
    try {
      const res = await fetch(`${url}/models`, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      if (!res.ok) {
        return { success: false, message: `Custom endpoint rejected credentials (${res.status}).` };
      }
      const data = await res.json();
      return { success: true, message: `Successfully connected to Custom/Proxy endpoint`, modelCount: data.data?.length };
    } catch (err: any) {
      return { success: false, message: `Network error connecting to custom endpoint: ${err.message}` };
    }
  }
}

export const llmRouter = new LLMRouter();

