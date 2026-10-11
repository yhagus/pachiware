import { cachedTokensOf } from "./usage.js";
import { db, agentsConfig, bots, profiles, usageEvents, decryptSecret, eq, and } from "@pachiware/db";
import { CacheService, tenantKey } from "../cache/redis.js";
import { skillRegistry } from "@pachiware/skills";
import type { ChatMessage, LLMRequestOptions, LLMResponse } from "./types.js";
import type { ToolCall } from "@pachiware/skills";

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
      if (!["openai", "custom"].includes(profile.provider)) throw new Error("Unsupported profile provider");
      const key = profile.apiKeyEncrypted ? decryptSecret(profile.apiKeyEncrypted) : null;
      dbConfig = { ...dbConfig, defaultProvider: profile.provider, defaultModel: profile.model, [`${profile.provider}ApiKey`]: key, [`${profile.provider}BaseUrl`]: profile.baseUrl, [`${profile.provider}Model`]: profile.model };
    }
    const provider = options.provider || dbConfig.defaultProvider;
    const resolved = { ...options, temperature: options.temperature ?? dbConfig.temperature, maxTokens: options.maxTokens ?? dbConfig.maxTokens };
    let response: LLMResponse;
    switch (provider) {
      case "anthropic": response = await this.callAnthropic(messages, resolved, dbConfig); break;
      case "custom": response = await this.callCustomOpenAI(messages, resolved, dbConfig); break;
      case "openai": response = await this.callOpenAI(messages, resolved, dbConfig); break;
      default: throw new Error("Unsupported tenant LLM provider");
    }
    if (response.finishReason !== "error") {
      await db.insert(usageEvents).values({ tenantId: options.tenantId, botId: options.botId || null, type: "llm_tokens", provider, model: options.model || dbConfig[`${provider}Model`] || dbConfig.defaultModel, promptTokens: response.usage?.promptTokens || 0, completionTokens: response.usage?.completionTokens || 0, metadata: { cachedTokens: response.usage?.cachedTokens || 0 } });
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
          content: m.content || "",
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
        content: m.content || "",
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

      if (!response.ok) {
        throw new Error(`OpenAI API error (${response.status}): provider request rejected`);
      }

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
    const model = options.model || dbConfig?.anthropicModel || "claude-3-5-sonnet-20241022";

    if (!apiKey) {
      return this.handleMissingApiKey("anthropic", messages, options);
    }

    let systemPrompt = "";
    const anthropicMessages: any[] = [];

    for (const m of messages) {
      if (m.role === "system") {
        systemPrompt += (m.content || "") + "\n\n";
      } else if (m.role === "tool") {
        anthropicMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.toolCallId,
              content: m.content || "",
            },
          ],
        });
      } else if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const contentBlocks: any[] = [];
        if (m.content) {
          contentBlocks.push({ type: "text", text: m.content });
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
      } else {
        anthropicMessages.push({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content || "",
        });
      }
    }

    const body: any = {
      model,
      system: systemPrompt.trim() || undefined,
      messages: anthropicMessages,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.7,
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

      if (!response.ok) {
        throw new Error(`Anthropic API error (${response.status}): provider request rejected`);
      }

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
          content: m.content || "",
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
        content: m.content || "",
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

      if (!response.ok) {
        throw new Error(`Custom LLM endpoint error (${response.status}): provider request rejected`);
      }

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

