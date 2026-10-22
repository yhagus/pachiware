// Providers, their endpoints and auth headers, free of database imports so the eval's judge can use them in any process.
// apps/web/src/pages/tenant/TenantProfiles.tsx mirrors this list for the console.
/** A Profile's providers. Only BYOK (`custom`) names its own address and API format; the others are fixed. */
export const PROVIDERS = ["openai", "anthropic", "deepseek", "custom"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const isProvider = (v: unknown): v is Provider => PROVIDERS.includes(v as Provider);
export const PROVIDER_ERROR = `provider must be ${PROVIDERS.slice(0, -1).join(", ")}, or ${PROVIDERS.at(-1)}`;
/** The providers a tenant default may name: it keeps a key and address for each, and none for DeepSeek. */
export const DEFAULT_PROVIDERS = ["openai", "anthropic", "custom"] as const;
export const isDefaultProvider = (v: unknown): v is (typeof DEFAULT_PROVIDERS)[number] => DEFAULT_PROVIDERS.includes(v as any);

export const DEFAULT_BASE_URLS: Partial<Record<Provider, string>> = { openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com/v1", deepseek: "https://api.deepseek.com" };
export const DEFAULT_MODELS: Partial<Record<Provider, string>> = { openai: "gpt-4o", anthropic: "claude-sonnet-5-5", deepseek: "deepseek-flash" };
/** The most models one Profile holds: the one it answers with and two fallbacks, each asked when the one before fails. */
export const MAX_PROFILE_MODELS = 3;
/** The cheapest current Claude model, for the one-token credentials check. */
export const ANTHROPIC_TEST_MODEL = "claude-haiku-5-5";

/** The request shape a BYOK profile speaks. An OpenAI or DeepSeek profile always uses Chat Completions and an Anthropic one Messages. */
export const API_FORMATS = ["chat_completions", "responses", "messages"] as const;
export type ApiFormat = (typeof API_FORMATS)[number];
export const isApiFormat = (v: unknown): v is ApiFormat => API_FORMATS.includes(v as ApiFormat);
export const API_FORMAT_ERROR = "apiFormat must be chat_completions, responses, or messages";
export const API_FORMAT_NAMES: Record<ApiFormat, string> = { chat_completions: "Chat Completions", responses: "Responses", messages: "Messages" };
export const API_FORMAT_PATHS: Record<ApiFormat, string> = { chat_completions: "chat/completions", responses: "responses", messages: "messages" };
export const apiFormatOf = (provider: string, format?: string | null): ApiFormat =>
  provider === "anthropic" ? "messages" : provider === "custom" && isApiFormat(format) ? format : "chat_completions";

/** The reasoning efforts the console names; a provider's other words (xhigh, max, minimal…) go in as typed (#344). */
export const REASONING_EFFORTS = ["low", "medium", "high"] as const;
/** One word, as providers name their efforts; null or empty sends none, the provider's own default. */
export const isReasoningEffort = (v: unknown): v is string | null => v === null || v === "" || (typeof v === "string" && /^[A-Za-z0-9_.-]{1,32}$/.test(v.trim()));
export const REASONING_EFFORT_ERROR = "reasoningEffort must be one word, such as low, medium or high, or null for the provider's default";
/** The request fields that carry a reasoning effort in an API format: none when it is unset. */
export const effortFields = (format: ApiFormat, effort?: string | null): Record<string, unknown> =>
  !effort ? {} : format === "messages" ? { output_config: { effort } } : format === "responses" ? { reasoning: { effort } } : { reasoning_effort: effort };

export const providerBaseUrl = (provider: string, baseUrl?: string | null) => (baseUrl?.trim() || DEFAULT_BASE_URLS[provider as Provider] || "").replace(/\/+$/, "");
export const providerHeaders = (provider: string, key?: string | null): Record<string, string> =>
  !key ? {} : provider === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${key}` };
/** A BYOK Messages server gets both header styles, because Anthropic-compatible proxies differ on which one they read. */
export const formatHeaders = (provider: string, format: ApiFormat, key?: string | null): Record<string, string> =>
  provider === "custom" && format === "messages" ? { ...providerHeaders("anthropic", key), ...providerHeaders("custom", key) } : providerHeaders(provider, key);
