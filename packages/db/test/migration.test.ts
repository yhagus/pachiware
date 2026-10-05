import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();
const source = join(workspace, "packages/db/src");
const validKey = Buffer.alloc(32, 93).toString("base64");

function run(database: string, script: string, environment: Record<string, string | undefined> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "--eval", script],
    cwd: workspace,
    env: {
      ...process.env,
      DATABASE_URL: `sqlite:${database}`,
      NODE_ENV: "test",
      PLATFORM_ENCRYPTION_KEY: validKey,
      ...environment,
    },
  });
}

function stdout(result: ReturnType<typeof Bun.spawnSync>): string {
  return new TextDecoder().decode(result.stdout).trim();
}

function stderr(result: ReturnType<typeof Bun.spawnSync>): string {
  return new TextDecoder().decode(result.stderr).trim();
}

const legacyFixture = `
  import { Database } from "bun:sqlite";
  const database = new Database(process.env.DATABASE_URL.slice("sqlite:".length));
  database.exec(\`
    CREATE TABLE agents_config (
      id TEXT PRIMARY KEY DEFAULT 'default', name TEXT NOT NULL, system_prompt TEXT NOT NULL,
      default_provider TEXT NOT NULL, default_model TEXT NOT NULL, temperature REAL NOT NULL,
      max_tokens INTEGER NOT NULL, openai_api_key TEXT, openai_base_url TEXT, openai_model TEXT,
      anthropic_api_key TEXT, anthropic_base_url TEXT, anthropic_model TEXT, custom_base_url TEXT,
      custom_api_key TEXT, custom_model TEXT, discord_bot_token TEXT, discord_client_id TEXT,
      discord_guild_id TEXT, settings TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL
    );
    CREATE TABLE skills (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, is_enabled INTEGER NOT NULL, tool_definitions TEXT NOT NULL DEFAULT '[]', handler_type TEXT NOT NULL DEFAULT 'builtin', config TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL, priority TEXT NOT NULL, assigned_to TEXT, discord_channel_id TEXT, discord_guild_id TEXT, metadata TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE conversations (id TEXT PRIMARY KEY, channel_id TEXT, user_id TEXT, platform TEXT NOT NULL, metadata TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, tool_calls TEXT, tool_call_id TEXT, tokens_used INTEGER, created_at INTEGER NOT NULL);
  \`);
  database.query(\`INSERT INTO agents_config VALUES ('default','Legacy Agent','legacy prompt','openai','gpt-legacy',0.4,777,'openai-secret','https://legacy.example','model-x',NULL,NULL,NULL,NULL,NULL,NULL,'discord-secret','client-1','guild-1','{"mode":"legacy"}',100)\`).run();
  database.query(\`INSERT INTO skills VALUES ('legacy-skill','Legacy skill','old definition',0,'[]','builtin','{"colour":"blue"}',101,102)\`).run();
  database.query(\`INSERT INTO tasks VALUES ('task-1','Preserved task','description','pending','high','sam','channel-1','guild-1','{"origin":"legacy"}',103,104)\`).run();
  database.query(\`INSERT INTO conversations VALUES ('conversation-1','channel-1','user-1','discord','{}',105,106)\`).run();
  database.query(\`INSERT INTO messages VALUES ('message-1','conversation-1','user','preserved message',NULL,NULL,12,107)\`).run();
  database.close();
`;

describe("SQLite tenancy migration", () => {
  test("is idempotent on a fresh database and does not create a tenant without legacy credentials", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-migration-fresh-"));
    const database = join(directory, "fresh.db");
    try {
      const script = `
        import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
        import { queryClient } from ${JSON.stringify(join(source, "index.ts"))};
        await runMigrations();
        await runMigrations();
        console.log(JSON.stringify({ tenants: queryClient.query("SELECT COUNT(*) AS count FROM tenants").get().count, tables: queryClient.query("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('api_keys', 'bots', 'tenant_skills', 'usage_events')").get().count }));
      `;
      const result = run(database, script, { OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, CUSTOM_LLM_API_KEY: undefined, DISCORD_BOT_TOKEN: undefined });
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(stdout(result).match(/Bootstrap tenant API key/g)).toBeNull();
      expect(JSON.parse(stdout(result).split("\n").at(-1)!)).toEqual({ tenants: 0, tables: 4 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("migrates legacy configuration, data, skills, and bot into a bootstrap tenant exactly once", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-migration-legacy-"));
    const database = join(directory, "legacy.db");
    try {
      const fixture = run(database, legacyFixture);
      expect(fixture.exitCode, stderr(fixture)).toBe(0);
      const migrate = run(database, `
        import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
        import { queryClient } from ${JSON.stringify(join(source, "index.ts"))};
        import { decryptSecret } from ${JSON.stringify(join(source, "crypto.ts"))};
        await runMigrations();
        const tenant = queryClient.query("SELECT id, slug, platform_metadata FROM tenants").get();
        const config = queryClient.query("SELECT name, system_prompt, openai_api_key_encrypted, settings FROM agents_config").get();
        const bot = queryClient.query("SELECT id, tenant_id, token_encrypted, client_id, guild_ids FROM bots").get();
        const task = queryClient.query("SELECT tenant_id, title, discord_guild_id FROM tasks WHERE id = 'task-1'").get();
        const conversation = queryClient.query("SELECT tenant_id, bot_id FROM conversations WHERE id = 'conversation-1'").get();
        const message = queryClient.query("SELECT tenant_id, content FROM messages WHERE id = 'message-1'").get();
        const skill = queryClient.query("SELECT default_enabled, config FROM skills WHERE id = 'legacy-skill'").get();
        const tenantSkill = queryClient.query("SELECT is_enabled FROM tenant_skills WHERE skill_id = 'legacy-skill'").get();
        const keyCount = queryClient.query("SELECT COUNT(*) AS count FROM api_keys").get().count;
        console.log(JSON.stringify({ tenant, config: { ...config, openai_api_key_encrypted: decryptSecret(config.openai_api_key_encrypted) }, bot: { ...bot, token_encrypted: decryptSecret(bot.token_encrypted) }, task, conversation, message, skill, tenantSkill, keyCount }));
      `);
      expect(migrate.exitCode, stderr(migrate)).toBe(0);
      expect(stdout(migrate).match(/Bootstrap tenant API key \(shown once\): pk_live_[A-Za-z0-9_-]+/g)).toHaveLength(1);
      const migrated = JSON.parse(stdout(migrate).split("\n").at(-1)!);
      expect(migrated.tenant).toMatchObject({ slug: "default", platform_metadata: JSON.stringify({ bootstrap: true }) });
      expect(migrated.config).toMatchObject({ name: "Legacy Agent", system_prompt: "legacy prompt", openai_api_key_encrypted: "openai-secret", settings: "{\"mode\":\"legacy\"}" });
      expect(migrated.bot).toMatchObject({ tenant_id: migrated.tenant.id, token_encrypted: "discord-secret", client_id: "client-1", guild_ids: "[\"guild-1\"]" });
      expect(migrated.task).toMatchObject({ tenant_id: migrated.tenant.id, title: "Preserved task", discord_guild_id: "guild-1" });
      expect(migrated.conversation).toEqual({ tenant_id: migrated.tenant.id, bot_id: migrated.bot.id });
      expect(migrated.message).toEqual({ tenant_id: migrated.tenant.id, content: "preserved message" });
      expect(migrated.skill).toEqual({ default_enabled: 0, config: "{\"colour\":\"blue\"}" });
      expect(migrated.tenantSkill).toEqual({ is_enabled: 0 });
      expect(migrated.keyCount).toBe(1);

      const rerun = run(database, `import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))}; await runMigrations();`);
      expect(rerun.exitCode, stderr(rerun)).toBe(0);
      expect(stdout(rerun)).not.toContain("Bootstrap tenant API key");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rolls back an encryption-key failure so a later valid-key migration succeeds", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-migration-rollback-"));
    const database = join(directory, "rollback.db");
    try {
      expect(run(database, legacyFixture).exitCode).toBe(0);
      const failed = run(database, `import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))}; await runMigrations();`, { PLATFORM_ENCRYPTION_KEY: "invalid" });
      expect(failed.exitCode).toBe(1);
      const inspect = run(database, `
        import { Database } from "bun:sqlite";
        const db = new Database(process.env.DATABASE_URL.slice("sqlite:".length));
        console.log(JSON.stringify({ legacy: db.query("PRAGMA table_info(agents_config)").all().some((column) => column.name === "id"), tenants: db.query("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'tenants'").get().count }));
      `);
      expect(inspect.exitCode, stderr(inspect)).toBe(0);
      expect(JSON.parse(stdout(inspect))).toEqual({ legacy: true, tenants: 0 });
      const recovered = run(database, `import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))}; await runMigrations();`);
      expect(recovered.exitCode, stderr(recovered)).toBe(0);
      expect(stdout(recovered)).toContain("Bootstrap tenant API key");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
