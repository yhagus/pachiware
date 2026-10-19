import { Hono } from "hono";
import { repositories, type GuildConfigInput, type PlaneScope } from "@pachiware/db";
import { now } from "@pachiware/skills";
import { discordBotManager } from "../../discord/client.js";
import { loadGuildSettings, saveGuildSettings, DailyLogTaken } from "../../loop/prompt.js";
import { object, string, stringArray, placeSettings, digestChannels, dailyLogChannels, docSources } from "../validation.js";
import { DocSourceRefused } from "../../docsMirror.js";
import { botFields, assertProfile, assertAccounts, botColumns, saveAccounts, botsOut } from "../v1/bots.js";
import { botAvailabilityRoutes } from "../availability.js";
import { botReminderRoutes } from "../reminders.js";
import { patchConversationMetadata } from "../../loop/conversationMetadata.js";
export const botAdminRoutes = new Hono();
botAdminRoutes.post("/tenants/:id/bots", async (c) => {
  if (!await repositories().tenants.get(c.req.param("id"))) return c.json({ error: "Tenant not found" }, 404);
  const fields = botFields(object(await c.req.json(), "body"), true);
  await assertProfile(c.req.param("id"), fields.profileId);
  await assertAccounts(c.req.param("id"), fields);
  const bot = await repositories().bots.create({ tenantId: c.req.param("id"), ...botColumns(fields) } as any);
  await saveAccounts(c.req.param("id"), bot.id, fields);
  if (bot.isEnabled) void discordBotManager.startBot(bot.id).catch(() => {});
  return c.json({ success: true, bot: (await botsOut([bot]))[0] }, 201);
});
botAdminRoutes.get("/tenants/:id/bots", async (c) => {
  const tenantId = c.req.param("id");
  if (!await repositories().tenants.get(tenantId)) return c.json({ error: "Tenant not found" }, 404);
  const pageSize = Math.min(48, Math.max(1, Number(c.req.query("pageSize")) || 12));
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const { bots, total } = await repositories().bots.search(tenantId, { q: c.req.query("q"), platform: c.req.query("platform"), page, pageSize });
  return c.json({ success: true, bots: await botsOut(bots), total, page, pageSize });
});
botAdminRoutes.use("/bots/:botId/*", async (c, next) => {
  const row = await repositories().bots.get(c.req.param("botId")!);
  if (!row || !await repositories().tenants.get(row.tenantId)) return c.json({ error: "Bot not found" }, 404);
  await next();
});
botAdminRoutes.use("/bots/:botId", async (c, next) => {
  const row = await repositories().bots.get(c.req.param("botId")!);
  if (!row || !await repositories().tenants.get(row.tenantId)) return c.json({ error: "Bot not found" }, 404);
  await next();
});
botAdminRoutes.get("/bots/:botId", async (c) => {
  const row = (await repositories().bots.get(c.req.param("botId")!))!;
  return c.json({ success: true, bot: (await botsOut([row]))[0] });
});
botAdminRoutes.get("/bots/:botId/guilds", (c) => {
  const guilds = discordBotManager.getGuilds(c.req.param("botId")!);
  return c.json({ success: true, connected: guilds !== null, guilds: guilds ?? [] });
});
const guildSettingsOut = (s: Awaited<ReturnType<typeof loadGuildSettings>>) => ({ systemPrompt: s.systemPrompt ?? "", useThreads: s.useThreads, alwaysChannelIds: s.alwaysChannelIds, timezone: s.timezone, language: s.language, digestChannels: s.digestChannels, dailyLogChannels: s.dailyLogChannels, docSources: s.docSources });
botAdminRoutes.get("/bots/:botId/guilds/:guildId/config", async (c) => {
  const bot = (await repositories().bots.get(c.req.param("botId")!))!;
  return c.json({ success: true, config: guildSettingsOut(await loadGuildSettings(bot.tenantId, bot.id, c.req.param("guildId")!)) });
});
botAdminRoutes.put("/bots/:botId/guilds/:guildId/config", async (c) => {
  const bot = (await repositories().bots.get(c.req.param("botId")!))!;
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
  if (body.dailyLogChannels !== undefined) input.dailyLogChannels = dailyLogChannels(body.dailyLogChannels);
  if (body.docSources !== undefined) input.docSources = docSources(body.docSources);
  Object.assign(input, placeSettings(body, true));
  try { return c.json({ success: true, config: guildSettingsOut(await saveGuildSettings(bot.tenantId, bot.id, guildId, input, discordBotManager)) }); }
  catch (e) {
    if (e instanceof DailyLogTaken) return c.json({ error: e.message }, 409);
    if (e instanceof DocSourceRefused) return c.json({ error: e.message }, 400);
    throw e;
  }
});
// Git access per server (channelId "") and per channel: which attached accounts are on, and which repos (wildcard patterns).
const scopesOut = (rows: any[], channelId: string) => rows.filter((r) => r.channelId === channelId).map((r) => ({ gitAccountId: r.gitAccountId, repoPatterns: r.repoPatterns }));
botAdminRoutes.get("/bots/:botId/guilds/:guildId/git", async (c) => {
  const botId = c.req.param("botId")!, rows = await repositories().git.listScopes(botId, c.req.param("guildId")!);
  const channels: Record<string, ReturnType<typeof scopesOut>> = {};
  for (const id of new Set<string>(rows.filter((r: any) => r.channelId).map((r: any) => r.channelId))) channels[id] = scopesOut(rows, id);
  const accounts = (await repositories().git.listBotAccounts(botId)).map(({ id, name, provider, baseUrl, username }) => ({ id, name, provider, baseUrl, username }));
  return c.json({ success: true, accounts, server: scopesOut(rows, ""), channels });
});
async function putScope(c: any, channelId: string) {
  const bot = (await repositories().bots.get(c.req.param("botId")!))!;
  const body = object(await c.req.json(), "body");
  if (!Array.isArray(body.rules)) return c.json({ error: "rules must be an array" }, 400);
  const rules = body.rules.map((r: any) => { const o = object(r, "rule"); return { gitAccountId: string(o.gitAccountId, "gitAccountId")!, repoPatterns: stringArray(o.repoPatterns, "repoPatterns") }; });
  try { await repositories().git.replaceScopes(bot.tenantId, bot.id, c.req.param("guildId")!, channelId, rules); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
  const rows = await repositories().git.listScopes(bot.id, c.req.param("guildId")!);
  return c.json({ success: true, server: scopesOut(rows, ""), rules: scopesOut(rows, channelId) });
}
botAdminRoutes.put("/bots/:botId/guilds/:guildId/git", (c) => putScope(c, ""));
botAdminRoutes.put("/bots/:botId/guilds/:guildId/channels/:channelId/git", (c) => putScope(c, c.req.param("channelId")!));
// Plane access per guild (channelId "") and per channel: which attached Plane accounts are on, and which Plane project ids ("*" for all).
const planeRulesOut = (rows: PlaneScope[], channelId: string) => rows.filter((r) => r.channelId === channelId).map((r) => ({ planeAccountId: r.planeAccountId, projectIds: r.projectIds }));
async function planeScopeOut(botId: string, guildId: string) {
  const rows = await repositories().plane.listScopes(botId, guildId);
  const channels: Record<string, ReturnType<typeof planeRulesOut>> = {};
  for (const id of new Set(rows.filter((r) => r.channelId).map((r) => r.channelId))) channels[id] = planeRulesOut(rows, id);
  return { guild: planeRulesOut(rows, ""), channels };
}
botAdminRoutes.get("/bots/:botId/guilds/:guildId/plane", async (c) => {
  const botId = c.req.param("botId")!;
  const accounts = (await repositories().plane.listBotAccounts(botId)).map(({ id, name, baseUrl, workspaceSlug, planeUserName }) => ({ id, name, baseUrl, workspaceSlug, planeUserName }));
  return c.json({ success: true, accounts, ...await planeScopeOut(botId, c.req.param("guildId")!) });
});
async function putPlaneScope(c: any, channelId: string) {
  const bot = (await repositories().bots.get(c.req.param("botId")!))!;
  const body = object(await c.req.json(), "body");
  if (!Array.isArray(body.rules)) return c.json({ error: "rules must be an array" }, 400);
  const rules = body.rules.map((r: any) => { const o = object(r, "rule"); return { planeAccountId: string(o.planeAccountId, "planeAccountId")!, projectIds: stringArray(o.projectIds, "projectIds") }; });
  try { await repositories().plane.replaceScopes(bot.tenantId, bot.id, c.req.param("guildId")!, channelId, rules); }
  catch (e) { return c.json({ error: (e as Error).message }, 400); }
  const out = await planeScopeOut(bot.id, c.req.param("guildId")!);
  return c.json({ success: true, guild: out.guild, rules: channelId ? out.channels[channelId] ?? [] : out.guild });
}
botAdminRoutes.put("/bots/:botId/guilds/:guildId/plane", (c) => putPlaneScope(c, ""));
botAdminRoutes.put("/bots/:botId/guilds/:guildId/channels/:channelId/plane", (c) => putPlaneScope(c, c.req.param("channelId")!));
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
// Ends a conversation, so the next message in its channel or thread starts a fresh one; nothing is posted in Discord. Ending it again keeps the first time.
botAdminRoutes.post("/bots/:botId/conversations/:id/end", async (c) => {
  const owned = await repositories().conversations.getForBot(c.req.param("botId")!, c.req.param("id")!);
  if (!owned) return c.json({ error: "Conversation not found" }, 404);
  const endedAt: string = owned.metadata?.endedAt ?? new Date(now()).toISOString();
  if (!owned.metadata?.endedAt) await patchConversationMetadata(owned.tenantId, owned.id, { endedAt });
  return c.json({ success: true, endedAt });
});
botAdminRoutes.patch("/bots/:botId", async (c) => {
  const fields = botFields(object(await c.req.json(), "body"));
  const owner = await repositories().bots.get(c.req.param("botId")!);
  await assertProfile(owner!.tenantId, fields.profileId);
  await assertAccounts(owner!.tenantId, fields);
  const bot = (await repositories().bots.update(c.req.param("botId"), botColumns(fields)))!;
  await saveAccounts(owner!.tenantId, c.req.param("botId"), fields);
  if (bot.isEnabled) void discordBotManager.restartBot(bot.id).catch(() => {});
  else await discordBotManager.stopBot(c.req.param("botId"));
  return c.json({ success: true, bot: (await botsOut([bot]))[0] });
});
botAdminRoutes.post("/bots/:botId/restart", async (c) => c.json(await discordBotManager.restartBot(c.req.param("botId"))));
botAdminRoutes.delete("/bots/:botId", async (c) => {
  await discordBotManager.removeBot(c.req.param("botId")); await repositories().bots.remove(c.req.param("botId"));
  return c.json({ success: true });
});
