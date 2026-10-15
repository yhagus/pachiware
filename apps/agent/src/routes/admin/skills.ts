import { Hono } from "hono";
import { repositories, db, skills, tenantSkills, seedTenant, eq } from "@pachiware/db";
import { skillRegistry, listPlaybooks, playbookChain } from "@pachiware/skills";
import { switchTenantSkill } from "../skillSwitch.js";
import { availabilityRoutes } from "../availability.js";

export const skillAdminRoutes = new Hono();

skillAdminRoutes.get("/tenants/:id/skills", async (c) => {
  const id = c.req.param("id");
  if (!await repositories().tenants.get(id)) return c.json({ error: "Tenant not found" }, 404);
  await seedTenant(id);
  const rows = await db.select({ s: skills, state: tenantSkills }).from(tenantSkills).innerJoin(skills, eq(tenantSkills.skillId, skills.id)).where(eq(tenantSkills.tenantId, id));
  // Tools, groups and effects come from the code registry; the seeded tool_definitions column is not kept in sync with it.
  const code = new Map(skillRegistry.catalogue().map((s) => [s.id, s]));
  return c.json({ success: true, skills: rows.map(({ s, state }: any) => {
    const { groups = [], tools = [] } = code.get(s.id) ?? {};
    return { id: s.id, name: s.name, description: s.description, groups, tools, toolCount: tools.length, isEnabled: state.isEnabled };
  }).sort((a: any, b: any) => a.name.localeCompare(b.name)),
  playbooks: await playbookSummaries(id) });
});
/**
 * Playbooks are availability targets too: built-in and the tenant's own, each with the skills it requires, whether it starts off,
 * what it loads (`chain` is every playbook a start brings in), and why it cannot start for the tenant, or null.
 */
async function playbookSummaries(tenantId: string) {
  const playbooks = await listPlaybooks(tenantId), available = await skillRegistry.availableAt({ tenantId }, playbooks);
  return playbooks.map((p) => {
    const found = playbookChain(p, playbooks);
    return { name: p.name, description: p.description, requires: p.requires, defaultOff: p.defaultOff, loads: p.loads, chain: "chain" in found ? found.chain.slice(1) : [], start: p.start, cause: available.playbookCause(p.name) };
  });
}
skillAdminRoutes.patch("/tenants/:id/skills/:skillId", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (typeof body?.isEnabled !== "boolean") return c.json({ error: "isEnabled must be a boolean" }, 400);
  const tenantId = c.req.param("id");
  const state = await switchTenantSkill(tenantId, c.req.param("skillId"), body.isEnabled);
  if (!state) return c.json({ error: "Skill not found" }, 404);
  return c.json({ success: true, isEnabled: state.isEnabled });
});
// Tenant-level rules for tools, effects and playbooks; a whole skill is switched with the PATCH above.
availabilityRoutes(skillAdminRoutes, "/tenants/:id/availability", async (c) => (await repositories().tenants.get(c.req.param("id")!) ? { tenantId: c.req.param("id")!, level: "tenant" } : null));
