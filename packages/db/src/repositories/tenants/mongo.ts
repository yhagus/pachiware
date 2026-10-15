import { randomUUID } from "node:crypto";
import type { ClientSession, Db, Filter } from "mongodb";
import { generateApiKey, hashApiKey } from "../../crypto.js";
import { DEFAULT_SYSTEM_PROMPT } from "../../persona.js";
import { dataCollections, ensureCollection, inTransaction, type MongoConnection, type MongoMigration } from "../../mongo/connection.js";
import type { ApiKey, Tenant, TenantRepository, TenantStatus } from "./types.js";

// Collections mirror the SQL tables and keep their names; fields keep the camelCase names of the domain types.
// `_id` holds the UUID string the SQL engines use, and every document a tenant owns carries its `tenantId`.
type TenantDoc = Omit<Tenant, "id"> & { _id: string };
type ApiKeyDoc = Omit<ApiKey, "id"> & { _id: string; keyHash: string };
type SkillDoc = { _id: string; defaultEnabled: boolean; config: Record<string, any> };

export const tenantMigrations: MongoMigration[] = [
  {
    id: "0001-tenants-and-api-keys",
    async up(db) {
      const tenants = await ensureCollection(db, "tenants");
      await tenants.createIndex({ slug: 1 }, { unique: true, name: "tenants_slug_unique" });
      await tenants.createIndex({ apiKeyId: 1 }, { name: "tenants_api_key_idx" });
      const keys = await ensureCollection(db, "api_keys");
      await keys.createIndex({ keyHash: 1 }, { unique: true, name: "api_keys_hash_unique" });
      // A tenant's defaults: its agent configuration (`_id` is the tenant id, as SQL keys it) and skill switches.
      const config = await ensureCollection(db, "agents_config");
      await config.createIndex({ tenantId: 1 }, { unique: true, name: "agents_config_tenant_unique" });
      const switches = await ensureCollection(db, "tenant_skills");
      await switches.createIndex({ tenantId: 1, skillId: 1 }, { unique: true, name: "tenant_skills_unique" });
      await ensureCollection(db, "skills");
    },
  },
];

const STATUSES: TenantStatus[] = ["active", "suspended", "deleted"];
const live = { status: { $ne: "deleted" as const } };

/** Tenants and API keys on MongoDB. */
export function createMongoTenantRepository(connection: MongoConnection): TenantRepository {
  const { db } = connection;
  const tenants = db.collection<TenantDoc>("tenants");
  const keys = db.collection<ApiKeyDoc>("api_keys");
  const one = async (filter: Filter<TenantDoc>) => {
    const doc = await tenants.findOne({ ...filter, ...live });
    return doc ? toTenant(doc) : null;
  };
  const many = async (filter: Filter<TenantDoc> = {}) => (await tenants.find({ ...filter, ...live }).sort({ createdAt: 1, _id: 1 }).limit(1000).toArray()).map(toTenant);
  const change = async (id: string, values: Partial<TenantDoc>) => {
    const doc = await tenants.findOneAndUpdate({ _id: id, ...live }, { $set: { ...values, updatedAt: new Date() } }, { returnDocument: "after" });
    return doc ? toTenant(doc) : null;
  };

  return {
    async create(input) {
      const now = new Date();
      const doc: TenantDoc = { _id: randomUUID(), name: input.name, slug: input.slug || randomUUID(), apiKeyId: input.apiKeyId ?? null, status: "active", platformMetadata: input.metadata || {}, createdAt: now, updatedAt: now };
      await inTransaction(connection, async (session) => {
        await tenants.insertOne(doc, { session });
        await insertTenantDefaults(db, doc._id, session);
      });
      return toTenant(doc);
    },
    get: (id) => one({ _id: id }),
    getBySlug: (slug) => one({ slug }),
    list: () => many(),
    count: () => tenants.countDocuments(live),
    async update(id, input) {
      const values: Partial<TenantDoc> = {};
      if (input.name !== undefined) values.name = input.name;
      if (input.status !== undefined) {
        if (!STATUSES.includes(input.status as TenantStatus)) throw new Error("Invalid tenant status");
        values.status = input.status as TenantStatus;
      }
      if (input.metadata !== undefined) values.platformMetadata = input.metadata;
      return change(id, values);
    },
    remove: (id) => change(id, { status: "deleted" }),
    async purge(id) {
      // Listing collections is not allowed inside a transaction, so it happens first.
      const owned = (await dataCollections(connection)).filter((name) => name !== "tenants");
      return inTransaction(connection, async (session) => {
        for (const name of owned) await db.collection(name).deleteMany({ tenantId: id }, { session });
        return (await tenants.deleteOne({ _id: id }, { session })).deletedCount > 0;
      });
    },
    async seedDefaults() {
      for (const { _id } of await tenants.find({}, { projection: { _id: 1 } }).toArray()) await insertTenantDefaults(db, _id);
    },

    async issueApiKey(name = "API Key", scopes = ["*"]) {
      const key = generateApiKey();
      const doc: ApiKeyDoc = { _id: randomUUID(), name, scopes, keyPrefix: key.keyPrefix, keyHash: hashApiKey(key.raw), lastUsedAt: null, revokedAt: null, createdAt: new Date() };
      await keys.insertOne(doc);
      return { ...key, keyId: doc._id };
    },
    async getApiKey(id) {
      const doc = await keys.findOne({ _id: id });
      return doc ? toApiKey(doc) : null;
    },
    async resolveApiKey(raw) {
      if (!raw || raw.length > 256) return null;
      const doc = await keys.findOne({ keyHash: hashApiKey(raw), revokedAt: null });
      return doc ? toApiKey(doc) : null;
    },
    async touchApiKey(id) {
      await keys.updateOne({ _id: id }, { $set: { lastUsedAt: new Date() } });
    },
    async revokeApiKey(id) {
      await keys.updateOne({ _id: id }, { $set: { revokedAt: new Date() } });
    },
    async listApiKeys() {
      const all = await keys.find().sort({ createdAt: 1, _id: 1 }).toArray();
      const counts = await tenants.aggregate<{ _id: string | null; n: number }>([{ $match: live }, { $group: { _id: "$apiKeyId", n: { $sum: 1 } } }]).toArray();
      const byKey = new Map(counts.map((c) => [c._id, c.n]));
      return all.map((doc) => ({ ...toApiKey(doc), tenantCount: byKey.get(doc._id) ?? 0 }));
    },
    linkApiKey: (tenantId, apiKeyId) => change(tenantId, { apiKeyId }),
    getForApiKey: (apiKeyId, ref) => one({ apiKeyId, $or: [{ _id: ref }, { slug: ref }] }),
    listForApiKey: (apiKeyId) => many({ apiKeyId }),
  };
}

/** Writes the agent configuration and skill switches a tenant lacks, leaving any it has untouched. */
async function insertTenantDefaults(db: Db, tenantId: string, session?: ClientSession) {
  const now = new Date();
  await db.collection<{ _id: string }>("agents_config").updateOne({ _id: tenantId }, { $setOnInsert: defaultAgentConfig(tenantId, now) }, { upsert: true, session });
  for (const skill of await db.collection<SkillDoc>("skills").find({}, { session }).toArray()) {
    await db.collection("tenant_skills").updateOne(
      { tenantId, skillId: skill._id },
      { $setOnInsert: { _id: randomUUID() as any, isEnabled: skill.defaultEnabled, config: skill.config ?? {}, updatedAt: now } },
      { upsert: true, session },
    );
  }
}

/** What the SQL column defaults and `defaultAgentConfig` in sql.ts give a new tenant. */
const defaultAgentConfig = (tenantId: string, now: Date) => ({
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
});

function toTenant({ _id, ...doc }: TenantDoc): Tenant {
  return { id: _id, name: doc.name, slug: doc.slug, apiKeyId: doc.apiKeyId ?? null, status: doc.status, platformMetadata: doc.platformMetadata ?? {}, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
}

function toApiKey(doc: ApiKeyDoc): ApiKey {
  return { id: doc._id, name: doc.name, keyPrefix: doc.keyPrefix, scopes: doc.scopes ?? [], lastUsedAt: doc.lastUsedAt ?? null, revokedAt: doc.revokedAt ?? null, createdAt: doc.createdAt };
}
