import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { ensureCollection, inTransaction, type MongoConnection, type MongoMigration } from "../../mongo/connection.js";
import { createMongoSkillRepository } from "../skills/mongo.js";
import { checkPlaneScopeRules, narrowPlaneChannelRule } from "./rules.js";
import type { BotRef } from "../git/types.js";
import type { PlaneAccount, PlaneRepository, PlaneScope } from "./types.js";

type AccountDoc = Omit<PlaneAccount, "id"> & { _id: string };
type LinkDoc = { _id: string; tenantId: string; botId: string; planeAccountId: string; createdAt: Date };
type ScopeDoc = Omit<PlaneScope, "id"> & { _id: string };
/** The fields of a bot this repository reads; the bots repository owns the collection. */
type BotDoc = { _id: string; tenantId: string; name: string; connectionStatus: string };

export const planeMigrations: MongoMigration[] = [
  {
    id: "0230-plane",
    async up(db) {
      const accounts = await ensureCollection(db, "plane_accounts");
      await accounts.createIndex({ tenantId: 1, name: 1 }, { unique: true, name: "plane_accounts_tenant_name_unique" });
      await accounts.createIndex({ tenantId: 1, createdAt: -1 }, { name: "plane_accounts_tenant_created_idx" });
      const links = await ensureCollection(db, "bot_plane_accounts");
      await links.createIndex({ botId: 1, planeAccountId: 1 }, { unique: true, name: "bot_plane_accounts_unique" });
      await links.createIndex({ planeAccountId: 1 }, { name: "bot_plane_accounts_account_idx" });
      await links.createIndex({ tenantId: 1 }, { name: "bot_plane_accounts_tenant_idx" });
      const scopes = await ensureCollection(db, "plane_scopes");
      await scopes.createIndex({ botId: 1, guildId: 1, channelId: 1, planeAccountId: 1 }, { unique: true, name: "plane_scopes_unique" });
      await scopes.createIndex({ planeAccountId: 1 }, { name: "plane_scopes_account_idx" });
    },
  },
];

/** Plane accounts, their bot links and Plane scopes on MongoDB. */
export function createMongoPlaneRepository(connection: MongoConnection): PlaneRepository {
  const { db } = connection;
  const accounts = db.collection<AccountDoc>("plane_accounts");
  const links = db.collection<LinkDoc>("bot_plane_accounts");
  const scopes = db.collection<ScopeDoc>("plane_scopes");
  const bots = db.collection<BotDoc>("bots");
  const skills = createMongoSkillRepository(connection);

  const ownsAll = async (tenantId: string, ids: string[], session?: ClientSession) => {
    const want = [...new Set(ids)];
    if (!want.length) return true;
    return await accounts.countDocuments({ _id: { $in: want }, tenantId }, { session }) === want.length;
  };
  const scopesOf = async (botId: string, guildId: string, session?: ClientSession) =>
    (await scopes.find({ botId, guildId }, { session }).sort({ channelId: 1, planeAccountId: 1 }).toArray()).map(toScope);

  return {
    async createAccount(input) {
      const now = new Date();
      const doc: AccountDoc = {
        _id: randomUUID(), tenantId: input.tenantId, name: input.name, baseUrl: input.baseUrl ?? null, workspaceSlug: input.workspaceSlug,
        apiKeyEncrypted: input.apiKeyEncrypted, planeUserId: input.planeUserId, planeUserName: input.planeUserName, createdAt: now, updatedAt: now,
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
      await scopes.deleteMany({ planeAccountId: id }, { session });
      await links.deleteMany({ planeAccountId: id }, { session });
      return (await accounts.deleteOne({ _id: id }, { session })).deletedCount > 0;
    }),
    ownsAccounts: (tenantId, ids) => ownsAll(tenantId, ids),

    async setBotAccounts(tenantId, botId, ids) {
      const want = [...new Set(ids)];
      const added = await inTransaction(connection, async (session) => {
        // Checked inside the transaction, so an account deleted meanwhile cannot be linked.
        if (!await bots.findOne({ _id: botId, tenantId }, { session, projection: { _id: 1 } })) throw new Error("Bot not found");
        if (!await ownsAll(tenantId, want, session)) throw new Error("Plane account not found");
        const have = (await links.find({ botId }, { session, projection: { planeAccountId: 1 } }).toArray()).map((l) => l.planeAccountId);
        const drop = have.filter((id) => !want.includes(id));
        if (drop.length) {
          await scopes.deleteMany({ botId, planeAccountId: { $in: drop } }, { session });
          await links.deleteMany({ botId, planeAccountId: { $in: drop } }, { session });
        }
        const add = want.filter((id) => !have.includes(id));
        if (add.length) await links.insertMany(add.map((planeAccountId) => ({ _id: randomUUID(), tenantId, botId, planeAccountId, createdAt: new Date() })), { session });
        return add.length > 0;
      });
      // The plane skill ships off; linking an account is the moment someone wants it. Plane stays closed anywhere without a guild rule.
      if (added) await skills.enable(tenantId, "plane");
    },
    async listBotAccounts(botId) {
      const ids = (await links.find({ botId }, { projection: { planeAccountId: 1 } }).toArray()).map((l) => l.planeAccountId);
      if (!ids.length) return [];
      return (await accounts.find({ _id: { $in: ids } }).sort({ createdAt: 1, _id: 1 }).toArray()).map(toAccount);
    },
    async botAccountIds(botIds) {
      if (!botIds.length) return {};
      const out: Record<string, string[]> = {};
      for (const l of await links.find({ botId: { $in: botIds } }).sort({ createdAt: 1, _id: 1 }).toArray()) (out[l.botId] ??= []).push(l.planeAccountId);
      return out;
    },
    async botsByAccount(tenantId) {
      const held = await links.find({ tenantId }).sort({ createdAt: 1, _id: 1 }).toArray();
      if (!held.length) return {};
      const live = new Map((await bots.find({ _id: { $in: [...new Set(held.map((l) => l.botId))] }, connectionStatus: { $ne: "deleted" } }, { projection: { name: 1 } }).toArray()).map((b) => [b._id, b.name]));
      const out: Record<string, BotRef[]> = {};
      for (const l of held) {
        const name = live.get(l.botId);
        if (name !== undefined) (out[l.planeAccountId] ??= []).push({ id: l.botId, name });
      }
      return out;
    },

    listScopes: (botId, guildId) => scopesOf(botId, guildId),
    replaceScopes: (tenantId, botId, guildId, channelId, rules) => inTransaction(connection, async (session) => {
      const linked = new Set((await links.find({ botId }, { session, projection: { planeAccountId: 1 } }).toArray()).map((l) => l.planeAccountId));
      const current = await scopesOf(botId, guildId, session);
      const clean = checkPlaneScopeRules(rules, linked, channelId, current);
      await scopes.deleteMany({ botId, guildId, channelId }, { session });
      if (clean.length) await scopes.insertMany(clean.map((r) => ({ _id: randomUUID(), tenantId, botId, guildId, channelId, ...r, updatedAt: new Date() })), { session });
      if (channelId) return;
      for (const c of current.filter((r) => r.channelId !== "")) {
        const narrowed = narrowPlaneChannelRule(clean, c);
        if (!narrowed) await scopes.deleteOne({ _id: c.id }, { session });
        else if (narrowed.length !== c.projectIds.length) await scopes.updateOne({ _id: c.id }, { $set: { projectIds: narrowed } }, { session });
      }
    }),
  };
}

function toAccount({ _id, ...doc }: AccountDoc): PlaneAccount {
  return {
    id: _id, tenantId: doc.tenantId, name: doc.name, baseUrl: doc.baseUrl ?? null, workspaceSlug: doc.workspaceSlug, apiKeyEncrypted: doc.apiKeyEncrypted,
    planeUserId: doc.planeUserId, planeUserName: doc.planeUserName, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  };
}

function toScope({ _id, ...doc }: ScopeDoc): PlaneScope {
  return { id: _id, tenantId: doc.tenantId, botId: doc.botId, guildId: doc.guildId, channelId: doc.channelId, planeAccountId: doc.planeAccountId, projectIds: doc.projectIds ?? [], updatedAt: doc.updatedAt };
}
