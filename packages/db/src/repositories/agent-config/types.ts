/** Domain types and the repository interface for a tenant's agent configuration. Every engine implements it. */

export type AgentLanguage = "id" | "en";

/** The tenant default: its persona, provider keys (kept encrypted), time zone and language. Every tenant has exactly one. */
export type AgentConfig = {
  tenantId: string;
  name: string;
  systemPrompt: string;
  defaultProvider: string;
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  openaiApiKeyEncrypted: string | null;
  openaiBaseUrl: string | null;
  openaiModel: string | null;
  anthropicApiKeyEncrypted: string | null;
  anthropicBaseUrl: string | null;
  anthropicModel: string | null;
  customBaseUrl: string | null;
  customApiKeyEncrypted: string | null;
  customModel: string | null;
  timezone: string;
  language: AgentLanguage;
  settings: Record<string, any>;
  updatedAt: Date;
};

export type AgentConfigUpdate = Partial<Omit<AgentConfig, "tenantId" | "updatedAt">>;

export interface AgentConfigRepository {
  /** The tenant's configuration; null when it has none. */
  get(tenantId: string): Promise<AgentConfig | null>;
  /** Changes the fields given; null when the tenant has no configuration. */
  update(tenantId: string, input: AgentConfigUpdate): Promise<AgentConfig | null>;
}
