/** Domain types and the repository interface for Skills and each tenant's skill switches. Every engine implements it. */

/** A skill the platform registered, shared by every tenant. */
export type Skill = {
  id: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  toolDefinitions: any[];
  handlerType: string;
  config: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
};

export type SkillDefinition = Omit<Skill, "createdAt" | "updatedAt">;

/** One tenant's switch for one skill. */
export type TenantSkill = {
  id: string;
  tenantId: string;
  skillId: string;
  isEnabled: boolean;
  config: Record<string, any>;
  updatedAt: Date;
};

export type TenantSkillListing = { skill: Skill; state: TenantSkill };

export interface SkillRepository {
  /** Registers a skill, or refreshes the name, description and tools of one already registered. True when it was new. */
  register(skill: SkillDefinition): Promise<boolean>;
  /** Every registered skill, by id. */
  list(): Promise<Skill[]>;
  /** Gives the tenant a switch, at the skill's default, for every registered skill it has none for. */
  seedTenant(tenantId: string): Promise<void>;
  /** The tenant's switches with their skills, by skill id. */
  listForTenant(tenantId: string): Promise<TenantSkillListing[]>;
  /** The skills the tenant has switched on, by id. */
  listEnabled(tenantId: string): Promise<Skill[]>;
  getForTenant(tenantId: string, skillId: string): Promise<TenantSkill | null>;
  /** Flips an existing switch; null when the tenant has none for this skill. */
  setEnabled(tenantId: string, skillId: string, isEnabled: boolean): Promise<TenantSkill | null>;
  /** Replaces the tenant's configuration of a skill; null when the tenant has no switch for it. */
  setConfig(tenantId: string, skillId: string, config: Record<string, any>): Promise<TenantSkill | null>;
  /** Switches a registered skill on for the tenant, creating its switch when missing; enabling again changes nothing. False when no such skill is registered. */
  enable(tenantId: string, skillId: string): Promise<boolean>;
}
