import { Hono } from "hono";
import { object } from "../validation.js";
import { repositories } from "@pachiware/db";
import { skillRegistry } from "@pachiware/skills";
import { switchTenantSkill } from "../skillSwitch.js";
import type { TenantEnv } from "../../middleware/tenant.js";
import { CacheService, tenantKey } from "../../cache/redis.js";
export const skillRoutes = new Hono<TenantEnv>();
skillRoutes.get("/", async (c) => {
  await repositories().skills.seedTenant(c.get("tenantId"));
  const rows = await repositories().skills.listForTenant(c.get("tenantId"));
  return c.json({ success: true, skills: rows.map(({ skill: s, state }) => ({ ...s, isEnabled: state.isEnabled, config: state.config, tools: s.toolDefinitions, toolCount: s.toolDefinitions.length, updatedAt: state.updatedAt })) });
});
skillRoutes.patch("/:id/toggle", async (c) => {
  const current = await repositories().skills.getForTenant(c.get("tenantId"), c.req.param("id"));
  if (!current) return c.json({ error: "Skill not found" }, 404);
  const state = (await switchTenantSkill(c.get("tenantId"), current.skillId, !current.isEnabled))!;
  return c.json({ success: true, message: "Skill updated.", skill: { ...state, id: state.skillId } });
});
skillRoutes.put("/:id", async (c) => {
  const body = object(await c.req.json(), "body");
  if (!body.config || typeof body.config !== "object" || Array.isArray(body.config)) return c.json({ error: "config must be an object" }, 400);
  const state = await repositories().skills.setConfig(c.get("tenantId"), c.req.param("id"), body.config);
  if (!state) return c.json({ error: "Skill not found" }, 404);
  await CacheService.del(tenantKey(c.get("tenantId"), "skills:active"));
  return c.json({ success: true, skill: state });
});
skillRoutes.post("/test", async (c) => {
  const body = object(await c.req.json(), "body");
  if (typeof body.toolName !== "string") return c.json({ error: "toolName required" }, 400);
  const result = await skillRegistry.executeTool({ id: `test-${Date.now()}`, name: body.toolName, arguments: body.arguments || {} }, { tenantId: c.get("tenantId") });
  return c.json({ success: true, result });
});
