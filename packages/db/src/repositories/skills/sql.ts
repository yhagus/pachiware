import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type { SqlConnection } from "../../connection.js";
import type { Skill, SkillRepository, TenantSkill } from "./types.js";

/** Skills and tenant skill switches on SQLite and PostgreSQL. */
export function createSqlSkillRepository({ db, tables: t }: SqlConnection): SkillRepository {
  const switchOf = (tenantId: string, skillId: string) => and(eq(t.tenantSkills.tenantId, tenantId), eq(t.tenantSkills.skillId, skillId));
  const change = async (tenantId: string, skillId: string, values: Record<string, any>) => {
    const [row] = await db.update(t.tenantSkills).set({ ...values, updatedAt: new Date() }).where(switchOf(tenantId, skillId)).returning();
    return row ? toTenantSkill(row) : null;
  };
  return {
    async register(skill) {
      const [existing] = await db.select({ id: t.skills.id }).from(t.skills).where(eq(t.skills.id, skill.id)).limit(1);
      if (!existing) {
        const now = new Date();
        await db.insert(t.skills).values({ ...skill, createdAt: now, updatedAt: now });
        return true;
      }
      await db.update(t.skills).set({ name: skill.name, description: skill.description, toolDefinitions: skill.toolDefinitions, updatedAt: new Date() }).where(eq(t.skills.id, skill.id));
      return false;
    },
    async list() {
      return (await db.select().from(t.skills).orderBy(asc(t.skills.id))).map(toSkill);
    },
    async seedTenant(tenantId) {
      for (const skill of await db.select().from(t.skills)) {
        await db.insert(t.tenantSkills).values({ id: randomUUID(), tenantId, skillId: skill.id, isEnabled: skill.defaultEnabled, config: skill.config, updatedAt: new Date() }).onConflictDoNothing();
      }
    },
    async listForTenant(tenantId) {
      const rows = await db.select({ skill: t.skills, state: t.tenantSkills }).from(t.tenantSkills).innerJoin(t.skills, eq(t.tenantSkills.skillId, t.skills.id))
        .where(eq(t.tenantSkills.tenantId, tenantId)).orderBy(asc(t.skills.id));
      return rows.map((row: any) => ({ skill: toSkill(row.skill), state: toTenantSkill(row.state) }));
    },
    async listEnabled(tenantId) {
      const rows = await db.select({ skill: t.skills }).from(t.tenantSkills).innerJoin(t.skills, eq(t.tenantSkills.skillId, t.skills.id))
        .where(and(eq(t.tenantSkills.tenantId, tenantId), eq(t.tenantSkills.isEnabled, true))).orderBy(asc(t.skills.id));
      return rows.map((row: any) => toSkill(row.skill));
    },
    async getForTenant(tenantId, skillId) {
      const [row] = await db.select().from(t.tenantSkills).where(switchOf(tenantId, skillId)).limit(1);
      return row ? toTenantSkill(row) : null;
    },
    setEnabled: (tenantId, skillId, isEnabled) => change(tenantId, skillId, { isEnabled }),
    setConfig: (tenantId, skillId, config) => change(tenantId, skillId, { config }),
    async enable(tenantId, skillId) {
      const [skill] = await db.select({ id: t.skills.id }).from(t.skills).where(eq(t.skills.id, skillId)).limit(1);
      if (!skill) return false;
      // The unique switch per tenant and skill makes a second insert a no-op, so two callers never both add one.
      await db.insert(t.tenantSkills).values({ id: randomUUID(), tenantId, skillId, isEnabled: true, updatedAt: new Date() }).onConflictDoNothing();
      await db.update(t.tenantSkills).set({ isEnabled: true, updatedAt: new Date() }).where(and(switchOf(tenantId, skillId), eq(t.tenantSkills.isEnabled, false)));
      return true;
    },
  };
}

function toSkill(row: any): Skill {
  return { id: row.id, name: row.name, description: row.description, defaultEnabled: row.defaultEnabled, toolDefinitions: row.toolDefinitions ?? [], handlerType: row.handlerType, config: row.config ?? {}, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function toTenantSkill(row: any): TenantSkill {
  return { id: row.id, tenantId: row.tenantId, skillId: row.skillId, isEnabled: row.isEnabled, config: row.config ?? {}, updatedAt: row.updatedAt };
}
