import { pgTable, text, timestamp, boolean, jsonb, integer, real } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Agents Configuration Table
 * Stores agent personality, active system prompts, LLM router defaults, and provider configurations.
 */
export const agentsConfig = pgTable("agents_config", {
  id: text("id").primaryKey().default("default"),
  name: text("name").notNull().default("Pachiware Agent"),
  systemPrompt: text("system_prompt").notNull().default(
    "You are Pachiware Agent, an intelligent autonomous system capable of channel management, task tracking, and problem solving. You execute actions via your available tools and communicate clearly and concisely."
  ),
  defaultProvider: text("default_provider").notNull().default("openai"), // 'openai' | 'anthropic' | 'custom'
  defaultModel: text("default_model").notNull().default("gpt-4o"),
  temperature: real("temperature").notNull().default(0.7),
  maxTokens: integer("max_tokens").notNull().default(4096),

  // OpenAI Provider
  openaiApiKey: text("openai_api_key"),
  openaiBaseUrl: text("openai_base_url"),
  openaiModel: text("openai_model"),

  // Anthropic Provider
  anthropicApiKey: text("anthropic_api_key"),
  anthropicBaseUrl: text("anthropic_base_url"),
  anthropicModel: text("anthropic_model"),

  // Custom / 9router (OpenAI-compatible) Provider
  customBaseUrl: text("custom_base_url"),
  customApiKey: text("custom_api_key"),
  customModel: text("custom_model"),

  // Discord Gateway
  discordBotToken: text("discord_bot_token"),
  discordClientId: text("discord_client_id"),
  discordGuildId: text("discord_guild_id"),

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
  isEnabled: boolean("is_enabled").notNull().default(true),
  toolDefinitions: jsonb("tool_definitions").notNull().default([]), // array of OpenAI/Anthropic tool schemas
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
export const tasks = pgTable("tasks", {
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
});

/**
 * Conversations Table
 * Groups message threads originating from Discord channels or Web Dashboard chats.
 */
export const conversations = pgTable("conversations", {
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
});

/**
 * Messages Table
 * Persistent message history for context windows, audit trails, and tool execution logs.
 */
export const messages = pgTable("messages", {
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
});

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
