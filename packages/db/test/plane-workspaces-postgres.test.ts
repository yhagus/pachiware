import { describe, expect, test } from "bun:test";
import { openConnection, type SqlConnection } from "../src/connection.ts";
import { migrateDatabase, SQL_TABLES } from "../src/migrate.ts";
import { createRepositories } from "../src/repositories/index.ts";
import { requireTestDatabase } from "./test-database.ts";

// Runs against TEST_POSTGRES_URL's database, whose tables are all dropped. SQLite's upgrade is in migration.test.ts.
const url = process.env.TEST_POSTGRES_URL ? requireTestDatabase("TEST_POSTGRES_URL", process.env.TEST_POSTGRES_URL) : undefined;

/** The Plane tables before Plane accounts listed several Plane workspaces: one `workspace_slug`, and scopes without one. */
const LEGACY_PLANE_TABLES = [
  "DROP TABLE plane_scopes, bot_plane_accounts, plane_accounts",
  "CREATE TABLE plane_accounts (id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, base_url TEXT, workspace_slug TEXT NOT NULL, api_key_encrypted TEXT NOT NULL, plane_user_id TEXT NOT NULL, plane_user_name TEXT NOT NULL, plane_version TEXT NOT NULL DEFAULT '1.3', plane_server_version TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id,name), UNIQUE(tenant_id,id))",
  "CREATE TABLE bot_plane_accounts (id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, plane_account_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(bot_id,plane_account_id), FOREIGN KEY(tenant_id,plane_account_id) REFERENCES plane_accounts(tenant_id,id))",
  "CREATE TABLE plane_scopes (id TEXT PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, bot_id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL DEFAULT '', plane_account_id TEXT NOT NULL, project_ids JSONB NOT NULL DEFAULT '[]', updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(bot_id,guild_id,channel_id,plane_account_id), FOREIGN KEY(bot_id,plane_account_id) REFERENCES bot_plane_accounts(bot_id,plane_account_id) ON DELETE CASCADE)",
];

(url ? describe : describe.skip)("PostgreSQL upgrade to Plane accounts with a list of Plane workspaces", () => {
  test("each account's one slug becomes its list and its scopes' slug, the scope key admits a second workspace, and migrating twice is harmless", async () => {
    const connection = openConnection(url!) as SqlConnection;
    const run = (sql: string) => connection.client.unsafe(sql);
    try {
      await run(`DROP TABLE IF EXISTS ${SQL_TABLES.join(", ")} CASCADE`);
      await migrateDatabase(connection);
      for (const sql of LEGACY_PLANE_TABLES) await run(sql);
      await run("INSERT INTO tenants (id, name, slug) VALUES ('t1', 'One', 'one')");
      await run("INSERT INTO bots (id, tenant_id, token_encrypted) VALUES ('b1', 't1', 'enc')");
      await run("INSERT INTO plane_accounts (id, tenant_id, name, workspace_slug, api_key_encrypted, plane_user_id, plane_user_name) VALUES ('p1', 't1', 'main', 'acme', 'enc', 'u-1', 'Pachi Bot')");
      await run("INSERT INTO bot_plane_accounts (id, tenant_id, bot_id, plane_account_id) VALUES ('l1', 't1', 'b1', 'p1')");
      await run(`INSERT INTO plane_scopes (id, tenant_id, bot_id, guild_id, channel_id, plane_account_id, project_ids) VALUES ('s1', 't1', 'b1', 'g1', '', 'p1', '["*"]'), ('s2', 't1', 'b1', 'g1', 'c1', 'p1', '["11111111-1111-4111-8111-111111111111"]')`);

      await migrateDatabase(connection);
      await migrateDatabase(connection);

      const { plane } = createRepositories(connection);
      expect(await plane.getAccount("p1")).toMatchObject({ planeVersion: "1.3.1", workspaces: [{ slug: "acme", enabled: true }] });
      expect((await plane.listScopes("b1", "g1")).map((r) => [r.id, r.channelId, r.workspaceSlug])).toEqual([["s1", "", "acme"], ["s2", "c1", "acme"]]);
      const columns = (await run("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'plane_accounts'")).map((c: any) => c.name);
      expect(columns).not.toContain("workspace_slug");

      await plane.updateAccount("p1", { workspaces: [{ slug: "acme", enabled: true }, { slug: "beta", enabled: true }] });
      await plane.replaceScopes("t1", "b1", "g1", "", [{ planeAccountId: "p1", workspaceSlug: "acme", projectIds: ["*"] }, { planeAccountId: "p1", workspaceSlug: "beta", projectIds: ["*"] }]);
      expect((await plane.listScopes("b1", "g1")).filter((r) => r.channelId === "").map((r) => r.workspaceSlug)).toEqual(["acme", "beta"]);
    } finally {
      await connection.close();
    }
  });
});
