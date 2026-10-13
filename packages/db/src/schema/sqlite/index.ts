import { sqliteTable, text, integer, real, index, uniqueIndex, foreignKey } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";

/**
 * SQLite mirror of the PostgreSQL schema.
 *
 * Design notes:
 * - UUIDs: SQLite has no gen_random_uuid(); we generate client-side via crypto.randomUUID()
 *   as the column default function.
 * - Timestamps: Stored as unix epoch milliseconds (integer, mode: 'timestamp_ms').
 *   Drizzle auto-converts to/from JS `Date` so application code can keep passing `new Date()`
 *   just like it does on PostgreSQL.
 * - JSONB fields: Stored as text with {mode: 'json'} so Drizzle parses/serializes
 *   JavaScript objects transparently (matching the pg driver's JSON behaviour).
 * - Booleans: Stored as integer 0/1 with {mode: 'boolean'}.
 *
 * Column names are IDENTICAL to the pg schema so application code is dialect-agnostic.
 */

const defaultUuid = () => randomUUID();
const defaultNow = () => new Date();

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey().$defaultFn(defaultUuid),
  keyPrefix: text("key_prefix").notNull(), keyHash: text("key_hash").notNull(),
  name: text("name").notNull().default("API Key"), scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default([]),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }), revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
}, (t) => [uniqueIndex("api_keys_hash_idx").on(t.keyHash)]);

export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey().$defaultFn(defaultUuid),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  apiKeyId: text("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
  status: text("status").notNull().default("active"),
  platformMetadata: text("platform_metadata", { mode: "json" }).$type<Record<string, any>>().notNull().default({}),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
});

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey().$defaultFn(defaultUuid), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(), provider: text("provider").notNull(), model: text("model").notNull(), baseUrl: text("base_url"), apiKeyEncrypted: text("api_key_encrypted"), acceptsImages: integer("accepts_images", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
}, (t) => [index("profiles_tenant_idx").on(t.tenantId)]);

export const gitAccounts = sqliteTable("git_accounts", {
  id: text("id").primaryKey().$defaultFn(defaultUuid), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(), provider: text("provider").notNull(), baseUrl: text("base_url"), username: text("username").notNull(), tokenEncrypted: text("token_encrypted").notNull(),
  authType: text("auth_type").notNull().default("token"), refreshTokenEncrypted: text("refresh_token_encrypted"), tokenExpiresAt: integer("token_expires_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
}, (t) => [uniqueIndex("git_accounts_tenant_name_idx").on(t.tenantId, t.name), uniqueIndex("git_accounts_tenant_id_idx").on(t.tenantId, t.id)]);

export const gitOauthApps = sqliteTable("git_oauth_apps", {
  id: text("id").primaryKey().$defaultFn(defaultUuid), provider: text("provider").notNull(), baseUrl: text("base_url").notNull().default(""),
  clientId: text("client_id").notNull(), clientSecretEncrypted: text("client_secret_encrypted").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
}, (t) => [uniqueIndex("git_oauth_apps_host_idx").on(t.provider, t.baseUrl)]);

export const bots = sqliteTable("bots", {
  id: text("id").primaryKey().$defaultFn(defaultUuid), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Discord Bot"), platform: text("platform").notNull().default("discord"),
  tokenEncrypted: text("token_encrypted").notNull(), clientId: text("client_id"), guildIds: text("guild_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true), connectionStatus: text("connection_status").notNull().default("disconnected"),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  gitAccountId: text("git_account_id"),
  lastConnectedAt: integer("last_connected_at", { mode: "timestamp_ms" }), lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
}, (t) => [index("bots_tenant_idx").on(t.tenantId), uniqueIndex("bots_tenant_id_idx").on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.gitAccountId], foreignColumns: [gitAccounts.tenantId, gitAccounts.id] })]);

export const guildConfigs = sqliteTable("guild_configs", {
  id: text("id").primaryKey().$defaultFn(defaultUuid), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  botId: text("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }), guildId: text("guild_id").notNull(),
  systemPrompt: text("system_prompt"), useThreads: integer("use_threads", { mode: "boolean" }).notNull().default(true), alwaysChannelIds: text("always_channel_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
  timezone: text("timezone"), language: text("language").$type<"id" | "en">(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
}, (t) => [uniqueIndex("guild_configs_bot_guild_idx").on(t.botId, t.guildId)]);

export const botGitAccounts = sqliteTable("bot_git_accounts", {
  id: text("id").primaryKey().$defaultFn(defaultUuid), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  botId: text("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }), gitAccountId: text("git_account_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
}, (t) => [uniqueIndex("bot_git_accounts_idx").on(t.botId, t.gitAccountId), foreignKey({ columns: [t.tenantId, t.gitAccountId], foreignColumns: [gitAccounts.tenantId, gitAccounts.id] })]);

export const gitScopes = sqliteTable("git_scopes", {
  id: text("id").primaryKey().$defaultFn(defaultUuid), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  botId: text("bot_id").notNull(), guildId: text("guild_id").notNull(), channelId: text("channel_id").notNull().default(""), gitAccountId: text("git_account_id").notNull(),
  repoPatterns: text("repo_patterns", { mode: "json" }).$type<string[]>().notNull().default(["*"]),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
}, (t) => [uniqueIndex("git_scopes_idx").on(t.botId, t.guildId, t.channelId, t.gitAccountId), foreignKey({ columns: [t.botId, t.gitAccountId], foreignColumns: [botGitAccounts.botId, botGitAccounts.gitAccountId] }).onDelete("cascade")]);

export const availabilityRules = sqliteTable("availability_rules", {
  id: text("id").primaryKey().$defaultFn(defaultUuid), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  level: text("level").notNull(), botId: text("bot_id").references(() => bots.id, { onDelete: "cascade" }), guildId: text("guild_id").notNull().default(""), channelId: text("channel_id").notNull().default(""),
  targetKind: text("target_kind").notNull(), targetName: text("target_name").notNull(), value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
}, (t) => [uniqueIndex("availability_rules_key_idx").on(t.tenantId, t.level, sql`coalesce(${t.botId}, '')`, t.guildId, t.channelId, t.targetKind, t.targetName)]);

export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey().$defaultFn(defaultUuid), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), botId: text("bot_id").notNull(),
  kind: text("kind").$type<"reminder" | "digest">().notNull().default("reminder"), guildId: text("guild_id"), channelId: text("channel_id").notNull(),
  ownerId: text("owner_id"), ownerName: text("owner_name"), text: text("text").notNull().default(""), withTasks: integer("with_tasks", { mode: "boolean" }).notNull().default(false),
  mentions: text("mentions", { mode: "json" }).$type<string[]>().notNull().default([]),
  recurrence: text("recurrence").$type<"once" | "daily" | "weekly" | "monthly">().notNull().default("once"), weekdays: text("weekdays", { mode: "json" }).$type<number[]>().notNull().default([]), dayOfMonth: integer("day_of_month"),
  timeOfDay: text("time_of_day"), timezone: text("timezone").notNull(), until: integer("until", { mode: "timestamp_ms" }),
  nextAt: integer("next_at", { mode: "timestamp_ms" }).notNull(), lastFiredAt: integer("last_fired_at", { mode: "timestamp_ms" }),
  status: text("status").$type<"active" | "cancelled" | "done">().notNull().default("active"), attempts: integer("attempts").notNull().default(0), error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
}, (t) => [index("schedules_due_idx").on(t.status, t.nextAt), foreignKey({ columns: [t.tenantId, t.botId], foreignColumns: [bots.tenantId, bots.id] })]);

export const usageEvents = sqliteTable("usage_events", {
  id: text("id").primaryKey().$defaultFn(defaultUuid), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), botId: text("bot_id"),
  type: text("type").notNull(), provider: text("provider"), model: text("model"),
  promptTokens: integer("prompt_tokens").notNull().default(0), completionTokens: integer("completion_tokens").notNull().default(0),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, any>>().notNull().default({}), createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
}, (t) => [index("usage_tenant_created_idx").on(t.tenantId, t.createdAt), foreignKey({ columns: [t.tenantId, t.botId], foreignColumns: [bots.tenantId, bots.id] })]);

export const agentsConfig = sqliteTable("agents_config", {
  tenantId: text("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Pachiware Agent"),
  systemPrompt: text("system_prompt").notNull().default(
    "You are Pachiware Agent, an intelligent autonomous system capable of channel management, task tracking, and problem solving. You execute actions via your available tools and communicate clearly and concisely."
  ),
  defaultProvider: text("default_provider").notNull().default("openai"),
  defaultModel: text("default_model").notNull().default("gpt-4o"),
  temperature: real("temperature").notNull().default(0.2),
  maxTokens: integer("max_tokens").notNull().default(4096),

  openaiApiKeyEncrypted: text("openai_api_key_encrypted"),
  openaiBaseUrl: text("openai_base_url"),
  openaiModel: text("openai_model"),

  anthropicApiKeyEncrypted: text("anthropic_api_key_encrypted"),
  anthropicBaseUrl: text("anthropic_base_url"),
  anthropicModel: text("anthropic_model"),

  customBaseUrl: text("custom_base_url"),
  customApiKeyEncrypted: text("custom_api_key_encrypted"),
  customModel: text("custom_model"),

  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  language: text("language").$type<"id" | "en">().notNull().default("id"),
  settings: text("settings", { mode: "json" }).$type<Record<string, any>>().notNull().default({}),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(defaultNow),
});

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  defaultEnabled: integer("default_enabled", { mode: "boolean" }).notNull().default(true),
  toolDefinitions: text("tool_definitions", { mode: "json" }).$type<any[]>().notNull().default([]),
  handlerType: text("handler_type").notNull().default("builtin"),
  config: text("config", { mode: "json" }).$type<Record<string, any>>().notNull().default({}),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(defaultNow),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(defaultNow),
});

export const tenantSkills = sqliteTable("tenant_skills", {
  id: text("id").primaryKey().$defaultFn(defaultUuid), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  skillId: text("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true), config: text("config", { mode: "json" }).$type<Record<string, any>>().notNull().default({}), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(defaultNow),
}, (t) => [uniqueIndex("tenant_skills_unique_idx").on(t.tenantId, t.skillId)]);

export const tasks = sqliteTable("tasks", {
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  id: text("id").primaryKey().$defaultFn(defaultUuid),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("medium"),
  assignedTo: text("assigned_to"),
  discordChannelId: text("discord_channel_id"),
  discordGuildId: text("discord_guild_id"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, any>>().default({}),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(defaultNow),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(defaultNow),
}, (t) => [index("tasks_tenant_created_idx").on(t.tenantId, t.createdAt)]);

export const conversations = sqliteTable("conversations", {
  botId: text("bot_id"),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  id: text("id").primaryKey().$defaultFn(defaultUuid),
  channelId: text("channel_id"),
  userId: text("user_id"),
  platform: text("platform").notNull().default("discord"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, any>>().default({}),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(defaultNow),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(defaultNow),
}, (t) => [index("conversations_tenant_created_idx").on(t.tenantId, t.createdAt), uniqueIndex("conversations_tenant_id_idx").on(t.tenantId, t.id), foreignKey({ columns: [t.tenantId, t.botId], foreignColumns: [bots.tenantId, bots.id] })]);

export const messages = sqliteTable("messages", {
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  id: text("id").primaryKey().$defaultFn(defaultUuid),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content"),
  toolCalls: text("tool_calls", { mode: "json" }).$type<any>(),
  toolCallId: text("tool_call_id"),
  tokensUsed: integer("tokens_used"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(defaultNow),
}, (t) => [index("messages_tenant_created_idx").on(t.tenantId, t.createdAt), foreignKey({ columns: [t.tenantId, t.conversationId], foreignColumns: [conversations.tenantId, conversations.id] }).onDelete("cascade")]);

// Shared type definitions
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

export type Bot = typeof bots.$inferSelect;
export type NewBot = typeof bots.$inferInsert;

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;

export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;

export type TenantSkill = typeof tenantSkills.$inferSelect;
export type NewTenantSkill = typeof tenantSkills.$inferInsert;
