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
import { detectDialect, type DbDialect } from "../dialect.js";

import * as pgSchema from "./pg/index.js";
import * as sqliteSchema from "./sqlite/index.js";

const { databaseUrl } = getInfraConfig();
export const activeDialect: DbDialect = detectDialect(databaseUrl);

const active = activeDialect === "postgres" ? pgSchema : sqliteSchema;

export const agentsConfig = active.agentsConfig;
export const skills = active.skills;
export const tasks = active.tasks;
export const conversations = active.conversations;
export const messages = active.messages;

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
