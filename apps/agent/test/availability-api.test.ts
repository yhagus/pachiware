import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();

function run(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-availability-"));
  const script = `
    const assert = (c, m) => { if (!c) throw new Error(m); };
    const imp = (p) => import(${JSON.stringify(root + "/")} + p);
    const { runMigrations } = await imp("packages/db/src/migrate.ts"); const { runSeed } = await imp("packages/db/src/seed.ts");
    await runMigrations(); await runSeed();
    const { createServer } = await imp("apps/agent/src/server.ts"); const db = await imp("packages/db/src/tenancy.ts");
    const app = createServer();
    const call = async (method, path, headers, body) => { const r = await app.request(path, { method, headers, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
    ${body}
    console.log(JSON.stringify({ ok: true }));`;
  const result = Bun.spawnSync({ cmd: ["bun", "--eval", script], cwd: root, env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "t.db")}`, WORKSPACE_DIR: join(dir, "ws"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" } });
  try { expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("admin API sets and clears availability rules at every level", () => run(`
  const t = await db.createTenant({ name: "A", slug: "a" }), bot = await db.createBot({ tenantId: t.id, token: "x" });
  const h = { "X-Platform-Key": "k", "Content-Type": "application/json" };
  const levels = ["/api/admin/tenants/" + t.id, "/api/admin/bots/" + bot.id, "/api/admin/bots/" + bot.id + "/guilds/g1", "/api/admin/bots/" + bot.id + "/guilds/g1/channels/c1"];
  for (const base of levels) {
    const url = base + "/availability";
    const set = await call("PUT", url, h, { kind: "tool", name: "createTask", value: "off" });
    assert(set.status === 200, url + " set " + set.status + " " + JSON.stringify(set.body));
    const got = await call("GET", url, h);
    assert(JSON.stringify(got.body.rules) === JSON.stringify([{ kind: "tool", name: "createTask", value: "off" }]), url + " list " + JSON.stringify(got.body));
    const cleared = await call("DELETE", url + "?kind=tool&name=createTask", h);
    assert(cleared.status === 200 && cleared.body.rules.length === 0, url + " clear " + JSON.stringify(cleared.body));
  }
  // Each level keeps its own rules.
  await call("PUT", levels[3] + "/availability", h, { kind: "skill", name: "workspace", value: "off" });
  assert((await call("GET", levels[2] + "/availability", h)).body.rules.length === 0, "a channel rule showed at the guild");
  assert((await call("GET", "/api/admin/bots/" + bot.id + "/guilds/g1/channels/c2/availability", h)).body.rules.length === 0, "a channel rule showed in another channel");
  assert((await call("GET", levels[0] + "/availability", { "Content-Type": "application/json" })).status === 401, "admin key required");
`));

test("availability rules refuse playbook tools, unknown targets and bad values with 400", () => run(`
  const t = await db.createTenant({ name: "A", slug: "a" }), bot = await db.createBot({ tenantId: t.id, token: "x" });
  const h = { "X-Platform-Key": "k", "Content-Type": "application/json" };
  const url = "/api/admin/bots/" + bot.id + "/guilds/g1/availability";
  const refused = async (rule, why) => { const r = await call("PUT", url, h, rule); assert(r.status === 400 && typeof r.body.error === "string", why + ": " + r.status + " " + JSON.stringify(r.body)); return r.body.error; };
  assert(/issue-draft/.test(await refused({ kind: "tool", name: "writeIssueDraft", value: "off" }, "playbook tool")), "the reason names the playbook");
  await refused({ kind: "tool", name: "noSuchTool", value: "off" }, "unknown tool");
  await refused({ kind: "skill", name: "no_such_skill", value: "off" }, "unknown skill");
  await refused({ kind: "colour", name: "red", value: "off" }, "unknown kind");
  await refused({ kind: "tool", name: "createTask", value: "maybe" }, "unknown value");
  await refused({ name: "createTask", value: "off" }, "missing kind");
  assert((await call("GET", url, h)).body.rules.length === 0, "a refused rule was stored");
  assert((await call("PUT", "/api/admin/bots/nope/availability", h, { kind: "tool", name: "createTask", value: "off" })).status === 404, "unknown bot");
  assert((await call("PUT", "/api/admin/tenants/nope/availability", h, { kind: "tool", name: "createTask", value: "off" })).status === 404, "unknown tenant");
`));

test("effect rules set and clear at every level, and an unknown effect is refused", () => run(`
  const t = await db.createTenant({ name: "A", slug: "a" }), bot = await db.createBot({ tenantId: t.id, token: "x" });
  const h = { "X-Platform-Key": "k", "Content-Type": "application/json" };
  const levels = ["/api/admin/tenants/" + t.id, "/api/admin/bots/" + bot.id, "/api/admin/bots/" + bot.id + "/guilds/g1", "/api/admin/bots/" + bot.id + "/guilds/g1/channels/c1"];
  for (const base of levels) {
    const url = base + "/availability";
    for (const effect of ["read", "write", "danger"]) {
      const set = await call("PUT", url, h, { kind: "effect", name: effect, value: "off" });
      assert(set.status === 200 && set.body.rules.some((r) => r.kind === "effect" && r.name === effect && r.value === "off"), url + " set " + effect + " " + set.status + " " + JSON.stringify(set.body));
    }
    const cleared = await call("DELETE", url + "?kind=effect&name=danger", h);
    assert(cleared.status === 200 && JSON.stringify(cleared.body.rules.map((r) => r.name)) === JSON.stringify(["read", "write"]), url + " clear " + JSON.stringify(cleared.body));
    const unknown = await call("PUT", url, h, { kind: "effect", name: "destructive", value: "off" });
    assert(unknown.status === 400 && /destructive/.test(unknown.body.error), url + " unknown effect " + unknown.status + " " + JSON.stringify(unknown.body));
  }
`));

test("a channel cannot turn back on a tool or an effect that its guild turned off", () => run(`
  const t = await db.createTenant({ name: "A", slug: "a" }), bot = await db.createBot({ tenantId: t.id, token: "x" });
  const h = { "X-Platform-Key": "k", "Content-Type": "application/json" };
  assert((await call("PUT", "/api/admin/bots/" + bot.id + "/guilds/g1/availability", h, { kind: "effect", name: "danger", value: "off" })).status === 200, "guild danger off");
  const channel = "/api/admin/bots/" + bot.id + "/guilds/g1/channels/c1/availability";
  for (const rule of [{ kind: "effect", name: "danger", value: "on" }, { kind: "tool", name: "archiveChannel", value: "on" }]) {
    const r = await call("PUT", channel, h, rule);
    assert(r.status === 400 && typeof r.body.error === "string", JSON.stringify(rule) + " " + r.status + " " + JSON.stringify(r.body));
  }
  assert((await call("GET", channel, h)).body.rules.length === 0, "a refused rule was stored");
`));

test("the tenant API manages the tenant's own rules and no other tenant's", () => run(`
  const key = await db.issueApiKey("k1");
  const a = await db.createTenant({ name: "A", slug: "a", apiKeyId: key.keyId }), b = await db.createTenant({ name: "B", slug: "b", apiKeyId: key.keyId });
  const botA = await db.createBot({ tenantId: a.id, token: "x" }), botB = await db.createBot({ tenantId: b.id, token: "y" });
  const as = (tenant) => ({ Authorization: "Bearer " + key.raw, "X-Tenant-Id": tenant.id, "Content-Type": "application/json" });
  const rule = { kind: "tool", name: "createTask", value: "off" };
  for (const path of ["/api/v1/availability", "/api/v1/bots/" + botA.id + "/availability", "/api/v1/bots/" + botA.id + "/guilds/g1/availability", "/api/v1/bots/" + botA.id + "/guilds/g1/channels/c1/availability"]) {
    const set = await call("PUT", path, as(a), rule);
    assert(set.status === 200 && set.body.rules.length === 1, path + " set " + set.status + " " + JSON.stringify(set.body));
  }
  assert((await call("GET", "/api/v1/availability", as(b))).body.rules.length === 0, "tenant B sees tenant A's tenant rules");
  assert((await call("PUT", "/api/v1/bots/" + botB.id + "/availability", as(a), rule)).status === 404, "tenant A wrote a rule on tenant B's bot");
  assert((await call("GET", "/api/v1/bots/" + botA.id + "/guilds/g1/availability", as(b))).status === 404, "tenant B read tenant A's bot rules");
  assert((await call("DELETE", "/api/v1/bots/" + botA.id + "/availability?kind=tool&name=createTask", as(b))).status === 404, "tenant B cleared tenant A's rule");
  assert((await call("GET", "/api/v1/bots/" + botA.id + "/availability", as(a))).body.rules.length === 1, "tenant A's rule is gone");
  const cleared = await call("DELETE", "/api/v1/availability?kind=tool&name=createTask", as(a));
  assert(cleared.status === 200 && cleared.body.rules.length === 0, "tenant clear " + JSON.stringify(cleared.body));
`));

test("the tenant skill switch keeps working beside availability rules", () => run(`
  const t = await db.createTenant({ name: "A", slug: "a" });
  const h = { "X-Platform-Key": "k", "Content-Type": "application/json" };
  const skills = async () => Object.fromEntries((await call("GET", "/api/admin/tenants/" + t.id + "/skills", h)).body.skills.map((s) => [s.id, s.isEnabled]));
  assert((await skills()).task_management === true, "tasks start on");
  assert((await call("PATCH", "/api/admin/tenants/" + t.id + "/skills/task_management", h, { isEnabled: false })).status === 200, "switch refused");
  assert((await skills()).task_management === false, "switch did not stick");
  const rule = await call("PUT", "/api/admin/tenants/" + t.id + "/availability", h, { kind: "skill", name: "task_management", value: "off" });
  assert(rule.status === 400 && /switch/i.test(rule.body.error), "a tenant skill rule should point at the switch: " + JSON.stringify(rule.body));
  assert((await call("GET", "/api/admin/tenants/" + t.id + "/availability", h)).body.rules.length === 0, "the switch wrote a rule");
`));
