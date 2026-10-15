/** Domain types and the repository interface for usage events. Every engine implements it. */

/** One metered thing a tenant did: tokens of an LLM call, a tool call, a Discord message, a guardrail decision. */
export type UsageEvent = {
  id: string;
  tenantId: string;
  botId: string | null;
  type: string;
  provider: string | null;
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  metadata: Record<string, any>;
  createdAt: Date;
};

export type NewUsageEvent = {
  tenantId: string;
  botId?: string | null;
  type: string;
  provider?: string | null;
  model?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  metadata?: Record<string, any>;
};

/** Events of one tenant, type, provider and model added up. `cachedTokens` sums each event's `metadata.cachedTokens`. */
export type UsageTotal = {
  tenantId: string;
  type: string;
  provider: string | null;
  model: string | null;
  events: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
};

export interface UsageRepository {
  record(event: NewUsageEvent): Promise<void>;
  /** Events, oldest first, of one tenant and of one type when given. */
  list(filter?: { tenantId?: string; type?: string }): Promise<UsageEvent[]>;
  /** Totals per tenant, type, provider and model, of events created within `from` and `to` (both inclusive) when given. */
  totals(filter?: { tenantId?: string; from?: Date; to?: Date }): Promise<UsageTotal[]>;
}
