import type { Context, Hono } from "hono";
import { skillRegistry, listAvailabilityRules, setAvailabilityRule, clearAvailabilityRule, AvailabilityError, type LevelKey } from "@pachiware/skills";
import { object } from "./validation.js";

/**
 * GET lists one level's rules, PUT `{kind, name, value}` sets one, DELETE `?kind=&name=` clears one; each answers `{rules}` of that level.
 * `level` returns the level the request names, or null when its tenant or bot is not the caller's (404).
 */
export function availabilityRoutes(app: Hono<any>, path: string, level: (c: Context<any>) => Promise<LevelKey | null>) {
  const withLevel = (handle: (c: Context<any>, key: LevelKey) => Promise<Response>) => async (c: Context<any>) => {
    const key = await level(c);
    return key ? handle(c, key) : c.json({ error: "Not found" }, 404);
  };
  const out = async (c: Context<any>, key: LevelKey) => c.json({ success: true, rules: await listAvailabilityRules(key) });
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

/** The level a path names below a bot: the bot, a guild of it, or a channel of that guild. */
export const botLevel = (c: Context<any>, tenantId: string, botId: string): LevelKey => {
  const guildId = c.req.param("guildId"), channelId = c.req.param("channelId");
  return { tenantId, botId, guildId, channelId, level: channelId ? "channel" : guildId ? "guild" : "bot" };
};
