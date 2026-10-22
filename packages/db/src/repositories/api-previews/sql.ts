import { randomUUID } from "node:crypto";
import { and, desc, eq, getTableColumns } from "drizzle-orm";
import type { SqlConnection } from "../../connection.js";
import type { ApiPreview, ApiPreviewRepository, ApiPreviewSummary } from "./types.js";

/** API previews on SQLite and PostgreSQL. */
export function createSqlApiPreviewRepository({ db, tables: t }: SqlConnection): ApiPreviewRepository {
  const p = t.apiPreviews;
  const { document: _, ...summary } = getTableColumns(p);
  return {
    async create(input) {
      const [row] = await db.insert(p).values({
        id: randomUUID(), tenantId: input.tenantId, botId: input.botId, guildId: input.guildId ?? null, channelId: input.channelId, sourcePath: input.sourcePath,
        title: input.title, version: input.version ?? null, document: input.document, createdById: input.createdById ?? null, createdByName: input.createdByName ?? null, createdAt: new Date(),
      }).returning();
      return toPreview(row);
    },
    async get(id) {
      const [row] = await db.select().from(p).where(eq(p.id, id)).limit(1);
      return row ? toPreview(row) : null;
    },
    async list(tenantId, filter = {}) {
      const rows = await db.select(summary).from(p)
        .where(and(eq(p.tenantId, tenantId), filter.botId !== undefined ? eq(p.botId, filter.botId) : undefined, filter.channelId !== undefined ? eq(p.channelId, filter.channelId) : undefined))
        .orderBy(desc(p.createdAt), desc(p.id));
      return rows.map(toSummary);
    },
    async remove(tenantId, id) {
      return (await db.delete(p).where(and(eq(p.tenantId, tenantId), eq(p.id, id))).returning({ id: p.id })).length > 0;
    },
  };
}

function toSummary(row: any): ApiPreviewSummary {
  return {
    id: row.id, tenantId: row.tenantId, botId: row.botId, guildId: row.guildId ?? null, channelId: row.channelId, sourcePath: row.sourcePath, title: row.title,
    version: row.version ?? null, createdById: row.createdById ?? null, createdByName: row.createdByName ?? null, createdAt: row.createdAt,
  };
}
const toPreview = (row: any): ApiPreview => ({ ...toSummary(row), document: row.document });
