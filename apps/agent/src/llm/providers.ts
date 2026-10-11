// Providers, their endpoints and auth headers, free of database imports so the eval's judge can use them in any process.
// apps/web/src/pages/tenant/TenantProfiles.tsx mirrors this list for the console.
export const PROVIDERS = ["openai", "anthropic", "custom"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const isProvider = (v: unknown): v is Provider => PROVIDERS.includes(v as Provider);
export const PROVIDER_ERROR = `provider must be ${PROVIDERS.slice(0, -1).join(", ")}, or ${PROVIDERS.at(-1)}`;

export const DEFAULT_BASE_URLS: Partial<Record<Provider, string>> = { openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com/v1" };
export const DEFAULT_MODELS: Partial<Record<Provider, string>> = { openai: "gpt-4o", anthropic: "claude-sonnet-5-5" };
/** The cheapest current Claude model, for the one-token credentials check. */
export const ANTHROPIC_TEST_MODEL = "claude-haiku-5-5";

export const providerBaseUrl = (provider: string, baseUrl?: string | null) => (baseUrl?.trim() || DEFAULT_BASE_URLS[provider as Provider] || "").replace(/\/+$/, "");
export const providerHeaders = (provider: string, key?: string | null): Record<string, string> =>
  !key ? {} : provider === "anthropic" ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { Authorization: `Bearer ${key}` };
