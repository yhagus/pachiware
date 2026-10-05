const BASE_URL = import.meta.env.VITE_API_URL || "";

export function getApiKey(): string { return localStorage.getItem("pachiware.apiKey") || import.meta.env.VITE_PACHIWARE_API_KEY || ""; }
export function getPlatformKey(): string { return sessionStorage.getItem("pachiware.platformKey") || ""; }
export function setCredentials(apiKey: string, platformKey: string) {
  localStorage.setItem("pachiware.apiKey", apiKey.trim());
  sessionStorage.setItem("pachiware.platformKey", platformKey.trim());
  window.dispatchEvent(new Event("pachiware:credentials"));
}

export async function connectLocalConsole(): Promise<void> {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return;
  try {
    if (getApiKey()) {
      const current = await fetch(`${BASE_URL}/api/v1/config`, { headers: { Authorization: `Bearer ${getApiKey()}` }, cache: "no-store" });
      if (current.status !== 401) return;
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await fetch("/api/console/session", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 503) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      if (!response.ok) return;
      const session = await response.json();
      if (typeof session.apiKey === "string" && typeof session.platformKey === "string") setCredentials(session.apiKey, session.platformKey);
      return;
    }
  } catch {
    // Manual credential entry remains available when CLI setup is absent.
  }
}
async function fetchJSON<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set("Content-Type", "application/json");
  if (endpoint.startsWith("/api/v1/")) headers.set("Authorization", `Bearer ${getApiKey()}`);
  if (endpoint.startsWith("/api/admin/")) headers.set("X-Platform-Key", getPlatformKey());
  const response = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }
  return response.json();
}

export interface HealthResponse {
  status: string;
  setupRequired?: boolean;
  hasTenants?: boolean;
  uptimeSeconds: number;
  services: {
    database: string;
    redis: string;
    discord: { connected: boolean; botTag: string | null; botId: string; tenantId: string; guildCount: number }[];
  };
}

export interface AgentConfigData {
  tenantId: string;
  name: string;
  systemPrompt: string;
  defaultProvider: "openai" | "anthropic" | "custom";
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  openaiApiKeyEncrypted?: string | null;
  openaiBaseUrl?: string | null;
  openaiModel?: string | null;
  anthropicApiKeyEncrypted?: string | null;
  anthropicBaseUrl?: string | null;
  anthropicModel?: string | null;
  customBaseUrl?: string | null;
  customApiKeyEncrypted?: string | null;
  customModel?: string | null;
  settings?: Record<string, any>;
  updatedAt: string;
}

export interface InfrastructureData {
  databaseUrl: string;
  rawDatabaseUrl?: string;
  redisUrl: string;
  rawRedisUrl?: string;
  isFromRuntimeStore?: boolean;
  updatedAt?: string;
  notice?: string;
}

export interface SkillItem {
  id: string;
  name: string;
  description: string;
  isEnabled: boolean;
  handlerType: string;
  toolCount: number;
  tools: any[];
  config: Record<string, any>;
  updatedAt: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string | null;
  status: "pending" | "in_progress" | "completed";
  priority: "low" | "medium" | "high" | "urgent";
  assignedTo: string | null;
  discordChannelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatResponse {
  success: boolean;
  reply: string;
  conversationId: string;
  iterations: number;
  toolsExecuted: { call: any; result: any }[];
  steps: { type: "thought" | "tool_call" | "tool_result"; payload: any }[];
}

export const api = {
  getHealth: () => fetchJSON<HealthResponse>("/api/health"),

  getAgentConfig: () =>
    fetchJSON<{ success: boolean; config: AgentConfigData }>("/api/v1/config"),

  updateAgentConfig: (data: Partial<AgentConfigData>) =>
    fetchJSON<{ success: boolean; message: string; config: AgentConfigData }>("/api/v1/config", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getSkills: () => fetchJSON<{ success: boolean; skills: SkillItem[] }>("/api/v1/skills"),

  toggleSkill: (id: string) =>
    fetchJSON<{ success: boolean; message: string; skill: SkillItem }>(`/api/v1/skills/${id}/toggle`, {
      method: "PATCH",
    }),

  testTool: (toolName: string, args: Record<string, any>) =>
    fetchJSON<{ success: boolean; result: any }>("/api/v1/skills/test", {
      method: "POST",
      body: JSON.stringify({ toolName, arguments: args }),
    }),

  getTasks: (params?: { status?: string; priority?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.priority) query.set("priority", params.priority);
    if (params?.search) query.set("search", params.search);
    const qs = query.toString();
    return fetchJSON<{
      success: boolean;
      counts: { total: number; pending: number; in_progress: number; completed: number };
      tasks: TaskItem[];
    }>(`/api/v1/tasks${qs ? `?${qs}` : ""}`);
  },

  createTask: (data: Partial<TaskItem>) =>
    fetchJSON<{ success: boolean; task: TaskItem }>("/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateTask: (id: string, data: Partial<TaskItem>) =>
    fetchJSON<{ success: boolean; task: TaskItem }>(`/api/v1/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteTask: (id: string) =>
    fetchJSON<{ success: boolean; message: string }>(`/api/v1/tasks/${id}`, {
      method: "DELETE",
    }),

  sendChat: (message: string, conversationId?: string) =>
    fetchJSON<ChatResponse>("/api/v1/chat", {
      method: "POST",
      body: JSON.stringify({ message, conversationId }),
    }),

  testLLM: (data: { provider: string; apiKey?: string; baseUrl?: string }) =>
    fetchJSON<{ success: boolean; message: string; modelCount?: number }>("/api/v1/config/test/llm", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getBots: () => fetchJSON<{ success: boolean; bots: Bot[] }>("/api/v1/bots"),
  createBot: (data: BotInput) => fetchJSON<{ success: boolean; bot: Bot }>("/api/v1/bots", { method: "POST", body: JSON.stringify(data) }),
  updateBot: (id: string, data: Partial<BotInput>) => fetchJSON<{ success: boolean; bot: Bot }>(`/api/v1/bots/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteBot: (id: string) => fetchJSON<{ success: boolean }>(`/api/v1/bots/${id}`, { method: "DELETE" }),
  testBot: (id: string) => fetchJSON<{ success: boolean; botTag?: string; error?: string }>(`/api/v1/bots/${id}/test`, { method: "POST", body: "{}" }),
  restartBot: (id: string) => fetchJSON<{ success: boolean; message: string }>(`/api/v1/bots/${id}/restart`, { method: "POST" }),
  listTenants: () => fetchJSON<{ tenants: { id: string; name: string; slug: string }[] }>("/api/admin/tenants"),
  createTenant: (name: string, slug?: string) => fetchJSON<{ tenant: { id: string } }>("/api/admin/tenants", { method: "POST", body: JSON.stringify({ name, slug }) }),
  issueApiKey: (id: string) => fetchJSON<{ raw: string; keyPrefix: string }>(`/api/admin/tenants/${id}/api-keys`, { method: "POST", body: JSON.stringify({ name: "Operator console" }) }),

  getInfrastructure: () =>
    fetchJSON<{ success: boolean; infrastructure: InfrastructureData }>("/api/admin/infrastructure"),

  updateInfrastructure: (data: { databaseUrl?: string; redisUrl?: string }) =>
    fetchJSON<{ success: boolean; message: string; infrastructure: InfrastructureData }>("/api/admin/infrastructure", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  testPostgres: (data: { databaseUrl?: string }) =>
    fetchJSON<{ success: boolean; message: string; latencyMs?: number }>("/api/admin/infrastructure/test-db", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  testRedis: () =>
    fetchJSON<{ success: boolean; message: string; latencyMs?: number }>("/api/admin/infrastructure/test-redis", {
      method: "POST",
    }),
};


export interface Bot { id: string; tenantId: string; name: string; platform: string; clientId: string | null; guildIds: string[]; isEnabled: boolean; hasToken: boolean; connectionStatus: string; lastError: string | null; lastConnectedAt: string | null; }
export interface BotInput { name?: string; token: string; clientId?: string; guildIds?: string[]; isEnabled?: boolean; }
