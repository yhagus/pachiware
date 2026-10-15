import { randomUUID } from "node:crypto";
import { ensureCollection, type MongoConnection, type MongoMigration } from "../../mongo/connection.js";
import type { TaskRow, TaskRowRepository } from "./types.js";

type TaskRowDoc = Omit<TaskRow, "id"> & { _id: string };

export const taskRowMigrations: MongoMigration[] = [
  {
    id: "0301-task-rows",
    async up(db) {
      const tasks = await ensureCollection(db, "tasks");
      await tasks.createIndex({ tenantId: 1, createdAt: 1 }, { name: "tasks_tenant_created_idx" });
    },
  },
];

/** Task rows on MongoDB. */
export function createMongoTaskRowRepository({ db }: MongoConnection): TaskRowRepository {
  const tasks = db.collection<TaskRowDoc>("tasks");
  return {
    async create(input) {
      const now = new Date();
      const doc: TaskRowDoc = {
        _id: randomUUID(), tenantId: input.tenantId, title: input.title, description: input.description ?? null, status: input.status ?? "pending", priority: input.priority ?? "medium",
        assignedTo: input.assignedTo ?? null, discordChannelId: input.discordChannelId ?? null, discordGuildId: input.discordGuildId ?? null, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now,
      };
      await tasks.insertOne(doc);
      return toTaskRow(doc);
    },
    async list(tenantId) {
      return (await tasks.find(tenantId === undefined ? {} : { tenantId }).sort({ createdAt: 1, _id: 1 }).toArray()).map(toTaskRow);
    },
  };
}

function toTaskRow({ _id, ...doc }: TaskRowDoc): TaskRow {
  return {
    id: _id, tenantId: doc.tenantId, title: doc.title, description: doc.description ?? null, status: doc.status, priority: doc.priority, assignedTo: doc.assignedTo ?? null,
    discordChannelId: doc.discordChannelId ?? null, discordGuildId: doc.discordGuildId ?? null, metadata: doc.metadata ?? {}, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  };
}
