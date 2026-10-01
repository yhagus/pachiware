const BASE_URL = import.meta.env.VITE_API_URL || "";

async function fetchJSON<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

export interface HealthResponse {
  status: string;
  uptimeSeconds: number;
  services: {
    database: string;
    redis: string;
    discord: {
      connected: boolean;
      botTag: string | null;
      botId: string | null;
      guildCount: number;
    };
  };
}

export interface AgentConfigData {
  id: string;
  name: string;
  systemPrompt: string;
  defaultProvider: "openai" | "anthropic" | "custom";
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  openaiApiKey?: string | null;
  openaiBaseUrl?: string | null;
  openaiModel?: string | null;
  anthropicApiKey?: string | null;
  anthropicBaseUrl?: string | null;
  anthropicModel?: string | null;
  customBaseUrl?: string | null;
  customApiKey?: string | null;
  customModel?: string | null;
  discordBotToken?: string | null;
  discordClientId?: string | null;
  discordGuildId?: string | null;
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
    fetchJSON<{ success: boolean; config: AgentConfigData }>("/api/agent/config"),

  updateAgentConfig: (data: Partial<AgentConfigData>) =>
    fetchJSON<{ success: boolean; message: string; config: AgentConfigData }>("/api/agent/config", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  getSkills: () => fetchJSON<{ success: boolean; skills: SkillItem[] }>("/api/skills"),

  toggleSkill: (id: string) =>
    fetchJSON<{ success: boolean; message: string; skill: SkillItem }>(`/api/skills/${id}/toggle`, {
      method: "PATCH",
    }),

  testTool: (toolName: string, args: Record<string, any>) =>
    fetchJSON<{ success: boolean; result: any }>("/api/skills/test", {
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
    }>(`/api/tasks${qs ? `?${qs}` : ""}`);
  },

  createTask: (data: Partial<TaskItem>) =>
    fetchJSON<{ success: boolean; task: TaskItem }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateTask: (id: string, data: Partial<TaskItem>) =>
    fetchJSON<{ success: boolean; task: TaskItem }>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteTask: (id: string) =>
    fetchJSON<{ success: boolean; message: string }>(`/api/tasks/${id}`, {
      method: "DELETE",
    }),

  sendChat: (message: string, conversationId?: string) =>
    fetchJSON<ChatResponse>("/api/agent/chat", {
      method: "POST",
      body: JSON.stringify({ message, conversationId }),
    }),

  testLLM: (data: { provider: string; apiKey?: string; baseUrl?: string }) =>
    fetchJSON<{ success: boolean; message: string; modelCount?: number }>("/api/agent/test/llm", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  testDiscord: (data: { token?: string }) =>
    fetchJSON<{ success: boolean; botTag?: string; botId?: string; error?: string }>("/api/agent/test/discord", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  restartDiscord: () =>
    fetchJSON<{ success: boolean; message: string }>("/api/agent/discord/restart", {
      method: "POST",
    }),

  getInfrastructure: () =>
    fetchJSON<{ success: boolean; infrastructure: InfrastructureData }>("/api/agent/infrastructure"),

  updateInfrastructure: (data: { databaseUrl?: string; redisUrl?: string }) =>
    fetchJSON<{ success: boolean; message: string; infrastructure: InfrastructureData }>("/api/agent/infrastructure", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  testPostgres: (data: { databaseUrl?: string }) =>
    fetchJSON<{ success: boolean; message: string; latencyMs?: number }>("/api/agent/infrastructure/test-db", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  testRedis: () =>
    fetchJSON<{ success: boolean; message: string; latencyMs?: number }>("/api/agent/infrastructure/test-redis", {
      method: "POST",
    }),
};

