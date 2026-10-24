import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();

function run(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-previews-"));
  const script = `
    const assert = (c, m) => { if (!c) throw new Error(m); };
    const imp = (p) => import(${JSON.stringify(root + "/")} + p);
    const { runMigrations } = await imp("packages/db/src/migrate.ts"); const { runSeed } = await imp("packages/db/src/seed.ts");
    await runMigrations(); await runSeed();
    const { createServer } = await imp("apps/agent/src/server.ts"); const { repositories } = await imp("packages/db/src/index.ts");
    const app = createServer();
    const call = async (method, path, headers, body) => { const r = await app.request(path, { method, headers, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
    const t = await repositories().tenants.create({ name: "A", slug: "a" }), other = await repositories().tenants.create({ name: "B", slug: "b" });
    const helper = await repositories().bots.create({ tenantId: t.id, token: "x", name: "Helper" }), second = await repositories().bots.create({ tenantId: t.id, token: "y", name: "Second" });
    const theirs = await repositories().bots.create({ tenantId: other.id, token: "z", name: "Theirs" });
    // Rows as publishOpenApi writes them; the console never creates one.
    const publish = (bot, tenant, title, extra = {}) => repositories().apiPreviews.create({ tenantId: tenant.id, botId: bot.id, guildId: "g1", channelId: "c1", sourcePath: "channel/files/" + title + ".json", title, version: "1", document: "{}", createdById: "u-alice", createdByName: "Alice", ...extra });
    ${body}
    console.log(JSON.stringify({ ok: true }));`;
  const result = Bun.spawnSync({ cmd: ["bun", "--eval", script], cwd: root, env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "t.db")}`, WORKSPACE_DIR: join(dir, "ws"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), PLATFORM_ADMIN_KEY: "k", PUBLIC_URL: "https://pachi.example.com", NODE_ENV: "test" } });
  try { expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("the admin API lists a tenant's API previews newest first, by bot, with their links, and revokes one", () => run(`
  const h = { "X-Platform-Key": "k", "Content-Type": "application/json" };
  const base = "/api/admin/tenants/" + t.id + "/api-previews";
  const first = await publish(helper, t, "users"); await Bun.sleep(5);
  const dm = await publish(second, t, "billing", { guildId: null, channelId: "dm-1", createdByName: null, createdById: "u-bob" }); await Bun.sleep(5);
  const last = await publish(helper, t, "orders");
  await publish(theirs, other, "theirs");

  assert((await call("GET", base, {})).status === 401, "admin key required");
  assert((await call("GET", "/api/admin/tenants/nope/api-previews", h)).status === 404, "unknown tenant");
  const listed = await call("GET", base, h);
  assert(listed.status === 200, "list " + listed.status + " " + JSON.stringify(listed.body));
  assert(JSON.stringify(listed.body.previews.map((p) => p.title)) === JSON.stringify(["orders", "billing", "users"]), "newest first, only this tenant's: " + JSON.stringify(listed.body.previews));
  const [top] = listed.body.previews;
  const expected = { id: last.id, url: "https://pachi.example.com/open-api/" + last.id, botId: helper.id, botName: "Helper", guildId: "g1", channelId: "c1", sourcePath: "channel/files/orders.json", title: "orders", version: "1", createdById: "u-alice", createdByName: "Alice", createdAt: last.createdAt.toISOString() };
  assert(JSON.stringify(top) === JSON.stringify(expected), "row: " + JSON.stringify(top));
  assert(listed.body.previews[1].guildId === null && listed.body.previews[1].botName === "Second", "a DM's preview: " + JSON.stringify(listed.body.previews[1]));
  const byBot = await call("GET", base + "?botId=" + helper.id, h);
  assert(JSON.stringify(byBot.body.previews.map((p) => p.id)) === JSON.stringify([last.id, first.id]), "one bot's: " + JSON.stringify(byBot.body));

  const revoked = await call("DELETE", base + "/" + first.id, h);
  assert(revoked.status === 200 && revoked.body.success === true, "revoke " + revoked.status);
  assert((await app.request("/open-api/" + first.id)).status === 404, "a revoked link is gone");
  assert((await call("DELETE", base + "/" + first.id, h)).status === 404, "revoked twice");
  const theirsListed = await repositories().apiPreviews.list(other.id);
  assert((await call("DELETE", "/api/admin/tenants/" + t.id + "/api-previews/" + theirsListed[0].id, h)).status === 404, "another tenant's preview");
  assert((await repositories().apiPreviews.get(theirsListed[0].id)) !== null, "another tenant's preview kept");
`), 30_000);

test("a tenant's API key lists and revokes that tenant's previews and no other's", () => run(`
  const key = await repositories().tenants.issueApiKey("k1");
  await repositories().tenants.linkApiKey(t.id, key.keyId);
  const h = { Authorization: "Bearer " + key.raw, "Content-Type": "application/json", "X-Tenant-Id": t.id };
  const mine = await publish(helper, t, "users"), foreign = await publish(theirs, other, "theirs");
  const listed = await call("GET", "/api/v1/api-previews", h);
  assert(listed.status === 200 && JSON.stringify(listed.body.previews.map((p) => p.id)) === JSON.stringify([mine.id]), "own only: " + JSON.stringify(listed.body));
  assert((await call("DELETE", "/api/v1/api-previews/" + foreign.id, h)).status === 404, "another tenant's");
  assert((await call("DELETE", "/api/v1/api-previews/" + mine.id, h)).status === 200, "own revoked");
`), 30_000);
