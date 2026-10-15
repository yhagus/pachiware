import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { SqlConnection } from "../../connection.js";
import type { GitAccount, GitOAuthApp, GitRepository, GitScope } from "./types.js";
import { checkScopeRules, narrowChannelRule } from "./rules.js";

/** Git accounts, bot links, Git scopes and git OAuth apps on SQLite and PostgreSQL. */
export function createSqlGitRepository({ db, tables: t }: SqlConnection): GitRepository {
  return {
    async createAccount(input) {
      const now = new Date();
      const [row] = await db.insert(t.gitAccounts).values({
        id: randomUUID(), tenantId: input.tenantId, name: input.name, provider: input.provider, baseUrl: input.baseUrl ?? null, username: input.username,
        tokenEncrypted: input.tokenEncrypted, authType: input.authType ?? "token", refreshTokenEncrypted: input.refreshTokenEncrypted ?? null,
        tokenExpiresAt: input.tokenExpiresAt ?? null, createdAt: now, updatedAt: now,
      }).returning();
      return toAccount(row);
    },
    async getAccount(id) {
      const [row] = await db.select().from(t.gitAccounts).where(eq(t.gitAccounts.id, id)).limit(1);
      return row ? toAccount(row) : null;
    },
    async listAccounts(tenantId) {
      return (await db.select().from(t.gitAccounts).where(eq(t.gitAccounts.tenantId, tenantId)).orderBy(desc(t.gitAccounts.createdAt), desc(t.gitAccounts.id)).limit(200)).map(toAccount);
    },
    async updateAccount(id, input) {
      const values = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const [row] = await db.update(t.gitAccounts).set({ ...values, updatedAt: new Date() }).where(eq(t.gitAccounts.id, id)).returning();
      return row ? toAccount(row) : null;
    },
    async deleteAccount(id) {
      return (await db.delete(t.gitAccounts).where(eq(t.gitAccounts.id, id)).returning()).length > 0;
    },
    ownsAccounts: (tenantId, ids) => ownsAll(tenantId, ids),

    async setBotAccounts(tenantId, botId, ids) {
      const want = [...new Set(ids)];
      if (!await ownsAll(tenantId, want)) throw new Error("Git account not found");
      const have: string[] = (await db.select({ id: t.botGitAccounts.gitAccountId }).from(t.botGitAccounts).where(eq(t.botGitAccounts.botId, botId))).map((r: any) => r.id as string);
      const drop = have.filter((id) => !want.includes(id));
      if (drop.length) {
        // SQLite connections may run with foreign keys off, so the scopes go explicitly.
        await db.delete(t.gitScopes).where(and(eq(t.gitScopes.botId, botId), inArray(t.gitScopes.gitAccountId, drop)));
        await db.delete(t.botGitAccounts).where(and(eq(t.botGitAccounts.botId, botId), inArray(t.botGitAccounts.gitAccountId, drop)));
      }
      const add = want.filter((id) => !have.includes(id));
      if (add.length) {
        await db.insert(t.botGitAccounts).values(add.map((gitAccountId) => ({ id: randomUUID(), tenantId, botId, gitAccountId, createdAt: new Date() })));
        await enableGitSkill(tenantId);
      }
    },
    async listBotAccounts(botId) {
      const rows = await db.select({ acc: t.gitAccounts }).from(t.botGitAccounts).innerJoin(t.gitAccounts, eq(t.gitAccounts.id, t.botGitAccounts.gitAccountId))
        .where(eq(t.botGitAccounts.botId, botId)).orderBy(asc(t.gitAccounts.createdAt), asc(t.gitAccounts.id));
      return rows.map((r: any) => toAccount(r.acc));
    },
    async botAccountIds(botIds) {
      if (!botIds.length) return {};
      const rows = await db.select({ botId: t.botGitAccounts.botId, id: t.botGitAccounts.gitAccountId }).from(t.botGitAccounts)
        .where(inArray(t.botGitAccounts.botId, botIds)).orderBy(asc(t.botGitAccounts.createdAt), asc(t.botGitAccounts.id));
      const out: Record<string, string[]> = {};
      for (const r of rows) (out[r.botId] ??= []).push(r.id);
      return out;
    },
    async botsByAccount(tenantId) {
      const rows = await db.select({ id: t.bots.id, name: t.bots.name, accountId: t.botGitAccounts.gitAccountId }).from(t.botGitAccounts).innerJoin(t.bots, eq(t.bots.id, t.botGitAccounts.botId))
        .where(and(eq(t.botGitAccounts.tenantId, tenantId), ne(t.bots.connectionStatus, "deleted"))).orderBy(asc(t.botGitAccounts.createdAt), asc(t.botGitAccounts.id));
      const out: Record<string, { id: string; name: string }[]> = {};
      for (const r of rows) (out[r.accountId] ??= []).push({ id: r.id, name: r.name });
      return out;
    },

    listScopes: (botId, guildId) => scopesOf(botId, guildId),
    async replaceScopes(tenantId, botId, guildId, channelId, rules) {
      const linked = new Set<string>((await db.select({ id: t.botGitAccounts.gitAccountId }).from(t.botGitAccounts).where(eq(t.botGitAccounts.botId, botId))).map((r: any) => r.id));
      const clean = checkScopeRules(rules, linked, channelId, channelId ? await scopesOf(botId, guildId) : []);
      await db.delete(t.gitScopes).where(and(eq(t.gitScopes.botId, botId), eq(t.gitScopes.guildId, guildId), eq(t.gitScopes.channelId, channelId)));
      if (clean.length) await db.insert(t.gitScopes).values(clean.map((r) => ({ id: randomUUID(), tenantId, botId, guildId, channelId, ...r, updatedAt: new Date() })));
      if (channelId) return;
      for (const c of (await scopesOf(botId, guildId)).filter((r) => r.channelId !== "")) {
        const narrowed = narrowChannelRule(clean, c);
        if (!narrowed) await db.delete(t.gitScopes).where(eq(t.gitScopes.id, c.id));
        else if (narrowed.length !== c.repoPatterns.length) await db.update(t.gitScopes).set({ repoPatterns: narrowed }).where(eq(t.gitScopes.id, c.id));
      }
    },

    async createOAuthApp(input) {
      const now = new Date();
      const [row] = await db.insert(t.gitOauthApps).values({ id: randomUUID(), ...input, createdAt: now, updatedAt: now }).returning();
      return toOAuthApp(row);
    },
    async findOAuthApp(provider, baseUrl) {
      const [row] = await db.select().from(t.gitOauthApps).where(and(eq(t.gitOauthApps.provider, provider), eq(t.gitOauthApps.baseUrl, baseUrl ?? ""))).limit(1);
      return row ? toOAuthApp(row) : null;
    },
    async listOAuthApps() {
      return (await db.select().from(t.gitOauthApps).orderBy(desc(t.gitOauthApps.createdAt), desc(t.gitOauthApps.id)).limit(200)).map(toOAuthApp);
    },
    async deleteOAuthApp(id) {
      return (await db.delete(t.gitOauthApps).where(eq(t.gitOauthApps.id, id)).returning()).length > 0;
    },
  };

  async function scopesOf(botId: string, guildId: string): Promise<GitScope[]> {
    return (await db.select().from(t.gitScopes).where(and(eq(t.gitScopes.botId, botId), eq(t.gitScopes.guildId, guildId)))).map(toScope);
  }

  async function ownsAll(tenantId: string, ids: string[]) {
    const want = [...new Set(ids)];
    if (!want.length) return true;
    const owned = await db.select({ id: t.gitAccounts.id }).from(t.gitAccounts).where(and(eq(t.gitAccounts.tenantId, tenantId), inArray(t.gitAccounts.id, want)));
    return owned.length === want.length;
  }

  /** The git skill ships off; linking an account is the moment someone wants it. Git stays closed anywhere without a server rule, so this opens nothing by itself. */
  async function enableGitSkill(tenantId: string) {
    const [skill] = await db.select({ id: t.skills.id }).from(t.skills).where(eq(t.skills.id, "git_repositories")).limit(1);
    if (!skill) return;
    const where = and(eq(t.tenantSkills.tenantId, tenantId), eq(t.tenantSkills.skillId, skill.id));
    const [row] = await db.select().from(t.tenantSkills).where(where).limit(1);
    if (!row) await db.insert(t.tenantSkills).values({ tenantId, skillId: skill.id, isEnabled: true });
    else if (!row.isEnabled) await db.update(t.tenantSkills).set({ isEnabled: true, updatedAt: new Date() }).where(where);
  }
}

function toOAuthApp(row: any): GitOAuthApp {
  return { id: row.id, provider: row.provider, baseUrl: row.baseUrl ?? "", clientId: row.clientId, clientSecretEncrypted: row.clientSecretEncrypted, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function toScope(row: any): GitScope {
  return { id: row.id, tenantId: row.tenantId, botId: row.botId, guildId: row.guildId, channelId: row.channelId, gitAccountId: row.gitAccountId, repoPatterns: row.repoPatterns ?? [], updatedAt: row.updatedAt };
}

function toAccount(row: any): GitAccount {
  return {
    id: row.id, tenantId: row.tenantId, name: row.name, provider: row.provider, baseUrl: row.baseUrl ?? null, username: row.username, authType: row.authType,
    tokenEncrypted: row.tokenEncrypted, refreshTokenEncrypted: row.refreshTokenEncrypted ?? null, tokenExpiresAt: row.tokenExpiresAt ?? null,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}
