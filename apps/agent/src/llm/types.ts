import type { ToolDefinition, ToolCall, Language } from "@pachiware/skills";

export type MessageRole = "system" | "user" | "assistant" | "tool";

/** Image bytes travel only in the user turn they arrived with; stored history keeps a text placeholder. */
export type ImagePart = { type: "image"; mediaType: string; data: string };
export type ContentPart = { type: "text"; text: string } | ImagePart;

export interface ChatMessage {
  role: MessageRole;
  content: string | ContentPart[] | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  httpStatus?: number;
  /** The provider refused the request's images, and this answer came from a retry without them. */
  imagesRejected?: boolean;
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
  /** The least output a call may be given, above the tenant's own limit, which it never lowers: a long playbook writes whole documents in one tool call. */
  minOutputTokens?: number;
  cacheKey?: string;
  /** The index of the last stored-history message: on Anthropic its last block carries a cache breakpoint, so the history is cached with the prefix. */
  historyEnd?: number;
  tools?: ToolDefinition[];
  /** "none" offers the tools but forbids calling them, so the request keeps the cached prefix of one that may. */
  toolChoice?: "none";
  provider?: "openai" | "anthropic" | "custom";
  /** The configured language of the place, for a fallback answer when the provider fails; the tenant's when absent. */
  language?: Language;
  /** When the turn must stop (epoch ms): no attempt, retry or fallback Profile starts past it, and the last attempt is cut at it. */
  deadline?: number;
}
