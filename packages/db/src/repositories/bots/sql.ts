import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { SqlConnection } from "../../connection.js";
import { decryptSecret, encryptSecret } from "../../crypto.js";
import { sqlTransaction } from "../sql-transaction.js";
import type { Bot, BotRepository, BotWithToken, GuildConfig } from "./types.js";

/** Bots and guild configuration on SQLite and PostgreSQL. */
export function createSqlBotRepository(connection: SqlConnection): BotRepository {
  const { db, tables: t } = connection;
  const live = ne(t.bots.connectionStatus, "deleted");
  /** A bot may only answer with a profile of its own tenant. */
  function* requireProfile(tx: any, tenantId: string, profileId: string | null | undefined): Generator<any, void, any> {
    if (!profileId) return;
    const [found] = yield tx.select({ id: t.profiles.id }).from(t.profiles).where(and(eq(t.profiles.id, profileId), eq(t.profiles.tenantId, tenantId))).limit(1);
    if (!found) throw new Error("Profile not found");
  }
  const row = async (id: string, tenantId?: string) => {
    const [found] = await db.select().from(t.bots).where(and(eq(t.bots.id, id), live, tenantId ? eq(t.bots.tenantId, tenantId) : undefined)).limit(1);
    return found ?? null;
  };
  const withToken = (found: any): BotWithToken => ({ bot: toBot(found), token: decryptSecret(found.tokenEncrypted) });
  const requireToken = (token: string | undefined) => {
    if (!token?.trim()) throw new Error("Bot token is required");
    return encryptSecret(token.trim());
  };

  const repository: BotRepository = {
    async create({ token, ...input }) {
      const now = new Date();
      return toBot(await sqlTransaction(connection, function* (tx) {
        const [tenant] = yield tx.select({ id: t.tenants.id }).from(t.tenants).where(and(eq(t.tenants.id, input.tenantId), ne(t.tenants.status, "deleted"))).limit(1);
        if (!tenant) throw new Error("Tenant not found");
        const tokenEncrypted = requireToken(token);
        if (input.platform && input.platform !== "discord") throw new Error("Unsupported bot platform");
        yield* requireProfile(tx, input.tenantId, input.profileId);
        const [created] = yield tx.insert(t.bots).values({ id: randomUUID(), ...input, tokenEncrypted, createdAt: now, updatedAt: now }).returning();
        return created;
      }));
    },
    async get(id, tenantId) {
      const found = await row(id, tenantId);
      return found ? toBot(found) : null;
    },
    async getWithToken(id) {
      const found = await row(id);
      return found ? withToken(found) : null;
    },
    async listForTenant(tenantId) {
      return (await db.select().from(t.bots).where(and(eq(t.bots.tenantId, tenantId), live)).orderBy(asc(t.bots.createdAt), asc(t.bots.id))).map(toBot);
    },
    async search(tenantId, { q, platform, page, pageSize }) {
      const fragment = q?.trim().toLowerCase();
      const where = and(eq(t.bots.tenantId, tenantId), live, platform ? eq(t.bots.platform, platform) : undefined,
        fragment ? sql`lower(${t.bots.name}) like ${`%${fragment.replace(/[\\%_]/g, "\\$&")}%`} escape '\\'` : undefined);
      const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(t.bots).where(where);
      const rows = await db.select().from(t.bots).where(where).orderBy(desc(t.bots.createdAt), asc(t.bots.id)).limit(pageSize).offset((page - 1) * pageSize);
      return { bots: rows.map(toBot), total: Number(n) };
    },
    async listRunnable() {
      const rows = await db.select({ bot: t.bots }).from(t.bots).innerJoin(t.tenants, eq(t.bots.tenantId, t.tenants.id))
        .where(and(eq(t.bots.isEnabled, true), live, eq(t.tenants.status, "active"))).orderBy(asc(t.bots.createdAt), asc(t.bots.id));
      const runnable: BotWithToken[] = [];
      for (const { bot } of rows) {
        try { runnable.push(withToken(bot)); }
        catch { await repository.update(bot.id, { connectionStatus: "error", lastError: "Unable to decrypt bot token; verify platform encryption configuration." }); }
      }
      return runnable;
    },
    async count() {
      const [found] = await db.select({ n: sql<number>`count(*)` }).from(t.bots).where(live);
      return Number(found?.n ?? 0);
    },
    async update(id, { token, ...input }) {
      const values: Record<string, any> = { ...input, updatedAt: new Date() };
      if (token !== undefined) values.tokenEncrypted = requireToken(token);
      const write = (store: any) => store.update(t.bots).set(values).where(and(eq(t.bots.id, id), live)).returning();
      const [changed] = !values.profileId ? await write(db) : await sqlTransaction(connection, function* (tx) {
        const [bot] = yield tx.select({ tenantId: t.bots.tenantId }).from(t.bots).where(and(eq(t.bots.id, id), live)).limit(1);
        if (!bot) return [];
        yield* requireProfile(tx, bot.tenantId, values.profileId);
        return yield write(tx);
      });
      return changed ? toBot(changed) : null;
    },
    async remove(id) {
      // Keep the row so usage and conversations stay linked; the tombstone never cascades, so its availability rules go here.
      await db.update(t.bots).set({ isEnabled: false, connectionStatus: "deleted", tokenEncrypted: "", updatedAt: new Date() }).where(eq(t.bots.id, id));
      await db.delete(t.availabilityRules).where(eq(t.availabilityRules.botId, id));
    },

    async getGuildConfig(botId, guildId) {
      const [found] = await db.select().from(t.guildConfigs).where(and(eq(t.guildConfigs.botId, botId), eq(t.guildConfigs.guildId, guildId))).limit(1);
      return found ? toGuildConfig(found) : null;
    },
    async saveGuildConfig(tenantId, botId, guildId, input) {
      const values = { ...input, updatedAt: new Date() };
      const existing = await repository.getGuildConfig(botId, guildId);
      const [saved] = existing
        ? await db.update(t.guildConfigs).set(values).where(eq(t.guildConfigs.id, existing.id)).returning()
        : await db.insert(t.guildConfigs).values({ id: randomUUID(), tenantId, botId, guildId, ...values }).returning();
      return toGuildConfig(saved);
    },
    async listGuildConfigs(tenantId) {
      return (await db.select().from(t.guildConfigs).where(eq(t.guildConfigs.tenantId, tenantId))).map(toGuildConfig);
    },
  };
  return repository;
}

function toBot(row: any): Bot {
  return {
    id: row.id, tenantId: row.tenantId, name: row.name, platform: row.platform, clientId: row.clientId ?? null, guildIds: row.guildIds ?? [],
    isEnabled: Boolean(row.isEnabled), connectionStatus: row.connectionStatus, profileId: row.profileId ?? null, hasToken: Boolean(row.tokenEncrypted),
    lastConnectedAt: row.lastConnectedAt ?? null, lastError: row.lastError ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function toGuildConfig(row: any): GuildConfig {
  return {
    id: row.id, tenantId: row.tenantId, botId: row.botId, guildId: row.guildId, systemPrompt: row.systemPrompt ?? null, useThreads: Boolean(row.useThreads),
    alwaysChannelIds: row.alwaysChannelIds ?? [], timezone: row.timezone ?? null, language: row.language ?? null, digestChannels: row.digestChannels ?? [], updatedAt: row.updatedAt,
  };
}
