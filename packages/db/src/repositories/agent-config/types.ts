/** Domain types and the repository interface for a tenant's agent configuration. Every engine implements it. */
import { DEFAULT_SYSTEM_PROMPT } from "../../persona.js";

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

/** The configuration a new tenant starts with, on every engine. */
export function defaultAgentConfig(tenantId: string, now: Date): AgentConfig {
  return {
    tenantId,
    name: "Pachiware Agent",
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    defaultProvider: "openai",
    defaultModel: "gpt-4o",
    temperature: 0.2,
    maxTokens: 4096,
    openaiApiKeyEncrypted: null,
    openaiBaseUrl: null,
    openaiModel: null,
    anthropicApiKeyEncrypted: null,
    anthropicBaseUrl: null,
    anthropicModel: null,
    customBaseUrl: null,
    customApiKeyEncrypted: null,
    customModel: null,
    timezone: "Asia/Jakarta",
    language: "id",
    settings: { maxReActIterations: 32 },
    updatedAt: now,
  };
}

export interface AgentConfigRepository {
  /** The tenant's configuration; null when it has none. */
  get(tenantId: string): Promise<AgentConfig | null>;
  /** Changes the fields given; null when the tenant has no configuration. */
  update(tenantId: string, input: AgentConfigUpdate): Promise<AgentConfig | null>;
}
