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
        import { queryClient } from ${JSON.stringify(join(source, "internal.ts"))};
        await runMigrations();
        await runMigrations();
        const columns = queryClient.query("PRAGMA table_info(schedules)").all().map((c) => c.name);
        console.log(JSON.stringify({ tenants: queryClient.query("SELECT COUNT(*) AS count FROM tenants").get().count, tables: queryClient.query("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('api_keys', 'bots', 'tenant_skills', 'usage_events', 'schedules')").get().count, dueIndex: queryClient.query("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'schedules_due_idx'").get()?.sql, columns }));
      `;
      const result = run(database, script, { OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, CUSTOM_LLM_API_KEY: undefined, DISCORD_BOT_TOKEN: undefined });
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(stdout(result).match(/Bootstrap API key/g)).toBeNull();
      expect(JSON.parse(stdout(result).split("\n").at(-1)!)).toEqual({
        tenants: 0, tables: 5, dueIndex: "CREATE INDEX schedules_due_idx ON schedules(status,next_at)",
        columns: ["id", "tenant_id", "bot_id", "kind", "guild_id", "channel_id", "owner_id", "owner_name", "text", "with_tasks", "mentions", "recurrence", "weekdays", "day_of_month", "time_of_day", "timezone", "until", "next_at", "last_fired_at", "status", "attempts", "error", "created_at"],
      });
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
        import { queryClient, repositories } from ${JSON.stringify(join(source, "internal.ts"))};
        import { decryptSecret } from ${JSON.stringify(join(source, "crypto.ts"))};
        await runMigrations();
        const tenant = queryClient.query("SELECT id, slug, platform_metadata FROM tenants").get();
        const config = queryClient.query("SELECT name, system_prompt, openai_api_key_encrypted, settings FROM agents_config").get();
        const bot = queryClient.query("SELECT id, tenant_id, token_encrypted, client_id, guild_ids FROM bots").get();
        const task = queryClient.query("SELECT tenant_id, title, discord_guild_id FROM tasks WHERE id = 'task-1'").get();
        const stored = await repositories().conversations.get(tenant.id, "conversation-1");
        const conversation = stored && { tenant_id: stored.tenantId, bot_id: stored.botId };
        const message = (await repositories().conversations.listMessages(tenant.id, "conversation-1", { offset: 0, limit: 10 })).filter((m) => m.id === "message-1").map((m) => ({ tenant_id: m.tenantId, content: m.content }))[0];
        const skill = queryClient.query("SELECT default_enabled, config FROM skills WHERE id = 'legacy-skill'").get();
        const tenantSkill = queryClient.query("SELECT is_enabled FROM tenant_skills WHERE skill_id = 'legacy-skill'").get();
        const keyCount = queryClient.query("SELECT COUNT(*) AS count FROM api_keys").get().count;
        const owner = queryClient.query("SELECT t.api_key_id AS key, k.name FROM tenants t JOIN api_keys k ON k.id = t.api_key_id").get();
        console.log(JSON.stringify({ tenant, config: { ...config, openai_api_key_encrypted: decryptSecret(config.openai_api_key_encrypted) }, bot: { ...bot, token_encrypted: decryptSecret(bot.token_encrypted) }, task, conversation, message, skill, tenantSkill, keyCount, owner }));
      `);
      expect(migrate.exitCode, stderr(migrate)).toBe(0);
      expect(stdout(migrate).match(/Bootstrap API key \(shown once\): pk_live_[A-Za-z0-9_-]+/g)).toHaveLength(1);
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
      expect(migrated.owner.name).toBe("Bootstrap Key");

      const rerun = run(database, `import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))}; await runMigrations();`);
      expect(rerun.exitCode, stderr(rerun)).toBe(0);
      expect(stdout(rerun)).not.toContain("Bootstrap API key");
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
      expect(stdout(recovered)).toContain("Bootstrap API key");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("adds the accepts-images flag to existing profiles, turned off", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-migration-profiles-"));
    const database = join(directory, "profiles.db");
    try {
      const result = run(database, `
        import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
        import { queryClient } from ${JSON.stringify(join(source, "internal.ts"))};
        await runMigrations();
        queryClient.exec("ALTER TABLE profiles DROP COLUMN accepts_images");
        queryClient.exec("INSERT INTO tenants (id,name,slug) VALUES ('t1','One','one')");
        queryClient.exec("INSERT INTO profiles (id,tenant_id,name,provider,model) VALUES ('p1','t1','Old','openai','gpt-x')");
        await runMigrations();
        await runMigrations();
        console.log(JSON.stringify(queryClient.query("SELECT id, accepts_images AS flag FROM profiles").all()));
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(JSON.parse(stdout(result).split("\n").at(-1)!)).toEqual([{ id: "p1", flag: 0 }]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("adds the fallback to existing profiles, empty, and clears it when the fallback is deleted", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-migration-fallback-"));
    const database = join(directory, "fallback.db");
    try {
      const result = run(database, `
        import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
        import { queryClient } from ${JSON.stringify(join(source, "internal.ts"))};
        await runMigrations();
        queryClient.exec("ALTER TABLE profiles DROP COLUMN fallback_profile_id");
        queryClient.exec("INSERT INTO tenants (id,name,slug) VALUES ('t1','One','one')");
        queryClient.exec("INSERT INTO profiles (id,tenant_id,name,provider,model) VALUES ('p1','t1','Old','openai','gpt-x'),('p2','t1','Backup','openai','gpt-y')");
        await runMigrations();
        await runMigrations();
        const before = queryClient.query("SELECT id, fallback_profile_id AS fallback FROM profiles ORDER BY id").all();
        queryClient.exec("UPDATE profiles SET fallback_profile_id = 'p2' WHERE id = 'p1'");
        queryClient.exec("DELETE FROM profiles WHERE id = 'p2'");
        console.log(JSON.stringify({ before, after: queryClient.query("SELECT id, fallback_profile_id AS fallback FROM profiles").all() }));
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(JSON.parse(stdout(result).split("\n").at(-1)!)).toEqual({
        before: [{ id: "p1", fallback: null }, { id: "p2", fallback: null }],
        after: [{ id: "p1", fallback: null }],
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("upgrades per-tenant API keys to global keys, linking each tenant to its first live key", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-migration-keys-"));
    const database = join(directory, "keys.db");
    try {
      const result = run(database, `
        import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
        import { queryClient } from ${JSON.stringify(join(source, "internal.ts"))};
        await runMigrations();
        // Rebuild the pre-global shape: keys carried tenant_id and tenants had no owner column.
        queryClient.exec("PRAGMA foreign_keys = OFF");
        queryClient.exec("DROP TABLE api_keys; ALTER TABLE tenants DROP COLUMN api_key_id; DROP INDEX IF EXISTS tenants_api_key_idx");
        queryClient.exec("CREATE TABLE api_keys (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT 'API Key', scopes TEXT NOT NULL DEFAULT '[]', last_used_at INTEGER, revoked_at INTEGER, created_at INTEGER NOT NULL DEFAULT 0)");
        queryClient.exec("INSERT INTO tenants (id,name,slug) VALUES ('t1','One','one'),('t2','Two','two'),('t3','Three','three')");
        queryClient.exec("INSERT INTO api_keys (id,tenant_id,key_prefix,key_hash,name,revoked_at,created_at) VALUES ('k1-old','t1','pk_live_a','h1','revoked first',5,1),('k1-new','t1','pk_live_b','h2','live second',NULL,2),('k2','t2','pk_live_c','h3','only',NULL,1)");
        queryClient.exec("PRAGMA foreign_keys = ON");
        await runMigrations();
        await runMigrations();
        const owners = Object.fromEntries(queryClient.query("SELECT slug, api_key_id AS key FROM tenants").all().map((r) => [r.slug, r.key]));
        const cols = queryClient.query("PRAGMA table_info(api_keys)").all().map((c) => c.name);
        console.log(JSON.stringify({ owners, hasTenantId: cols.includes("tenant_id"), keys: queryClient.query("SELECT COUNT(*) AS n FROM api_keys").get().n }));
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(JSON.parse(stdout(result).split("\n").at(-1)!)).toEqual({ owners: { one: "k1-new", two: "k2", three: null }, hasTenantId: false, keys: 3 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("backfills existing tenants with Asia/Jakarta and Indonesian, and leaves guild overrides empty", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-migration-zones-"));
    const database = join(directory, "zones.db");
    try {
      const result = run(database, `
        import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
        import { queryClient } from ${JSON.stringify(join(source, "internal.ts"))};
        await runMigrations();
        for (const column of ["timezone", "language"]) { queryClient.exec("ALTER TABLE agents_config DROP COLUMN " + column); queryClient.exec("ALTER TABLE guild_configs DROP COLUMN " + column); }
        queryClient.exec("INSERT INTO tenants (id,name,slug) VALUES ('t1','One','one')");
        queryClient.exec("INSERT INTO agents_config (tenant_id) VALUES ('t1')");
        queryClient.exec("INSERT INTO bots (id,tenant_id,token_encrypted) VALUES ('b1','t1','x')");
        queryClient.exec("INSERT INTO guild_configs (id,tenant_id,bot_id,guild_id) VALUES ('g1','t1','b1','guild-1')");
        await runMigrations();
        await runMigrations();
        console.log(JSON.stringify({ tenant: queryClient.query("SELECT timezone, language FROM agents_config").get(), guild: queryClient.query("SELECT timezone, language FROM guild_configs").get() }));
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(JSON.parse(stdout(result).split("\n").at(-1)!)).toEqual({ tenant: { timezone: "Asia/Jakarta", language: "id" }, guild: { timezone: null, language: null } });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  test("adds Daily log channels to existing guild settings, none turned on", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-migration-daily-logs-"));
    const database = join(directory, "daily-logs.db");
    try {
      const result = run(database, `
        import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
        import { queryClient } from ${JSON.stringify(join(source, "internal.ts"))};
        await runMigrations();
        queryClient.exec("ALTER TABLE guild_configs DROP COLUMN daily_log_channels");
        queryClient.exec("INSERT INTO tenants (id,name,slug) VALUES ('t1','One','one')");
        queryClient.exec("INSERT INTO bots (id,tenant_id,token_encrypted) VALUES ('b1','t1','x')");
        queryClient.exec("INSERT INTO guild_configs (id,tenant_id,bot_id,guild_id) VALUES ('g1','t1','b1','guild-1')");
        await runMigrations();
        await runMigrations();
        console.log(JSON.stringify(queryClient.query("SELECT id, daily_log_channels AS channels FROM guild_configs").all()));
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(JSON.parse(stdout(result).split("\n").at(-1)!)).toEqual([{ id: "g1", channels: "[]" }]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  test("adds doc sources to existing guild settings, none mirrored", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-migration-doc-sources-"));
    const database = join(directory, "doc-sources.db");
    try {
      const result = run(database, `
        import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
        import { queryClient } from ${JSON.stringify(join(source, "internal.ts"))};
        await runMigrations();
        queryClient.exec("ALTER TABLE guild_configs DROP COLUMN doc_sources");
        queryClient.exec("INSERT INTO tenants (id,name,slug) VALUES ('t1','One','one')");
        queryClient.exec("INSERT INTO bots (id,tenant_id,token_encrypted) VALUES ('b1','t1','x')");
        queryClient.exec("INSERT INTO guild_configs (id,tenant_id,bot_id,guild_id,daily_log_channels) VALUES ('g1','t1','b1','guild-1','[{\\"channelId\\":\\"c1\\",\\"backfill\\":false}]')");
        await runMigrations();
        await runMigrations();
        console.log(JSON.stringify(queryClient.query("SELECT id, daily_log_channels AS logs, doc_sources AS sources FROM guild_configs").all()));
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(JSON.parse(stdout(result).split("\n").at(-1)!)).toEqual([{ id: "g1", logs: '[{"channelId":"c1","backfill":false}]', sources: "[]" }]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("puts every existing Plane account on Plane 1.3, with no server release read yet", () => {
    const directory = mkdtempSync(join(tmpdir(), "pachiware-migration-plane-version-"));
    const database = join(directory, "plane-version.db");
    try {
      const result = run(database, `
        import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
        import { queryClient } from ${JSON.stringify(join(source, "internal.ts"))};
        await runMigrations();
        queryClient.exec("ALTER TABLE plane_accounts DROP COLUMN plane_version");
        queryClient.exec("ALTER TABLE plane_accounts DROP COLUMN plane_server_version");
        queryClient.exec("INSERT INTO tenants (id,name,slug) VALUES ('t1','One','one')");
        queryClient.exec("INSERT INTO plane_accounts (id,tenant_id,name,workspace_slug,api_key_encrypted,plane_user_id,plane_user_name) VALUES ('p1','t1','main','acme','enc','u-1','Pachi Bot')");
        await runMigrations();
        await runMigrations();
        console.log(JSON.stringify(queryClient.query("SELECT id, name, plane_version AS version, plane_server_version AS release FROM plane_accounts").all()));
      `);
      expect(result.exitCode, stderr(result)).toBe(0);
      expect(JSON.parse(stdout(result).split("\n").at(-1)!)).toEqual([{ id: "p1", name: "main", version: "1.3", release: null }]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
