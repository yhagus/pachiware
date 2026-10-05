import { Hono } from "hono";
import { object } from "../validation.js";
import { db, skills, tenantSkills, seedTenant } from "@pachiware/db";
import { and, eq } from "drizzle-orm";
import { skillRegistry } from "@pachiware/skills";
import type { TenantEnv } from "../../middleware/tenant.js";
import { CacheService, tenantKey } from "../../cache/redis.js";
export const skillRoutes = new Hono<TenantEnv>();
skillRoutes.get("/", async (c) => {
  await seedTenant(c.get("tenantId"));
  const rows = await db.select({ definition: skills, state: tenantSkills }).from(tenantSkills).innerJoin(skills, eq(tenantSkills.skillId, skills.id)).where(eq(tenantSkills.tenantId, c.get("tenantId")));
  return c.json({ success: true, skills: rows.map(({ definition: s, state }: any) => ({ ...s, isEnabled: state.isEnabled, config: state.config, tools: s.toolDefinitions, toolCount: s.toolDefinitions.length, updatedAt: state.updatedAt })) });
});
skillRoutes.patch("/:id/toggle", async (c) => {
  const where = and(eq(tenantSkills.tenantId, c.get("tenantId")), eq(tenantSkills.skillId, c.req.param("id")));
  const [current] = await db.select().from(tenantSkills).where(where).limit(1);
  if (!current) return c.json({ error: "Skill not found" }, 404);
  const [state] = await db.update(tenantSkills).set({ isEnabled: !current.isEnabled, updatedAt: new Date() }).where(where).returning();
  await CacheService.del(tenantKey(c.get("tenantId"), "skills:active"));
  return c.json({ success: true, message: "Skill updated.", skill: { ...state, id: state.skillId } });
});
skillRoutes.put("/:id", async (c) => {
  const body = object(await c.req.json(), "body");
  if (!body.config || typeof body.config !== "object" || Array.isArray(body.config)) return c.json({ error: "config must be an object" }, 400);
  const [state] = await db.update(tenantSkills).set({ config: body.config, updatedAt: new Date() }).where(and(eq(tenantSkills.tenantId, c.get("tenantId")), eq(tenantSkills.skillId, c.req.param("id")))).returning();
  if (!state) return c.json({ error: "Skill not found" }, 404);
  await CacheService.del(tenantKey(c.get("tenantId"), "skills:active"));
  return c.json({ success: true, skill: state });
});
skillRoutes.post("/test", async (c) => {
  const body = object(await c.req.json(), "body");
  if (typeof body.toolName !== "string") return c.json({ error: "toolName required" }, 400);
  const result = await skillRegistry.executeTool({ id: `test-${Date.now()}`, name: body.toolName, arguments: body.arguments || {} }, { db, tenantId: c.get("tenantId") });
  return c.json({ success: true, result });
});
