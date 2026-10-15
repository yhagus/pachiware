import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { SqlConnection } from "../../connection.js";
import type { TaskRow, TaskRowRepository } from "./types.js";

/** Task rows on SQLite and PostgreSQL. */
export function createSqlTaskRowRepository({ db, tables: t }: SqlConnection): TaskRowRepository {
  return {
    async create(input) {
      const [row] = await db.insert(t.tasks).values({ ...input, metadata: input.metadata ?? {}, id: randomUUID() }).returning();
      return toTaskRow(row);
    },
    async list(tenantId) {
      const rows = await db.select().from(t.tasks).where(tenantId === undefined ? undefined : eq(t.tasks.tenantId, tenantId)).orderBy(asc(t.tasks.createdAt), asc(t.tasks.id));
      return rows.map(toTaskRow);
    },
  };
}

function toTaskRow(row: any): TaskRow {
  return {
    id: row.id, tenantId: row.tenantId, title: row.title, description: row.description ?? null, status: row.status, priority: row.priority, assignedTo: row.assignedTo ?? null,
    discordChannelId: row.discordChannelId ?? null, discordGuildId: row.discordGuildId ?? null, metadata: row.metadata ?? {}, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}
