import type { Context, Hono } from "hono";
import { skillRegistry, listAvailabilityRules, inheritedAvailability, setAvailabilityRule, clearAvailabilityRule, listPlaybooks, AvailabilityError, type LevelKey } from "@pachiware/skills";
import { guildSlashStatus } from "../discord/commands.js";
import { db, bots } from "@pachiware/db";
import { and, eq, ne } from "drizzle-orm";
import { object } from "./validation.js";

/**
 * GET lists one level's rules, PUT `{kind, name, value}` sets one, DELETE `?kind=&name=` clears one; each answers `{rules, inherited}` of that level,
 * `inherited` being what the levels above leave it (see inheritedAvailability).
 * `level` returns the level the request names, or null when its tenant or bot is not the caller's (404).
 */
export function availabilityRoutes(app: Hono<any>, path: string, level: (c: Context<any>) => Promise<LevelKey | null>) {
  const withLevel = (handle: (c: Context<any>, key: LevelKey) => Promise<Response>) => async (c: Context<any>) => {
    const key = await level(c);
    return key ? handle(c, key) : c.json({ error: "Not found" }, 404);
  };
  // Commands are registered per guild, so only a guild's view says which playbooks have a slash command there.
  const slash = async (key: LevelKey) => key.level === "guild" ? { slash: await guildSlashStatus({ tenantId: key.tenantId, botId: key.botId!, guildId: key.guildId! }, await listPlaybooks(key.tenantId)) } : {};
  const out = async (c: Context<any>, key: LevelKey) => c.json({ success: true, rules: await listAvailabilityRules(key), inherited: await inheritedAvailability(key, skillRegistry.getAllSkills(), await skillRegistry.getActiveSkills(key.tenantId)), ...await slash(key) });
  app.get(path, withLevel(out));
  app.put(path, withLevel(async (c, key) => {
    const body = object(await c.req.json().catch(() => null), "body");
    try { await setAvailabilityRule(key, { kind: body.kind, name: String(body.name ?? ""), value: body.value }, skillRegistry.getAllSkills()); }
    catch (e) { if (e instanceof AvailabilityError) return c.json({ error: e.message }, 400); throw e; }
    return out(c, key);
  }));
  app.delete(path, withLevel(async (c, key) => {
    await clearAvailabilityRule(key, { kind: c.req.query("kind") ?? "", name: c.req.query("name") ?? "" });
    return out(c, key);
  }));
}

/**
 * Mounts the availability routes of a bot, its guilds and their channels under `botPath`, whose `:${param}` names the bot.
 * The bot must not be deleted and, when `tenantOf` is given, must belong to that tenant; otherwise 404.
 */
export function botAvailabilityRoutes(app: Hono<any>, botPath: string, param: string, tenantOf?: (c: Context<any>) => string) {
  const level = async (c: Context<any>): Promise<LevelKey | null> => {
    const botId = c.req.param(param)!, tenantId = tenantOf?.(c);
    const [bot] = await db.select({ tenantId: bots.tenantId }).from(bots).where(and(eq(bots.id, botId), ne(bots.connectionStatus, "deleted"), tenantId ? eq(bots.tenantId, tenantId) : undefined)).limit(1);
    if (!bot) return null;
    const guildId = c.req.param("guildId"), channelId = c.req.param("channelId");
    return { tenantId: bot.tenantId, botId, guildId, channelId, level: channelId ? "channel" : guildId ? "guild" : "bot" };
  };
  for (const path of ["", "/guilds/:guildId", "/guilds/:guildId/channels/:channelId"]) availabilityRoutes(app, `${botPath}${path}/availability`, level);
}
