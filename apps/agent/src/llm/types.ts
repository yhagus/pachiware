import type { ToolDefinition, ToolCall } from "@pachiware/skills";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: MessageRole;
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
  };
}

export interface LLMRequestOptions {
  tenantId: string;
  botId?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  cacheKey?: string;
  tools?: ToolDefinition[];
  provider?: "openai" | "anthropic" | "custom";
}
