import { randomUUID } from "node:crypto";
import type { Filter } from "mongodb";
import { ensureCollection, inTransaction, type MongoConnection, type MongoMigration } from "../../mongo/connection.js";
import type { Profile, ProfileRepository } from "./types.js";

type ProfileDoc = Omit<Profile, "id"> & { _id: string };

export const profileMigrations: MongoMigration[] = [
  {
    id: "0101-profiles",
    async up(db) {
      const profiles = await ensureCollection(db, "profiles");
      await profiles.createIndex({ tenantId: 1, createdAt: -1 }, { name: "profiles_tenant_created_idx" });
    },
  },
];

/** Profiles on MongoDB. */
export function createMongoProfileRepository(connection: MongoConnection): ProfileRepository {
  const { db } = connection;
  const profiles = db.collection<ProfileDoc>("profiles");
  const bots = db.collection<{ _id: string; tenantId: string; profileId: string | null }>("bots");
  const one = async (filter: Filter<ProfileDoc>) => {
    const doc = await profiles.findOne(filter);
    return doc ? toProfile(doc) : null;
  };

  return {
    async listForTenant(tenantId) {
      return (await profiles.find({ tenantId }).sort({ createdAt: -1, _id: -1 }).limit(500).toArray()).map(toProfile);
    },
    async create(tenantId, input) {
      const now = new Date();
      const doc: ProfileDoc = { _id: randomUUID(), tenantId, baseUrl: null, apiKeyEncrypted: null, acceptsImages: false, apiFormat: "chat_completions", ...defined(input), createdAt: now, updatedAt: now } as ProfileDoc;
      await inTransaction(connection, async (session) => {
        // SQL's foreign key: the tenant must exist.
        if (!(await db.collection<{ _id: string }>("tenants").findOne({ _id: tenantId }, { session, projection: { _id: 1 } }))) throw new Error("Tenant not found");
        await profiles.insertOne(doc, { session });
      });
      return toProfile(doc);
    },
    get: (id) => one({ _id: id }),
    getForTenant: (tenantId, id) => one({ _id: id, tenantId }),
    async getForBot(tenantId, botId) {
      const bot = await bots.findOne({ _id: botId, tenantId });
      return bot?.profileId ? one({ _id: bot.profileId, tenantId }) : null;
    },
    async update(id, input) {
      const doc = await profiles.findOneAndUpdate({ _id: id }, { $set: { ...defined(input), updatedAt: new Date() } }, { returnDocument: "after" });
      return doc ? toProfile(doc) : null;
    },
    async remove(id) {
      // Bots pointing at the profile fall back to the tenant default, as SQL's ON DELETE SET NULL does.
      return inTransaction(connection, async (session) => {
        await bots.updateMany({ profileId: id }, { $set: { profileId: null } }, { session });
        return (await profiles.deleteOne({ _id: id }, { session })).deletedCount > 0;
      });
    },
  };
}

const FIELDS = ["name", "provider", "model", "baseUrl", "apiKeyEncrypted", "acceptsImages", "apiFormat"] as const;
const defined = (input: Record<string, any>) => Object.fromEntries(FIELDS.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]));

function toProfile(doc: ProfileDoc): Profile {
  return {
    id: doc._id, tenantId: doc.tenantId, name: doc.name, provider: doc.provider, model: doc.model, baseUrl: doc.baseUrl ?? null,
    apiKeyEncrypted: doc.apiKeyEncrypted ?? null, acceptsImages: Boolean(doc.acceptsImages), apiFormat: doc.apiFormat, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  };
}
