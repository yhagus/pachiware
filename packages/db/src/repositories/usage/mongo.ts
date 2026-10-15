import { randomUUID } from "node:crypto";
import type { Filter } from "mongodb";
import { ensureCollection, inTransaction, type MongoConnection, type MongoMigration } from "../../mongo/connection.js";
import type { UsageEvent, UsageRepository, UsageTotal } from "./types.js";

type UsageEventDoc = Omit<UsageEvent, "id"> & { _id: string };
type TotalRow = { _id: { tenantId: string; type: string; provider: string | null; model: string | null }; events: number; promptTokens: number; completionTokens: number; cachedTokens: number };

export const usageMigrations: MongoMigration[] = [
  {
    id: "0102-usage-events",
    async up(db) {
      const usage = await ensureCollection(db, "usage_events");
      await usage.createIndex({ tenantId: 1, createdAt: 1 }, { name: "usage_tenant_created_idx" });
    },
  },
];

const orZero = (field: string) => ({ $ifNull: [`$${field}`, 0] });

/** Usage events on MongoDB. */
export function createMongoUsageRepository(connection: MongoConnection): UsageRepository {
  const { db } = connection;
  const usage = db.collection<UsageEventDoc>("usage_events");
  return {
    async record(event) {
      const doc: UsageEventDoc = {
        _id: randomUUID(), tenantId: event.tenantId, botId: event.botId ?? null, type: event.type, provider: event.provider ?? null, model: event.model ?? null,
        promptTokens: event.promptTokens ?? 0, completionTokens: event.completionTokens ?? 0, metadata: event.metadata ?? {}, createdAt: new Date(),
      };
      await inTransaction(connection, async (session) => {
        // SQL's foreign keys: the tenant exists, and a bot named belongs to it (deleted bots keep their document).
        if (!(await db.collection<{ _id: string }>("tenants").findOne({ _id: doc.tenantId }, { session, projection: { _id: 1 } }))) throw new Error("Tenant not found");
        if (doc.botId && !(await db.collection<{ _id: string; tenantId: string }>("bots").findOne({ _id: doc.botId, tenantId: doc.tenantId }, { session, projection: { _id: 1 } }))) {
          throw new Error("Bot not found for this tenant");
        }
        await usage.insertOne(doc, { session });
      });
    },
    async list(filter = {}) {
      const query: Filter<UsageEventDoc> = {};
      if (filter.tenantId) query.tenantId = filter.tenantId;
      if (filter.type) query.type = filter.type;
      return (await usage.find(query).sort({ createdAt: 1, _id: 1 }).toArray()).map(toUsageEvent);
    },
    async totals(filter = {}) {
      const match: Filter<UsageEventDoc> = {};
      if (filter.tenantId) match.tenantId = filter.tenantId;
      if (filter.from || filter.to) match.createdAt = { ...(filter.from && { $gte: filter.from }), ...(filter.to && { $lte: filter.to }) };
      const rows = await usage.aggregate<TotalRow>([
        { $match: match },
        {
          $group: {
            _id: { tenantId: "$tenantId", type: "$type", provider: { $ifNull: ["$provider", null] }, model: { $ifNull: ["$model", null] } },
            events: { $sum: 1 },
            promptTokens: { $sum: orZero("promptTokens") },
            completionTokens: { $sum: orZero("completionTokens") },
            // SQL casts the JSON field to an integer; a missing or unreadable one counts as nothing.
            cachedTokens: { $sum: { $convert: { input: "$metadata.cachedTokens", to: "long", onError: 0, onNull: 0 } } },
          },
        },
      ]).toArray();
      return rows.map(({ _id, ...row }): UsageTotal => ({
        tenantId: _id.tenantId, type: _id.type, provider: _id.provider ?? null, model: _id.model ?? null,
        events: Number(row.events), promptTokens: Number(row.promptTokens), completionTokens: Number(row.completionTokens), cachedTokens: Number(row.cachedTokens),
      }));
    },
  };
}

function toUsageEvent(doc: UsageEventDoc): UsageEvent {
  return {
    id: doc._id, tenantId: doc.tenantId, botId: doc.botId ?? null, type: doc.type, provider: doc.provider ?? null, model: doc.model ?? null,
    promptTokens: doc.promptTokens, completionTokens: doc.completionTokens, metadata: doc.metadata ?? {}, createdAt: doc.createdAt,
  };
}
