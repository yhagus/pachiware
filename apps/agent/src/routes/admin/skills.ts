import { Hono } from "hono";
import { db, skills, tenantSkills, seedTenant, getTenantById, eq } from "@pachiware/db";
import { and } from "drizzle-orm";
import { skillRegistry } from "@pachiware/skills";
import { CacheService, tenantKey } from "../../cache/redis.js";

export const skillAdminRoutes = new Hono();

skillAdminRoutes.get("/tenants/:id/skills", async (c) => {
  const id = c.req.param("id");
  if (!await getTenantById(id)) return c.json({ error: "Tenant not found" }, 404);
  await seedTenant(id);
  const rows = await db.select({ s: skills, state: tenantSkills }).from(tenantSkills).innerJoin(skills, eq(tenantSkills.skillId, skills.id)).where(eq(tenantSkills.tenantId, id));
  // Tools, groups and effects come from the code registry; the seeded tool_definitions column is not kept in sync with it.
  const code = new Map(skillRegistry.catalogue().map((s) => [s.id, s]));
  return c.json({ success: true, skills: rows.map(({ s, state }: any) => {
    const { groups = [], tools = [] } = code.get(s.id) ?? {};
    return { id: s.id, name: s.name, description: s.description, groups, tools, toolCount: tools.length, isEnabled: state.isEnabled };
  }).sort((a: any, b: any) => a.name.localeCompare(b.name)) });
});
skillAdminRoutes.patch("/tenants/:id/skills/:skillId", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (typeof body?.isEnabled !== "boolean") return c.json({ error: "isEnabled must be a boolean" }, 400);
  const tenantId = c.req.param("id");
  const [state] = await db.update(tenantSkills).set({ isEnabled: body.isEnabled, updatedAt: new Date() })
    .where(and(eq(tenantSkills.tenantId, tenantId), eq(tenantSkills.skillId, c.req.param("skillId")))).returning();
  if (!state) return c.json({ error: "Skill not found" }, 404);
  await CacheService.del(tenantKey(tenantId, "skills:active"));
  return c.json({ success: true, isEnabled: state.isEnabled });
});
