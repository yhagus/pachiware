import { cachedTokensOf } from "./usage.js";
import { db, agentsConfig, bots, profiles, usageEvents, decryptSecret, eq, and } from "@pachiware/db";
import { CacheService, tenantKey } from "../cache/redis.js";
import { skillRegistry } from "@pachiware/skills";
import type { ChatMessage, ContentPart, LLMRequestOptions, LLMResponse } from "./types.js";
import type { ToolCall } from "@pachiware/skills";
import { providerBaseUrl, providerHeaders } from "./providers.js";

export { providerBaseUrl, providerHeaders };

type ProbeResult = { ok: boolean; message: string };
// An 8x8 solid PNG, small enough for every provider's image limits.
const PROBE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mO44GCAFTEMLQkAaplQAWdwh5oAAAAASUVORK5CYII=";
const textOf = (content: ChatMessage["content"]) => typeof content === "string" || content === null ? content || "" : content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
const hasImages = (messages: ChatMessage[]) => messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image"));
const withoutImages = (messages: ChatMessage[]) => messages.map((m) => (Array.isArray(m.content) ? { ...m, content: textOf(m.content) } : m));
const openAIContent = (content: ChatMessage["content"]) => !Array.isArray(content) ? content || "" : content.map((p) =>
  p.type === "text" ? p : { type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.data}` } });
// Claude reads images best when they come before the text.
const anthropicBlocks = (content: ChatMessage["content"]): any[] => !Array.isArray(content) ? (content ? [{ type: "text", text: content }] : []) : [
  ...content.filter((p) => p.type === "image").map((p) => ({ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } })),
  ...content.filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text"),
];
const anthropicModelOf = (config: any): string => config?.anthropicModel || (config?.defaultProvider === "anthropic" && config?.defaultModel) || "claude-3-5-sonnet-20241022";

export class LLMRouter {
  private async getActiveTenantConfig(tenantId: string) {
    try {
      let cached = await CacheService.get<any>(tenantKey(tenantId, "agent:config"));
      if (!cached) {
        const rows = await db
          .select()
          .from(agentsConfig)
          .where(eq(agentsConfig.tenantId, tenantId))
          .limit(1);
        cached = rows[0] || null;
        if (cached) {
          await CacheService.set(tenantKey(tenantId, "agent:config"), cached, 120);
        }
      }
      if (!cached) throw new Error("Tenant agent configuration not found");
      const decrypted = { ...cached };
      for (const provider of ["openai", "anthropic", "custom"]) decrypted[`${provider}ApiKey`] = cached[`${provider}ApiKeyEncrypted`] ? decryptSecret(cached[`${provider}ApiKeyEncrypted`]) : null;
      return decrypted;
    } catch {
      throw new Error("Unable to load tenant LLM configuration");
    }
  }

  // An integration may point at a profile (one provider + one model). It overrides the tenant default for that integration only.
  private async getBotProfile(tenantId: string, botId?: string) {
    if (!botId) return null;
    const [row] = await db.select({ profile: profiles }).from(bots).innerJoin(profiles, eq(bots.profileId, profiles.id))
      .where(and(eq(bots.id, botId), eq(bots.tenantId, tenantId), eq(profiles.tenantId, tenantId))).limit(1);
    return row?.profile ?? null;
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
    let dbConfig = await this.getActiveTenantConfig(options.tenantId);
    const profile = options.provider ? null : await this.getBotProfile(options.tenantId, options.botId);
    if (profile) {
      if (!["openai", "anthropic", "custom"].includes(profile.provider)) throw new Error("Unsupported profile provider");
      const key = profile.apiKeyEncrypted ? decryptSecret(profile.apiKeyEncrypted) : null;
      dbConfig = { ...dbConfig, defaultProvider: profile.provider, defaultModel: profile.model, [`${profile.provider}ApiKey`]: key, [`${profile.provider}BaseUrl`]: profile.baseUrl, [`${profile.provider}Model`]: profile.model };
    }
    const provider = options.provider || dbConfig.defaultProvider;
    const resolved = { ...options, temperature: options.temperature ?? dbConfig.temperature, maxTokens: options.maxTokens ?? dbConfig.maxTokens };
    const call = (list: ChatMessage[]) => {
      switch (provider) {
        case "anthropic": return this.callAnthropic(list, resolved, dbConfig);
        case "custom": return this.callCustomOpenAI(list, resolved, dbConfig);
        case "openai": return this.callOpenAI(list, resolved, dbConfig);
        default: throw new Error("Unsupported tenant LLM provider");
      }
    };
    const started = performance.now();
    let response = await call(messages);
    // A 400 on a request with images is most likely the model refusing them: one retry without, so the text still gets answered.
    if (response.httpStatus === 400 && hasImages(messages)) {
      const retry = await call(withoutImages(messages));
      if (retry.finishReason !== "error") response = { ...retry, imagesRejected: true };
    }
    if (response.finishReason !== "error") {
      await db.insert(usageEvents).values({ tenantId: options.tenantId, botId: options.botId || null, type: "llm_tokens", provider, model: options.model || dbConfig[`${provider}Model`] || dbConfig.defaultModel, promptTokens: response.usage?.promptTokens || 0, completionTokens: response.usage?.completionTokens || 0, metadata: { cachedTokens: response.usage?.cachedTokens || 0, latencyMs: Math.round(performance.now() - started) } });
    }
    return response;
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
    const baseUrl = (dbConfig?.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = options.model || dbConfig?.openaiModel || dbConfig?.defaultModel || "gpt-4o";

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
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    };

    // Routes requests of one conversation to the same cache; only OpenAI itself is known to accept the field.
    if (options.cacheKey && new URL(baseUrl).hostname === "api.openai.com") body.prompt_cache_key = options.cacheKey;

    if (options.tools && options.tools.length > 0) {
      body.tools = skillRegistry.toOpenAITools(options.tools);
    }

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) return this.rejected(response.status, messages, options);

      const data = await response.json();
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
        finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
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
   * Calls Anthropic Messages API.
   */
  private async callAnthropic(
    messages: ChatMessage[],
    options: LLMRequestOptions,
    dbConfig?: any
  ): Promise<LLMResponse> {
    const apiKey = dbConfig?.anthropicApiKey;
    const baseUrl = (dbConfig?.anthropicBaseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
    const model = options.model || anthropicModelOf(dbConfig);

    if (!apiKey) {
      return this.handleMissingApiKey("anthropic", messages, options);
    }

    let systemPrompt = "";
    const anthropicMessages: any[] = [];

    // Consecutive user turns become one message, with tool_result blocks first as the API requires.
    const pushUser = (blocks: any[]) => {
      const last = anthropicMessages.at(-1);
      if (last?.role !== "user") return void anthropicMessages.push({ role: "user", content: blocks });
      const merged = [...(typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content), ...blocks];
      last.content = [...merged.filter((b) => b.type === "tool_result"), ...merged.filter((b) => b.type !== "tool_result")];
    };

    for (const m of messages) {
      if (m.role === "system") {
        systemPrompt += textOf(m.content) + "\n\n";
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
    }

    const body: any = {
      model,
      system: systemPrompt.trim() || undefined,
      messages: anthropicMessages,
      max_tokens: options.maxTokens ?? 4096,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = skillRegistry.toAnthropicTools(options.tools);
    }

    try {
      const response = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) return this.rejected(response.status, messages, options);

      const data = await response.json();
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
        finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
        usage: data.usage
          ? {
              promptTokens: data.usage.input_tokens,
              completionTokens: data.usage.output_tokens,
              totalTokens: data.usage.input_tokens + data.usage.output_tokens,
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
    const baseUrl = (dbConfig?.customBaseUrl || "").replace(/\/+$/, "");
    const model = options.model || dbConfig?.customModel || "gpt-4o";

    if (!apiKey) {
      return this.handleMissingApiKey("custom", messages, options);
    }
    if (!baseUrl) {
      return { content: "No custom provider base URL configured for this tenant. Configure it in the operator console.", toolCalls: [], finishReason: "error" };
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
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = skillRegistry.toOpenAITools(options.tools);
    }

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) return this.rejected(response.status, messages, options);

      const data = await response.json();
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
        finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
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
   * Graceful fallback when API key is missing or invalid.
   * Can automatically parse common user commands to demonstrate tool calling in development.
   */
  private handleMissingApiKey(
    providerName: string,
    messages: ChatMessage[],
    options: LLMRequestOptions
  ): LLMResponse {
    return { content: `No ${providerName} API key configured for this tenant. Configure credentials in the operator console.`, toolCalls: [], finishReason: "error" };
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
    return {
      content: `I encountered an issue reaching the LLM provider (${errorReason}). Please verify your API key and base URL in the Web Management settings.`,
      toolCalls: [],
      finishReason: "error",
    };
  }

  // The profile Test action: a text request, then a tiny PNG in the provider's own image shape.
  static async probeProfile(provider: string, model: string, apiKey: string | null, baseUrl?: string | null): Promise<{ text: ProbeResult; image: ProbeResult }> {
    const anthropic = provider === "anthropic";
    const send = async (image: boolean): Promise<string | null> => {
      const content = !image ? "Reply with the single word OK." : anthropic
        ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: PROBE_PNG } }, { type: "text", text: "What colour is this image? One word." }]
        : [{ type: "text", text: "What colour is this image? One word." }, { type: "image_url", image_url: { url: `data:image/png;base64,${PROBE_PNG}` } }];
      try {
        const res = await fetch(`${providerBaseUrl(provider, baseUrl)}/${anthropic ? "messages" : "chat/completions"}`, {
          method: "POST", headers: { "Content-Type": "application/json", ...providerHeaders(provider, apiKey) },
          body: JSON.stringify({ model, max_tokens: 64, messages: [{ role: "user", content }] }), signal: AbortSignal.timeout(30000),
        });
        if (res.ok) return null;
        const reason = await res.json().then((d: any) => d?.error?.message, () => null);
        return `${res.status}${typeof reason === "string" && reason ? `: ${reason.slice(0, 200)}` : ""}`;
      } catch { return "the provider could not be reached"; }
    };
    const textError = await send(false);
    if (textError) return { text: { ok: false, message: `Failed (${textError}). Check the model, base URL, and API key.` }, image: { ok: false, message: "Not tried, because text failed." } };
    const imageError = await send(true);
    return { text: { ok: true, message: "Works." }, image: imageError ? { ok: false, message: `Rejected (${imageError}).` } : { ok: true, message: "Accepted." } };
  }

  static async testOpenAI(apiKey: string, baseUrl?: string): Promise<{ success: boolean; message: string; modelCount?: number }> {
    const url = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
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
    const url = (baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
    try {
      const res = await fetch(`${url}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
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
    const url = (baseUrl || "").replace(/\/+$/, "");
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

