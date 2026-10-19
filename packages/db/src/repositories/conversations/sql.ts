import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { SqlConnection } from "../../connection.js";
import { endedAtOf, type Conversation, type ConversationRepository, type Message } from "./types.js";

/** Conversations and their messages on SQLite and PostgreSQL. */
export function createSqlConversationRepository({ engine, db, tables: t }: SqlConnection): ConversationRepository {
  const c = t.conversations, m = t.messages;
  const inConversation = (tenantId: string, conversationId: string) => and(eq(m.conversationId, conversationId), eq(m.tenantId, tenantId));
  const one = async (where: any) => {
    const [row] = await db.select().from(c).where(where).limit(1);
    return row ? toConversation(row) : null;
  };

  return {
    async create(input) {
      const [row] = await db.insert(c).values({
        id: randomUUID(), tenantId: input.tenantId, botId: input.botId ?? null, platform: input.platform,
        channelId: input.channelId ?? null, userId: input.userId ?? null, metadata: input.metadata ?? {},
      }).returning();
      return toConversation(row);
    },
    get: (tenantId, id) => one(and(eq(c.id, id), eq(c.tenantId, tenantId))),
    async latestInChannel(tenantId, botId, channelId) {
      const [row] = await db.select().from(c).where(and(eq(c.tenantId, tenantId), eq(c.botId, botId), eq(c.channelId, channelId))).orderBy(desc(c.createdAt)).limit(1);
      return row ? toConversation(row) : null;
    },
    async listForTenant(tenantId) {
      return (await db.select().from(c).where(eq(c.tenantId, tenantId)).orderBy(desc(c.createdAt)).limit(100)).map(toConversation);
    },
    getForBot: (botId, id) => one(and(eq(c.id, id), eq(c.botId, botId))),
    async listForBot(botId, { channelId, limit }) {
      const where = and(eq(c.botId, botId), channelId ? or(eq(c.channelId, channelId), sql`${c.metadata}->>'parentChannelId' = ${channelId}`) : undefined);
      const rows = await db.select({ id: c.id, channelId: c.channelId, userId: c.userId, createdAt: c.createdAt, metadata: c.metadata }).from(c).where(where).orderBy(desc(c.createdAt)).limit(limit);
      const ids = rows.map((r: any) => r.id);
      const stats = ids.length ? await db.select({
        id: m.conversationId, n: sql`count(*)`.mapWith(Number), last: sql`max(${m.createdAt})`.mapWith(m.createdAt),
      }).from(m).where(inArray(m.conversationId, ids)).groupBy(m.conversationId) : [];
      const byId = new Map(stats.map((s: any) => [s.id, s]));
      return rows.map((r: any) => {
        const s: any = byId.get(r.id);
        return { id: r.id, channelId: r.channelId ?? null, userId: r.userId ?? null, createdAt: r.createdAt, messageCount: s?.n ?? 0, lastMessageAt: s?.last ?? null, endedAt: endedAtOf(r.metadata) };
      });
    },
    async setMetadata(tenantId, id, metadata) {
      await db.update(c).set({ metadata }).where(and(eq(c.id, id), eq(c.tenantId, tenantId)));
    },
    async remove(tenantId, id) {
      // Messages go first and explicitly: an old SQLite file may lack the cascading foreign key.
      const conversation = and(eq(c.id, id), eq(c.tenantId, tenantId));
      if (engine === "sqlite") {
        // Bun SQLite transactions must stay synchronous to keep their rollback.
        return db.transaction((tx: any) => {
          tx.delete(m).where(inConversation(tenantId, id)).run();
          return tx.delete(c).where(conversation).returning({ id: c.id }).all().length > 0;
        });
      }
      return db.transaction(async (tx: any) => {
        await tx.delete(m).where(inConversation(tenantId, id));
        return (await tx.delete(c).where(conversation).returning({ id: c.id })).length > 0;
      });
    },

    async addMessage(input) {
      const [row] = await db.insert(m).values({
        id: randomUUID(), tenantId: input.tenantId, conversationId: input.conversationId, role: input.role, content: input.content ?? null,
        toolCalls: input.toolCalls ?? null, toolCallId: input.toolCallId ?? null, tokensUsed: input.tokensUsed ?? null,
      }).returning();
      return toMessage(row);
    },
    async countMessages(tenantId, conversationId) {
      const [row] = await db.select({ n: sql<number>`count(*)` }).from(m).where(inConversation(tenantId, conversationId));
      return Number(row?.n ?? 0);
    },
    async listMessages(tenantId, conversationId, { offset, limit }) {
      return (await db.select().from(m).where(inConversation(tenantId, conversationId)).orderBy(asc(m.createdAt)).offset(offset).limit(limit)).map(toMessage);
    },
    async latestMessages(tenantId, conversationId, { limit, chatOnly }) {
      const chat = chatOnly ? and(inArray(m.role, ["user", "assistant"]), isNotNull(m.content)) : undefined;
      const rows = await db.select().from(m).where(and(inConversation(tenantId, conversationId), chat)).orderBy(desc(m.createdAt)).limit(limit);
      return rows.map(toMessage).reverse();
    },
  };
}

function toConversation(row: any): Conversation {
  return {
    id: row.id, tenantId: row.tenantId, botId: row.botId ?? null, channelId: row.channelId ?? null, userId: row.userId ?? null,
    platform: row.platform, metadata: row.metadata ?? {}, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function toMessage(row: any): Message {
  return {
    id: row.id, tenantId: row.tenantId, conversationId: row.conversationId, role: row.role, content: row.content ?? null,
    toolCalls: row.toolCalls ?? null, toolCallId: row.toolCallId ?? null, tokensUsed: row.tokensUsed ?? null, createdAt: row.createdAt,
  };
}
