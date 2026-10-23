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
/** How many model calls one turn may make when the tenant set no other number; Discord, the web chat and the loop share it. */
export const DEFAULT_REACT_ITERATIONS = 32;
/** Hours with no turn in a conversation after which the next message there starts a fresh one; `settings.conversationIdleHours` overrides it, 0 for never. */
export const DEFAULT_CONVERSATION_IDLE_HOURS = 24;
/** Seconds a worked-on Changelog draft waits before running a turn that could not reach the model once more; `settings.modelRetryWaitSeconds` overrides it, 0 to pause at once. */
export const DEFAULT_MODEL_RETRY_WAIT_SECONDS = 60;

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
    settings: { maxReActIterations: DEFAULT_REACT_ITERATIONS },
    updatedAt: now,
  };
}

export interface AgentConfigRepository {
  /** The tenant's configuration; null when it has none. */
  get(tenantId: string): Promise<AgentConfig | null>;
  /** Changes the fields given; null when the tenant has no configuration. */
  update(tenantId: string, input: AgentConfigUpdate): Promise<AgentConfig | null>;
}
