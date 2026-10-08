import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();

test("admin Workspace routes: browse, edit with version check, move, delete, refuse unsafe paths, stay inside the tenant", () => {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-wsadmin-"));
  const script = `
    const assert = (c, m) => { if (!c) throw new Error(m); };
    const imp = (p) => import(${JSON.stringify(root + "/")} + p);
    const { runMigrations } = await imp("packages/db/src/migrate.ts"); const { runSeed } = await imp("packages/db/src/seed.ts");
    await runMigrations(); await runSeed();
    const { createServer } = await imp("apps/agent/src/server.ts"); const { createTenant } = await imp("packages/db/src/tenancy.ts");
    const app = createServer(), alpha = await createTenant({ name: "A", slug: "a" }), beta = await createTenant({ name: "B", slug: "b" });
    const h = { "X-Platform-Key": "k", "Content-Type": "application/json" };
    const base = (t) => "/api/admin/tenants/" + t.id + "/workspace";
    const put = (t, body) => app.request(base(t) + "/file", { method: "PUT", headers: h, body: JSON.stringify(body) });
    assert((await app.request(base(alpha) + "/tree")).status === 401, "admin key required");
    assert((await app.request("/api/admin/tenants/nope/workspace/tree", { headers: h })).status === 404, "unknown tenant");
    const made = await put(alpha, { path: "guilds/g1/channels/c1/notes/a.md", content: "# Hi" });
    assert(made.status === 200, "create failed " + made.status); const v1 = (await made.json()).version;
    const tree = await (await app.request(base(alpha) + "/tree?path=guilds/g1/channels/c1", { headers: h })).json();
    assert(tree.entries.some((e) => e.path === "guilds/g1/channels/c1/notes" && e.type === "dir"), "tree missing folder");
    const file = await (await app.request(base(alpha) + "/file?path=guilds/g1/channels/c1/notes/a.md", { headers: h })).json();
    assert(file.content === "# Hi" && file.version === v1, "read failed");
    assert((await put(alpha, { path: "guilds/g1/channels/c1/notes/a.md", content: "blind" })).status === 409, "overwrite without version accepted");
    const ok = await put(alpha, { path: "guilds/g1/channels/c1/notes/a.md", content: "# Hello", version: v1 });
    assert(ok.status === 200, "edit refused");
    const stale = await put(alpha, { path: "guilds/g1/channels/c1/notes/a.md", content: "# Late", version: v1 });
    assert(stale.status === 409 && /changed/i.test((await stale.json()).error), "stale edit accepted");
    assert((await app.request(base(beta) + "/file?path=guilds/g1/channels/c1/notes/a.md", { headers: h })).status === 404, "another tenant read the file");
    for (const p of ["../x.md", "/etc/passwd", "a/../../x.md", "a\\\\b.md"]) assert((await put(alpha, { path: p, content: "x" })).status === 400, "unsafe path accepted: " + p);
    assert((await put(alpha, { path: "guilds/g1/channels/c1/ideas/README.md", content: "# ideas\\n" })).status === 200, "new folder via README failed");
    assert((await put(alpha, { path: "guilds/g1/channels/c1/.keep", content: "" })).status === 400, "dot name accepted");
    const mv = await app.request(base(alpha) + "/move", { method: "POST", headers: h, body: JSON.stringify({ from: "guilds/g1/channels/c1/notes/a.md", to: "shared/a.md" }) });
    assert(mv.status === 200, "move failed");
    assert((await app.request(base(alpha) + "/file?path=shared/a.md", { headers: h })).status === 200, "moved file missing");
    assert((await app.request(base(alpha) + "/file?path=shared/a.md", { method: "DELETE", headers: h })).status === 200, "delete failed");
    assert((await app.request(base(alpha) + "/file?path=shared/a.md", { headers: h })).status === 404, "file still there");
    console.log(JSON.stringify({ ok: true }));`;
  const result = Bun.spawnSync({ cmd: ["bun", "--eval", script], cwd: root, env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "t.db")}`, WORKSPACE_DIR: join(dir, "ws"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" } });
  try { expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0); } finally { rmSync(dir, { recursive: true, force: true }); }
});
