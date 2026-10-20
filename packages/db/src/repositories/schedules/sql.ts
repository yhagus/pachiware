import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { SqlConnection } from "../../connection.js";
import type { Schedule, ScheduleFilter, ScheduleRepository } from "./types.js";

/** Schedules on SQLite and PostgreSQL. */
export function createSqlScheduleRepository({ db, tables: t }: SqlConnection): ScheduleRepository {
  const s = t.schedules;
  const soonest = [asc(s.nextAt), asc(s.id)];

  const repo: ScheduleRepository = {
    async create(input) {
      const [row] = await db.insert(s).values({ ...input, id: randomUUID() }).returning();
      return toSchedule(row);
    },
    async get(id) {
      const [row] = await db.select().from(s).where(eq(s.id, id)).limit(1);
      return row ? toSchedule(row) : null;
    },
    async list(filter = {}) {
      return (await db.select().from(s).where(matching(filter)).orderBy(...soonest)).map(toSchedule);
    },
    async count(filter = {}) {
      const [row] = await db.select({ n: sql<number>`count(*)` }).from(s).where(matching(filter));
      return Number(row?.n ?? 0);
    },
    async due(at) {
      return (await db.select().from(s).where(and(eq(s.status, "active"), lte(s.nextAt, at))).orderBy(...soonest)).map(toSchedule);
    },
    async update(id, changes) {
      if (!Object.keys(changes).length) return repo.get(id);
      const [row] = await db.update(s).set(changes).where(eq(s.id, id)).returning();
      return row ? toSchedule(row) : null;
    },
  };
  return repo;

  function matching(f: ScheduleFilter) {
    const visible = f.visibleTo && (f.visibleTo.guildId ? or(eq(s.ownerId, f.visibleTo.ownerId), eq(s.guildId, f.visibleTo.guildId)) : eq(s.ownerId, f.visibleTo.ownerId));
    return and(
      f.id !== undefined ? eq(s.id, f.id) : undefined,
      f.tenantId !== undefined ? eq(s.tenantId, f.tenantId) : undefined,
      f.botId !== undefined ? eq(s.botId, f.botId) : undefined,
      f.kind !== undefined ? (Array.isArray(f.kind) ? inArray(s.kind, f.kind) : eq(s.kind, f.kind)) : undefined,
      f.status !== undefined ? eq(s.status, f.status) : undefined,
      f.guildId !== undefined ? eq(s.guildId, f.guildId) : undefined,
      f.ownerId !== undefined ? eq(s.ownerId, f.ownerId) : undefined,
      visible,
    );
  }
}

function toSchedule(row: any): Schedule {
  return {
    id: row.id, tenantId: row.tenantId, botId: row.botId, kind: row.kind, guildId: row.guildId ?? null, channelId: row.channelId,
    ownerId: row.ownerId ?? null, ownerName: row.ownerName ?? null, text: row.text, withTasks: Boolean(row.withTasks), mentions: row.mentions ?? [],
    recurrence: row.recurrence, weekdays: row.weekdays ?? [], dayOfMonth: row.dayOfMonth ?? null, timeOfDay: row.timeOfDay ?? null, timezone: row.timezone,
    until: row.until ?? null, nextAt: row.nextAt, lastFiredAt: row.lastFiredAt ?? null, status: row.status, attempts: row.attempts, error: row.error ?? null, createdAt: row.createdAt,
  };
}
