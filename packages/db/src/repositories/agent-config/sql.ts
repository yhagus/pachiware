import { eq } from "drizzle-orm";
import type { SqlConnection } from "../../connection.js";
import type { AgentConfig, AgentConfigRepository } from "./types.js";

/** Agent configuration on SQLite and PostgreSQL. */
export function createSqlAgentConfigRepository({ db, tables: t }: SqlConnection): AgentConfigRepository {
  return {
    async get(tenantId) {
      const [row] = await db.select().from(t.agentsConfig).where(eq(t.agentsConfig.tenantId, tenantId)).limit(1);
      return row ? toAgentConfig(row) : null;
    },
    async update(tenantId, input) {
      const values = Object.fromEntries(Object.entries(input).filter(([field, value]) => value !== undefined && field !== "tenantId" && field !== "updatedAt"));
      const [row] = await db.update(t.agentsConfig).set({ ...values, updatedAt: new Date() }).where(eq(t.agentsConfig.tenantId, tenantId)).returning();
      return row ? toAgentConfig(row) : null;
    },
  };
}

function toAgentConfig(row: any): AgentConfig {
  return {
    tenantId: row.tenantId, name: row.name, systemPrompt: row.systemPrompt, defaultProvider: row.defaultProvider, defaultModel: row.defaultModel,
    temperature: row.temperature, maxTokens: row.maxTokens,
    openaiApiKeyEncrypted: row.openaiApiKeyEncrypted ?? null, openaiBaseUrl: row.openaiBaseUrl ?? null, openaiModel: row.openaiModel ?? null,
    anthropicApiKeyEncrypted: row.anthropicApiKeyEncrypted ?? null, anthropicBaseUrl: row.anthropicBaseUrl ?? null, anthropicModel: row.anthropicModel ?? null,
    customBaseUrl: row.customBaseUrl ?? null, customApiKeyEncrypted: row.customApiKeyEncrypted ?? null, customModel: row.customModel ?? null,
    timezone: row.timezone, language: row.language, settings: row.settings ?? {}, updatedAt: row.updatedAt,
  };
}
