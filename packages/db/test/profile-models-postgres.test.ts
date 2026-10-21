import { describe, expect, test } from "bun:test";
import { openConnection, type SqlConnection } from "../src/connection.ts";
import { migrateDatabase, SQL_TABLES } from "../src/migrate.ts";
import { createRepositories } from "../src/repositories/index.ts";
import { requireTestDatabase } from "./test-database.ts";

// Runs against TEST_POSTGRES_URL's database, whose tables are all dropped. SQLite's upgrade is in migration.test.ts.
const url = process.env.TEST_POSTGRES_URL ? requireTestDatabase("TEST_POSTGRES_URL", process.env.TEST_POSTGRES_URL) : undefined;

(url ? describe : describe.skip)("PostgreSQL upgrade to fallback models", () => {
  test("the fallback profile goes, an OpenAI or Anthropic base URL becomes BYOK unless it is the provider's own, and migrating twice is harmless", async () => {
    const connection = openConnection(url!) as SqlConnection;
    const run = (sql: string) => connection.client.unsafe(sql);
    try {
      await run(`DROP TABLE IF EXISTS ${SQL_TABLES.join(", ")} CASCADE`);
      await migrateDatabase(connection);
      await run("ALTER TABLE profiles DROP COLUMN fallback_models");
      await run("ALTER TABLE profiles ADD COLUMN fallback_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL");
      await run("INSERT INTO tenants (id, name, slug) VALUES ('t1', 'One', 'one')");
      await run(`INSERT INTO profiles (id, tenant_id, name, provider, model, base_url, api_format, fallback_profile_id) VALUES
        ('p1', 't1', 'Backup', 'openai', 'gpt-y', NULL, 'chat_completions', NULL),
        ('p2', 't1', 'Main', 'openai', 'gpt-x', 'https://api.openai.com/v1/', 'chat_completions', 'p1'),
        ('p3', 't1', 'Proxy', 'openai', 'gpt-p', 'https://proxy.example/v1', 'chat_completions', NULL),
        ('p4', 't1', 'Claude proxy', 'anthropic', 'claude-p', 'https://claude.example/v1', 'chat_completions', NULL)`);

      await migrateDatabase(connection);
      await migrateDatabase(connection);

      const { profiles } = createRepositories(connection);
      const rows = await Promise.all(["p1", "p2", "p3", "p4"].map((id) => profiles.get(id)));
      expect(rows.map((p) => [p!.id, p!.provider, p!.baseUrl, p!.apiFormat, p!.fallbackModels])).toEqual([
        ["p1", "openai", null, "chat_completions", []],
        ["p2", "openai", null, "chat_completions", []],
        ["p3", "custom", "https://proxy.example/v1", "chat_completions", []],
        ["p4", "custom", "https://claude.example/v1", "messages", []],
      ]);
      const columns = (await run("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'profiles'")).map((c: any) => c.name);
      expect(columns).toContain("fallback_models");
      expect(columns).not.toContain("fallback_profile_id");
      expect(await profiles.remove("p1")).toBe(true);
    } finally {
      await connection.close();
    }
  });
});
