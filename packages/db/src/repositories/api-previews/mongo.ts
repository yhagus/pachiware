import { randomUUID } from "node:crypto";
import { ensureCollection, inTransaction, type MongoConnection, type MongoMigration } from "../../mongo/connection.js";
import type { ApiPreview, ApiPreviewRepository, ApiPreviewSummary } from "./types.js";

type ApiPreviewDoc = Omit<ApiPreview, "id"> & { _id: string };

export const apiPreviewMigrations: MongoMigration[] = [
  {
    id: "0400-api-previews",
    async up(db) {
      const previews = await ensureCollection(db, "api_previews");
      // The console lists a tenant's previews, newest first; `_id` breaks ties as the listing does.
      await previews.createIndex({ tenantId: 1, createdAt: -1, _id: -1 }, { name: "api_previews_tenant_created_idx" });
    },
  },
];

const newest = { createdAt: -1, _id: -1 } as const;

/** API previews on MongoDB. */
export function createMongoApiPreviewRepository(connection: MongoConnection): ApiPreviewRepository {
  const { db } = connection;
  const previews = db.collection<ApiPreviewDoc>("api_previews");
  return {
    async create(input) {
      const doc: ApiPreviewDoc = {
        _id: randomUUID(), tenantId: input.tenantId, botId: input.botId, guildId: input.guildId ?? null, channelId: input.channelId, sourcePath: input.sourcePath,
        title: input.title, version: input.version ?? null, document: input.document, createdById: input.createdById ?? null, createdByName: input.createdByName ?? null, createdAt: new Date(),
      };
      await inTransaction(connection, async (session) => {
        // SQL keys the bot by (tenant, id); a bot of another tenant is no bot at all here.
        const bot = await db.collection<{ _id: string }>("bots").findOne({ _id: input.botId, tenantId: input.tenantId }, { session, projection: { _id: 1 } });
        if (!bot) throw new Error(`Bot ${input.botId} does not belong to tenant ${input.tenantId}.`);
        await previews.insertOne(doc, { session });
      });
      return toPreview(doc);
    },
    async get(id) {
      const doc = await previews.findOne({ _id: id });
      return doc ? toPreview(doc) : null;
    },
    async list(tenantId, filter = {}) {
      const where = { tenantId, ...(filter.botId !== undefined ? { botId: filter.botId } : {}), ...(filter.channelId !== undefined ? { channelId: filter.channelId } : {}) };
      return (await previews.find(where, { projection: { document: 0 } }).sort(newest).toArray()).map(toSummary);
    },
    async remove(tenantId, id) {
      return (await previews.deleteOne({ _id: id, tenantId })).deletedCount > 0;
    },
  };
}

function toSummary({ _id, ...doc }: Omit<ApiPreviewDoc, "document">): ApiPreviewSummary {
  return {
    id: _id, tenantId: doc.tenantId, botId: doc.botId, guildId: doc.guildId ?? null, channelId: doc.channelId, sourcePath: doc.sourcePath, title: doc.title,
    version: doc.version ?? null, createdById: doc.createdById ?? null, createdByName: doc.createdByName ?? null, createdAt: doc.createdAt,
  };
}
const toPreview = (doc: ApiPreviewDoc): ApiPreview => ({ ...toSummary(doc), document: doc.document });
