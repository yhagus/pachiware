import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { SqlConnection } from "../../connection.js";
import type { UsageEvent, UsageRepository, UsageTotal } from "./types.js";

/** Usage events on SQLite and PostgreSQL. */
export function createSqlUsageRepository({ db, tables: t }: SqlConnection): UsageRepository {
  const u = t.usageEvents;
  return {
    async record(event) {
      await db.insert(u).values({
        id: randomUUID(), tenantId: event.tenantId, botId: event.botId ?? null, type: event.type, provider: event.provider ?? null, model: event.model ?? null,
        promptTokens: event.promptTokens ?? 0, completionTokens: event.completionTokens ?? 0, metadata: event.metadata ?? {},
      });
    },
    async list(filter = {}) {
      const conditions = [];
      if (filter.tenantId) conditions.push(eq(u.tenantId, filter.tenantId));
      if (filter.type) conditions.push(eq(u.type, filter.type));
      return (await db.select().from(u).where(and(...conditions)).orderBy(asc(u.createdAt), asc(u.id))).map(toUsageEvent);
    },
    async totals(filter = {}) {
      const conditions = [];
      if (filter.tenantId) conditions.push(eq(u.tenantId, filter.tenantId));
      if (filter.from) conditions.push(gte(u.createdAt, filter.from));
      if (filter.to) conditions.push(lte(u.createdAt, filter.to));
      const rows = await db.select({
        tenantId: u.tenantId, type: u.type, provider: u.provider, model: u.model, events: sql<number>`count(*)`,
        promptTokens: sql<number>`coalesce(sum(${u.promptTokens}),0)`, completionTokens: sql<number>`coalesce(sum(${u.completionTokens}),0)`,
        cachedTokens: sql<number>`coalesce(sum(cast(${u.metadata}->>'cachedTokens' as integer)),0)`,
      }).from(u).where(and(...conditions)).groupBy(u.tenantId, u.type, u.provider, u.model);
      return rows.map((row: any): UsageTotal => ({
        tenantId: row.tenantId, type: row.type, provider: row.provider ?? null, model: row.model ?? null,
        events: Number(row.events), promptTokens: Number(row.promptTokens), completionTokens: Number(row.completionTokens), cachedTokens: Number(row.cachedTokens),
      }));
    },
  };
}

function toUsageEvent(row: any): UsageEvent {
  return {
    id: row.id, tenantId: row.tenantId, botId: row.botId ?? null, type: row.type, provider: row.provider ?? null, model: row.model ?? null,
    promptTokens: row.promptTokens, completionTokens: row.completionTokens, metadata: row.metadata ?? {}, createdAt: row.createdAt,
  };
}
