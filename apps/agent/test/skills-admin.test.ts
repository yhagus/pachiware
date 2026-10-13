import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();

test("admin skills catalogue lists every tool with its effect, group and playbook, and real tool counts", () => {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-skillsadmin-"));
  const script = `
    const assert = (c, m) => { if (!c) throw new Error(m); };
    const imp = (p) => import(${JSON.stringify(root + "/")} + p);
    const { runMigrations } = await imp("packages/db/src/migrate.ts"); const { runSeed } = await imp("packages/db/src/seed.ts");
    await runMigrations(); await runSeed();
    const { createServer } = await imp("apps/agent/src/server.ts"); const { createTenant } = await imp("packages/db/src/tenancy.ts");
    const app = createServer(), alpha = await createTenant({ name: "A", slug: "a" }), beta = await createTenant({ name: "B", slug: "b" });
    const h = { "X-Platform-Key": "k", "Content-Type": "application/json" };
    const list = async (t) => (await (await app.request("/api/admin/tenants/" + t.id + "/skills", { headers: h })).json()).skills;
    assert((await app.request("/api/admin/tenants/" + alpha.id + "/skills")).status === 401, "admin key required");
    assert((await app.request("/api/admin/tenants/nope/skills", { headers: h })).status === 404, "unknown tenant");
    const skills = await list(alpha), byId = Object.fromEntries(skills.map((s) => [s.id, s]));
    assert(byId.git_repositories.toolCount === 86 && byId.git_repositories.tools.length === 86, "git count " + byId.git_repositories.toolCount);
    assert(byId.workspace.toolCount === 14, "workspace count " + byId.workspace.toolCount);
    assert(byId.task_management.toolCount === 5 && byId.discord_management.toolCount === 8 && byId.reminders.toolCount === 3, "small skill counts");
    assert(JSON.stringify(byId.git_repositories.groups) === JSON.stringify(["Browse", "Issues & PRs", "Code", "CI", "Repo admin", "Org"]), "git groups");
    assert(byId.workspace.groups.length === 0, "workspace declares no groups");
    const tool = (s, n) => byId[s].tools.find((t) => t.name === n);
    const secrets = tool("git_repositories", "repoSecrets");
    assert(secrets.effect === "danger" && secrets.group === "CI" && /secret/i.test(secrets.description) && !secrets.playbook, "repoSecrets " + JSON.stringify(secrets));
    assert(tool("git_repositories", "repoList").effect === "read" && tool("git_repositories", "repoList").group === "Browse", "repoList");
    assert(tool("git_repositories", "briefRead").playbook === "issue-draft", "briefRead playbook");
    assert(tool("workspace", "postBriefRound").playbook === "issue-draft" && tool("workspace", "postBriefRound").effect === "write", "postBriefRound");
    assert(tool("workspace", "deleteFile").effect === "danger" && !tool("workspace", "deleteFile").group, "deleteFile");
    assert(tool("discord_management", "archiveChannel").effect === "danger", "archiveChannel");
    assert(skills.every((s) => s.tools.every((t) => ["read", "write", "danger"].includes(t.effect))), "every tool has an effect");
    assert((await app.request("/api/admin/tenants/" + alpha.id + "/skills/git_repositories", { method: "PATCH", headers: h, body: JSON.stringify({ isEnabled: !byId.git_repositories.isEnabled }) })).status === 200, "toggle");
    assert((await list(alpha)).find((s) => s.id === "git_repositories").isEnabled === !byId.git_repositories.isEnabled, "alpha git not toggled");
    const betaGit = (await list(beta)).find((s) => s.id === "git_repositories");
    assert(betaGit.isEnabled === byId.git_repositories.isEnabled && betaGit.toolCount === 86, "beta affected by alpha");
    console.log(JSON.stringify({ ok: true }));`;
  const result = Bun.spawnSync({ cmd: ["bun", "--eval", script], cwd: root, env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "t.db")}`, WORKSPACE_DIR: join(dir, "ws"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" } });
  try { expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0); } finally { rmSync(dir, { recursive: true, force: true }); }
});
