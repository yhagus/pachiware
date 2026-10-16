import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { repositories, type Bot } from "@pachiware/db";
import type { TenantEnv } from "../../middleware/tenant.js";
import { DiscordBotManager, discordBotManager } from "../../discord/client.js";
import { object, string, stringArray } from "../validation.js";
import { botAvailabilityRoutes } from "../availability.js";
import { botReminderRoutes } from "../reminders.js";

export const botRoutes = new Hono<TenantEnv>();
// A profile can only be attached to integrations of the tenant that owns it.
export async function assertProfile(tenantId: string, profileId: string | null | undefined) {
  if (!profileId) return;
  if (!await repositories().profiles.getForTenant(tenantId, profileId)) throw new HTTPException(400, { message: "Profile not found for this tenant" });
}
// A bot may hold many git accounts, all of its own tenant (the DB composite FK enforces the same).
export async function assertGitAccounts(tenantId: string, ids: string[] | undefined) {
  if (!ids?.length) return;
  if (!await repositories().git.ownsAccounts(tenantId, ids)) throw new HTTPException(400, { message: "Git account not found for this tenant" });
}
// A bot may hold many Plane accounts, all of its own tenant.
export async function assertPlaneAccounts(tenantId: string, ids: string[] | undefined) {
  if (!ids?.length) return;
  if (!await repositories().plane.ownsAccounts(tenantId, ids)) throw new HTTPException(400, { message: "Plane account not found for this tenant" });
}
// Bots as the API returns them, plus the ids of the git and Plane accounts attached to each.
export async function botsOut(rows: Bot[]) {
  const ids = rows.map((r) => r.id);
  const [git, plane] = [await repositories().git.botAccountIds(ids), await repositories().plane.botAccountIds(ids)];
  return rows.map((r) => ({ ...r, gitAccountIds: git[r.id] ?? [], planeAccountIds: plane[r.id] ?? [] }));
}
/** Checks the account ids a bot body names against the tenant, before the bot is written. */
export async function assertAccounts(tenantId: string, fields: Record<string, any>) {
  await assertGitAccounts(tenantId, fields.gitAccountIds);
  await assertPlaneAccounts(tenantId, fields.planeAccountIds);
}
/** The bot's own fields, without the account links that `saveAccounts` writes. */
export const botColumns = ({ gitAccountIds, planeAccountIds, ...rest }: Record<string, any>) => rest;
/** Replaces the git and Plane accounts a bot holds, for each list the body gave. */
export async function saveAccounts(tenantId: string, botId: string, fields: Record<string, any>) {
  if (fields.gitAccountIds) await repositories().git.setBotAccounts(tenantId, botId, fields.gitAccountIds);
  if (fields.planeAccountIds) await repositories().plane.setBotAccounts(tenantId, botId, fields.planeAccountIds);
}
export function botFields(body: Record<string, any>, creating = false) {
  const fields: Record<string, any> = {};
  for (const key of ["name", "clientId"]) if (body[key] !== undefined) fields[key] = string(body[key], key);
  if (body.token !== undefined || creating) fields.token = string(body.token, "token");
  if (fields.token?.includes("••••")) delete fields.token;
  if (creating && !fields.token) throw new HTTPException(400, { message: "A new bot token is required" });
  if (body.profileId !== undefined) fields.profileId = body.profileId === null ? null : string(body.profileId, "profileId");
  if (body.gitAccountIds !== undefined) fields.gitAccountIds = stringArray(body.gitAccountIds, "gitAccountIds").slice(0, 20);
  if (body.planeAccountIds !== undefined) fields.planeAccountIds = stringArray(body.planeAccountIds, "planeAccountIds").slice(0, 20);
  if (body.guildIds !== undefined) fields.guildIds = stringArray(body.guildIds, "guildIds");
  if (body.isEnabled !== undefined) {
    if (typeof body.isEnabled !== "boolean") throw new HTTPException(400, { message: "isEnabled must be boolean" });
    fields.isEnabled = body.isEnabled;
  }
  if (body.platform !== undefined && body.platform !== "discord") throw new HTTPException(400, { message: "Only Discord bots are supported" });
  return fields;
}
botRoutes.get("/", async (c) => c.json({ success: true, bots: await botsOut(await repositories().bots.listForTenant(c.get("tenantId"))) }));
botRoutes.post("/", async (c) => {
  const body = object(await c.req.json(), "body");
  const fields = botFields(body, true);
  await assertProfile(c.get("tenantId"), fields.profileId);
  await assertAccounts(c.get("tenantId"), fields);
  const bot = await repositories().bots.create({ tenantId: c.get("tenantId"), ...botColumns(fields) } as any);
  await saveAccounts(c.get("tenantId"), bot.id, fields);
  if (bot.isEnabled) void discordBotManager.startBot(bot.id).catch(() => {});
  return c.json({ success: true, bot: (await botsOut([bot]))[0] }, 201);
});
botRoutes.use("/:id/*", async (c, next) => {
  if (!await repositories().bots.get(c.req.param("id")!, c.get("tenantId"))) return c.json({ error: "Bot not found" }, 404);
  await next();
});
// Apply the same ownership guard to the bare resource path.
botRoutes.use("/:id", async (c, next) => {
  if (!await repositories().bots.get(c.req.param("id")!, c.get("tenantId"))) return c.json({ error: "Bot not found" }, 404);
  await next();
});
botRoutes.patch("/:id", async (c) => {
  const fields = botFields(object(await c.req.json(), "body"));
  await assertProfile(c.get("tenantId"), fields.profileId);
  await assertAccounts(c.get("tenantId"), fields);
  const bot = (await repositories().bots.update(c.req.param("id"), botColumns(fields)))!;
  await saveAccounts(c.get("tenantId"), c.req.param("id"), fields);
  if (bot.isEnabled) void discordBotManager.restartBot(bot.id).catch(() => {});
  else await discordBotManager.stopBot(c.req.param("id"));
  return c.json({ success: true, bot: (await botsOut([bot]))[0] });
});
botRoutes.delete("/:id", async (c) => { await discordBotManager.removeBot(c.req.param("id")); await repositories().bots.remove(c.req.param("id")); return c.json({ success: true }); });
botRoutes.post("/:id/restart", async (c) => c.json(await discordBotManager.restartBot(c.req.param("id"))));
botRoutes.post("/:id/test", async (c) => {
  const body = object(await c.req.json(), "body");
  const resolved = await repositories().bots.getWithToken(c.req.param("id"));
  const token = typeof body.token === "string" && !body.token.includes("••••") ? body.token : resolved!.token;
  return c.json(await DiscordBotManager.testToken(token));
});
botAvailabilityRoutes(botRoutes, "/:id", "id", (c) => c.get("tenantId"));
botReminderRoutes(botRoutes, "/:id", "id", (c) => c.get("tenantId"));
