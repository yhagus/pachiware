import { queryClient } from "./index.js";
import { activeDialect } from "./schema/index.js";

async function runMigrationsPostgres() {
  console.log("🚀 Running database migrations for PostgreSQL...");

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
      openai_api_key TEXT,
      openai_base_url TEXT,
      openai_model TEXT,
      anthropic_api_key TEXT,
      anthropic_base_url TEXT,
      anthropic_model TEXT,
      custom_base_url TEXT,
      custom_api_key TEXT,
      custom_model TEXT,
      discord_bot_token TEXT,
      discord_client_id TEXT,
      discord_guild_id TEXT,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Safely ensure columns exist on existing databases
  await queryClient`ALTER TABLE agents_config ADD COLUMN IF NOT EXISTS openai_api_key TEXT;`;
  await queryClient`ALTER TABLE agents_config ADD COLUMN IF NOT EXISTS openai_base_url TEXT;`;
  await queryClient`ALTER TABLE agents_config ADD COLUMN IF NOT EXISTS openai_model TEXT;`;
  await queryClient`ALTER TABLE agents_config ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;`;
  await queryClient`ALTER TABLE agents_config ADD COLUMN IF NOT EXISTS anthropic_base_url TEXT;`;
  await queryClient`ALTER TABLE agents_config ADD COLUMN IF NOT EXISTS anthropic_model TEXT;`;
  await queryClient`ALTER TABLE agents_config ADD COLUMN IF NOT EXISTS custom_model TEXT;`;
  await queryClient`ALTER TABLE agents_config ADD COLUMN IF NOT EXISTS discord_bot_token TEXT;`;
  await queryClient`ALTER TABLE agents_config ADD COLUMN IF NOT EXISTS discord_client_id TEXT;`;
  await queryClient`ALTER TABLE agents_config ADD COLUMN IF NOT EXISTS discord_guild_id TEXT;`;

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

  await queryClient`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);`;
  await queryClient`CREATE INDEX IF NOT EXISTS idx_tasks_discord_channel ON tasks(discord_channel_id);`;
  await queryClient`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);`;
}

async function runMigrationsSqlite() {
  console.log("🚀 Running database migrations for SQLite...");

  const exec = (sql: string) => queryClient.exec(sql);

  // Timestamps are stored as INTEGER (unix epoch milliseconds) to match the
  // drizzle `timestamp_ms` mode used in the SQLite schema. JSON columns are
  // stored as TEXT (drizzle serializes/parses).

  exec(`
    CREATE TABLE IF NOT EXISTS agents_config (
      id TEXT PRIMARY KEY DEFAULT 'default',
      name TEXT NOT NULL DEFAULT 'Pachiware Agent',
      system_prompt TEXT NOT NULL DEFAULT 'You are Pachiware Agent, an intelligent autonomous system capable of channel management, task tracking, and problem solving. You execute actions via your available tools and communicate clearly and concisely.',
      default_provider TEXT NOT NULL DEFAULT 'openai',
      default_model TEXT NOT NULL DEFAULT 'gpt-4o',
      temperature REAL NOT NULL DEFAULT 0.7,
      max_tokens INTEGER NOT NULL DEFAULT 4096,
      openai_api_key TEXT,
      openai_base_url TEXT,
      openai_model TEXT,
      anthropic_api_key TEXT,
      anthropic_base_url TEXT,
      anthropic_model TEXT,
      custom_base_url TEXT,
      custom_api_key TEXT,
      custom_model TEXT,
      discord_bot_token TEXT,
      discord_client_id TEXT,
      discord_guild_id TEXT,
      settings TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );
  `);

  // Idempotent column additions (SQLite 3.35+ supports IF NOT EXISTS on ADD COLUMN)
  const addCol = (table: string, column: string, type: string) => {
    try {
      exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
    } catch (err: any) {
      // Ignore "duplicate column" errors for forward-compat on older DBs
      if (!/duplicate column/i.test(err?.message || "")) {
        // Rethrow genuine failures
        if (!/already exists/i.test(err?.message || "")) {
          throw err;
        }
      }
    }
  };

  addCol("agents_config", "openai_api_key", "TEXT");
  addCol("agents_config", "openai_base_url", "TEXT");
  addCol("agents_config", "openai_model", "TEXT");
  addCol("agents_config", "anthropic_api_key", "TEXT");
  addCol("agents_config", "anthropic_base_url", "TEXT");
  addCol("agents_config", "anthropic_model", "TEXT");
  addCol("agents_config", "custom_model", "TEXT");
  addCol("agents_config", "discord_bot_token", "TEXT");
  addCol("agents_config", "discord_client_id", "TEXT");
  addCol("agents_config", "discord_guild_id", "TEXT");

  exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      tool_definitions TEXT NOT NULL DEFAULT '[]',
      handler_type TEXT NOT NULL DEFAULT 'builtin',
      config TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      priority TEXT NOT NULL DEFAULT 'medium',
      assigned_to TEXT,
      discord_channel_id TEXT,
      discord_guild_id TEXT,
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      user_id TEXT,
      platform TEXT NOT NULL DEFAULT 'discord',
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT,
      tool_calls TEXT,
      tool_call_id TEXT,
      tokens_used INTEGER,
      created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000)
    );
  `);

  exec(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);`);
  exec(`CREATE INDEX IF NOT EXISTS idx_tasks_discord_channel ON tasks(discord_channel_id);`);
  exec(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);`);
}

export async function runMigrations() {
  if (activeDialect === "sqlite") {
    await runMigrationsSqlite();
  } else {
    await runMigrationsPostgres();
  }
  console.log(`✅ Database schema migrated successfully! (dialect: ${activeDialect})`);
}

if (import.meta.main || process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Migration failed:", err);
      process.exit(1);
    });
}
