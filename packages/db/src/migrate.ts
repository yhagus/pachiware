import { queryClient } from "./index.js";

export async function runMigrations() {
  console.log("🚀 Running database migrations for PostgreSQL 18...");

  await queryClient`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS agents_config (
      id TEXT PRIMARY KEY DEFAULT 'default',
      name TEXT NOT NULL DEFAULT 'Pachiware Agent',
      system_prompt TEXT NOT NULL DEFAULT 'You are Pachiware Agent, an intelligent autonomous system capable of channel management, task tracking, and problem solving. You execute actions via your available tools and communicate clearly and concisely.',
      default_provider TEXT NOT NULL DEFAULT 'openai',
      default_model TEXT NOT NULL DEFAULT 'gpt-4o',
      temperature REAL NOT NULL DEFAULT 0.7,
      max_tokens INTEGER NOT NULL DEFAULT 4096,
      custom_base_url TEXT,
      custom_api_key TEXT,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      tool_definitions JSONB NOT NULL DEFAULT '[]'::jsonb,
      handler_type TEXT NOT NULL DEFAULT 'builtin',
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      assigned_to TEXT,
      discord_channel_id TEXT,
      discord_guild_id TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      channel_id TEXT,
      user_id TEXT,
      platform TEXT NOT NULL DEFAULT 'discord',
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await queryClient`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT,
      tool_calls JSONB,
      tool_call_id TEXT,
      tokens_used INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Create indexes for high performance queries
  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `;
  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_tasks_discord_channel ON tasks(discord_channel_id);
  `;
  await queryClient`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  `;

  console.log("✅ Database schema migrated successfully!");
}

if (import.meta.main || process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Migration failed:", err);
      process.exit(1);
    });
}
