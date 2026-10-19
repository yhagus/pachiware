import { pgTable, text, timestamp, boolean, jsonb, integer, real, index, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { DEFAULT_SYSTEM_PROMPT } from "../../persona.js";
import type { DigestChannel, DailyLogChannel, DocSource } from "../types.js";
import type { ScheduleKind } from "../../repositories/schedules/types.js";

/**
 * Agents Configuration Table
 * Stores agent personality, active system prompts, LLM router defaults, and provider configurations.
 */
export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  keyPrefix: text("key_prefix").notNull(), keyHash: text("key_hash").notNull(),
  name: text("name").notNull().default("API Key"), scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }), revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [uniqueIndex("api_keys_hash_idx").on(t.keyHash)]);

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  apiKeyId: text("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  platformMetadata: jsonb("platform_metadata").$type<Record<string, any>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(), provider: text("provider").notNull(), model: text("model").notNull(), baseUrl: text("base_url"), apiKeyEncrypted: text("api_key_encrypted"), acceptsImages: boolean("accepts_images").notNull().default(false), apiFormat: text("api_format").notNull().default("chat_completions"), fallbackProfileId: text("fallback_profile_id").references((): any => profiles.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("profiles_tenant_idx").on(t.tenantId)]);

export const gitAccounts = pgTable("git_accounts", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(), provider: text("provider").notNull(), baseUrl: text("base_url"), username: text("username").notNull(), tokenEncrypted: text("token_encrypted").notNull(),
  authType: text("auth_type").notNull().default("token"), refreshTokenEncrypted: text("refresh_token_encrypted"), tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [uniqueIndex("git_accounts_tenant_name_idx").on(t.tenantId, t.name), uniqueIndex("git_accounts_tenant_id_idx").on(t.tenantId, t.id)]);

export const gitOauthApps = pgTable("git_oauth_apps", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), provider: text("provider").notNull(), baseUrl: text("base_url").notNull().default(""),
  clientId: text("client_id").notNull(), clientSecretEncrypted: text("client_secret_encrypted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [uniqueIndex("git_oauth_apps_host_idx").on(t.provider, t.baseUrl)]);

export const bots = pgTable("bots", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Discord Bot"), platform: text("platform").notNull().default("discord"),
  tokenEncrypted: text("token_encrypted").notNull(), clientId: text("client_id"), guildIds: jsonb("guild_ids").$type<string[]>().notNull().default([]),
  isEnabled: boolean("is_enabled").notNull().default(true), connectionStatus: text("connection_status").notNull().default("disconnected"),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  gitAccountId: text("git_account_id"),
  lastConnectedAt: timestamp("last_connected_at", { withTimezone: true }), lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("bots_tenant_idx").on(t.tenantId), uniqueIndex("bots_tenant_id_idx").on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.gitAccountId], foreignColumns: [gitAccounts.tenantId, gitAccounts.id] })]);

export const guildConfigs = pgTable("guild_configs", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  botId: text("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }), guildId: text("guild_id").notNull(),
  systemPrompt: text("system_prompt"), useThreads: boolean("use_threads").notNull().default(true), alwaysChannelIds: jsonb("always_channel_ids").$type<string[]>().notNull().default([]),
  timezone: text("timezone"), language: text("language").$type<"id" | "en">(),
  digestChannels: jsonb("digest_channels").$type<DigestChannel[]>().notNull().default([]),
  dailyLogChannels: jsonb("daily_log_channels").$type<DailyLogChannel[]>().notNull().default([]),
  docSources: jsonb("doc_sources").$type<DocSource[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [uniqueIndex("guild_configs_bot_guild_idx").on(t.botId, t.guildId)]);

export const botGitAccounts = pgTable("bot_git_accounts", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  botId: text("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }), gitAccountId: text("git_account_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [uniqueIndex("bot_git_accounts_idx").on(t.botId, t.gitAccountId), foreignKey({ columns: [t.tenantId, t.gitAccountId], foreignColumns: [gitAccounts.tenantId, gitAccounts.id] })]);

export const gitScopes = pgTable("git_scopes", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  botId: text("bot_id").notNull(), guildId: text("guild_id").notNull(), channelId: text("channel_id").notNull().default(""), gitAccountId: text("git_account_id").notNull(),
  repoPatterns: jsonb("repo_patterns").$type<string[]>().notNull().default(["*"]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [uniqueIndex("git_scopes_idx").on(t.botId, t.guildId, t.channelId, t.gitAccountId), foreignKey({ columns: [t.botId, t.gitAccountId], foreignColumns: [botGitAccounts.botId, botGitAccounts.gitAccountId] }).onDelete("cascade")]);

export const planeAccounts = pgTable("plane_accounts", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(), baseUrl: text("base_url"), workspaceSlug: text("workspace_slug").notNull(), apiKeyEncrypted: text("api_key_encrypted").notNull(),
  planeUserId: text("plane_user_id").notNull(), planeUserName: text("plane_user_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [uniqueIndex("plane_accounts_tenant_name_idx").on(t.tenantId, t.name), uniqueIndex("plane_accounts_tenant_id_idx").on(t.tenantId, t.id)]);

export const botPlaneAccounts = pgTable("bot_plane_accounts", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  botId: text("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }), planeAccountId: text("plane_account_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [uniqueIndex("bot_plane_accounts_idx").on(t.botId, t.planeAccountId), foreignKey({ columns: [t.tenantId, t.planeAccountId], foreignColumns: [planeAccounts.tenantId, planeAccounts.id] })]);

export const planeScopes = pgTable("plane_scopes", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  botId: text("bot_id").notNull(), guildId: text("guild_id").notNull(), channelId: text("channel_id").notNull().default(""), planeAccountId: text("plane_account_id").notNull(),
  projectIds: jsonb("project_ids").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [uniqueIndex("plane_scopes_idx").on(t.botId, t.guildId, t.channelId, t.planeAccountId), foreignKey({ columns: [t.botId, t.planeAccountId], foreignColumns: [botPlaneAccounts.botId, botPlaneAccounts.planeAccountId] }).onDelete("cascade")]);

/** Availability rules: tenant (no bot), bot, (bot, guild), or channel level; target kind playbook, skill, tool or effect; value off, opt_in or on. No row means inherit. */
export const availabilityRules = pgTable("availability_rules", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  level: text("level").notNull(), botId: text("bot_id").references(() => bots.id, { onDelete: "cascade" }), guildId: text("guild_id").notNull().default(""), channelId: text("channel_id").notNull().default(""),
  targetKind: text("target_kind").notNull(), targetName: text("target_name").notNull(), value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [uniqueIndex("availability_rules_key_idx").on(t.tenantId, t.level, sql`coalesce(${t.botId}, '')`, t.guildId, t.channelId, t.targetKind, t.targetName)]);

/** A Reminder or Digest run the scheduler polls by (status, next_at); the row holds the whole recurrence, never a cron string (ADR 0006). */
export const schedules = pgTable("schedules", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), botId: text("bot_id").notNull(),
  kind: text("kind").$type<ScheduleKind>().notNull().default("reminder"), guildId: text("guild_id"), channelId: text("channel_id").notNull(),
  ownerId: text("owner_id"), ownerName: text("owner_name"), text: text("text").notNull().default(""), withTasks: boolean("with_tasks").notNull().default(false),
  mentions: jsonb("mentions").$type<string[]>().notNull().default([]),
  recurrence: text("recurrence").$type<"once" | "daily" | "weekly" | "monthly">().notNull().default("once"), weekdays: jsonb("weekdays").$type<number[]>().notNull().default([]), dayOfMonth: integer("day_of_month"),
  timeOfDay: text("time_of_day"), timezone: text("timezone").notNull(), until: timestamp("until", { withTimezone: true }),
  nextAt: timestamp("next_at", { withTimezone: true }).notNull(), lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
  status: text("status").$type<"active" | "cancelled" | "done">().notNull().default("active"), attempts: integer("attempts").notNull().default(0), error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("schedules_due_idx").on(t.status, t.nextAt), foreignKey({ columns: [t.tenantId, t.botId], foreignColumns: [bots.tenantId, bots.id] })]);

export const usageEvents = pgTable("usage_events", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), botId: text("bot_id"),
  type: text("type").notNull(), provider: text("provider"), model: text("model"),
  promptTokens: integer("prompt_tokens").notNull().default(0), completionTokens: integer("completion_tokens").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, any>>().notNull().default({}), createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index("usage_tenant_created_idx").on(t.tenantId, t.createdAt), foreignKey({ columns: [t.tenantId, t.botId], foreignColumns: [bots.tenantId, bots.id] })]);

export const agentsConfig = pgTable("agents_config", {
  tenantId: text("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Pachiware Agent"),
  systemPrompt: text("system_prompt").notNull().default(DEFAULT_SYSTEM_PROMPT),
  defaultProvider: text("default_provider").notNull().default("openai"), // 'openai' | 'anthropic' | 'custom'
  defaultModel: text("default_model").notNull().default("gpt-4o"),
  temperature: real("temperature").notNull().default(0.2),
  maxTokens: integer("max_tokens").notNull().default(4096),

  // OpenAI Provider
  openaiApiKeyEncrypted: text("openai_api_key_encrypted"),
  openaiBaseUrl: text("openai_base_url"),
  openaiModel: text("openai_model"),

  // Anthropic Provider
  anthropicApiKeyEncrypted: text("anthropic_api_key_encrypted"),
  anthropicBaseUrl: text("anthropic_base_url"),
  anthropicModel: text("anthropic_model"),

  // Custom (OpenAI-compatible) Provider
  customBaseUrl: text("custom_base_url"),
  customApiKeyEncrypted: text("custom_api_key_encrypted"),
  customModel: text("custom_model"),

  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  language: text("language").$type<"id" | "en">().notNull().default("id"),
  settings: jsonb("settings").default({}).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

/**
 * Skills Table
 * Stores registered skills, tool definitions (JSON schema), and execution configurations.
 */
export const skills = pgTable("skills", {
  id: text("id").primaryKey(), // e.g., 'task_management', 'discord_management'
  name: text("name").notNull(),
  description: text("description").notNull(),
  defaultEnabled: boolean("default_enabled").notNull().default(true),
  toolDefinitions: jsonb("tool_definitions").notNull().default([]), // kept empty: tools live in the skill modules (#134)
  handlerType: text("handler_type").notNull().default("builtin"), // 'builtin' | 'custom_code' | 'webhook'
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

/**
 * Tasks Table
 * Stores tasks created via Discord commands, Agent tool execution, or Web Management GUI.
 */
export const tenantSkills = pgTable("tenant_skills", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  skillId: text("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  isEnabled: boolean("is_enabled").notNull().default(true), config: jsonb("config").$type<Record<string, any>>().notNull().default({}), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [uniqueIndex("tenant_skills_unique_idx").on(t.tenantId, t.skillId)]);

export const tasks = pgTable("tasks", {
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"), // 'pending' | 'in_progress' | 'completed'
  priority: text("priority").notNull().default("medium"), // 'low' | 'medium' | 'high' | 'urgent'
  assignedTo: text("assigned_to"),
  discordChannelId: text("discord_channel_id"),
  discordGuildId: text("discord_guild_id"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
}, (t) => [index("tasks_tenant_created_idx").on(t.tenantId, t.createdAt)]);

/**
 * Conversations Table
 * Groups message threads originating from Discord channels or Web Dashboard chats.
 */
export const conversations = pgTable("conversations", {
  botId: text("bot_id"),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  channelId: text("channel_id"),
  userId: text("user_id"),
  platform: text("platform").notNull().default("discord"), // 'discord' | 'web'
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
}, (t) => [index("conversations_tenant_created_idx").on(t.tenantId, t.createdAt), uniqueIndex("conversations_tenant_id_idx").on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.botId], foreignColumns: [bots.tenantId, bots.id] })]);

/**
 * Messages Table
 * Persistent message history for context windows, audit trails, and tool execution logs.
 */
export const messages = pgTable("messages", {
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'system' | 'user' | 'assistant' | 'tool'
  content: text("content"),
  toolCalls: jsonb("tool_calls"), // for assistant tool call records
  toolCallId: text("tool_call_id"), // for tool result records
  tokensUsed: integer("tokens_used"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
}, (t) => [index("messages_tenant_created_idx").on(t.tenantId, t.createdAt), foreignKey({ columns: [t.tenantId, t.conversationId], foreignColumns: [conversations.tenantId, conversations.id] }).onDelete("cascade")]);

// Type definitions
export type AgentConfig = typeof agentsConfig.$inferSelect;
export type NewAgentConfig = typeof agentsConfig.$inferInsert;

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type GitAccount = typeof gitAccounts.$inferSelect;
export type NewGitAccount = typeof gitAccounts.$inferInsert;
export type GitOauthApp = typeof gitOauthApps.$inferSelect;

export type Bot = typeof bots.$inferSelect;
export type NewBot = typeof bots.$inferInsert;

export type GuildConfig = typeof guildConfigs.$inferSelect;

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;

export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;

export type TenantSkill = typeof tenantSkills.$inferSelect;
export type NewTenantSkill = typeof tenantSkills.$inferInsert;
