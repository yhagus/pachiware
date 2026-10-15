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
  test("global keys: issue, ownership lookup, revoke, list counts, soft-delete", () => {
    const { directory, result } = runIsolated(`
      import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
      import { queryClient, repositories } from ${JSON.stringify(join(source, "index.ts"))};
      await runMigrations();
      const tenants = repositories().tenants;
      const issued = await tenants.issueApiKey("deploy"), other = await tenants.issueApiKey("other");
      const owned = await tenants.create({ name: "Acme", slug: "acme", apiKeyId: issued.keyId });
      const loose = await tenants.create({ name: "Loose", slug: "loose" });
      const found = await tenants.resolveApiKey(issued.raw);
      const bySlug = (await tenants.getForApiKey(issued.keyId, "acme"))?.id === owned.id;
      const byId = (await tenants.getForApiKey(issued.keyId, owned.id))?.id === owned.id;
      const foreign = await tenants.getForApiKey(other.keyId, "acme");
      const unowned = await tenants.getForApiKey(issued.keyId, "loose");
      const listedOwned = (await tenants.listForApiKey(issued.keyId)).map((t) => t.slug);
      const listed = await tenants.listApiKeys();
      await tenants.remove(owned.id);
      const afterDelete = await tenants.getForApiKey(issued.keyId, "acme");
      await tenants.revokeApiKey(issued.keyId);
      const revoked = await tenants.resolveApiKey(issued.raw);
      const stored = queryClient.query("SELECT key_hash FROM api_keys WHERE id = ?").get(issued.keyId);
      console.log(JSON.stringify({ found: found?.name, scopes: found?.scopes, bySlug, byId, foreign, unowned, listedOwned, counts: Object.fromEntries(listed.map((k) => [k.name, k.tenantCount])), looseOwner: loose.apiKeyId, afterDelete, revoked, hash: stored.key_hash }));
    `);
    try {
      expect(result.exitCode, errorOutput(result)).toBe(0);
      const value = JSON.parse(output(result).split("\n").at(-1)!);
      expect(value).toMatchObject({ found: "deploy", scopes: ["*"], bySlug: true, byId: true, foreign: null, unowned: null, listedOwned: ["acme"], counts: { deploy: 1, other: 0 }, looseOwner: null, afterDelete: null, revoked: null });
      expect(value.hash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("creates tenant defaults without creating sample tasks", () => {
    const { directory, result } = runIsolated(`
      import { runMigrations } from ${JSON.stringify(join(source, "migrate.ts"))};
      import { queryClient, repositories } from ${JSON.stringify(join(source, "index.ts"))};
      await runMigrations();
      await repositories().skills.register({ id: "enabled", name: "Enabled", description: "enabled skill", defaultEnabled: true, toolDefinitions: [], handlerType: "builtin", config: { level: 1 } });
      await repositories().skills.register({ id: "disabled", name: "Disabled", description: "disabled skill", defaultEnabled: false, toolDefinitions: [], handlerType: "builtin", config: { level: 2 } });
      const tenant = await repositories().tenants.create({ name: "New Tenant", slug: "new-tenant" });
      const tenantSkillsRows = (await repositories().skills.listForTenant(tenant.id)).map(({ state }) => state);
      const taskRows = await repositories().taskRows.list(tenant.id);
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
      import { queryClient, repositories } from ${JSON.stringify(join(source, "index.ts"))};
      await runMigrations();
      const { bots } = repositories();
      const tenant = await repositories().tenants.create({ name: "Bots", slug: "bots" });
      const bot = await bots.create({ tenantId: tenant.id, token: "first-token", guildIds: ["guild-1"] });
      const storedBefore = queryClient.query("SELECT token_encrypted FROM bots WHERE id = ?").get(bot.id);
      const first = await bots.getWithToken(bot.id);
      await bots.update(bot.id, { token: "second-token", name: "Updated" });
      const second = await bots.getWithToken(bot.id);
      const listed = await bots.listForTenant(tenant.id);
      const active = await bots.listRunnable();
      await bots.remove(bot.id);
      const afterDelete = await bots.getWithToken(bot.id);
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
      expect(value.listed[0]).toMatchObject({ name: "Updated", isEnabled: true, hasToken: true });
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
      import { queryClient, repositories } from ${JSON.stringify(join(source, "index.ts"))};
      await runMigrations();
      const first = await repositories().tenants.create({ name: "First", slug: "first" });
      const second = await repositories().tenants.create({ name: "Second", slug: "second" });
      const bot = await repositories().bots.create({ tenantId: first.id, token: "secret" });
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
