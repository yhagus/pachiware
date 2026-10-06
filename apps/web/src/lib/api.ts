const BASE_URL = import.meta.env.VITE_API_URL || "";

export function getPlatformKey(): string { return sessionStorage.getItem("pachiware.platformKey") || ""; }
export function setPlatformKey(key: string) {
  sessionStorage.setItem("pachiware.platformKey", key.trim());
  window.dispatchEvent(new Event("pachiware:credentials"));
}
export function clearPlatformKey() { setPlatformKey(""); }

/** On localhost the Vite dev plugin hands out the platform key automatically. */
export async function connectLocalConsole(): Promise<void> {
  if (getPlatformKey() || !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return;
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await fetch("/api/console/session", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 503) { await new Promise((r) => setTimeout(r, 500)); continue; }
      if (!response.ok) return;
      const session = await response.json();
      if (typeof session.platformKey === "string") setPlatformKey(session.platformKey);
      return;
    }
  } catch {
    // Manual key entry remains available.
  }
}

async function fetchJSON<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "application/json");
  if (endpoint.startsWith("/api/admin/")) headers.set("X-Platform-Key", getPlatformKey());
  const response = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }
  return response.json();
}
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export interface HealthResponse {
  status: string;
  setupRequired?: boolean;
  hasTenants?: boolean;
  hasEncryptionKey?: boolean;
  uptimeSeconds: number;
  memory?: { rss: number; heapUsed: number };
  services: {
    database: string;
    databaseDialect?: string;
    redis: string;
    discord: { connected: boolean; botTag: string | null; botId: string; tenantId: string; guildCount: number }[];
  };
}
export interface Stats {
  tenants: number; bots: number;
  storage: { dbBytes: number | null; cacheBytes: number | null };
  system: {
    cpu: { percent: number; cores: number };
    memory: { used: number; total: number };
    disk: { used: number; total: number };
    diskIo: { readBps: number; writeBps: number } | null;
  };
}
export interface InfrastructureData {
  databaseUrl: string; rawDatabaseUrl?: string; databaseDialect?: string; redisUrl: string; rawRedisUrl?: string; isFromRuntimeStore?: boolean; updatedAt?: string;
}
export interface ApiKey { id: string; name: string; keyPrefix: string; tenantCount: number; lastUsedAt: string | null; revokedAt: string | null; createdAt: string; }
export interface Tenant { id: string; name: string; slug: string; status: string; apiKeyId: string | null; createdAt?: string; }
export interface Bot { id: string; tenantId: string; name: string; platform: string; clientId: string | null; guildIds: string[]; profileId: string | null; isEnabled: boolean; hasToken: boolean; connectionStatus: string; lastError: string | null; lastConnectedAt: string | null; }
export interface GuildChannel { id: string; name: string; type: "text" | "voice" | "announcement" | "stage" | "forum"; category: string | null; }
export interface Guild { id: string; name: string; icon: string | null; memberCount: number; allowed: boolean; channels: GuildChannel[]; }
export interface GuildConfig { systemPrompt: string; useThreads: boolean; alwaysChannelIds: string[]; }
export interface Conversation { id: string; channelId: string | null; userId: string | null; createdAt: string; lastMessageAt: string | null; messageCount: number; }
export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; createdAt: string; }
export interface Profile { id: string; tenantId: string; name: string; provider: "openai" | "custom"; model: string; baseUrl: string | null; hasApiKey: boolean; createdAt: string; }
export interface ProfileInput { name?: string; provider?: string; model?: string; baseUrl?: string | null; apiKey?: string | null; }
export interface BotInput { profileId?: string | null; name?: string; platform?: string; token?: string; clientId?: string; guildIds?: string[]; isEnabled?: boolean; }

export const api = {
  getHealth: () => fetchJSON<HealthResponse>("/api/health"),
  getStats: () => fetchJSON<Stats>("/api/admin/stats"),
  getInfrastructure: () => fetchJSON<{ infrastructure: InfrastructureData }>("/api/admin/infrastructure"),
  updateInfrastructure: (data: { databaseUrl?: string }) => fetchJSON<{ message: string }>("/api/admin/infrastructure", json("PUT", data)),
  testPostgres: (data: { databaseUrl?: string }) => fetchJSON<{ success: boolean; message: string }>("/api/admin/infrastructure/test-db", json("POST", data)),

  listTenants: () => fetchJSON<{ tenants: Tenant[] }>("/api/admin/tenants"),
  getTenant: (id: string) => fetchJSON<{ tenant: Tenant }>(`/api/admin/tenants/${id}`),
  createTenant: (name: string, slug?: string, apiKeyId?: string) => fetchJSON<{ tenant: Tenant }>("/api/admin/tenants", json("POST", { name, slug: slug || undefined, apiKeyId: apiKeyId || undefined })),
  updateTenant: (id: string, data: { name?: string; status?: "active" | "suspended" }) => fetchJSON<{ tenant: Tenant }>(`/api/admin/tenants/${id}`, json("PATCH", data)),

  listApiKeys: () => fetchJSON<{ apiKeys: ApiKey[] }>("/api/admin/api-keys"),
  createApiKey: (name: string) => fetchJSON<{ raw: string; keyId: string }>("/api/admin/api-keys", json("POST", { name })),
  revokeApiKey: (id: string) => fetchJSON<{ success: boolean }>(`/api/admin/api-keys/${id}`, json("DELETE")),
  listBots: (tenantId: string, p: { page: number; pageSize: number; q?: string; platform?: string }) =>
    fetchJSON<{ bots: Bot[]; total: number; page: number; pageSize: number }>(`/api/admin/tenants/${tenantId}/bots?${new URLSearchParams({ page: String(p.page), pageSize: String(p.pageSize), ...(p.q ? { q: p.q } : {}), ...(p.platform ? { platform: p.platform } : {}) })}`),
  createBot: (tenantId: string, data: BotInput) => fetchJSON<{ bot: Bot }>(`/api/admin/tenants/${tenantId}/bots`, json("POST", data)),
  listProfiles: (tenantId: string) => fetchJSON<{ profiles: Profile[] }>(`/api/admin/tenants/${tenantId}/profiles`),
  createProfile: (tenantId: string, data: ProfileInput) => fetchJSON<{ profile: Profile }>(`/api/admin/tenants/${tenantId}/profiles`, json("POST", data)),
  listProfileModels: (data: { provider: string; baseUrl?: string; apiKey?: string; profileId?: string }) => fetchJSON<{ models: string[] }>("/api/admin/profiles/models", json("POST", data)),
  updateProfile: (id: string, data: ProfileInput) => fetchJSON<{ profile: Profile }>(`/api/admin/profiles/${id}`, json("PATCH", data)),
  deleteProfile: (id: string) => fetchJSON<{ success: boolean }>(`/api/admin/profiles/${id}`, json("DELETE")),
  getBot: (id: string) => fetchJSON<{ bot: Bot }>(`/api/admin/bots/${id}`),
  getBotGuilds: (id: string) => fetchJSON<{ connected: boolean; guilds: Guild[] }>(`/api/admin/bots/${id}/guilds`),
  getGuildConfig: (id: string, guildId: string) => fetchJSON<{ config: GuildConfig }>(`/api/admin/bots/${id}/guilds/${guildId}/config`),
  saveGuildConfig: (id: string, guildId: string, data: Partial<GuildConfig>) => fetchJSON<{ config: GuildConfig }>(`/api/admin/bots/${id}/guilds/${guildId}/config`, json("PUT", data)),
  listBotConversations: (id: string, channelId: string) => fetchJSON<{ conversations: Conversation[] }>(`/api/admin/bots/${id}/conversations?channelId=${encodeURIComponent(channelId)}`),
  getBotConversationMessages: (id: string, conversationId: string) => fetchJSON<{ messages: ChatMessage[] }>(`/api/admin/bots/${id}/conversations/${conversationId}/messages`),
  updateBot: (id: string, data: BotInput) => fetchJSON<{ bot: Bot }>(`/api/admin/bots/${id}`, json("PATCH", data)),
  restartBot: (id: string) => fetchJSON<{ success: boolean; message?: string; error?: string }>(`/api/admin/bots/${id}/restart`, json("POST")),
  deleteBot: (id: string) => fetchJSON<{ success: boolean }>(`/api/admin/bots/${id}`, json("DELETE")),
};
