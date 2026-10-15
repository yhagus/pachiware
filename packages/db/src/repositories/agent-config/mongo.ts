import type { MongoConnection } from "../../mongo/connection.js";
import type { AgentConfig, AgentConfigRepository } from "./types.js";

// `agents_config` is created with the tenants (tenants/mongo.ts); `_id` is the tenant id, as SQL keys it.
type AgentConfigDoc = AgentConfig & { _id: string };

/** Agent configuration on MongoDB. */
export function createMongoAgentConfigRepository({ db }: MongoConnection): AgentConfigRepository {
  const configs = db.collection<AgentConfigDoc>("agents_config");
  return {
    async get(tenantId) {
      const doc = await configs.findOne({ _id: tenantId });
      return doc ? toAgentConfig(doc) : null;
    },
    async update(tenantId, input) {
      const values = Object.fromEntries(Object.entries(input).filter(([field, value]) => value !== undefined && field !== "tenantId" && field !== "updatedAt"));
      const doc = await configs.findOneAndUpdate({ _id: tenantId }, { $set: { ...values, updatedAt: new Date() } }, { returnDocument: "after" });
      return doc ? toAgentConfig(doc) : null;
    },
  };
}

function toAgentConfig({ _id, ...doc }: AgentConfigDoc): AgentConfig {
  return {
    tenantId: _id, name: doc.name, systemPrompt: doc.systemPrompt, defaultProvider: doc.defaultProvider, defaultModel: doc.defaultModel,
    temperature: doc.temperature, maxTokens: doc.maxTokens,
    openaiApiKeyEncrypted: doc.openaiApiKeyEncrypted ?? null, openaiBaseUrl: doc.openaiBaseUrl ?? null, openaiModel: doc.openaiModel ?? null,
    anthropicApiKeyEncrypted: doc.anthropicApiKeyEncrypted ?? null, anthropicBaseUrl: doc.anthropicBaseUrl ?? null, anthropicModel: doc.anthropicModel ?? null,
    customBaseUrl: doc.customBaseUrl ?? null, customApiKeyEncrypted: doc.customApiKeyEncrypted ?? null, customModel: doc.customModel ?? null,
    timezone: doc.timezone, language: doc.language, settings: doc.settings ?? {}, updatedAt: doc.updatedAt,
  };
}
