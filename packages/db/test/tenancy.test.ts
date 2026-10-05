import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();
const source = join(workspace, "packages/db/src");
const encryptionKey = Buffer.alloc(32, 42).toString("base64");

function runIsolated(script: string) {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-tenancy-"));
  const database = join(directory, "tenant.db");
  try {
    const result = Bun.spawnSync({
      cmd: ["bun", "--eval", script],
      cwd: workspace,
      env: {
        ...process.env,
        DATABASE_URL: `sqlite:${database}`,
        PLATFORM_ENCRYPTION_KEY: encryptionKey,
        NODE_ENV: "test",
      },
    });
    return { directory, database, result };
  } finally {
    // The caller consumes subprocess output synchronously before cleanup.
  }
}

function output(result: ReturnType<typeof Bun.spawnSync>): string {
  return new TextDecoder().decode(result.stdout).trim();
}

function errorOutput(result: ReturnType<typeof Bun.spawnSync>): string {
  return new TextDecoder().decode(result.stderr).trim();
}

describe("tenant persistence helpers", () => {
  test("issue, lookup, revoke, suspend, and soft-delete API keys", () => {
    const { directory, result } = runIsolated(`
      import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
      import { createTenant, issueApiKey, getTenantByApiKey, revokeApiKey, updateTenant, deleteTenant, listApiKeysForTenant } from ${JSON.stringify(join(source, "tenancy.ts"))};
      import { queryClient } from ${JSON.stringify(join(source, "index.ts"))};
      await runMigrations();
      const tenant = await createTenant({ name: "Acme", slug: "acme" });
      const issued = await issueApiKey(tenant.id, "deploy", ["tasks:read"]);
      const active = await getTenantByApiKey(issued.raw);
      const listed = await listApiKeysForTenant(tenant.id);
      await revokeApiKey(issued.keyId);
      const revoked = await getTenantByApiKey(issued.raw);
      const second = await issueApiKey(tenant.id);
      await updateTenant(tenant.id, { status: "suspended" });
      const suspended = await getTenantByApiKey(second.raw);
      const suspendedIncluded = await getTenantByApiKey(second.raw, true);
      await deleteTenant(tenant.id);
      const deleted = await getTenantByApiKey(second.raw, true);
      const stored = queryClient.query("SELECT key_hash FROM api_keys WHERE id = ?").get(issued.keyId);
      console.log(JSON.stringify({ active: active?.tenant.slug, listed, revoked, suspended, suspendedIncluded: suspendedIncluded?.tenant.status, deleted, hash: stored.key_hash }));
    `);
    try {
      expect(result.exitCode, errorOutput(result)).toBe(0);
      const value = JSON.parse(output(result).split("\n").at(-1)!);
      expect(value.active).toBe("acme");
      expect(value.listed).toEqual([{ id: expect.any(String), tenantId: expect.any(String), name: "deploy", keyPrefix: expect.any(String), scopes: ["tasks:read"], lastUsedAt: null, revokedAt: null, createdAt: expect.any(String) }]);
      expect(value.revoked).toBeNull();
      expect(value.suspended).toBeNull();
      expect(value.suspendedIncluded).toBe("suspended");
      expect(value.deleted).toBeNull();
      expect(value.hash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("creates tenant defaults without creating sample tasks", () => {
    const { directory, result } = runIsolated(`
      import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
      import { createTenant } from ${JSON.stringify(join(source, "tenancy.ts"))};
      import { queryClient } from ${JSON.stringify(join(source, "index.ts"))};
      await runMigrations();
      queryClient.query("INSERT INTO skills (id, name, description, default_enabled, config) VALUES (?, ?, ?, ?, ?)").run("enabled", "Enabled", "enabled skill", 1, JSON.stringify({ level: 1 }));
      queryClient.query("INSERT INTO skills (id, name, description, default_enabled, config) VALUES (?, ?, ?, ?, ?)").run("disabled", "Disabled", "disabled skill", 0, JSON.stringify({ level: 2 }));
      const tenant = await createTenant({ name: "New Tenant", slug: "new-tenant" });
      const tenantSkillsRows = queryClient.query("SELECT skill_id AS skillId, is_enabled AS isEnabled, config FROM tenant_skills WHERE tenant_id = ?").all(tenant.id).map((row) => ({ ...row, isEnabled: Boolean(row.isEnabled), config: JSON.parse(row.config) }));
      const taskRows = queryClient.query("SELECT id FROM tasks WHERE tenant_id = ?").all(tenant.id);
      console.log(JSON.stringify({ tenantSkillsRows, taskCount: taskRows.length }));
    `);
    try {
      expect(result.exitCode, errorOutput(result)).toBe(0);
      const value = JSON.parse(output(result).split("\n").at(-1)!);
      expect(value.taskCount).toBe(0);
      expect(value.tenantSkillsRows.map((row: any) => ({ skillId: row.skillId, isEnabled: row.isEnabled, config: row.config })).sort((a: any, b: any) => a.skillId.localeCompare(b.skillId))).toEqual([
        { skillId: "disabled", isEnabled: false, config: { level: 2 } },
        { skillId: "enabled", isEnabled: true, config: { level: 1 } },
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("encrypts bot tokens at rest and supports bot lifecycle helpers", () => {
    const { directory, result } = runIsolated(`
      import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
      import { createTenant, createBot, getBotDecrypted, updateBot, listBotsForTenant, listAllActiveBots, deleteBot } from ${JSON.stringify(join(source, "tenancy.ts"))};
      import { queryClient } from ${JSON.stringify(join(source, "index.ts"))};
      await runMigrations();
      const tenant = await createTenant({ name: "Bots", slug: "bots" });
      const bot = await createBot({ tenantId: tenant.id, token: "first-token", guildIds: ["guild-1"] });
      const storedBefore = queryClient.query("SELECT token_encrypted FROM bots WHERE id = ?").get(bot.id);
      const first = await getBotDecrypted(bot.id);
      await updateBot(bot.id, { token: "second-token", name: "Updated" });
      const second = await getBotDecrypted(bot.id);
      const listed = await listBotsForTenant(tenant.id);
      const active = await listAllActiveBots();
      await deleteBot(bot.id);
      const afterDelete = await getBotDecrypted(bot.id);
      const deleted = queryClient.query("SELECT name, is_enabled, connection_status, token_encrypted FROM bots WHERE id = ?").get(bot.id);
      console.log(JSON.stringify({ storedBefore, firstToken: first?.token, secondToken: second?.token, listed, active, afterDelete, deleted }));
    `);
    try {
      expect(result.exitCode, errorOutput(result)).toBe(0);
      const value = JSON.parse(output(result).split("\n").at(-1)!);
      expect(value.storedBefore.token_encrypted).toStartWith("v1:");
      expect(value.storedBefore.token_encrypted).not.toContain("first-token");
      expect(value.firstToken).toBe("first-token");
      expect(value.secondToken).toBe("second-token");
      expect(value.listed).toHaveLength(1);
      expect(value.listed[0]).toMatchObject({ name: "Updated", isEnabled: true, tokenEncrypted: expect.stringMatching(/^v1:/) });
      expect(value.active).toMatchObject([{ bot: { id: value.listed[0].id }, token: "second-token" }]);
      expect(value.afterDelete).toBeNull();
      expect(value.deleted).toEqual({ name: "Updated", is_enabled: 0, connection_status: "deleted", token_encrypted: "" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects cross-tenant bot and conversation links at the database boundary", () => {
    const { directory, result } = runIsolated(`
      import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
      import { createTenant, createBot } from ${JSON.stringify(join(source, "tenancy.ts"))};
      import { queryClient } from ${JSON.stringify(join(source, "index.ts"))};
      await runMigrations();
      const first = await createTenant({ name: "First", slug: "first" });
      const second = await createTenant({ name: "Second", slug: "second" });
      const bot = await createBot({ tenantId: first.id, token: "secret" });
      queryClient.query("INSERT INTO conversations (id, tenant_id, bot_id, platform) VALUES (?, ?, ?, ?)").run("conversation-1", first.id, bot.id, "discord");
      let botRejected = false;
      let messageRejected = false;
      try { queryClient.query("INSERT INTO conversations (id, tenant_id, bot_id, platform) VALUES (?, ?, ?, ?)").run("bad-bot", second.id, bot.id, "discord"); } catch { botRejected = true; }
      try { queryClient.query("INSERT INTO messages (id, tenant_id, conversation_id, role) VALUES (?, ?, ?, ?)").run("bad-message", second.id, "conversation-1", "user"); } catch { messageRejected = true; }
      console.log(JSON.stringify({ botRejected, messageRejected }));
    `);
    try {
      expect(result.exitCode, errorOutput(result)).toBe(0);
      expect(JSON.parse(output(result).split("\n").at(-1)!)).toEqual({ botRejected: true, messageRejected: true });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
