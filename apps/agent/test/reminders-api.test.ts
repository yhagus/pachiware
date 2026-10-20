import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();

function run(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-reminders-"));
  const script = `
    const assert = (c, m) => { if (!c) throw new Error(m); };
    const imp = (p) => import(${JSON.stringify(root + "/")} + p);
    const { runMigrations } = await imp("packages/db/src/migrate.ts"); const { runSeed } = await imp("packages/db/src/seed.ts");
    await runMigrations(); await runSeed();
    const { createServer } = await imp("apps/agent/src/server.ts"); const { repositories } = await imp("packages/db/src/index.ts");
    const app = createServer();
    const call = async (method, path, headers, body) => { const r = await app.request(path, { method, headers, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
    const t = await repositories().tenants.create({ name: "A", slug: "a" }), bot = await repositories().bots.create({ tenantId: t.id, token: "x" });
    // Rows as the reminders skill writes them; the console never creates one.
    const insert = async (row) => (await repositories().schedules.create({ tenantId: t.id, botId: bot.id, kind: "reminder", guildId: "g1", channelId: "c1", ownerId: "u-alice", ownerName: "Alice", text: "send the invoice", mentions: [], recurrence: "once", timeOfDay: "15:00", timezone: "Asia/Jakarta", nextAt: new Date("2026-03-06T08:00:00Z"), ...row })).id;
    ${body}
    console.log(JSON.stringify({ ok: true }));`;
  const result = Bun.spawnSync({ cmd: ["bun", "--eval", script], cwd: root, env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "t.db")}`, WORKSPACE_DIR: join(dir, "ws"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" } });
  try { expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("the admin API lists a bot's active Reminders soonest first and cancels one", () => run(`
  const h = { "X-Platform-Key": "k", "Content-Type": "application/json" };
  const url = "/api/admin/bots/" + bot.id + "/reminders";
  const later = await insert({ text: "weekly sync", recurrence: "weekly", weekdays: [1, 4], timeOfDay: "09:00", nextAt: new Date("2026-03-09T02:00:00Z"), mentions: ["u-bob"], until: new Date("2026-12-31T16:59:59Z") });
  const soon = await insert({});
  const routine = await insert({ kind: "routine", text: "summarize my tasks", recurrence: "daily", timeOfDay: "09:00", nextAt: new Date("2026-03-07T02:00:00Z"), error: null });
  await insert({ status: "done", text: "already posted" });
  await insert({ status: "cancelled", text: "already cancelled" });
  await insert({ kind: "digest", ownerId: null, ownerName: null, text: "", recurrence: "daily", timeOfDay: "08:00" });
  const other = await repositories().bots.create({ tenantId: t.id, token: "y" });
  await insert({ botId: other.id, text: "another bot's" });

  const listed = await call("GET", url, h);
  assert(listed.status === 200, "list " + listed.status + " " + JSON.stringify(listed.body));
  assert(JSON.stringify(listed.body.reminders.map((r) => r.id)) === JSON.stringify([soon, routine, later]), "active Reminders and Routines of this bot, soonest first: " + JSON.stringify(listed.body.reminders));
  assert(JSON.stringify(listed.body.reminders.map((r) => r.kind)) === JSON.stringify(["reminder", "routine", "reminder"]), "each with its kind");
  const [first, , second] = listed.body.reminders;
  assert(first.ownerId === "u-alice" && first.ownerName === "Alice" && first.guildId === "g1" && first.channelId === "c1" && first.text === "send the invoice" && first.recurrence === "once" && first.timeOfDay === "15:00" && first.timezone === "Asia/Jakarta" && first.nextAt === "2026-03-06T08:00:00.000Z" && first.until === null, "row fields: " + JSON.stringify(first));
  assert(JSON.stringify(second.weekdays) === "[1,4]" && JSON.stringify(second.mentions) === '["u-bob"]' && second.until === "2026-12-31T16:59:59.000Z" && second.withTasks === false, "repeat fields: " + JSON.stringify(second));
  assert(!("status" in first) || first.status === "active", "only active rows are Reminders here");

  const cancelled = await call("DELETE", url + "/" + soon, h);
  assert(cancelled.status === 200 && cancelled.body.success === true, "cancel " + cancelled.status + " " + JSON.stringify(cancelled.body));
  const row = await repositories().schedules.get(soon);
  assert(row.status === "cancelled", "cancel must mark the row cancelled, not delete it: " + JSON.stringify(row));
  assert(JSON.stringify((await call("GET", url, h)).body.reminders.map((r) => r.id)) === JSON.stringify([routine, later]), "a cancelled Reminder is still listed");
  assert((await call("DELETE", url + "/" + routine, h)).status === 200 && (await repositories().schedules.get(routine)).status === "cancelled", "a Routine is cancelled the same way");
  assert((await call("DELETE", url + "/" + soon, h)).status === 404, "cancelling twice");
  assert((await call("DELETE", url + "/nope", h)).status === 404, "unknown Reminder");
  const foreign = (await repositories().schedules.list({ botId: other.id }))[0];
  assert((await call("DELETE", url + "/" + foreign.id, h)).status === 404, "another bot's Reminder cancelled through this bot");
  assert((await call("GET", "/api/admin/bots/nope/reminders", h)).status === 404, "unknown bot");
  assert((await call("GET", url, { "Content-Type": "application/json" })).status === 401, "admin key required");
  assert((await call("POST", url, h, { text: "from the console", at: "2026-03-07T15:00" })).status === 404, "there is no creation endpoint");
`));

test("the tenant API lists and cancels Reminders of an owned bot only", () => run(`
  const key = await repositories().tenants.issueApiKey("one"); await repositories().tenants.linkApiKey(t.id, key.keyId);
  const h = { Authorization: "Bearer " + key.raw, "Content-Type": "application/json", "X-Tenant-Id": t.id };
  const url = "/api/v1/bots/" + bot.id + "/reminders";
  const id = await insert({});
  const listed = await call("GET", url, h);
  assert(listed.status === 200 && listed.body.reminders.length === 1 && listed.body.reminders[0].id === id && listed.body.reminders[0].text === "send the invoice", "list " + listed.status + " " + JSON.stringify(listed.body));
  const cancelled = await call("DELETE", url + "/" + id, h);
  assert(cancelled.status === 200 && cancelled.body.success === true, "cancel " + cancelled.status + " " + JSON.stringify(cancelled.body));
  assert((await repositories().schedules.get(id)).status === "cancelled", "row not cancelled");
  assert((await call("GET", url, h)).body.reminders.length === 0, "cancelled Reminder still listed");

  const otherTenant = await repositories().tenants.create({ name: "B", slug: "b" }), theirs = await repositories().bots.create({ tenantId: otherTenant.id, token: "z" });
  const theirRow = await insert({ tenantId: otherTenant.id, botId: theirs.id });
  assert((await call("GET", "/api/v1/bots/" + theirs.id + "/reminders", h)).status === 404, "another tenant's bot listed");
  assert((await call("DELETE", "/api/v1/bots/" + theirs.id + "/reminders/" + theirRow, h)).status === 404, "another tenant's Reminder cancelled");
  assert((await repositories().schedules.get(theirRow)).status === "active", "another tenant's row changed");
  assert((await call("GET", url, { "Content-Type": "application/json", "X-Tenant-Id": t.id })).status === 401, "tenant key required");
`));
