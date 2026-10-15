/**
 * Dialect-aware schema barrel.
 *
 * At process startup we inspect the configured database URL and bind the
 * exported tables to either the PostgreSQL schema or the SQLite schema.
 *
 * Both dialect schemas intentionally share identical column names and
 * (as closely as possible) identical TypeScript shapes, so application code
 * using named imports — `import { tasks } from "@pachiware/db"` — works
 * unchanged regardless of the active dialect.
 */
import { getInfraConfig } from "../runtime-store.js";
import { detectEngine, type DatabaseEngine } from "../engine.js";

import * as pgSchema from "./pg/index.js";
import * as sqliteSchema from "./sqlite/index.js";

const { databaseUrl } = getInfraConfig();
export let activeDialect: DatabaseEngine = detectEngine(databaseUrl);

const active = activeDialect === "postgres" ? pgSchema : sqliteSchema;

export let agentsConfig = active.agentsConfig;
export let skills = active.skills;
export let tasks = active.tasks;
export let conversations = active.conversations;
export let messages = active.messages;

// Re-export shared types (identical across both dialects for every table)
export type AgentConfig = typeof pgSchema.agentsConfig.$inferSelect;
export type NewAgentConfig = typeof pgSchema.agentsConfig.$inferInsert;

export type Skill = typeof pgSchema.skills.$inferSelect;
export type NewSkill = typeof pgSchema.skills.$inferInsert;

export type Task = typeof pgSchema.tasks.$inferSelect;
export type NewTask = typeof pgSchema.tasks.$inferInsert;

export type Conversation = typeof pgSchema.conversations.$inferSelect;
export type NewConversation = typeof pgSchema.conversations.$inferInsert;

export type Message = typeof pgSchema.messages.$inferSelect;
export type NewMessage = typeof pgSchema.messages.$inferInsert;

// Access to the raw dialect-specific schemas if needed (migrations, dialect-aware tooling)
export { pgSchema, sqliteSchema };

export let tenants = active.tenants;

export let apiKeys = active.apiKeys;

export let profiles = active.profiles;
export type Profile = typeof pgSchema.profiles.$inferSelect;
export type NewProfile = typeof pgSchema.profiles.$inferInsert;

export let gitAccounts = active.gitAccounts;

export let gitOauthApps = active.gitOauthApps;

export let bots = active.bots;
export type Bot = typeof pgSchema.bots.$inferSelect;
export type NewBot = typeof pgSchema.bots.$inferInsert;

export let guildConfigs = active.guildConfigs;
export type GuildConfig = typeof pgSchema.guildConfigs.$inferSelect;
export type { DigestChannel } from "./types.js";

export let botGitAccounts = active.botGitAccounts;

export let gitScopes = active.gitScopes;

export let availabilityRules = active.availabilityRules;
export type AvailabilityRuleRow = typeof pgSchema.availabilityRules.$inferSelect;

export let usageEvents = active.usageEvents;
export type UsageEvent = typeof pgSchema.usageEvents.$inferSelect;
export type NewUsageEvent = typeof pgSchema.usageEvents.$inferInsert;

export let schedules = active.schedules;
export type Schedule = typeof pgSchema.schedules.$inferSelect;
export type NewSchedule = typeof pgSchema.schedules.$inferInsert;

export let tenantSkills = active.tenantSkills;
export type TenantSkill = typeof pgSchema.tenantSkills.$inferSelect;
export type NewTenantSkill = typeof pgSchema.tenantSkills.$inferInsert;
