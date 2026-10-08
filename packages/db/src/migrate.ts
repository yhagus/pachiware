import { randomUUID } from "node:crypto";
import { queryClient } from "./index.js";
import { activeDialect } from "./schema/index.js";
import { encryptSecret, generateApiKey, hashApiKey } from "./crypto.js";

const tables = ["api_keys", "tenants", "profiles", "git_accounts", "git_oauth_apps", "bots", "guild_configs", "bot_git_accounts", "git_scopes", "agents_config", "skills", "tenant_skills", "tasks", "conversations", "messages", "usage_events"] as const;

function definitions(pg: boolean): Record<string, string> {
  const time = pg ? "TIMESTAMPTZ" : "INTEGER";
  const now = pg ? "CURRENT_TIMESTAMP" : "(CAST(strftime('%s','now') AS INTEGER) * 1000)";
  const json = pg ? "JSONB" : "TEXT";
  const bool = pg ? "BOOLEAN" : "INTEGER";
  const yes = pg ? "true" : "1";
  const id = pg ? "TEXT PRIMARY KEY DEFAULT gen_random_uuid()" : "TEXT PRIMARY KEY NOT NULL";
  const tenant = "tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE";
  const dates = `created_at ${time} NOT NULL DEFAULT ${now}, updated_at ${time} NOT NULL DEFAULT ${now}`;
  return {
    tenants: `id ${id}, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, api_key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'active', platform_metadata ${json} NOT NULL DEFAULT '{}', ${dates}`,
    api_keys: `id ${id}, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT 'API Key', scopes ${json} NOT NULL DEFAULT '[]', last_used_at ${time}, revoked_at ${time}, created_at ${time} NOT NULL DEFAULT ${now}`,
    profiles: `id ${id}, ${tenant}, name TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, base_url TEXT, api_key_encrypted TEXT, ${dates}`,
    git_accounts: `id ${id}, ${tenant}, name TEXT NOT NULL, provider TEXT NOT NULL, base_url TEXT, username TEXT NOT NULL, token_encrypted TEXT NOT NULL, auth_type TEXT NOT NULL DEFAULT 'token', refresh_token_encrypted TEXT, token_expires_at ${time}, ${dates}, UNIQUE(tenant_id,name), UNIQUE(tenant_id,id)`,
    git_oauth_apps: `id ${id}, provider TEXT NOT NULL, base_url TEXT NOT NULL DEFAULT '', client_id TEXT NOT NULL, client_secret_encrypted TEXT NOT NULL, ${dates}, UNIQUE(provider,base_url)`,
    bots: `id ${id}, ${tenant}, name TEXT NOT NULL DEFAULT 'Discord Bot', platform TEXT NOT NULL DEFAULT 'discord', token_encrypted TEXT NOT NULL, client_id TEXT, guild_ids ${json} NOT NULL DEFAULT '[]', is_enabled ${bool} NOT NULL DEFAULT ${yes}, connection_status TEXT NOT NULL DEFAULT 'disconnected', profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL, git_account_id TEXT, last_connected_at ${time}, last_error TEXT, ${dates}, UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,git_account_id) REFERENCES git_accounts(tenant_id,id)`,
    guild_configs: `id ${id}, ${tenant}, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, guild_id TEXT NOT NULL, system_prompt TEXT, use_threads ${bool} NOT NULL DEFAULT ${yes}, always_channel_ids ${json} NOT NULL DEFAULT '[]', updated_at ${time} NOT NULL DEFAULT ${now}, UNIQUE(bot_id,guild_id)`,
    bot_git_accounts: `id ${id}, ${tenant}, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, git_account_id TEXT NOT NULL, created_at ${time} NOT NULL DEFAULT ${now}, UNIQUE(bot_id,git_account_id), FOREIGN KEY(tenant_id,git_account_id) REFERENCES git_accounts(tenant_id,id)`,
    git_scopes: `id ${id}, ${tenant}, bot_id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL DEFAULT '', git_account_id TEXT NOT NULL, repo_patterns ${json} NOT NULL DEFAULT '["*"]', updated_at ${time} NOT NULL DEFAULT ${now}, UNIQUE(bot_id,guild_id,channel_id,git_account_id), FOREIGN KEY(bot_id,git_account_id) REFERENCES bot_git_accounts(bot_id,git_account_id) ON DELETE CASCADE`,
    agents_config: `tenant_id TEXT PRIMARY KEY NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL DEFAULT 'Pachiware Agent', system_prompt TEXT NOT NULL DEFAULT 'You are Pachiware Agent, a helpful and precise assistant.', default_provider TEXT NOT NULL DEFAULT 'openai', default_model TEXT NOT NULL DEFAULT 'gpt-4o', temperature REAL NOT NULL DEFAULT 0.7, max_tokens INTEGER NOT NULL DEFAULT 4096, openai_api_key_encrypted TEXT, openai_base_url TEXT, openai_model TEXT, anthropic_api_key_encrypted TEXT, anthropic_base_url TEXT, anthropic_model TEXT, custom_api_key_encrypted TEXT, custom_base_url TEXT, custom_model TEXT, settings ${json} NOT NULL DEFAULT '{}', updated_at ${time} NOT NULL DEFAULT ${now}`,
    skills: `id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, default_enabled ${bool} NOT NULL DEFAULT ${yes}, tool_definitions ${json} NOT NULL DEFAULT '[]', handler_type TEXT NOT NULL DEFAULT 'builtin', config ${json} NOT NULL DEFAULT '{}', ${dates}`,
    tenant_skills: `id ${id}, ${tenant}, skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE, is_enabled ${bool} NOT NULL DEFAULT ${yes}, config ${json} NOT NULL DEFAULT '{}', updated_at ${time} NOT NULL DEFAULT ${now}, UNIQUE(tenant_id,skill_id)`,
    tasks: `id ${id}, ${tenant}, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'pending', priority TEXT NOT NULL DEFAULT 'medium', assigned_to TEXT, discord_channel_id TEXT, discord_guild_id TEXT, metadata ${json} DEFAULT '{}', ${dates}`,
    conversations: `id ${id}, ${tenant}, bot_id TEXT, channel_id TEXT, user_id TEXT, platform TEXT NOT NULL DEFAULT 'discord', metadata ${json} DEFAULT '{}', ${dates}, UNIQUE(tenant_id,id), FOREIGN KEY(tenant_id,bot_id) REFERENCES bots(tenant_id,id)`,
    messages: `id ${id}, ${tenant}, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT, tool_calls ${json}, tool_call_id TEXT, tokens_used INTEGER, created_at ${time} NOT NULL DEFAULT ${now}, FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE`,
    usage_events: `id ${id}, ${tenant}, bot_id TEXT, type TEXT NOT NULL, provider TEXT, model TEXT, prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0, metadata ${json} NOT NULL DEFAULT '{}', created_at ${time} NOT NULL DEFAULT ${now}, FOREIGN KEY(tenant_id,bot_id) REFERENCES bots(tenant_id,id)`,
  };
}

type Execute = (sql: string, values?: any[]) => Promise<any[]>;

async function migrate(exec: Execute, pg: boolean): Promise<string | null> {
  const existing = pg
    ? await exec("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()")
    : await exec("SELECT name FROM sqlite_master WHERE type='table'");
  const names = new Set(existing.map((r) => r.name));
  const columns = names.has("agents_config")
    ? pg ? await exec("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name='agents_config'") : await exec("PRAGMA table_info(agents_config)")
    : [];
  const legacy = columns.some((c) => c.name === "id");
  const snapshots: Record<string, any[]> = {};
  if (legacy) {
    for (const table of ["agents_config", "skills", "tasks", "conversations", "messages"]) {
      snapshots[table] = names.has(table) ? await exec(`SELECT * FROM ${table}`) : [];
    }
  }
  // Snapshot/rebuild SQLite tables so NOT NULL and ownership FKs apply to old rows too.
  if (legacy && !pg) {
    for (const table of ["messages", "conversations", "tasks", "agents_config", "skills"]) {
      if (names.has(table)) await exec(`DROP TABLE ${table}`);
    }
  }
  const ddl = definitions(pg);
  // PostgreSQL legacy tables remain in place until their columns have been backfilled.
  for (const table of tables) await exec(`CREATE TABLE IF NOT EXISTS ${table} (${ddl[table]})`);
  const botCols = await exec(pg ? "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name='bots'" : "PRAGMA table_info(bots)");
  if (!botCols.some((c) => c.name === "profile_id")) await exec("ALTER TABLE bots ADD COLUMN profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL");
  // ponytail: SQLite cannot add a composite FK via ALTER, so upgraded SQLite DBs rely on the API's tenant check; fresh DBs and PostgreSQL enforce it.
  if (!botCols.some((c) => c.name === "git_account_id")) {
    await exec("ALTER TABLE bots ADD COLUMN git_account_id TEXT");
    if (pg) await exec("ALTER TABLE bots ADD CONSTRAINT bots_git_account_fk FOREIGN KEY (tenant_id, git_account_id) REFERENCES git_accounts(tenant_id, id)");
  }
  // bots.git_account_id is superseded by bot_git_accounts; the column stays but is no longer read.
  await exec(`INSERT INTO bot_git_accounts (id, tenant_id, bot_id, git_account_id) SELECT ${pg ? "gen_random_uuid()::text" : "lower(hex(randomblob(16)))"}, tenant_id, id, git_account_id FROM bots WHERE git_account_id IS NOT NULL AND connection_status <> 'deleted' AND NOT EXISTS (SELECT 1 FROM bot_git_accounts b WHERE b.bot_id = bots.id AND b.git_account_id = bots.git_account_id)`);
  const gitCols = await exec(pg ? "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name='git_accounts'" : "PRAGMA table_info(git_accounts)");
  if (!gitCols.some((c) => c.name === "auth_type")) {
    await exec("ALTER TABLE git_accounts ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'token'");
    await exec("ALTER TABLE git_accounts ADD COLUMN refresh_token_encrypted TEXT");
    await exec(`ALTER TABLE git_accounts ADD COLUMN token_expires_at ${pg ? "TIMESTAMPTZ" : "INTEGER"}`);
  }
  // Keys used to belong to one tenant; they are now global and tenants point back at the key that created them.
  const tenantCols = await exec(pg ? "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name='tenants'" : "PRAGMA table_info(tenants)");
  if (!tenantCols.some((c) => c.name === "api_key_id")) await exec("ALTER TABLE tenants ADD COLUMN api_key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL");
  const keyCols = await exec(pg ? "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name='api_keys'" : "PRAGMA table_info(api_keys)");
  if (keyCols.some((c) => c.name === "tenant_id")) {
    await exec("UPDATE tenants SET api_key_id = (SELECT k.id FROM api_keys k WHERE k.tenant_id = tenants.id ORDER BY (k.revoked_at IS NOT NULL), k.created_at, k.id LIMIT 1) WHERE api_key_id IS NULL");
    await exec("DROP INDEX IF EXISTS api_keys_tenant_idx");
    if (pg) await exec("ALTER TABLE api_keys DROP COLUMN tenant_id");
    else {
      await exec(`CREATE TABLE api_keys_new (${ddl.api_keys})`);
      await exec("INSERT INTO api_keys_new (id,key_prefix,key_hash,name,scopes,last_used_at,revoked_at,created_at) SELECT id,key_prefix,key_hash,name,scopes,last_used_at,revoked_at,created_at FROM api_keys");
      await exec("DROP TABLE api_keys");
      await exec("ALTER TABLE api_keys_new RENAME TO api_keys");
    }
  }
  const tenants = await exec("SELECT id FROM tenants LIMIT 1");
  const legacyConfig = snapshots.agents_config?.find((r) => r.id === "default") || snapshots.agents_config?.[0];
  const hasEnv = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CUSTOM_LLM_API_KEY", "DISCORD_BOT_TOKEN"].some((k) => Boolean(process.env[k]));
  let bootstrapKey: string | null = null;
  let tenantId = tenants[0]?.id;
  const insert = async (table: string, row: Record<string, any>) => {
    const entries = Object.entries(row).filter(([, v]) => v !== undefined);
    const jsonFields = new Set(["platform_metadata", "scopes", "guild_ids", "settings", "repo_patterns", "tool_definitions", "config", "metadata", "tool_calls"]);
    const params = entries.map(([key, value]) => pg && jsonFields.has(key) && value !== null && typeof value !== "string" ? JSON.stringify(value) : value);
    await exec(`INSERT INTO ${table} (${entries.map(([k]) => k).join(",")}) VALUES (${entries.map((_, i) => pg ? `$${i + 1}` : "?").join(",")})`, params);
  };
  if (!tenantId && (legacy || hasEnv)) {
    tenantId = randomUUID();
    const key = generateApiKey(), keyId = randomUUID();
    await insert("api_keys", { id: keyId, key_prefix: key.keyPrefix, key_hash: hashApiKey(key.raw), name: "Bootstrap Key", scopes: JSON.stringify(["*"]) });
    await insert("tenants", { id: tenantId, name: "Default Tenant", slug: "default", api_key_id: keyId, platform_metadata: JSON.stringify({ bootstrap: true }) });
    bootstrapKey = key.raw;
  }
  if (legacy && pg) {
    await exec("ALTER TABLE agents_config DROP CONSTRAINT agents_config_pkey");
    await exec("ALTER TABLE agents_config ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE");
    for (const provider of ["openai", "anthropic", "custom"]) {
      const old = `${provider}_api_key`;
      if (columns.some((c) => c.name === old)) await exec(`ALTER TABLE agents_config RENAME COLUMN ${old} TO ${old}_encrypted`);
      else await exec(`ALTER TABLE agents_config ADD COLUMN ${old}_encrypted TEXT`);
    }
    await exec("UPDATE agents_config SET tenant_id=$1", [tenantId]);
    await exec("ALTER TABLE agents_config DROP COLUMN id, DROP COLUMN IF EXISTS discord_bot_token, DROP COLUMN IF EXISTS discord_client_id, DROP COLUMN IF EXISTS discord_guild_id");
    await exec("ALTER TABLE agents_config ALTER COLUMN tenant_id SET NOT NULL, ADD PRIMARY KEY (tenant_id)");
    await exec("ALTER TABLE skills RENAME COLUMN is_enabled TO default_enabled");
    for (const table of ["tasks", "conversations", "messages"]) {
      await exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE`);
      await exec(`UPDATE ${table} SET tenant_id=$1`, [tenantId]);
      await exec(`ALTER TABLE ${table} ALTER COLUMN tenant_id SET NOT NULL`);
    }
    await exec("ALTER TABLE conversations ADD COLUMN bot_id TEXT");
    await exec("ALTER TABLE conversations ADD UNIQUE(tenant_id,id), ADD FOREIGN KEY(tenant_id,bot_id) REFERENCES bots(tenant_id,id)");
    await exec("ALTER TABLE messages ADD FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id) ON DELETE CASCADE");
  }
  if (tenantId && (legacy || (!tenants.length && hasEnv))) {
    const source = legacyConfig || {};
    const config: Record<string, any> = { tenant_id: tenantId };
    for (const key of ["name", "system_prompt", "default_provider", "default_model", "temperature", "max_tokens", "openai_base_url", "openai_model", "anthropic_base_url", "anthropic_model", "custom_base_url", "custom_model", "settings", "updated_at"]) {
      if (source[key] !== undefined) config[key] = source[key];
    }
    config.default_provider ??= process.env.DEFAULT_LLM_PROVIDER || "openai";
    config.default_model ??= process.env.DEFAULT_MODEL || "gpt-4o";
    for (const provider of ["openai", "anthropic", "custom"]) {
      const key = source[`${provider}_api_key`] || process.env[provider === "custom" ? "CUSTOM_LLM_API_KEY" : `${provider.toUpperCase()}_API_KEY`];
      config[`${provider}_api_key_encrypted`] = key ? encryptSecret(key) : null;
    }
    config.openai_base_url ??= process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    config.custom_base_url ??= process.env.CUSTOM_LLM_BASE_URL || null;
    config.custom_model ??= process.env.CUSTOM_LLM_MODEL || null;
    if (pg && legacy) {
      const entries = Object.entries(config).filter(([k]) => k !== "tenant_id");
      const jsonFields = new Set(["settings"]);
      const params = entries.map(([key, value]) => jsonFields.has(key) && value !== null && typeof value !== "string" ? JSON.stringify(value) : value);
      await exec(`UPDATE agents_config SET ${entries.map(([k], i) => `${k}=$${i + 1}`).join(",")} WHERE tenant_id=$${entries.length + 1}`, [...params, tenantId]);
    } else await insert("agents_config", config);
    const token = source.discord_bot_token || process.env.DISCORD_BOT_TOKEN;
    let botId: string | null = null;
    if (token) {
      botId = randomUUID();
      await insert("bots", { id: botId, tenant_id: tenantId, token_encrypted: encryptSecret(token), client_id: source.discord_client_id || process.env.DISCORD_CLIENT_ID || null, guild_ids: JSON.stringify([source.discord_guild_id || process.env.DISCORD_GUILD_ID].filter(Boolean)) });
    }
    if (legacy && !pg) {
      for (const row of snapshots.skills) {
        const { is_enabled, ...rest } = row;
        await insert("skills", { ...rest, default_enabled: is_enabled });
      }
      for (const table of ["tasks", "conversations", "messages"]) {
        for (const row of snapshots[table]) await insert(table, { ...row, tenant_id: tenantId, ...(table === "conversations" && row.platform === "discord" ? { bot_id: botId } : {}) });
      }
    } else if (pg && botId && legacy) {
      await exec("UPDATE conversations SET bot_id=$1 WHERE platform='discord'", [botId]);
    }
    for (const row of snapshots.skills || []) await insert("tenant_skills", { id: randomUUID(), tenant_id: tenantId, skill_id: row.id, is_enabled: row.is_enabled, config: typeof row.config === "string" ? row.config : JSON.stringify(row.config || {}) });
  }
  for (const table of ["tasks", "conversations", "messages"]) await exec(`CREATE INDEX IF NOT EXISTS ${table}_tenant_created_idx ON ${table}(tenant_id,created_at)`);
  await exec("CREATE INDEX IF NOT EXISTS tenants_api_key_idx ON tenants(api_key_id)");
  await exec("CREATE INDEX IF NOT EXISTS bots_tenant_idx ON bots(tenant_id)");
  await exec("CREATE INDEX IF NOT EXISTS profiles_tenant_idx ON profiles(tenant_id)");
  await exec("CREATE INDEX IF NOT EXISTS usage_tenant_created_idx ON usage_events(tenant_id,created_at)");
  return bootstrapKey;
}

export async function runMigrations(): Promise<void> {
  let key: string | null;
  if (activeDialect === "postgres") {
    key = await queryClient.begin(async (client: any) => {
      await client.unsafe("SELECT pg_advisory_xact_lock(73418263)");
      return migrate((sql, values = []) => client.unsafe(sql, values), true);
    });
  } else {
    queryClient.exec("PRAGMA foreign_keys = OFF");
    queryClient.exec("BEGIN IMMEDIATE");
    try {
      key = await migrate(async (sql, values = []) => {
        const query = queryClient.query(sql);
        return query.all(...values);
      }, false);
      const violations = queryClient.query("PRAGMA foreign_key_check").all();
      if (violations.length) throw new Error("Migration would violate database ownership constraints");
      queryClient.exec("COMMIT");
    } catch (err) {
      queryClient.exec("ROLLBACK");
      throw err;
    } finally {
      queryClient.exec("PRAGMA foreign_keys = ON");
    }
  }
  if (key) console.log(`Bootstrap API key (shown once): ${key}`);
  console.log(`Database schema migrated successfully (${activeDialect}).`);
}

if (import.meta.main) runMigrations().then(() => process.exit(0)).catch(() => { console.error("Migration failed; check database and encryption key configuration."); process.exit(1); });
