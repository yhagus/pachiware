import { randomUUID } from "node:crypto";
import type { Filter } from "mongodb";
import { ensureCollection, inTransaction, type MongoConnection, type MongoMigration } from "../../mongo/connection.js";
import type { Schedule, ScheduleFilter, ScheduleRepository } from "./types.js";

type ScheduleDoc = Omit<Schedule, "id"> & { _id: string };

export const scheduleMigrations: MongoMigration[] = [
  {
    id: "0300-schedules",
    async up(db) {
      const schedules = await ensureCollection(db, "schedules");
      // The scheduler polls `due(at)` by status and next run; `_id` breaks ties as the listing does.
      await schedules.createIndex({ status: 1, nextAt: 1, _id: 1 }, { name: "schedules_due_idx" });
      await schedules.createIndex({ tenantId: 1 }, { name: "schedules_tenant_idx" });
      await schedules.createIndex({ botId: 1 }, { name: "schedules_bot_idx" });
    },
  },
];

const soonest = { nextAt: 1, _id: 1 } as const;

/** Schedules on MongoDB. */
export function createMongoScheduleRepository(connection: MongoConnection): ScheduleRepository {
  const { db } = connection;
  const schedules = db.collection<ScheduleDoc>("schedules");

  const repo: ScheduleRepository = {
    async create(input) {
      const doc: ScheduleDoc = {
        _id: randomUUID(), tenantId: input.tenantId, botId: input.botId, kind: input.kind ?? "reminder", guildId: input.guildId ?? null, channelId: input.channelId,
        ownerId: input.ownerId ?? null, ownerName: input.ownerName ?? null, text: input.text ?? "", withTasks: input.withTasks ?? false, mentions: input.mentions ?? [],
        recurrence: input.recurrence ?? "once", weekdays: input.weekdays ?? [], dayOfMonth: input.dayOfMonth ?? null, timeOfDay: input.timeOfDay ?? null, timezone: input.timezone,
        until: input.until ?? null, nextAt: input.nextAt, lastFiredAt: null, status: input.status ?? "active", attempts: 0, error: null, createdAt: new Date(),
      };
      await inTransaction(connection, async (session) => {
        // SQL keys the bot by (tenant, id); a bot of another tenant is no bot at all here.
        const bot = await db.collection<{ _id: string }>("bots").findOne({ _id: input.botId, tenantId: input.tenantId }, { session, projection: { _id: 1 } });
        if (!bot) throw new Error(`Bot ${input.botId} does not belong to tenant ${input.tenantId}.`);
        await schedules.insertOne(doc, { session });
      });
      return toSchedule(doc);
    },
    async get(id) {
      const doc = await schedules.findOne({ _id: id });
      return doc ? toSchedule(doc) : null;
    },
    async list(filter = {}) {
      return (await schedules.find(matching(filter)).sort(soonest).toArray()).map(toSchedule);
    },
    count: (filter = {}) => schedules.countDocuments(matching(filter)),
    async due(at) {
      return (await schedules.find({ status: "active", nextAt: { $lte: at } }).sort(soonest).toArray()).map(toSchedule);
    },
    async update(id, changes) {
      if (!Object.keys(changes).length) return repo.get(id);
      const doc = await schedules.findOneAndUpdate({ _id: id }, { $set: changes }, { returnDocument: "after" });
      return doc ? toSchedule(doc) : null;
    },
  };
  return repo;
}

function matching(f: ScheduleFilter): Filter<ScheduleDoc> {
  const where: Filter<ScheduleDoc> = {};
  if (f.id !== undefined) where._id = f.id;
  if (f.tenantId !== undefined) where.tenantId = f.tenantId;
  if (f.botId !== undefined) where.botId = f.botId;
  if (f.kind !== undefined) where.kind = Array.isArray(f.kind) ? { $in: f.kind } : f.kind;
  if (f.status !== undefined) where.status = f.status;
  if (f.guildId !== undefined) where.guildId = f.guildId;
  if (f.ownerId !== undefined) where.ownerId = f.ownerId;
  if (f.visibleTo) {
    const { ownerId, guildId } = f.visibleTo;
    where.$or = guildId ? [{ ownerId }, { guildId }] : [{ ownerId }];
  }
  return where;
}

function toSchedule({ _id, ...doc }: ScheduleDoc): Schedule {
  return {
    id: _id, tenantId: doc.tenantId, botId: doc.botId, kind: doc.kind, guildId: doc.guildId ?? null, channelId: doc.channelId,
    ownerId: doc.ownerId ?? null, ownerName: doc.ownerName ?? null, text: doc.text, withTasks: Boolean(doc.withTasks), mentions: doc.mentions ?? [],
    recurrence: doc.recurrence, weekdays: doc.weekdays ?? [], dayOfMonth: doc.dayOfMonth ?? null, timeOfDay: doc.timeOfDay ?? null, timezone: doc.timezone,
    until: doc.until ?? null, nextAt: doc.nextAt, lastFiredAt: doc.lastFiredAt ?? null, status: doc.status, attempts: doc.attempts, error: doc.error ?? null, createdAt: doc.createdAt,
  };
}
