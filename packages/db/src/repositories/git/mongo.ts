import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { ensureCollection, inTransaction, type MongoConnection, type MongoMigration } from "../../mongo/connection.js";
import { createMongoSkillRepository } from "../skills/mongo.js";
import { checkScopeRules, narrowChannelRule } from "./rules.js";
import type { BotRef, GitAccount, GitOAuthApp, GitRepository, GitScope } from "./types.js";

type AccountDoc = Omit<GitAccount, "id"> & { _id: string };
type LinkDoc = { _id: string; tenantId: string; botId: string; gitAccountId: string; createdAt: Date };
type ScopeDoc = Omit<GitScope, "id"> & { _id: string };
type OAuthAppDoc = Omit<GitOAuthApp, "id"> & { _id: string };
/** The fields of a bot this repository reads; the bots repository owns the collection. */
type BotDoc = { _id: string; name: string; connectionStatus: string };

export const gitMigrations: MongoMigration[] = [
  {
    id: "0220-git",
    async up(db) {
      const accounts = await ensureCollection(db, "git_accounts");
      await accounts.createIndex({ tenantId: 1, name: 1 }, { unique: true, name: "git_accounts_tenant_name_unique" });
      await accounts.createIndex({ tenantId: 1, createdAt: -1 }, { name: "git_accounts_tenant_created_idx" });
      const links = await ensureCollection(db, "bot_git_accounts");
      await links.createIndex({ botId: 1, gitAccountId: 1 }, { unique: true, name: "bot_git_accounts_unique" });
      await links.createIndex({ gitAccountId: 1 }, { name: "bot_git_accounts_account_idx" });
      await links.createIndex({ tenantId: 1 }, { name: "bot_git_accounts_tenant_idx" });
      const scopes = await ensureCollection(db, "git_scopes");
      await scopes.createIndex({ botId: 1, guildId: 1, channelId: 1, gitAccountId: 1 }, { unique: true, name: "git_scopes_unique" });
      await scopes.createIndex({ gitAccountId: 1 }, { name: "git_scopes_account_idx" });
      const apps = await ensureCollection(db, "git_oauth_apps");
      await apps.createIndex({ provider: 1, baseUrl: 1 }, { unique: true, name: "git_oauth_apps_host_unique" });
    },
  },
];

/** Git accounts, bot links, Git scopes and git OAuth apps on MongoDB. */
export function createMongoGitRepository(connection: MongoConnection): GitRepository {
  const { db } = connection;
  const accounts = db.collection<AccountDoc>("git_accounts");
  const links = db.collection<LinkDoc>("bot_git_accounts");
  const scopes = db.collection<ScopeDoc>("git_scopes");
  const apps = db.collection<OAuthAppDoc>("git_oauth_apps");
  const bots = db.collection<BotDoc>("bots");
  const skills = createMongoSkillRepository(connection);

  const ownsAll = async (tenantId: string, ids: string[], session?: ClientSession) => {
    const want = [...new Set(ids)];
    if (!want.length) return true;
    return await accounts.countDocuments({ _id: { $in: want }, tenantId }, { session }) === want.length;
  };
  const scopesOf = async (botId: string, guildId: string, session?: ClientSession) => (await scopes.find({ botId, guildId }, { session }).toArray()).map(toScope);

  return {
    async createAccount(input) {
      const now = new Date();
      const doc: AccountDoc = {
        _id: randomUUID(), tenantId: input.tenantId, name: input.name, provider: input.provider, baseUrl: input.baseUrl ?? null, username: input.username,
        authType: input.authType ?? "token", tokenEncrypted: input.tokenEncrypted, refreshTokenEncrypted: input.refreshTokenEncrypted ?? null,
        tokenExpiresAt: input.tokenExpiresAt ?? null, createdAt: now, updatedAt: now,
      };
      await accounts.insertOne(doc);
      return toAccount(doc);
    },
    async getAccount(id) {
      const doc = await accounts.findOne({ _id: id });
      return doc ? toAccount(doc) : null;
    },
    async listAccounts(tenantId) {
      return (await accounts.find({ tenantId }).sort({ createdAt: -1, _id: -1 }).limit(200).toArray()).map(toAccount);
    },
    async updateAccount(id, input) {
      const values = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const doc = await accounts.findOneAndUpdate({ _id: id }, { $set: { ...values, updatedAt: new Date() } }, { returnDocument: "after" });
      return doc ? toAccount(doc) : null;
    },
    deleteAccount: (id) => inTransaction(connection, async (session) => {
      // Its links and their scopes go with it, as SQL deletes them; a deleted bot keeps its links until then.
      await scopes.deleteMany({ gitAccountId: id }, { session });
      await links.deleteMany({ gitAccountId: id }, { session });
      return (await accounts.deleteOne({ _id: id }, { session })).deletedCount > 0;
    }),
    ownsAccounts: (tenantId, ids) => ownsAll(tenantId, ids),

    async setBotAccounts(tenantId, botId, ids) {
      const want = [...new Set(ids)];
      const added = await inTransaction(connection, async (session) => {
        // Checked inside the transaction, so an account deleted meanwhile cannot be linked.
        if (!await ownsAll(tenantId, want, session)) throw new Error("Git account not found");
        const have = (await links.find({ botId }, { session, projection: { gitAccountId: 1 } }).toArray()).map((l) => l.gitAccountId);
        const drop = have.filter((id) => !want.includes(id));
        if (drop.length) {
          await scopes.deleteMany({ botId, gitAccountId: { $in: drop } }, { session });
          await links.deleteMany({ botId, gitAccountId: { $in: drop } }, { session });
        }
        const add = want.filter((id) => !have.includes(id));
        if (add.length) await links.insertMany(add.map((gitAccountId) => ({ _id: randomUUID(), tenantId, botId, gitAccountId, createdAt: new Date() })), { session });
        return add.length > 0;
      });
      // The git skill ships off; linking an account is the moment someone wants it. Git stays closed anywhere without a server rule.
      if (added) await skills.enable(tenantId, "git_repositories");
    },
    async listBotAccounts(botId) {
      const ids = (await links.find({ botId }, { projection: { gitAccountId: 1 } }).toArray()).map((l) => l.gitAccountId);
      if (!ids.length) return [];
      return (await accounts.find({ _id: { $in: ids } }).sort({ createdAt: 1, _id: 1 }).toArray()).map(toAccount);
    },
    async botAccountIds(botIds) {
      if (!botIds.length) return {};
      const out: Record<string, string[]> = {};
      for (const l of await links.find({ botId: { $in: botIds } }).sort({ createdAt: 1, _id: 1 }).toArray()) (out[l.botId] ??= []).push(l.gitAccountId);
      return out;
    },
    async botsByAccount(tenantId) {
      const held = await links.find({ tenantId }).sort({ createdAt: 1, _id: 1 }).toArray();
      if (!held.length) return {};
      const live = new Map((await bots.find({ _id: { $in: [...new Set(held.map((l) => l.botId))] }, connectionStatus: { $ne: "deleted" } }, { projection: { name: 1 } }).toArray()).map((b) => [b._id, b.name]));
      const out: Record<string, BotRef[]> = {};
      for (const l of held) {
        const name = live.get(l.botId);
        if (name !== undefined) (out[l.gitAccountId] ??= []).push({ id: l.botId, name });
      }
      return out;
    },

    listScopes: (botId, guildId) => scopesOf(botId, guildId),
    replaceScopes: (tenantId, botId, guildId, channelId, rules) => inTransaction(connection, async (session) => {
      const linked = new Set((await links.find({ botId }, { session, projection: { gitAccountId: 1 } }).toArray()).map((l) => l.gitAccountId));
      const clean = checkScopeRules(rules, linked, channelId, channelId ? await scopesOf(botId, guildId, session) : []);
      await scopes.deleteMany({ botId, guildId, channelId }, { session });
      if (clean.length) await scopes.insertMany(clean.map((r) => ({ _id: randomUUID(), tenantId, botId, guildId, channelId, ...r, updatedAt: new Date() })), { session });
      if (channelId) return;
      for (const c of (await scopesOf(botId, guildId, session)).filter((r) => r.channelId !== "")) {
        const narrowed = narrowChannelRule(clean, c);
        if (!narrowed) await scopes.deleteOne({ _id: c.id }, { session });
        else if (narrowed.length !== c.repoPatterns.length) await scopes.updateOne({ _id: c.id }, { $set: { repoPatterns: narrowed } }, { session });
      }
    }),

    async createOAuthApp(input) {
      const now = new Date();
      const doc: OAuthAppDoc = { _id: randomUUID(), provider: input.provider, baseUrl: input.baseUrl, clientId: input.clientId, clientSecretEncrypted: input.clientSecretEncrypted, createdAt: now, updatedAt: now };
      await apps.insertOne(doc);
      return toOAuthApp(doc);
    },
    async findOAuthApp(provider, baseUrl) {
      const doc = await apps.findOne({ provider, baseUrl: baseUrl ?? "" });
      return doc ? toOAuthApp(doc) : null;
    },
    async listOAuthApps() {
      return (await apps.find().sort({ createdAt: -1, _id: -1 }).limit(200).toArray()).map(toOAuthApp);
    },
    async deleteOAuthApp(id) {
      return (await apps.deleteOne({ _id: id })).deletedCount > 0;
    },
  };
}

function toAccount({ _id, ...doc }: AccountDoc): GitAccount {
  return {
    id: _id, tenantId: doc.tenantId, name: doc.name, provider: doc.provider, baseUrl: doc.baseUrl ?? null, username: doc.username, authType: doc.authType,
    tokenEncrypted: doc.tokenEncrypted, refreshTokenEncrypted: doc.refreshTokenEncrypted ?? null, tokenExpiresAt: doc.tokenExpiresAt ?? null,
    createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  };
}

function toScope({ _id, ...doc }: ScopeDoc): GitScope {
  return { id: _id, tenantId: doc.tenantId, botId: doc.botId, guildId: doc.guildId, channelId: doc.channelId, gitAccountId: doc.gitAccountId, repoPatterns: doc.repoPatterns ?? [], updatedAt: doc.updatedAt };
}

function toOAuthApp({ _id, ...doc }: OAuthAppDoc): GitOAuthApp {
  return { id: _id, provider: doc.provider, baseUrl: doc.baseUrl ?? "", clientId: doc.clientId, clientSecretEncrypted: doc.clientSecretEncrypted, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
}
