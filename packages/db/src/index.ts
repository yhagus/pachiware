import { connection } from "./internal.js";
import type { DatabaseEngine } from "./engine.js";

// No Drizzle instance, table or query operator leaves the package, so no outside query can work on SQL only.

export { repositories } from "./internal.js";
/** The engine of the configured database. */
export const activeEngine: DatabaseEngine = connection.engine;

export { runMigrations } from "./migrate.js";
export { runSeed } from "./seed.js";
export * from "./runtime-store.js";
export * from "./engine.js";
export * from "./crypto.js";
export * from "./persona.js";
export { ReplicaSetRequiredError } from "./mongo/connection.js";
export { patternCovers } from "./repositories/git/rules.js";
export { FallbackRefused } from "./repositories/profiles/types.js";
export { DEFAULT_REACT_ITERATIONS, DEFAULT_CONVERSATION_IDLE_HOURS } from "./repositories/agent-config/types.js";
export { ALL_PLANE_PROJECTS, PLANE_ID } from "./repositories/plane/rules.js";
export type { DigestChannel, DailyLogChannel, DocSource } from "./schema/types.js";
export type { Repositories, Tenant, TenantStatus, NewTenant, TenantUpdate, ApiKey, ApiKeyListing, IssuedApiKey, TenantRepository } from "./repositories/index.js";
export type { Schedule, NewSchedule, ScheduleUpdate, ScheduleFilter, ScheduleKind, ScheduleRecurrence, ScheduleStatus, ScheduleRepository, TaskRow, NewTaskRow, TaskRowRepository } from "./repositories/index.js";
export type { Profile, NewProfile, ProfileUpdate, ProfileRepository, AgentConfig, AgentConfigUpdate, AgentLanguage, AgentConfigRepository, UsageEvent, NewUsageEvent, UsageTotal, UsageRepository, StatsRepository } from "./repositories/index.js";
export type { Bot, NewBot, BotUpdate, BotWithToken, BotSearch, GuildConfig, GuildConfigInput, BotRepository } from "./repositories/index.js";
export type { Skill, SkillDefinition, TenantSkill, TenantSkillListing, SkillRepository } from "./repositories/index.js";
export type { RuleLevel, RuleTargetKind, RuleValue, RuleScope, RuleTarget, AvailabilityRuleRecord, AvailabilityRuleRepository } from "./repositories/index.js";
export type { Conversation, NewConversation, ConversationListing, Message, NewMessage, ConversationRepository } from "./repositories/index.js";
export type { GitRepository, GitAccount, NewGitAccount, GitAccountUpdate, BotRef, GitScope, GitScopeRule, GitOAuthApp, NewGitOAuthApp } from "./repositories/index.js";
export type { PlaneRepository, PlaneAccount, NewPlaneAccount, PlaneAccountUpdate, PlaneScope, PlaneScopeRule } from "./repositories/index.js";
