import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = process.cwd();
const src = (path: string) => JSON.stringify(join(workspace, path));

// Each scenario runs in its own process because the database dialect binds at import time.
function scenario(body: string) {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-digest-"));
  try {
    const result = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        const { runMigrations } = await import(${src("packages/db/src/migrate.ts")}); const { runSeed } = await import(${src("packages/db/src/seed.ts")});
        const { db, schedules, eq, and } = await import(${src("packages/db/src/index.ts")}); const { createTenant, createBot } = await import(${src("packages/db/src/tenancy.ts")});
        const { setClock } = await import(${src("packages/skills/src/clock.ts")});
        setClock(() => Date.parse("2026-03-06T20:00:00+07:00"));
        await runMigrations(); await runSeed();
        const tenant = await createTenant({ name: "Acme", slug: "acme" });
        const bot = await createBot({ tenantId: tenant.id, token: "t", isEnabled: false });
        const { createServer } = await import(${src("apps/agent/src/server.ts")}); const app = createServer();
        const admin = { "X-Platform-Key": "digest-admin-key", "Content-Type": "application/json" };
        const call = async (method, path, body) => app.request(path, { method, headers: admin, body: body === undefined ? undefined : JSON.stringify(body) });
        const status = async (method, path, body) => (await call(method, path, body)).status;
        const read = async (method, path, body) => (await call(method, path, body)).json();
        const path = "/api/admin/bots/" + bot.id + "/guilds/guild-1/config";
        const digests = async () => (await db.select().from(schedules).where(and(eq(schedules.botId, bot.id), eq(schedules.kind, "digest")))).sort((a, b) => a.channelId.localeCompare(b.channelId));
        ${body}
        console.log(JSON.stringify({ ok: true }));
      `],
      cwd: workspace,
      env: { ...process.env, DATABASE_URL: `sqlite:${join(directory, "digest.db")}`, WORKSPACE_DIR: join(directory, "workspace"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 43).toString("base64"), PLATFORM_ADMIN_KEY: "digest-admin-key", NODE_ENV: "test" },
    });
    return { code: result.exitCode, stderr: new TextDecoder().decode(result.stderr).trim() };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe("Digest channels on the server settings", () => {
  test("a guild starts with no Digest channels; the config endpoint stores channel plus hour and rejects anything else", () => {
    const { code, stderr } = scenario(`
      const fresh = await read("GET", path);
      assert(JSON.stringify(fresh.config.digestChannels) === "[]", "default wrong: " + JSON.stringify(fresh.config));
      const set = await read("PUT", path, { digestChannels: [{ channelId: "c1", hour: 8 }, { channelId: "c2", hour: 17 }] });
      assert(JSON.stringify(set.config.digestChannels) === JSON.stringify([{ channelId: "c1", hour: 8 }, { channelId: "c2", hour: 17 }]), "not stored: " + JSON.stringify(set.config));
      for (const bad of [[{ channelId: "c1", hour: 24 }], [{ channelId: "c1", hour: -1 }], [{ channelId: "c1", hour: 8.5 }], [{ channelId: "c1", hour: "8" }], [{ channelId: "c1" }], [{ hour: 8 }], [{ channelId: "", hour: 8 }], [{ channelId: "c1", hour: 8 }, { channelId: "c1", hour: 9 }], "c1", { channelId: "c1", hour: 8 }]) {
        assert(await status("PUT", path, { digestChannels: bad }) === 400, "accepted " + JSON.stringify(bad));
      }
      const kept = await read("GET", path);
      assert(kept.config.digestChannels.length === 2, "rejected writes changed the row: " + JSON.stringify(kept.config));
      const untouched = await read("PUT", path, { useThreads: false });
      assert(untouched.config.digestChannels.length === 2 && untouched.config.useThreads === false, "a save without digestChannels dropped them: " + JSON.stringify(untouched.config));
    `);
    expect(code, stderr).toBe(0);
  });

  test("saving upserts one daily digest schedule row per entry in the guild's zone and cancels the rows of removed entries", () => {
    const { code, stderr } = scenario(`
      await read("PUT", path, { digestChannels: [{ channelId: "c1", hour: 8 }, { channelId: "c2", hour: 17 }] });
      let rows = await digests();
      assert(rows.length === 2, "one row per entry: " + JSON.stringify(rows));
      const [c1, c2] = rows;
      assert(c1.kind === "digest" && c1.guildId === "guild-1" && c1.channelId === "c1" && c1.recurrence === "daily" && c1.timeOfDay === "08:00" && c1.timezone === "Asia/Jakarta" && c1.status === "active" && c1.ownerId === null && c1.withTasks === false && c1.mentions.length === 0, "row fields: " + JSON.stringify(c1));
      assert(c1.nextAt.toISOString() === "2026-03-07T01:00:00.000Z", "next 08:00 Jakarta after Friday 20:00: " + c1.nextAt.toISOString());
      assert(c2.timeOfDay === "17:00" && c2.nextAt.toISOString() === "2026-03-07T10:00:00.000Z", "second row: " + JSON.stringify(c2));

      await read("PUT", path, { systemPrompt: "Be brief." });
      rows = await digests();
      assert(rows.length === 2 && rows.every((r) => r.status === "active") && rows[0].id === c1.id, "a save without digestChannels must leave the rows alone: " + JSON.stringify(rows));

      await read("PUT", path, { digestChannels: [{ channelId: "c1", hour: 9 }, { channelId: "c3", hour: 7 }] });
      rows = await digests();
      const byChannel = Object.fromEntries(rows.map((r) => [r.channelId, r]));
      assert(rows.length === 3, "removed entries keep their row, cancelled: " + JSON.stringify(rows));
      assert(byChannel.c1.id === c1.id && byChannel.c1.status === "active" && byChannel.c1.timeOfDay === "09:00" && byChannel.c1.nextAt.toISOString() === "2026-03-07T02:00:00.000Z", "a changed hour updates the same row: " + JSON.stringify(byChannel.c1));
      assert(byChannel.c2.id === c2.id && byChannel.c2.status === "cancelled", "a removed entry cancels its row: " + JSON.stringify(byChannel.c2));
      assert(byChannel.c3.status === "active" && byChannel.c3.timeOfDay === "07:00", "a new entry gets a row: " + JSON.stringify(byChannel.c3));

      await read("PUT", path, { timezone: "Europe/Berlin" });
      rows = await digests();
      const berlin = rows.filter((r) => r.status === "active");
      assert(berlin.length === 2 && berlin.every((r) => r.timezone === "Europe/Berlin"), "a zone change moves the active rows to the new zone: " + JSON.stringify(rows));
      assert(berlin.find((r) => r.channelId === "c1").nextAt.toISOString() === "2026-03-07T08:00:00.000Z", "09:00 Berlin: " + JSON.stringify(berlin));

      await read("PUT", path, { digestChannels: [] });
      rows = await digests();
      assert(rows.length === 3 && rows.every((r) => r.status === "cancelled"), "an empty list cancels every row: " + JSON.stringify(rows));
      await read("PUT", path, { digestChannels: [{ channelId: "c1", hour: 8 }] });
      rows = await digests();
      assert(rows.filter((r) => r.status === "active").length === 1 && rows.length === 4, "opting a channel back in makes a fresh active row: " + JSON.stringify(rows));
    `);
    expect(code, stderr).toBe(0);
  });
});
