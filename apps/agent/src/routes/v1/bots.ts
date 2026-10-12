import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db, bots, profiles, gitAccounts, botGitAccounts, setBotGitAccounts, createBot, updateBot, deleteBot, getBotDecrypted, listBotsForTenant } from "@pachiware/db";
import { and, eq, ne, inArray } from "drizzle-orm";
import type { TenantEnv } from "../../middleware/tenant.js";
import { DiscordBotManager, discordBotManager } from "../../discord/client.js";
import { object, string, stringArray, publicBot } from "../validation.js";
import { availabilityRoutes, botLevel } from "../availability.js";

export const botRoutes = new Hono<TenantEnv>();
// A profile can only be attached to integrations of the tenant that owns it.
export async function assertProfile(tenantId: string, profileId: string | null | undefined) {
  if (!profileId) return;
  const [row] = await db.select({ id: profiles.id }).from(profiles).where(and(eq(profiles.id, profileId), eq(profiles.tenantId, tenantId))).limit(1);
  if (!row) throw new HTTPException(400, { message: "Profile not found for this tenant" });
}
// A bot may hold many git accounts, all of its own tenant (the DB composite FK enforces the same).
export async function assertGitAccounts(tenantId: string, ids: string[] | undefined) {
  if (!ids?.length) return;
  const rows = await db.select({ id: gitAccounts.id }).from(gitAccounts).where(and(eq(gitAccounts.tenantId, tenantId), inArray(gitAccounts.id, ids)));
  if (rows.length !== new Set(ids).size) throw new HTTPException(400, { message: "Git account not found for this tenant" });
}
// Bot rows as the API returns them, plus the ids of the git accounts attached to each.
export async function botsOut(rows: any[]) {
  const links = rows.length ? await db.select({ botId: botGitAccounts.botId, id: botGitAccounts.gitAccountId }).from(botGitAccounts).where(inArray(botGitAccounts.botId, rows.map((r) => r.id))) : [];
  return rows.map((r) => ({ ...publicBot(r), gitAccountIds: links.filter((l: any) => l.botId === r.id).map((l: any) => l.id) }));
}
export function botFields(body: Record<string, any>, creating = false) {
  const fields: Record<string, any> = {};
  for (const key of ["name", "clientId"]) if (body[key] !== undefined) fields[key] = string(body[key], key);
  if (body.token !== undefined || creating) fields.token = string(body.token, "token");
  if (fields.token?.includes("••••")) delete fields.token;
  if (creating && !fields.token) throw new HTTPException(400, { message: "A new bot token is required" });
  if (body.profileId !== undefined) fields.profileId = body.profileId === null ? null : string(body.profileId, "profileId");
  if (body.gitAccountIds !== undefined) fields.gitAccountIds = stringArray(body.gitAccountIds, "gitAccountIds").slice(0, 20);
  if (body.guildIds !== undefined) fields.guildIds = stringArray(body.guildIds, "guildIds");
  if (body.isEnabled !== undefined) {
    if (typeof body.isEnabled !== "boolean") throw new HTTPException(400, { message: "isEnabled must be boolean" });
    fields.isEnabled = body.isEnabled;
  }
  if (body.platform !== undefined && body.platform !== "discord") throw new HTTPException(400, { message: "Only Discord bots are supported" });
  return fields;
}
botRoutes.get("/", async (c) => c.json({ success: true, bots: await botsOut(await listBotsForTenant(c.get("tenantId"))) }));
botRoutes.post("/", async (c) => {
  const body = object(await c.req.json(), "body");
  const fields = botFields(body, true);
  await assertProfile(c.get("tenantId"), fields.profileId);
  await assertGitAccounts(c.get("tenantId"), fields.gitAccountIds);
  const { gitAccountIds, ...rest } = fields;
  const bot = await createBot({ tenantId: c.get("tenantId"), ...rest } as any);
  if (gitAccountIds) await setBotGitAccounts(c.get("tenantId"), bot.id, gitAccountIds);
  if (bot.isEnabled) void discordBotManager.startBot(bot.id).catch(() => {});
  return c.json({ success: true, bot: (await botsOut([bot]))[0] }, 201);
});
botRoutes.use("/:id/*", async (c, next) => {
  const [owned] = await db.select().from(bots).where(and(eq(bots.id, c.req.param("id")!), eq(bots.tenantId, c.get("tenantId")), ne(bots.connectionStatus, "deleted"))).limit(1);
  if (!owned) return c.json({ error: "Bot not found" }, 404);
  await next();
});
// Apply the same ownership guard to the bare resource path.
botRoutes.use("/:id", async (c, next) => {
  const [owned] = await db.select().from(bots).where(and(eq(bots.id, c.req.param("id")!), eq(bots.tenantId, c.get("tenantId")), ne(bots.connectionStatus, "deleted"))).limit(1);
  if (!owned) return c.json({ error: "Bot not found" }, 404);
  await next();
});
botRoutes.patch("/:id", async (c) => {
  const fields = botFields(object(await c.req.json(), "body"));
  await assertProfile(c.get("tenantId"), fields.profileId);
  await assertGitAccounts(c.get("tenantId"), fields.gitAccountIds);
  const { gitAccountIds, ...rest } = fields;
  const bot = await updateBot(c.req.param("id"), rest);
  if (gitAccountIds) await setBotGitAccounts(c.get("tenantId"), c.req.param("id"), gitAccountIds);
  if (bot?.isEnabled) void discordBotManager.restartBot(bot.id).catch(() => {});
  else await discordBotManager.stopBot(c.req.param("id"));
  return c.json({ success: true, bot: (await botsOut([bot]))[0] });
});
botRoutes.delete("/:id", async (c) => { await discordBotManager.removeBot(c.req.param("id")); await deleteBot(c.req.param("id")); return c.json({ success: true }); });
botRoutes.post("/:id/restart", async (c) => c.json(await discordBotManager.restartBot(c.req.param("id"))));
botRoutes.post("/:id/test", async (c) => {
  const body = object(await c.req.json(), "body");
  const resolved = await getBotDecrypted(c.req.param("id"));
  const token = typeof body.token === "string" && !body.token.includes("••••") ? body.token : resolved!.token;
  return c.json(await DiscordBotManager.testToken(token));
});
const ownBotLevel = async (c: any) => {
  const [bot] = await db.select({ id: bots.id }).from(bots).where(and(eq(bots.id, c.req.param("id")!), eq(bots.tenantId, c.get("tenantId")), ne(bots.connectionStatus, "deleted"))).limit(1);
  return bot ? botLevel(c, c.get("tenantId"), bot.id) : null;
};
for (const path of ["/:id/availability", "/:id/guilds/:guildId/availability", "/:id/guilds/:guildId/channels/:channelId/availability"]) availabilityRoutes(botRoutes, path, ownBotLevel);
