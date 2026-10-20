import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, notInArray } from "drizzle-orm";
import type { SqlConnection } from "../../connection.js";
import type { PlaneAccount, PlaneRepository, PlaneScope, PlaneWorkspace } from "./types.js";
import { checkPlaneScopeRules, narrowPlaneChannelRule, FIRST_PLANE_VERSION } from "./rules.js";
import { createSqlSkillRepository } from "../skills/sql.js";
import { sqlTransaction } from "../sql-transaction.js";

/** Plane accounts, their bot links and Plane scopes on SQLite and PostgreSQL. */
export function createSqlPlaneRepository(connection: SqlConnection): PlaneRepository {
  const { db, tables: t } = connection;
  const skills = createSqlSkillRepository(connection);
  return {
    async createAccount(input) {
      const now = new Date();
      const [row] = await db.insert(t.planeAccounts).values({
        id: randomUUID(), tenantId: input.tenantId, name: input.name, baseUrl: input.baseUrl ?? null, workspaces: input.workspaces,
        apiKeyEncrypted: input.apiKeyEncrypted, planeUserId: input.planeUserId, planeUserName: input.planeUserName, planeVersion: input.planeVersion, planeServerVersion: input.planeServerVersion ?? null, createdAt: now, updatedAt: now,
      }).returning();
      return toAccount(row);
    },
    async getAccount(id) {
      const [row] = await db.select().from(t.planeAccounts).where(eq(t.planeAccounts.id, id)).limit(1);
      return row ? toAccount(row) : null;
    },
    async listAccounts(tenantId) {
      return (await db.select().from(t.planeAccounts).where(eq(t.planeAccounts.tenantId, tenantId)).orderBy(desc(t.planeAccounts.createdAt), desc(t.planeAccounts.id)).limit(200)).map(toAccount);
    },
    async updateAccount(id, input) {
      const values = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      return sqlTransaction(connection, function* (tx) {
        const [row] = yield tx.update(t.planeAccounts).set({ ...values, updatedAt: new Date() }).where(eq(t.planeAccounts.id, id)).returning();
        if (!row) return null;
        // A Plane workspace left off the list takes its scopes with it, on every bot; one switched off keeps them.
        if (input.workspaces) {
          const slugs = input.workspaces.map((w) => w.slug);
          yield tx.delete(t.planeScopes).where(and(eq(t.planeScopes.planeAccountId, id), ...(slugs.length ? [notInArray(t.planeScopes.workspaceSlug, slugs)] : [])));
        }
        return toAccount(row);
      });
    },
    async deleteAccount(id) {
      // A deleted bot keeps its links, so they and their scopes go explicitly, in one transaction with the account.
      return sqlTransaction(connection, function* (tx) {
        yield tx.delete(t.planeScopes).where(eq(t.planeScopes.planeAccountId, id));
        yield tx.delete(t.botPlaneAccounts).where(eq(t.botPlaneAccounts.planeAccountId, id));
        return (yield tx.delete(t.planeAccounts).where(eq(t.planeAccounts.id, id)).returning()).length > 0;
      });
    },
    async ownsAccounts(tenantId, ids) {
      const want = [...new Set(ids)];
      if (!want.length) return true;
      const owned = await db.select({ id: t.planeAccounts.id }).from(t.planeAccounts).where(and(eq(t.planeAccounts.tenantId, tenantId), inArray(t.planeAccounts.id, want)));
      return owned.length === want.length;
    },

    async setBotAccounts(tenantId, botId, ids) {
      const want = [...new Set(ids)];
      const firstLinked = await sqlTransaction(connection, function* (tx) {
        const [bot] = yield tx.select({ id: t.bots.id }).from(t.bots).where(and(eq(t.bots.id, botId), eq(t.bots.tenantId, tenantId))).limit(1);
        if (!bot) throw new Error("Bot not found");
        const owned = want.length ? yield tx.select({ id: t.planeAccounts.id }).from(t.planeAccounts).where(and(eq(t.planeAccounts.tenantId, tenantId), inArray(t.planeAccounts.id, want))) : [];
        if (owned.length !== want.length) throw new Error("Plane account not found");
        const have: string[] = (yield tx.select({ id: t.botPlaneAccounts.planeAccountId }).from(t.botPlaneAccounts).where(eq(t.botPlaneAccounts.botId, botId))).map((r: any) => r.id);
        const drop = have.filter((id) => !want.includes(id));
        if (drop.length) {
          // SQLite connections may run with foreign keys off, so the scopes go explicitly.
          yield tx.delete(t.planeScopes).where(and(eq(t.planeScopes.botId, botId), inArray(t.planeScopes.planeAccountId, drop)));
          yield tx.delete(t.botPlaneAccounts).where(and(eq(t.botPlaneAccounts.botId, botId), inArray(t.botPlaneAccounts.planeAccountId, drop)));
        }
        const add = want.filter((id) => !have.includes(id));
        if (add.length) yield tx.insert(t.botPlaneAccounts).values(add.map((planeAccountId) => ({ id: randomUUID(), tenantId, botId, planeAccountId, createdAt: new Date() })));
        return have.length === 0 && add.length > 0;
      });
      // The plane skill ships off, so a bot's first Plane account switches it on; later links leave an admin's choice alone.
      if (firstLinked) await skills.enable(tenantId, "plane");
    },
    async listBotAccounts(botId) {
      const rows = await db.select({ acc: t.planeAccounts }).from(t.botPlaneAccounts).innerJoin(t.planeAccounts, eq(t.planeAccounts.id, t.botPlaneAccounts.planeAccountId))
        .where(eq(t.botPlaneAccounts.botId, botId)).orderBy(asc(t.planeAccounts.createdAt), asc(t.planeAccounts.id));
      return rows.map((r: any) => toAccount(r.acc));
    },
    async botAccountIds(botIds) {
      if (!botIds.length) return {};
      const rows = await db.select({ botId: t.botPlaneAccounts.botId, id: t.botPlaneAccounts.planeAccountId }).from(t.botPlaneAccounts)
        .where(inArray(t.botPlaneAccounts.botId, botIds)).orderBy(asc(t.botPlaneAccounts.createdAt), asc(t.botPlaneAccounts.id));
      const out: Record<string, string[]> = {};
      for (const r of rows) (out[r.botId] ??= []).push(r.id);
      return out;
    },
    async botsByAccount(tenantId) {
      const rows = await db.select({ id: t.bots.id, name: t.bots.name, accountId: t.botPlaneAccounts.planeAccountId }).from(t.botPlaneAccounts).innerJoin(t.bots, eq(t.bots.id, t.botPlaneAccounts.botId))
        .where(and(eq(t.botPlaneAccounts.tenantId, tenantId), ne(t.bots.connectionStatus, "deleted"))).orderBy(asc(t.botPlaneAccounts.createdAt), asc(t.botPlaneAccounts.id));
      const out: Record<string, { id: string; name: string }[]> = {};
      for (const r of rows) (out[r.accountId] ??= []).push({ id: r.id, name: r.name });
      return out;
    },

    listScopes: (botId, guildId) => scopesOf(botId, guildId),
    async replaceScopes(tenantId, botId, guildId, channelId, rules) {
      await sqlTransaction(connection, function* (tx) {
        const workspacesByAccount = new Map<string, PlaneWorkspace[]>((yield tx.select({ id: t.planeAccounts.id, workspaces: t.planeAccounts.workspaces }).from(t.botPlaneAccounts)
          .innerJoin(t.planeAccounts, eq(t.planeAccounts.id, t.botPlaneAccounts.planeAccountId)).where(eq(t.botPlaneAccounts.botId, botId))).map((r: any) => [r.id, r.workspaces ?? []]));
        const current: PlaneScope[] = (yield tx.select().from(t.planeScopes).where(and(eq(t.planeScopes.botId, botId), eq(t.planeScopes.guildId, guildId)))).map(toScope);
        const clean = checkPlaneScopeRules(rules, workspacesByAccount, channelId, current);
        yield tx.delete(t.planeScopes).where(and(eq(t.planeScopes.botId, botId), eq(t.planeScopes.guildId, guildId), eq(t.planeScopes.channelId, channelId)));
        if (clean.length) yield tx.insert(t.planeScopes).values(clean.map((r) => ({ id: randomUUID(), tenantId, botId, guildId, channelId, ...r, updatedAt: new Date() })));
        if (channelId) return;
        for (const c of current.filter((r) => r.channelId !== "")) {
          const narrowed = narrowPlaneChannelRule(clean, c);
          if (!narrowed) yield tx.delete(t.planeScopes).where(eq(t.planeScopes.id, c.id));
          else if (narrowed.length !== c.projectIds.length) yield tx.update(t.planeScopes).set({ projectIds: narrowed }).where(eq(t.planeScopes.id, c.id));
        }
      });
    },
  };

  async function scopesOf(botId: string, guildId: string): Promise<PlaneScope[]> {
    return (await db.select().from(t.planeScopes).where(and(eq(t.planeScopes.botId, botId), eq(t.planeScopes.guildId, guildId)))
      .orderBy(asc(t.planeScopes.channelId), asc(t.planeScopes.planeAccountId), asc(t.planeScopes.workspaceSlug))).map(toScope);
  }
}

function toScope(row: any): PlaneScope {
  return { id: row.id, tenantId: row.tenantId, botId: row.botId, guildId: row.guildId, channelId: row.channelId, planeAccountId: row.planeAccountId, workspaceSlug: row.workspaceSlug, projectIds: row.projectIds ?? [], updatedAt: row.updatedAt };
}

function toAccount(row: any): PlaneAccount {
  return {
    id: row.id, tenantId: row.tenantId, name: row.name, baseUrl: row.baseUrl ?? null, workspaces: row.workspaces ?? [], apiKeyEncrypted: row.apiKeyEncrypted,
    planeUserId: row.planeUserId, planeUserName: row.planeUserName, planeVersion: row.planeVersion ?? FIRST_PLANE_VERSION, planeServerVersion: row.planeServerVersion ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}
