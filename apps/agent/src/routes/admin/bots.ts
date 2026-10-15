import { Hono } from "hono";
import { repositories, db, bots, createBot, updateBot, deleteBot, setBotGitAccounts, listBotGitAccounts, listGitScopes, replaceGitScopes, eq, type GuildConfigInput } from "@pachiware/db";
import { ne, and, desc, sql } from "drizzle-orm";
import { discordBotManager } from "../../discord/client.js";
import { loadGuildSettings, saveGuildSettings } from "../../loop/prompt.js";
import { object, string, stringArray, placeSettings, digestChannels } from "../validation.js";
import { botFields, assertProfile, assertGitAccounts, botsOut } from "../v1/bots.js";
import { botAvailabilityRoutes } from "../availability.js";
import { botReminderRoutes } from "../reminders.js";
export const botAdminRoutes = new Hono();
botAdminRoutes.post("/tenants/:id/bots", async (c) => {
  if (!await repositories().tenants.get(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  const fields = botFields(object(await c.req.json(), "body"), true);
  await assertProfile(c.req.param("id"), fields.profileId);
  await assertGitAccounts(c.req.param("id"), fields.gitAccountIds);
  const { gitAccountIds, ...rest } = fields;
  const bot = await createBot({ tenantId: c.req.param("id"), ...rest } as any);
  if (gitAccountIds) await setBotGitAccounts(c.req.param("id"), bot.id, gitAccountIds);
  if (bot.isEnabled) void discordBotManager.startBot(bot.id).catch(() => {});
  return c.json({ success: true, bot: (await botsOut([bot]))[0] }, 201);
});
botAdminRoutes.get("/tenants/:id/bots", async (c) => {
  const tenantId = c.req.param("id");
  if (!await repositories().tenants.get(tenantId)) return c.json({ error: "Tenant not found" }, 404);
  const pageSize = Math.min(48, Math.max(1, Number(c.req.query("pageSize")) || 12));
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const q = c.req.query("q")?.trim().toLowerCase(), platform = c.req.query("platform");
  const where = and(eq(bots.tenantId, tenantId), ne(bots.connectionStatus, "deleted"), platform ? eq(bots.platform, platform) : undefined,
    q ? sql`lower(${bots.name}) like ${`%${q.replace(/[\\%_]/g, "\\$&")}%`} escape '\\'` : undefined);
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(bots).where(where);
  const rows = await db.select().from(bots).where(where).orderBy(desc(bots.createdAt), bots.id).limit(pageSize).offset((page - 1) * pageSize);
  return c.json({ success: true, bots: await botsOut(rows), total: Number(n), page, pageSize });
});
botAdminRoutes.use("/bots/:botId/*", async (c, next) => {
  const [row] = await db.select().from(bots).where(and(eq(bots.id, c.req.param("botId")!), ne(bots.connectionStatus, "deleted"))).limit(1);
  if (!row || !await repositories().tenants.get(row.tenantId)) return c.json({ error: "Bot not found" }, 404);
  await next();
});
botAdminRoutes.use("/bots/:botId", async (c, next) => {
  const [row] = await db.select().from(bots).where(and(eq(bots.id, c.req.param("botId")!), ne(bots.connectionStatus, "deleted"))).limit(1);
  if (!row || !await repositories().tenants.get(row.tenantId)) return c.json({ error: "Bot not found" }, 404);
  await next();
});
botAdminRoutes.get("/bots/:botId", async (c) => {
  const [row] = await db.select().from(bots).where(eq(bots.id, c.req.param("botId")!)).limit(1);
  return c.json({ success: true, bot: (await botsOut([row]))[0] });
});
botAdminRoutes.get("/bots/:botId/guilds", (c) => {
  const guilds = discordBotManager.getGuilds(c.req.param("botId")!);
  return c.json({ success: true, connected: guilds !== null, guilds: guilds ?? [] });
});
const guildSettingsOut = (s: Awaited<ReturnType<typeof loadGuildSettings>>) => ({ systemPrompt: s.systemPrompt ?? "", useThreads: s.useThreads, alwaysChannelIds: s.alwaysChannelIds, timezone: s.timezone, language: s.language, digestChannels: s.digestChannels });
botAdminRoutes.get("/bots/:botId/guilds/:guildId/config", async (c) => {
  const [bot] = await db.select().from(bots).where(eq(bots.id, c.req.param("botId")!)).limit(1);
  return c.json({ success: true, config: guildSettingsOut(await loadGuildSettings(bot.tenantId, bot.id, c.req.param("guildId")!)) });
});
botAdminRoutes.put("/bots/:botId/guilds/:guildId/config", async (c) => {
  const [bot] = await db.select().from(bots).where(eq(bots.id, c.req.param("botId")!)).limit(1);
  const body = object(await c.req.json(), "body"), guildId = c.req.param("guildId")!;
  const input: GuildConfigInput = {};
  if (body.systemPrompt !== undefined) {
    if (typeof body.systemPrompt !== "string" || body.systemPrompt.length > 8000) return c.json({ error: "systemPrompt must be a string of at most 8000 characters" }, 400);
    input.systemPrompt = body.systemPrompt.trim() || null;
  }
  if (body.useThreads !== undefined) {
    if (typeof body.useThreads !== "boolean") return c.json({ error: "useThreads must be a boolean" }, 400);
    input.useThreads = body.useThreads;
  }
  if (body.alwaysChannelIds !== undefined) input.alwaysChannelIds = stringArray(body.alwaysChannelIds, "alwaysChannelIds").slice(0, 50);
  if (body.digestChannels !== undefined) input.digestChannels = digestChannels(body.digestChannels);
  Object.assign(input, placeSettings(body, true));
  return c.json({ success: true, config: guildSettingsOut(await saveGuildSettings(bot.tenantId, bot.id, guildId, input)) });
});
// Git access per server (channelId "") and per channel: which attached accounts are on, and which repos (wildcard patterns).
const scopesOut = (rows: any[], channelId: string) => rows.filter((r) => r.channelId === channelId).map((r) => ({ gitAccountId: r.gitAccountId, repoPatterns: r.repoPatterns }));
botAdminRoutes.get("/bots/:botId/guilds/:guildId/git", async (c) => {
  const botId = c.req.param("botId")!, rows = await listGitScopes(botId, c.req.param("guildId")!);
  const channels: Record<string, ReturnType<typeof scopesOut>> = {};
  for (const id of new Set<string>(rows.filter((r: any) => r.channelId).map((r: any) => r.channelId))) channels[id] = scopesOut(rows, id);
  return c.json({ success: true, accounts: await listBotGitAccounts(botId), server: scopesOut(rows, ""), channels });
});
async function putScope(c: any, channelId: string) {
  const [bot] = await db.select().from(bots).where(eq(bots.id, c.req.param("botId")!)).limit(1);
  const body = object(await c.req.json(), "body");
  if (!Array.isArray(body.rules)) return c.json({ error: "rules must be an array" }, 400);
  const rules = body.rules.map((r: any) => { const o = object(r, "rule"); return { gitAccountId: string(o.gitAccountId, "gitAccountId")!, repoPatterns: stringArray(o.repoPatterns, "repoPatterns") }; });
  try { await replaceGitScopes(bot.tenantId, bot.id, c.req.param("guildId")!, channelId, rules); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
  const rows = await listGitScopes(bot.id, c.req.param("guildId")!);
  return c.json({ success: true, server: scopesOut(rows, ""), rules: scopesOut(rows, channelId) });
}
botAdminRoutes.put("/bots/:botId/guilds/:guildId/git", (c) => putScope(c, ""));
botAdminRoutes.put("/bots/:botId/guilds/:guildId/channels/:channelId/git", (c) => putScope(c, c.req.param("channelId")!));
botAvailabilityRoutes(botAdminRoutes, "/bots/:botId", "botId");
botReminderRoutes(botAdminRoutes, "/bots/:botId", "botId");
// Only conversations the bot itself handled (mentions, DMs, its own threads) are stored.
botAdminRoutes.get("/bots/:botId/conversations", async (c) => {
  const channelId = c.req.query("channelId");
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 50));
  return c.json({ success: true, conversations: await repositories().conversations.listForBot(c.req.param("botId")!, { channelId, limit }) });
});
botAdminRoutes.get("/bots/:botId/conversations/:id/messages", async (c) => {
  const { conversations } = repositories();
  const owned = await conversations.getForBot(c.req.param("botId")!, c.req.param("id")!);
  if (!owned) return c.json({ error: "Conversation not found" }, 404);
  const rows = await conversations.latestMessages(owned.tenantId, owned.id, { limit: 200, chatOnly: true });
  return c.json({ success: true, messages: rows.map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt })) });
});
botAdminRoutes.patch("/bots/:botId", async (c) => {
  const fields = botFields(object(await c.req.json(), "body"));
  const [owner] = await db.select({ tenantId: bots.tenantId }).from(bots).where(eq(bots.id, c.req.param("botId")!)).limit(1);
  await assertProfile(owner!.tenantId, fields.profileId);
  await assertGitAccounts(owner!.tenantId, fields.gitAccountIds);
  const { gitAccountIds, ...rest } = fields;
  const bot = await updateBot(c.req.param("botId"), rest);
  if (gitAccountIds) await setBotGitAccounts(owner!.tenantId, c.req.param("botId"), gitAccountIds);
  if (bot?.isEnabled) void discordBotManager.restartBot(bot.id).catch(() => {});
  else await discordBotManager.stopBot(c.req.param("botId"));
  return c.json({ success: true, bot: (await botsOut([bot]))[0] });
});
botAdminRoutes.post("/bots/:botId/restart", async (c) => c.json(await discordBotManager.restartBot(c.req.param("botId"))));
botAdminRoutes.delete("/bots/:botId", async (c) => {
  await discordBotManager.removeBot(c.req.param("botId")); await deleteBot(c.req.param("botId"));
  return c.json({ success: true });
});
