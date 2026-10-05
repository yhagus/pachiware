import { Hono } from "hono";
import { db, conversations, messages } from "@pachiware/db";
import { and, eq, desc } from "drizzle-orm";
import type { TenantEnv } from "../../middleware/tenant.js";
export const conversationRoutes = new Hono<TenantEnv>();
conversationRoutes.get("/", async (c) => c.json({ success: true, conversations: await db.select().from(conversations).where(eq(conversations.tenantId, c.get("tenantId"))).orderBy(desc(conversations.createdAt)).limit(100) }));
conversationRoutes.get("/:id/messages", async (c) => {
  const id = c.req.param("id");
  const [owned] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.tenantId, c.get("tenantId")))).limit(1);
  if (!owned) return c.json({ error: "Conversation not found" }, 404);
  const rows = await db.select().from(messages).where(and(eq(messages.tenantId, c.get("tenantId")), eq(messages.conversationId, id))).orderBy(desc(messages.createdAt)).limit(50);
  return c.json({ success: true, messages: rows.reverse() });
});
