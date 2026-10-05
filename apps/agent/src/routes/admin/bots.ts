import { Hono } from "hono";
import { db, bots, createBot, updateBot, deleteBot, listBotsForTenant, getTenantById, eq } from "@pachiware/db";
import { ne, and } from "drizzle-orm";
import { discordBotManager } from "../../discord/client.js";
import { publicBot, object } from "../validation.js";
import { botFields } from "../v1/bots.js";
export const botAdminRoutes = new Hono();
botAdminRoutes.post("/tenants/:id/bots", async (c) => {
  if (!await getTenantById(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  const bot = await createBot({ tenantId: c.req.param("id"), ...botFields(object(await c.req.json(), "body"), true) } as any);
  if (bot.isEnabled) void discordBotManager.startBot(bot.id).catch(() => {});
  return c.json({ success: true, bot: publicBot(bot) }, 201);
});
botAdminRoutes.get("/tenants/:id/bots", async (c) => {
  if (!await getTenantById(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  return c.json({ success: true, bots: (await listBotsForTenant(c.req.param("id"))).map(publicBot) });
});
botAdminRoutes.use("/bots/:botId/*", async (c, next) => {
  const [row] = await db.select().from(bots).where(and(eq(bots.id, c.req.param("botId")!), ne(bots.connectionStatus, "deleted"))).limit(1);
  if (!row || !await getTenantById(row.tenantId)) return c.json({ error: "Bot not found" }, 404);
  await next();
});
botAdminRoutes.use("/bots/:botId", async (c, next) => {
  const [row] = await db.select().from(bots).where(and(eq(bots.id, c.req.param("botId")!), ne(bots.connectionStatus, "deleted"))).limit(1);
  if (!row || !await getTenantById(row.tenantId)) return c.json({ error: "Bot not found" }, 404);
  await next();
});
botAdminRoutes.patch("/bots/:botId", async (c) => {
  const bot = await updateBot(c.req.param("botId"), botFields(object(await c.req.json(), "body")));
  if (bot?.isEnabled) void discordBotManager.restartBot(bot.id).catch(() => {});
  else await discordBotManager.stopBot(c.req.param("botId"));
  return c.json({ success: true, bot: publicBot(bot) });
});
botAdminRoutes.post("/bots/:botId/restart", async (c) => c.json(await discordBotManager.restartBot(c.req.param("botId"))));
botAdminRoutes.delete("/bots/:botId", async (c) => {
  await discordBotManager.removeBot(c.req.param("botId")); await deleteBot(c.req.param("botId"));
  return c.json({ success: true });
});
