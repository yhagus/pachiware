// Provider endpoints and auth headers, free of database imports so the eval's judge can use them in any process.
const DEFAULT_BASE_URLS: Record<string, string> = { openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com/v1" };
export const providerBaseUrl = (provider: string, baseUrl?: string | null) => (baseUrl?.trim() || DEFAULT_BASE_URLS[provider] || "").replace(/\/+$/, "");
export const providerHeaders = (provider: string, key?: string | null): Record<string, string> =>
  !key ? {} : provider === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${key}` };
