import { connection } from "./internal.js";
import type { DatabaseEngine } from "./engine.js";

// The public entry: repositories, domain types and start-up functions. No Drizzle instance, table
// binding or query operator leaves the package, so code outside it cannot write a query that works
// on SQL only (#167). The package's own tests reach the raw connection through internal.ts.

export { repositories } from "./internal.js";
/** The engine of the configured database. */
export const activeDialect: DatabaseEngine = connection.engine;

export { runMigrations } from "./migrate.js";
export { runSeed } from "./seed.js";
export * from "./runtime-store.js";
export * from "./engine.js";
export * from "./crypto.js";
export * from "./persona.js";
export { ReplicaSetRequiredError } from "./mongo/connection.js";
export { patternCovers } from "./repositories/git/rules.js";
export type { DigestChannel } from "./schema/types.js";
export type { Repositories, Tenant, TenantStatus, NewTenant, TenantUpdate, ApiKey, ApiKeyListing, IssuedApiKey, TenantRepository } from "./repositories/index.js";
export type { Schedule, NewSchedule, ScheduleUpdate, ScheduleFilter, ScheduleKind, ScheduleRecurrence, ScheduleStatus, ScheduleRepository, TaskRow, NewTaskRow, TaskRowRepository } from "./repositories/index.js";
export type { Profile, NewProfile, ProfileUpdate, ProfileRepository, AgentConfig, AgentConfigUpdate, AgentLanguage, AgentConfigRepository, UsageEvent, NewUsageEvent, UsageTotal, UsageRepository, StatsRepository } from "./repositories/index.js";
export type { Bot, NewBot, BotUpdate, BotWithToken, BotSearch, GuildConfig, GuildConfigInput, BotRepository } from "./repositories/index.js";
export type { Skill, SkillDefinition, TenantSkill, TenantSkillListing, SkillRepository } from "./repositories/index.js";
export type { RuleLevel, RuleTargetKind, RuleValue, RuleScope, RuleTarget, AvailabilityRuleRecord, AvailabilityRuleRepository } from "./repositories/index.js";
export type { Conversation, NewConversation, ConversationListing, Message, NewMessage, ConversationRepository } from "./repositories/index.js";
export type { GitRepository, GitAccount, NewGitAccount, GitAccountUpdate, BotRef, GitScope, GitScopeRule, GitOAuthApp, NewGitOAuthApp } from "./repositories/index.js";
