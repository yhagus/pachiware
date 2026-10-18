import { randomUUID } from "node:crypto";
import type { ClientSession, Filter } from "mongodb";
import { decryptSecret, encryptSecret } from "../../crypto.js";
import { ensureCollection, inTransaction, type MongoConnection, type MongoMigration } from "../../mongo/connection.js";
import type { Bot, BotRepository, BotWithToken, GuildConfig } from "./types.js";

type BotDoc = Omit<Bot, "id" | "hasToken"> & { _id: string; tokenEncrypted: string };
type GuildConfigDoc = Omit<GuildConfig, "id"> & { _id: string };

export const botMigrations: MongoMigration[] = [
  {
    id: "0100-bots-and-guild-configs",
    async up(db) {
      const bots = await ensureCollection(db, "bots");
      await bots.createIndex({ tenantId: 1, createdAt: 1 }, { name: "bots_tenant_created_idx" });
      await bots.createIndex({ profileId: 1 }, { name: "bots_profile_idx" });
      const guilds = await ensureCollection(db, "guild_configs");
      await guilds.createIndex({ botId: 1, guildId: 1 }, { unique: true, name: "guild_configs_bot_guild_unique" });
      await guilds.createIndex({ tenantId: 1 }, { name: "guild_configs_tenant_idx" });
    },
  },
];

const live = { connectionStatus: { $ne: "deleted" } };
const DECRYPT_ERROR = "Unable to decrypt bot token; verify platform encryption configuration.";

/** Bots and guild configuration on MongoDB. */
export function createMongoBotRepository(connection: MongoConnection): BotRepository {
  const { db } = connection;
  const bots = db.collection<BotDoc>("bots");
  const guilds = db.collection<GuildConfigDoc>("guild_configs");
  const tenants = db.collection<{ _id: string; status: string }>("tenants");
  const profiles = db.collection<{ _id: string; tenantId: string }>("profiles");
  const doc = (id: string, tenantId?: string) => bots.findOne({ _id: id, ...live, ...(tenantId ? { tenantId } : {}) });
  const withToken = (found: BotDoc): BotWithToken => ({ bot: toBot(found), token: decryptSecret(found.tokenEncrypted) });
  const requireToken = (token: string | undefined) => {
    if (!token?.trim()) throw new Error("Bot token is required");
    return encryptSecret(token.trim());
  };
  /** A bot may only answer with a profile of its own tenant. */
  const requireProfile = async (tenantId: string, profileId: string | null | undefined, session: ClientSession) => {
    if (profileId && !(await profiles.findOne({ _id: profileId, tenantId }, { session, projection: { _id: 1 } }))) throw new Error("Profile not found");
  };

  const repository: BotRepository = {
    async create({ token, ...input }) {
      const fields = defined(input);
      const tokenEncrypted = requireToken(token);
      if (fields.platform && fields.platform !== "discord") throw new Error("Unsupported bot platform");
      const now = new Date();
      const created: BotDoc = {
        _id: randomUUID(), tenantId: input.tenantId, name: "Discord Bot", platform: "discord", clientId: null, guildIds: [], isEnabled: true,
        connectionStatus: "disconnected", profileId: null, lastConnectedAt: null, lastError: null, createdAt: now, updatedAt: now, ...fields, tokenEncrypted,
      };
      await inTransaction(connection, async (session) => {
        if (!(await tenants.findOne({ _id: input.tenantId, status: { $ne: "deleted" } }, { session, projection: { _id: 1 } }))) throw new Error("Tenant not found");
        await requireProfile(created.tenantId, created.profileId, session);
        await bots.insertOne(created, { session });
      });
      return toBot(created);
    },
    async get(id, tenantId) {
      const found = await doc(id, tenantId);
      return found ? toBot(found) : null;
    },
    async getWithToken(id) {
      const found = await doc(id);
      return found ? withToken(found) : null;
    },
    async listForTenant(tenantId) {
      return (await bots.find({ tenantId, ...live }).sort({ createdAt: 1, _id: 1 }).toArray()).map(toBot);
    },
    async search(tenantId, { q, platform, page, pageSize }) {
      const fragment = q?.trim();
      const filter: Filter<BotDoc> = { tenantId, ...live };
      if (platform) filter.platform = platform;
      if (fragment) filter.name = { $regex: escapeRegex(fragment), $options: "i" };
      const total = await bots.countDocuments(filter);
      const found = await bots.find(filter).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * pageSize).limit(pageSize).toArray();
      return { bots: found.map(toBot), total };
    },
    async listRunnable() {
      const active = (await tenants.find({ status: "active" }, { projection: { _id: 1 } }).toArray()).map((t) => t._id);
      const found = await bots.find({ isEnabled: true, ...live, tenantId: { $in: active } }).sort({ createdAt: 1, _id: 1 }).toArray();
      const runnable: BotWithToken[] = [];
      for (const bot of found) {
        try { runnable.push(withToken(bot)); }
        catch { await repository.update(bot._id, { connectionStatus: "error", lastError: DECRYPT_ERROR }); }
      }
      return runnable;
    },
    count: () => bots.countDocuments(live),
    async update(id, { token, ...input }) {
      const values: Partial<BotDoc> = { ...defined(input), updatedAt: new Date() };
      if (token !== undefined) values.tokenEncrypted = requireToken(token);
      const write = (session?: ClientSession) => bots.findOneAndUpdate({ _id: id, ...live }, { $set: values }, { returnDocument: "after", session });
      const changed = !values.profileId ? await write() : await inTransaction(connection, async (session) => {
        const bot = await bots.findOne({ _id: id, ...live }, { session, projection: { tenantId: 1 } });
        if (!bot) return null;
        await requireProfile(bot.tenantId, values.profileId, session);
        return write(session);
      });
      return changed ? toBot(changed) : null;
    },
    async remove(id) {
      // Keep the document so usage and conversations stay linked; its availability rules go with it.
      await inTransaction(connection, async (session) => {
        await bots.updateOne({ _id: id }, { $set: { isEnabled: false, connectionStatus: "deleted", tokenEncrypted: "", updatedAt: new Date() } }, { session });
        await db.collection("availability_rules").deleteMany({ botId: id }, { session });
      });
    },

    async getGuildConfig(botId, guildId) {
      const found = await guilds.findOne({ botId, guildId });
      return found ? toGuildConfig(found) : null;
    },
    async saveGuildConfig(tenantId, botId, guildId, input) {
      const values = { ...defined(input), updatedAt: new Date() };
      const defaults = { systemPrompt: null, useThreads: true, alwaysChannelIds: [], timezone: null, language: null, digestChannels: [], dailyLogChannels: [], docSources: [] };
      const onInsert = { _id: randomUUID(), tenantId, ...Object.fromEntries(Object.entries(defaults).filter(([field]) => !(field in values))) };
      const saved = await inTransaction(connection, async (session) => {
        // SQL's foreign key: the bot must exist.
        if (!(await bots.findOne({ _id: botId }, { session, projection: { _id: 1 } }))) throw new Error("Bot not found");
        return guilds.findOneAndUpdate({ botId, guildId }, { $set: values, $setOnInsert: onInsert }, { upsert: true, returnDocument: "after", session });
      });
      return toGuildConfig(saved!);
    },
    async listGuildConfigs(tenantId) {
      return (await guilds.find({ tenantId }).sort({ botId: 1, guildId: 1 }).toArray()).map(toGuildConfig);
    },
  };
  return repository;
}

/** The fields given, without the undefined ones, which the driver would otherwise store as null. */
const defined = <T extends object>(input: T): Partial<T> => Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;

/** Matches the text literally inside a regular expression. */
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function toBot(doc: BotDoc): Bot {
  return {
    id: doc._id, tenantId: doc.tenantId, name: doc.name, platform: doc.platform, clientId: doc.clientId ?? null, guildIds: doc.guildIds ?? [],
    isEnabled: Boolean(doc.isEnabled), connectionStatus: doc.connectionStatus, profileId: doc.profileId ?? null, hasToken: Boolean(doc.tokenEncrypted),
    lastConnectedAt: doc.lastConnectedAt ?? null, lastError: doc.lastError ?? null, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  };
}

function toGuildConfig(doc: GuildConfigDoc): GuildConfig {
  return {
    id: doc._id, tenantId: doc.tenantId, botId: doc.botId, guildId: doc.guildId, systemPrompt: doc.systemPrompt ?? null, useThreads: Boolean(doc.useThreads),
    alwaysChannelIds: doc.alwaysChannelIds ?? [], timezone: doc.timezone ?? null, language: doc.language ?? null, digestChannels: doc.digestChannels ?? [], dailyLogChannels: doc.dailyLogChannels ?? [], docSources: doc.docSources ?? [], updatedAt: doc.updatedAt,
  };
}
