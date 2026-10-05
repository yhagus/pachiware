import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
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

export const agentsConfig = sqliteTable("agents_config", {
  id: text("id").primaryKey().default("default"),
  name: text("name").notNull().default("Pachiware Agent"),
  systemPrompt: text("system_prompt").notNull().default(
    "You are Pachiware Agent, an intelligent autonomous system capable of channel management, task tracking, and problem solving. You execute actions via your available tools and communicate clearly and concisely."
  ),
  defaultProvider: text("default_provider").notNull().default("openai"),
  defaultModel: text("default_model").notNull().default("gpt-4o"),
  temperature: real("temperature").notNull().default(0.7),
  maxTokens: integer("max_tokens").notNull().default(4096),

  openaiApiKey: text("openai_api_key"),
  openaiBaseUrl: text("openai_base_url"),
  openaiModel: text("openai_model"),

  anthropicApiKey: text("anthropic_api_key"),
  anthropicBaseUrl: text("anthropic_base_url"),
  anthropicModel: text("anthropic_model"),

  customBaseUrl: text("custom_base_url"),
  customApiKey: text("custom_api_key"),
  customModel: text("custom_model"),

  discordBotToken: text("discord_bot_token"),
  discordClientId: text("discord_client_id"),
  discordGuildId: text("discord_guild_id"),

  settings: text("settings", { mode: "json" }).$type<Record<string, any>>().notNull().default({}),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(defaultNow),
});

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
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

export const tasks = sqliteTable("tasks", {
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
});

export const conversations = sqliteTable("conversations", {
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
});

export const messages = sqliteTable("messages", {
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
});

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
