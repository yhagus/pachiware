import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { SqlConnection } from "../../connection.js";
import { definedProfileFields, PROFILE_DEFAULTS, type Profile, type ProfileRepository } from "./types.js";

/** Profiles on SQLite and PostgreSQL. */
export function createSqlProfileRepository({ db, tables: t }: SqlConnection): ProfileRepository {
  const one = async (where: any) => {
    const [row] = await db.select().from(t.profiles).where(where).limit(1);
    return row ? toProfile(row) : null;
  };

  return {
    async listForTenant(tenantId) {
      return (await db.select().from(t.profiles).where(eq(t.profiles.tenantId, tenantId)).orderBy(desc(t.profiles.createdAt), desc(t.profiles.id)).limit(500)).map(toProfile);
    },
    async create(tenantId, input) {
      const now = new Date();
      const [row] = await db.insert(t.profiles).values({ ...PROFILE_DEFAULTS, ...definedProfileFields(input), id: randomUUID(), tenantId, createdAt: now, updatedAt: now }).returning();
      return toProfile(row);
    },
    get: (id) => one(eq(t.profiles.id, id)),
    getForTenant: (tenantId, id) => one(and(eq(t.profiles.id, id), eq(t.profiles.tenantId, tenantId))),
    async getForBot(tenantId, botId) {
      const [row] = await db.select({ profile: t.profiles }).from(t.bots).innerJoin(t.profiles, eq(t.bots.profileId, t.profiles.id))
        .where(and(eq(t.bots.id, botId), eq(t.bots.tenantId, tenantId), eq(t.profiles.tenantId, tenantId))).limit(1);
      return row ? toProfile(row.profile) : null;
    },
    async update(id, input) {
      const [row] = await db.update(t.profiles).set({ ...definedProfileFields(input), updatedAt: new Date() }).where(eq(t.profiles.id, id)).returning();
      return row ? toProfile(row) : null;
    },
    async remove(id) {
      // Bots pointing at the profile fall back to the tenant default (the foreign key is ON DELETE SET NULL).
      return (await db.delete(t.profiles).where(eq(t.profiles.id, id)).returning()).length > 0;
    },
  };
}

function toProfile(row: any): Profile {
  return {
    id: row.id, tenantId: row.tenantId, name: row.name, provider: row.provider, model: row.model, baseUrl: row.baseUrl ?? null,
    apiKeyEncrypted: row.apiKeyEncrypted ?? null, acceptsImages: Boolean(row.acceptsImages), apiFormat: row.apiFormat, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}
