import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { SqlConnection, SqlTables } from "../../connection.js";
import { generateApiKey, hashApiKey } from "../../crypto.js";
import { defaultAgentConfig } from "../agent-config/types.js";
import { tenantStatus, type ApiKey, type Tenant, type TenantRepository } from "./types.js";

/** Tenants and API keys on SQLite and PostgreSQL. */
export function createSqlTenantRepository({ engine, db, tables: t }: SqlConnection): TenantRepository {
  const live = ne(t.tenants.status, "deleted");
  const one = async (where: any) => {
    const [row] = await db.select().from(t.tenants).where(and(where, live)).limit(1);
    return row ? toTenant(row) : null;
  };
  const many = async (where?: any) => (await db.select().from(t.tenants).where(where ? and(where, live) : live).orderBy(asc(t.tenants.createdAt), asc(t.tenants.id)).limit(1000)).map(toTenant);
  const change = async (id: string, values: Record<string, any>) => {
    const [row] = await db.update(t.tenants).set({ ...values, updatedAt: new Date() }).where(and(eq(t.tenants.id, id), live)).returning();
    return row ? toTenant(row) : null;
  };

  return {
    async create(input) {
      const now = new Date();
      const values = { id: randomUUID(), name: input.name, slug: input.slug || randomUUID(), apiKeyId: input.apiKeyId ?? null, platformMetadata: input.metadata || {}, createdAt: now, updatedAt: now };
      if (engine === "sqlite") {
        // Bun SQLite transactions must stay synchronous to keep their rollback.
        return toTenant(db.transaction((tx: any) => {
          const row = tx.insert(t.tenants).values(values).returning().get();
          tx.insert(t.agentsConfig).values(defaultAgentConfig(row.id, now)).run();
          for (const skill of tx.select().from(t.skills).all()) tx.insert(t.tenantSkills).values(defaultTenantSkill(row.id, skill, now)).run();
          return row;
        }));
      }
      return toTenant(await db.transaction(async (tx: any) => {
        const [row] = await tx.insert(t.tenants).values(values).returning();
        await insertTenantDefaults(tx, t, row.id, now);
        return row;
      }));
    },
    get: (id) => one(eq(t.tenants.id, id)),
    getBySlug: (slug) => one(eq(t.tenants.slug, slug)),
    list: () => many(),
    async count() {
      const [row] = await db.select({ n: sql<number>`count(*)` }).from(t.tenants).where(live);
      return Number(row?.n ?? 0);
    },
    async update(id, input) {
      const values: Record<string, any> = {};
      if (input.name !== undefined) values.name = input.name;
      if (input.status !== undefined) values.status = tenantStatus(input.status);
      if (input.metadata !== undefined) values.platformMetadata = input.metadata;
      return change(id, values);
    },
    remove: (id) => change(id, { status: "deleted" }),
    async purge(id) {
      // Delete owned records explicitly: upgraded SQLite files may lack some ownership foreign keys.
      const owned = ownedTables(t);
      if (engine === "sqlite") {
        return db.transaction((tx: any) => {
          for (const table of owned) tx.delete(table).where(eq(table.tenantId, id)).run();
          return tx.delete(t.tenants).where(eq(t.tenants.id, id)).returning().all().length > 0;
        });
      }
      return db.transaction(async (tx: any) => {
        for (const table of owned) await tx.delete(table).where(eq(table.tenantId, id));
        return (await tx.delete(t.tenants).where(eq(t.tenants.id, id)).returning()).length > 0;
      });
    },
    async seedDefaults() {
      for (const { id } of await db.select({ id: t.tenants.id }).from(t.tenants)) await insertTenantDefaults(db, t, id);
    },

    async issueApiKey(name = "API Key", scopes = ["*"]) {
      const key = generateApiKey();
      const [row] = await db.insert(t.apiKeys).values({ id: randomUUID(), name, scopes, keyPrefix: key.keyPrefix, keyHash: hashApiKey(key.raw), createdAt: new Date() }).returning();
      return { ...key, keyId: row.id };
    },
    async getApiKey(id) {
      const [row] = await db.select().from(t.apiKeys).where(eq(t.apiKeys.id, id)).limit(1);
      return row ? toApiKey(row) : null;
    },
    async resolveApiKey(raw) {
      if (!raw || raw.length > 256) return null;
      const [row] = await db.select().from(t.apiKeys).where(and(eq(t.apiKeys.keyHash, hashApiKey(raw)), isNull(t.apiKeys.revokedAt))).limit(1);
      return row ? toApiKey(row) : null;
    },
    async touchApiKey(id) {
      await db.update(t.apiKeys).set({ lastUsedAt: new Date() }).where(eq(t.apiKeys.id, id));
    },
    async revokeApiKey(id) {
      await db.update(t.apiKeys).set({ revokedAt: new Date() }).where(eq(t.apiKeys.id, id));
    },
    async listApiKeys() {
      const keys = await db.select().from(t.apiKeys).orderBy(asc(t.apiKeys.createdAt), asc(t.apiKeys.id));
      const counts = await db.select({ id: t.tenants.apiKeyId, n: sql<number>`count(*)` }).from(t.tenants).where(live).groupBy(t.tenants.apiKeyId);
      const byKey = new Map(counts.map((c: any) => [c.id, Number(c.n)]));
      return keys.map((row: any) => ({ ...toApiKey(row), tenantCount: byKey.get(row.id) ?? 0 }));
    },
    linkApiKey: (tenantId, apiKeyId) => change(tenantId, { apiKeyId }),
    getForApiKey: (apiKeyId, ref) => one(and(eq(t.tenants.apiKeyId, apiKeyId), or(eq(t.tenants.id, ref), eq(t.tenants.slug, ref)))),
    listForApiKey: (apiKeyId) => many(eq(t.tenants.apiKeyId, apiKeyId)),
  };
}

/** Writes the agent configuration and skill switches a tenant lacks. `store` is a database or a transaction. */
export async function insertTenantDefaults(store: any, t: SqlTables, tenantId: string, now = new Date()) {
  await store.insert(t.agentsConfig).values(defaultAgentConfig(tenantId, now)).onConflictDoNothing();
  for (const skill of await store.select().from(t.skills)) {
    await store.insert(t.tenantSkills).values(defaultTenantSkill(tenantId, skill, now)).onConflictDoNothing();
  }
}

const defaultTenantSkill = (tenantId: string, skill: { id: string; defaultEnabled: boolean; config: any }, updatedAt: Date) => ({ tenantId, skillId: skill.id, isEnabled: skill.defaultEnabled, config: skill.config, updatedAt });

/** Every table whose rows belong to a tenant, children before parents. */
function ownedTables(t: SqlTables): any[] {
  return [t.messages, t.conversations, t.usageEvents, t.schedules, t.apiPreviews, t.tasks, t.availabilityRules, t.gitScopes, t.botGitAccounts, t.planeScopes, t.botPlaneAccounts, t.guildConfigs, t.bots, t.gitAccounts, t.planeAccounts, t.profiles, t.tenantSkills, t.agentsConfig];
}

function toTenant(row: any): Tenant {
  return { id: row.id, name: row.name, slug: row.slug, apiKeyId: row.apiKeyId ?? null, status: row.status, platformMetadata: row.platformMetadata ?? {}, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function toApiKey(row: any): ApiKey {
  return { id: row.id, name: row.name, keyPrefix: row.keyPrefix, scopes: row.scopes ?? [], lastUsedAt: row.lastUsedAt ?? null, revokedAt: row.revokedAt ?? null, createdAt: row.createdAt };
}
