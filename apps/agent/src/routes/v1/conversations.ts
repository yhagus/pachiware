import { Hono } from "hono";
import { repositories } from "@pachiware/db";
import type { TenantEnv } from "../../middleware/tenant.js";
export const conversationRoutes = new Hono<TenantEnv>();
conversationRoutes.get("/", async (c) => c.json({ success: true, conversations: await repositories().conversations.listForTenant(c.get("tenantId")) }));
conversationRoutes.get("/:id/messages", async (c) => {
  const id = c.req.param("id");
  const { conversations } = repositories();
  if (!await conversations.get(c.get("tenantId"), id)) return c.json({ error: "Conversation not found" }, 404);
  return c.json({ success: true, messages: await conversations.latestMessages(c.get("tenantId"), id, { limit: 50 }) });
});
