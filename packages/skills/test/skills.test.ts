import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();

function runScenario(script: string) {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-skills-"));
  const result = Bun.spawnSync({
    cmd: ["bun", "--eval", script], cwd: workspace,
    env: { ...process.env, DATABASE_URL: `sqlite:${join(directory, "skills.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 23).toString("base64"), NODE_ENV: "test" },
  });
  return { directory, result };
}

describe("tenant-aware skill registry", () => {
  test("exposes only enabled tenant tools and denies cross-tenant task mutations", () => {
    const { directory, result } = runScenario(`
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const { runMigrations } = await import(${JSON.stringify(join(workspace, "packages/db/src/migrate.ts"))});
      const { runSeed } = await import(${JSON.stringify(join(workspace, "packages/db/src/seed.ts"))});
      const { db, tenantSkills, eq } = await import(${JSON.stringify(join(workspace, "packages/db/src/index.ts"))});
      const { createTenant } = await import(${JSON.stringify(join(workspace, "packages/db/src/tenancy.ts"))});
      const { skillRegistry } = await import(${JSON.stringify(join(workspace, "packages/skills/src/registry.ts"))});
      await runMigrations(); await runSeed();
      const alpha = await createTenant({ name: "Alpha", slug: "alpha" }); const beta = await createTenant({ name: "Beta", slug: "beta" });
      const context = { db, tenantId: alpha.id };
      const created = await skillRegistry.executeTool({ id: "create", name: "createTask", arguments: { title: "Alpha only" } }, context);
      assert(created.success, "createTask failed"); const taskId = created.data.task.id;
      const cross = await skillRegistry.executeTool({ id: "cross", name: "updateTaskStatus", arguments: { taskId, status: "completed" } }, { db, tenantId: beta.id, confirmed: true });
      assert(!cross.success && cross.error.includes("not found"), "cross-tenant mutation accepted");
      await db.update(tenantSkills).set({ isEnabled: false }).where(eq(tenantSkills.tenantId, alpha.id));
      const active = await skillRegistry.getActiveTools(alpha.id);
      const disabled = await skillRegistry.executeTool({ id: "disabled", name: "createTask", arguments: { title: "nope" } }, context);
      assert(active.length === 0 && !disabled.success && disabled.error.includes("disabled"), "disabled tenant tool available");
      const missingTenant = await skillRegistry.executeTool({ id: "missing", name: "createTask", arguments: { title: "x" } }, { db });
      assert(!missingTenant.success && missingTenant.error.includes("Tenant context required"), "missing tenant accepted");
      console.log(JSON.stringify({ ok: true, taskId }));
    `);
    try {
      expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
      expect(JSON.parse(new TextDecoder().decode(result.stdout).trim().split("\n").at(-1)!)).toMatchObject({ ok: true });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test("uses an injected Discord adapter and never needs a live gateway", () => {
    const { directory, result } = runScenario(`
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const { runMigrations } = await import(${JSON.stringify(join(workspace, "packages/db/src/migrate.ts"))}); const { runSeed } = await import(${JSON.stringify(join(workspace, "packages/db/src/seed.ts"))});
      const { db } = await import(${JSON.stringify(join(workspace, "packages/db/src/index.ts"))}); const { createTenant } = await import(${JSON.stringify(join(workspace, "packages/db/src/tenancy.ts"))}); const { skillRegistry } = await import(${JSON.stringify(join(workspace, "packages/skills/src/registry.ts"))});
      await runMigrations(); await runSeed(); const tenant = await createTenant({ name: "Discord", slug: "discord" });
      const adapter = { createChannel: async (args) => ({ id: "channel-1", name: args.channelName }), archiveChannel: async () => ({ id: "channel-1", message: "archived" }), listChannels: async () => [], setChannelTopic: async () => ({ id: "channel-1", topic: "topic" }) };
      const result = await skillRegistry.executeTool({ id: "discord", name: "createChannel", arguments: { channelName: "ops" } }, { db, tenantId: tenant.id, discord: adapter, confirmed: true, userId: "u", guildId: "g", channelId: "c", auth: { tenantId: tenant.id, userId: "u", guildId: "g", channelId: "c", roleIds: [], permissions: ["Administrator"] } });
      assert(result.success && result.data.channel.id === "channel-1" && !result.data.simulated, "adapter result was not used"); console.log(JSON.stringify({ ok: true }));
    `);
    try {
      expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
      expect(JSON.parse(new TextDecoder().decode(result.stdout).trim().split("\n").at(-1)!)).toEqual({ ok: true });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
