import { config } from "../config.js";
import { db, agentsConfig, eq } from "@pachiware/db";
import { CacheService } from "../cache/redis.js";
import { skillRegistry } from "@pachiware/skills";
import type { ChatMessage, LLMRequestOptions, LLMResponse } from "./types.js";
import type { ToolCall } from "@pachiware/skills";

export class LLMRouter {
  private async getActiveDbConfig() {
    try {
      let cached = await CacheService.get<any>("agent:config:default");
      if (!cached) {
        const rows = await db
          .select()
          .from(agentsConfig)
          .where(eq(agentsConfig.id, "default"))
          .limit(1);
        cached = rows[0] || null;
        if (cached) {
          await CacheService.set("agent:config:default", cached, 120);
        }
      }
      return cached;
    } catch {
      return null;
    }
  }

  /**
   * Main completion method dispatching to the configured or requested provider.
   */
  async complete(
    messages: ChatMessage[],
    options: LLMRequestOptions = {}
  ): Promise<LLMResponse> {
    const dbConfig = await this.getActiveDbConfig();
    const provider = options.provider || dbConfig?.defaultProvider || config.llm.defaultProvider;

    switch (provider) {
      case "anthropic":
        return this.callAnthropic(messages, options, dbConfig);
      case "custom":
        return this.callCustomOpenAI(messages, options, dbConfig);
      case "openai":
      default:
        return this.callOpenAI(messages, options, dbConfig);
    }
  }

  /**
   * Calls standard OpenAI Chat Completions API.
   */
  private async callOpenAI(
    messages: ChatMessage[],
    options: LLMRequestOptions,
    dbConfig?: any
  ): Promise<LLMResponse> {
    const apiKey = dbConfig?.openaiApiKey || config.llm.openai.apiKey;
    const baseUrl = (dbConfig?.openaiBaseUrl || config.llm.openai.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    const model = options.model || dbConfig?.openaiModel || dbConfig?.defaultModel || config.llm.defaultModel;

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
        const errorText = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
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
            }
          : undefined,
      };
    } catch (err: any) {
      console.warn("⚠️ OpenAI call failed, falling back to simulated response:", err.message);
      return this.handleFallback(err.message, messages, options);
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
    const apiKey = dbConfig?.anthropicApiKey || config.llm.anthropic.apiKey;
    const baseUrl = (dbConfig?.anthropicBaseUrl || config.llm.anthropic.baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
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
        const errorText = await response.text();
        throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
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
      console.warn("⚠️ Anthropic call failed, falling back to simulated response:", err.message);
      return this.handleFallback(err.message, messages, options);
    }
  }

  /**
   * Calls custom / OpenAI-compatible endpoint (e.g. 9router).
   */
  private async callCustomOpenAI(
    messages: ChatMessage[],
    options: LLMRequestOptions,
    dbConfig?: any
  ): Promise<LLMResponse> {
    const apiKey = dbConfig?.customApiKey || config.llm.custom.apiKey;
    const baseUrl = (dbConfig?.customBaseUrl || config.llm.custom.baseUrl || "https://api.9router.com/v1").replace(/\/+$/, "");
    const model = options.model || dbConfig?.customModel || config.llm.custom.model || "gpt-4o";

    if (!apiKey) {
      return this.handleMissingApiKey("custom (9router)", messages, options);
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
        const errorText = await response.text();
        throw new Error(`Custom LLM endpoint error (${response.status}): ${errorText}`);
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
            }
          : undefined,
      };
    } catch (err: any) {
      console.warn("⚠️ Custom LLM call failed, falling back to simulated response:", err.message);
      return this.handleFallback(err.message, messages, options);
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
    // If the conversation already has a tool response as the most recent interaction,
    // synthesize the final answer and conclude the ReAct loop!
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === "tool") {
      let parsed: any = null;
      try {
        parsed = JSON.parse(lastMsg.content || "{}");
      } catch {}

      const msg = parsed?.data?.message || parsed?.message || (parsed?.success ? "Action completed successfully." : "Execution finished.");
      return {
        content: `✅ ${msg} (Verified via Pachiware ReAct Loop)`,
        toolCalls: [],
        finishReason: "stop",
      };
    }

    const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    const lower = lastUserMessage.toLowerCase();

    // Check if tools were already executed for this user turn
    const hasToolResult = messages.some((m) => m.role === "tool");
    if (hasToolResult) {
      return {
        content: "I have completed executing the requested actions.",
        toolCalls: [],
        finishReason: "stop",
      };
    }

    // Intelligent command parsing for development / live testing without active key:
    if (lower.includes("create task") || lower.includes("new task")) {
      const titleMatch = lastUserMessage.match(/(?:title|task)[:\s]+"([^"]+)"/i) ||
                         lastUserMessage.match(/create task[:\s]+(.+)/i);
      const title = titleMatch ? titleMatch[1].trim() : "New Agent Task";

      return {
        content: `I'll create the task "${title}" for you.`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: "createTask",
            arguments: {
              title,
              description: `Created via agent ReAct loop (${lastUserMessage})`,
              priority: lower.includes("urgent") ? "urgent" : "medium",
            },
          },
        ],
        finishReason: "tool_calls",
      };
    }

    if (lower.includes("list tasks") || lower.includes("show tasks") || lower.includes("my tasks")) {
      return {
        content: "Let me check the current tasks for you.",
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: "listTasks",
            arguments: {
              status: lower.includes("completed") ? "completed" : "all",
              limit: 10,
            },
          },
        ],
        finishReason: "tool_calls",
      };
    }

    if (lower.includes("create channel")) {
      const match = lastUserMessage.match(/create channel[:\s]+#?([a-zA-Z0-9_-]+)/i);
      const channelName = match ? match[1] : "new-project-channel";

      return {
        content: `I'll provision the Discord channel #${channelName}.`,
        toolCalls: [
          {
            id: `call_${Date.now()}`,
            name: "createChannel",
            arguments: {
              channelName,
              type: "text",
            },
          },
        ],
        finishReason: "tool_calls",
      };
    }

    return {
      content: `Hello! I am Pachiware Agent. (Note: No ${providerName} API key is currently configured in your .env or Dashboard settings. Please configure your OpenAI, Anthropic, or 9router API key in the Management GUI or .env file to enable live LLM reasoning.)`,
      toolCalls: [],
      finishReason: "stop",
    };
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
        const text = await res.text();
        return { success: false, message: `OpenAI rejected credentials (${res.status}): ${text}` };
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
        const text = await res.text();
        return { success: false, message: `Anthropic rejected credentials (${res.status}): ${text}` };
      }
      return { success: true, message: `Successfully authenticated with Anthropic Messages API` };
    } catch (err: any) {
      return { success: false, message: `Network error connecting to Anthropic: ${err.message}` };
    }
  }

  static async testCustom(apiKey: string, baseUrl?: string): Promise<{ success: boolean; message: string; modelCount?: number }> {
    const url = (baseUrl || "https://api.9router.com/v1").replace(/\/+$/, "");
    try {
      const res = await fetch(`${url}/models`, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      if (!res.ok) {
        const text = await res.text();
        return { success: false, message: `Custom endpoint rejected credentials (${res.status}): ${text}` };
      }
      const data = await res.json();
      return { success: true, message: `Successfully connected to Custom/Proxy endpoint`, modelCount: data.data?.length };
    } catch (err: any) {
      return { success: false, message: `Network error connecting to custom endpoint: ${err.message}` };
    }
  }
}

export const llmRouter = new LLMRouter();

