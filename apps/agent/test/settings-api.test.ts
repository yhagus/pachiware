import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();
const src = (path: string) => JSON.stringify(join(workspace, path));

// Each scenario runs in its own process because the database dialect binds at import time.
function scenario(body: string) {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-settings-"));
  try {
    const result = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        const { runMigrations } = await import(${src("packages/db/src/migrate.ts")}); const { runSeed } = await import(${src("packages/db/src/seed.ts")});
        const { repositories } = await import(${src("packages/db/src/index.ts")});
        await runMigrations(); await runSeed();
        const tenant = await repositories().tenants.create({ name: "Acme", slug: "acme" });
        const { createServer } = await import(${src("apps/agent/src/server.ts")}); const app = createServer();
        const admin = { "X-Platform-Key": "settings-admin-key", "Content-Type": "application/json" };
        const call = async (method, path, body, headers = admin) => app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        const status = async (method, path, body, headers) => (await call(method, path, body, headers)).status;
        const read = async (method, path, body, headers) => (await call(method, path, body, headers)).json();
        ${body}
        console.log(JSON.stringify({ ok: true }));
      `],
      cwd: workspace,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(directory, "settings.db")}`, PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 41).toString("base64"), PLATFORM_ADMIN_KEY: "settings-admin-key", NODE_ENV: "test" },
    });
    return { code: result.exitCode, stderr: new TextDecoder().decode(result.stderr).trim() };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("time zone and language settings", () => {
  test("a new tenant starts on Asia/Jakarta and Indonesian; the admin settings endpoint accepts valid values and rejects invalid ones", () => {
    const { code, stderr } = scenario(`
      const path = "/api/admin/tenants/" + tenant.id + "/settings";
      const fresh = await read("GET", path);
      assert(fresh.settings.timezone === "Asia/Jakarta" && fresh.settings.language === "id", "seed wrong: " + JSON.stringify(fresh));
      const changed = await read("PUT", path, { timezone: "europe/berlin", language: "en" });
      assert(changed.settings.timezone === "Europe/Berlin" && changed.settings.language === "en", "update not applied: " + JSON.stringify(changed));
      assert(await status("PUT", path, { timezone: "Mars/Olympus" }) === 400, "unknown zone accepted");
      assert(await status("PUT", path, { timezone: "" }) === 400, "empty zone accepted");
      assert(await status("PUT", path, { language: "fr" }) === 400, "unsupported language accepted");
      assert(await status("PUT", path, { language: null }) === 400, "null language accepted on a tenant");
      const kept = await read("GET", path);
      assert(kept.settings.timezone === "Europe/Berlin" && kept.settings.language === "en", "rejected writes changed the row: " + JSON.stringify(kept));
      assert(await status("GET", "/api/admin/tenants/nope/settings") === 404, "unknown tenant not 404");
    `);
    expect(code, stderr).toBe(0);
  });

  test("a conversation starts fresh after 24 quiet hours unless the tenant sets other whole hours, 0 for never", () => {
    const { code, stderr } = scenario(`
      const path = "/api/admin/tenants/" + tenant.id + "/settings";
      assert((await read("GET", path)).settings.conversationIdleHours === 24, "default not 24");
      const changed = await read("PUT", path, { conversationIdleHours: 12 });
      assert(changed.settings.conversationIdleHours === 12 && changed.settings.timezone === "Asia/Jakarta" && changed.settings.language === "id", "update: " + JSON.stringify(changed));
      assert((await read("PUT", path, { conversationIdleHours: 0 })).settings.conversationIdleHours === 0, "0 refused");
      assert((await read("PUT", path, { conversationIdleHours: 720 })).settings.conversationIdleHours === 720, "720 refused");
      for (const bad of [-1, 721, 1.5, "12", null]) assert(await status("PUT", path, { conversationIdleHours: bad }) === 400, JSON.stringify(bad) + " accepted");
      const row = await repositories().agentConfig.get(tenant.id);
      assert(row.settings.conversationIdleHours === 720 && row.settings.maxReActIterations === 32, "settings not merged: " + JSON.stringify(row.settings));
      await read("PUT", path, { timezone: "Asia/Tokyo" });
      assert((await read("GET", path)).settings.conversationIdleHours === 720, "a time zone change reset the hours");
    `);
    expect(code, stderr).toBe(0);
  });

  test("a Changelog draft's model retry waits 60 seconds unless the tenant sets other whole seconds, 0 to pause at once and at most 600 (#358)", () => {
    const { code, stderr } = scenario(`
      const path = "/api/admin/tenants/" + tenant.id + "/settings";
      assert((await read("GET", path)).settings.modelRetryWaitSeconds === 60, "default not 60");
      const changed = await read("PUT", path, { modelRetryWaitSeconds: 30 });
      assert(changed.settings.modelRetryWaitSeconds === 30 && changed.settings.conversationIdleHours === 24 && changed.settings.timezone === "Asia/Jakarta", "update: " + JSON.stringify(changed));
      assert((await read("PUT", path, { modelRetryWaitSeconds: 0 })).settings.modelRetryWaitSeconds === 0, "0 refused");
      assert((await read("PUT", path, { modelRetryWaitSeconds: 600 })).settings.modelRetryWaitSeconds === 600, "600 refused");
      for (const bad of [-1, 601, 2.5, "60", null]) assert(await status("PUT", path, { modelRetryWaitSeconds: bad }) === 400, JSON.stringify(bad) + " accepted");
      await read("PUT", path, { conversationIdleHours: 6 });
      const row = await repositories().agentConfig.get(tenant.id);
      assert(row.settings.modelRetryWaitSeconds === 600 && row.settings.conversationIdleHours === 6 && row.settings.maxReActIterations === 32, "settings not merged: " + JSON.stringify(row.settings));
    `);
    expect(code, stderr).toBe(0);
  });

  test("an API changelog traces its endpoints with 3 workers at once unless the tenant sets 1 to 5 (#343)", () => {
    const { code, stderr } = scenario(`
      const path = "/api/admin/tenants/" + tenant.id + "/settings";
      assert((await read("GET", path)).settings.playbookWorkers === 3, "default not 3");
      const changed = await read("PUT", path, { playbookWorkers: 1 });
      assert(changed.settings.playbookWorkers === 1 && changed.settings.modelRetryWaitSeconds === 60 && changed.settings.conversationIdleHours === 24, "update: " + JSON.stringify(changed));
      assert((await read("PUT", path, { playbookWorkers: 5 })).settings.playbookWorkers === 5, "5 refused");
      for (const bad of [0, 6, 2.5, "3", null]) assert(await status("PUT", path, { playbookWorkers: bad }) === 400, JSON.stringify(bad) + " accepted");
      await read("PUT", path, { modelRetryWaitSeconds: 30 });
      const row = await repositories().agentConfig.get(tenant.id);
      assert(row.settings.playbookWorkers === 5 && row.settings.modelRetryWaitSeconds === 30 && row.settings.maxReActIterations === 32, "settings not merged: " + JSON.stringify(row.settings));
    `);
    expect(code, stderr).toBe(0);
  });

  test("the tenant API carries both settings on the config resource with the same validation", () => {
    const { code, stderr } = scenario(`
      const key = await repositories().tenants.issueApiKey("one");
      await repositories().tenants.linkApiKey(tenant.id, key.keyId);
      const headers = { Authorization: "Bearer " + key.raw, "Content-Type": "application/json", "X-Tenant-Id": tenant.id };
      const fresh = await read("GET", "/api/v1/config", undefined, headers);
      assert(fresh.config.timezone === "Asia/Jakarta" && fresh.config.language === "id", "config lacks the settings: " + JSON.stringify(fresh.config));
      const changed = await read("PUT", "/api/v1/config", { timezone: "Asia/Tokyo", language: "en" }, headers);
      assert(changed.config.timezone === "Asia/Tokyo" && changed.config.language === "en", "update not applied: " + JSON.stringify(changed.config));
      assert(await status("PUT", "/api/v1/config", { timezone: "Tokyo" }, headers) === 400, "bare city accepted");
      assert(await status("PUT", "/api/v1/config", { language: "EN" }, headers) === 400, "upper-case language accepted");
      const viewed = await read("GET", "/api/admin/tenants/" + tenant.id + "/settings");
      assert(viewed.settings.timezone === "Asia/Tokyo" && viewed.settings.language === "en", "admin and tenant views disagree: " + JSON.stringify(viewed));
    `);
    expect(code, stderr).toBe(0);
  }, 30_000);

  test("guild settings override the tenant per guild, nullable, beside useThreads and always-on channels", () => {
    const { code, stderr } = scenario(`
      const bot = await repositories().bots.create({ tenantId: tenant.id, token: "t", isEnabled: false });
      const path = "/api/admin/bots/" + bot.id + "/guilds/guild-1/config";
      const fresh = await read("GET", path);
      assert(fresh.config.timezone === null && fresh.config.language === null && fresh.config.useThreads === true, "defaults wrong: " + JSON.stringify(fresh.config));
      const set = await read("PUT", path, { timezone: "America/Sao_Paulo", language: "en", useThreads: false, alwaysChannelIds: ["c1"] });
      assert(set.config.timezone === "America/Sao_Paulo" && set.config.language === "en" && set.config.useThreads === false && set.config.alwaysChannelIds[0] === "c1", "override not stored: " + JSON.stringify(set.config));
      assert(await status("PUT", path, { timezone: "Nowhere/Town" }) === 400, "unknown zone accepted");
      assert(await status("PUT", path, { language: "de" }) === 400, "unsupported language accepted");
      const cleared = await read("PUT", path, { timezone: null, language: null });
      assert(cleared.config.timezone === null && cleared.config.language === null && cleared.config.useThreads === false, "null did not clear the override: " + JSON.stringify(cleared.config));
    `);
    expect(code, stderr).toBe(0);
  }, 30_000);
});
