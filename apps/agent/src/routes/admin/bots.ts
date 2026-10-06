import { Hono } from "hono";
import { db, bots, conversations, messages, createBot, updateBot, deleteBot, getTenantById, upsertGuildConfig, eq } from "@pachiware/db";
import { ne, and, desc, sql } from "drizzle-orm";
import { discordBotManager } from "../../discord/client.js";
import { guildCacheKey, loadGuildSettings } from "../../loop/prompt.js";
import { CacheService } from "../../cache/redis.js";
import { publicBot, object, stringArray } from "../validation.js";
import { botFields, assertProfile } from "../v1/bots.js";
export const botAdminRoutes = new Hono();
botAdminRoutes.post("/tenants/:id/bots", async (c) => {
  if (!await getTenantById(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  const fields = botFields(object(await c.req.json(), "body"), true);
  await assertProfile(c.req.param("id"), fields.profileId);
  const bot = await createBot({ tenantId: c.req.param("id"), ...fields } as any);
  if (bot.isEnabled) void discordBotManager.startBot(bot.id).catch(() => {});
  return c.json({ success: true, bot: publicBot(bot) }, 201);
});
botAdminRoutes.get("/tenants/:id/bots", async (c) => {
  const tenantId = c.req.param("id");
  if (!await getTenantById(tenantId)) return c.json({ error: "Tenant not found" }, 404);
  const pageSize = Math.min(48, Math.max(1, Number(c.req.query("pageSize")) || 12));
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const q = c.req.query("q")?.trim().toLowerCase(), platform = c.req.query("platform");
  const where = and(eq(bots.tenantId, tenantId), ne(bots.connectionStatus, "deleted"), platform ? eq(bots.platform, platform) : undefined,
    q ? sql`lower(${bots.name}) like ${`%${q.replace(/[\\%_]/g, "\\$&")}%`} escape '\\'` : undefined);
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(bots).where(where);
  const rows = await db.select().from(bots).where(where).orderBy(desc(bots.createdAt), bots.id).limit(pageSize).offset((page - 1) * pageSize);
  return c.json({ success: true, bots: rows.map(publicBot), total: Number(n), page, pageSize });
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
botAdminRoutes.get("/bots/:botId", async (c) => {
  const [row] = await db.select().from(bots).where(eq(bots.id, c.req.param("botId")!)).limit(1);
  return c.json({ success: true, bot: publicBot(row) });
});
botAdminRoutes.get("/bots/:botId/guilds", (c) => {
  const guilds = discordBotManager.getGuilds(c.req.param("botId")!);
  return c.json({ success: true, connected: guilds !== null, guilds: guilds ?? [] });
});
const guildSettingsOut = (s: Awaited<ReturnType<typeof loadGuildSettings>>) => ({ systemPrompt: s.systemPrompt ?? "", useThreads: s.useThreads, alwaysChannelIds: s.alwaysChannelIds });
botAdminRoutes.get("/bots/:botId/guilds/:guildId/config", async (c) => {
  const [bot] = await db.select().from(bots).where(eq(bots.id, c.req.param("botId")!)).limit(1);
  return c.json({ success: true, config: guildSettingsOut(await loadGuildSettings(bot.tenantId, bot.id, c.req.param("guildId")!)) });
});
botAdminRoutes.put("/bots/:botId/guilds/:guildId/config", async (c) => {
  const [bot] = await db.select().from(bots).where(eq(bots.id, c.req.param("botId")!)).limit(1);
  const body = object(await c.req.json(), "body"), guildId = c.req.param("guildId")!;
  const input: Parameters<typeof upsertGuildConfig>[3] = {};
  if (body.systemPrompt !== undefined) {
    if (typeof body.systemPrompt !== "string" || body.systemPrompt.length > 8000) return c.json({ error: "systemPrompt must be a string of at most 8000 characters" }, 400);
    input.systemPrompt = body.systemPrompt.trim() || null;
  }
  if (body.useThreads !== undefined) {
    if (typeof body.useThreads !== "boolean") return c.json({ error: "useThreads must be a boolean" }, 400);
    input.useThreads = body.useThreads;
  }
  if (body.alwaysChannelIds !== undefined) input.alwaysChannelIds = stringArray(body.alwaysChannelIds, "alwaysChannelIds").slice(0, 50);
  await upsertGuildConfig(bot.tenantId, bot.id, guildId, input);
  await CacheService.del(guildCacheKey(bot.tenantId, bot.id, guildId));
  return c.json({ success: true, config: guildSettingsOut(await loadGuildSettings(bot.tenantId, bot.id, guildId)) });
});
// Only conversations the bot itself handled (mentions, DMs, its own threads) are stored.
botAdminRoutes.get("/bots/:botId/conversations", async (c) => {
  const channelId = c.req.query("channelId");
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 50));
  const where = and(eq(conversations.botId, c.req.param("botId")!), channelId ? eq(conversations.channelId, channelId) : undefined);
  const rows = await db.select({
    id: conversations.id, channelId: conversations.channelId, userId: conversations.userId, createdAt: conversations.createdAt,
    messageCount: sql<number>`(select count(*) from ${messages} where ${messages.conversationId} = ${conversations.id})`,
    lastMessageAt: sql<number | string | null>`(select max(${messages.createdAt}) from ${messages} where ${messages.conversationId} = ${conversations.id})`,
  }).from(conversations).where(where).orderBy(desc(conversations.createdAt)).limit(limit);
  return c.json({ success: true, conversations: rows.map((r: any) => ({ ...r, messageCount: Number(r.messageCount) })) });
});
botAdminRoutes.get("/bots/:botId/conversations/:id/messages", async (c) => {
  const [owned] = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, c.req.param("id")!), eq(conversations.botId, c.req.param("botId")!))).limit(1);
  if (!owned) return c.json({ error: "Conversation not found" }, 404);
  const rows = await db.select({ id: messages.id, role: messages.role, content: messages.content, createdAt: messages.createdAt }).from(messages)
    .where(and(eq(messages.conversationId, owned.id), sql`${messages.role} in ('user','assistant')`, sql`${messages.content} is not null`)).orderBy(desc(messages.createdAt)).limit(200);
  return c.json({ success: true, messages: rows.reverse() });
});
botAdminRoutes.patch("/bots/:botId", async (c) => {
  const fields = botFields(object(await c.req.json(), "body"));
  const [owner] = await db.select({ tenantId: bots.tenantId }).from(bots).where(eq(bots.id, c.req.param("botId")!)).limit(1);
  await assertProfile(owner!.tenantId, fields.profileId);
  const bot = await updateBot(c.req.param("botId"), fields);
  if (bot?.isEnabled) void discordBotManager.restartBot(bot.id).catch(() => {});
  else await discordBotManager.stopBot(c.req.param("botId"));
  return c.json({ success: true, bot: publicBot(bot) });
});
botAdminRoutes.post("/bots/:botId/restart", async (c) => c.json(await discordBotManager.restartBot(c.req.param("botId"))));
botAdminRoutes.delete("/bots/:botId", async (c) => {
  await discordBotManager.removeBot(c.req.param("botId")); await deleteBot(c.req.param("botId"));
  return c.json({ success: true });
});
