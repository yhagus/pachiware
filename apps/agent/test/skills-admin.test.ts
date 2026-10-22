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
    const { createServer } = await imp("apps/agent/src/server.ts"); const { repositories } = await imp("packages/db/src/index.ts");
    const app = createServer(), alpha = await repositories().tenants.create({ name: "A", slug: "a" }), beta = await repositories().tenants.create({ name: "B", slug: "b" });
    const h = { "X-Platform-Key": "k", "Content-Type": "application/json" };
    const list = async (t) => (await (await app.request("/api/admin/tenants/" + t.id + "/skills", { headers: h })).json()).skills;
    assert((await app.request("/api/admin/tenants/" + alpha.id + "/skills")).status === 401, "admin key required");
    assert((await app.request("/api/admin/tenants/nope/skills", { headers: h })).status === 404, "unknown tenant");
    // A row holding text an older version stored; the console shows the module's.
    await repositories().skills.register({ id: "task_management", name: "Tasks (old)", description: "Old text.", defaultEnabled: true, toolDefinitions: [], handlerType: "builtin", config: {} });
    const skills = await list(alpha), byId = Object.fromEntries(skills.map((s) => [s.id, s]));
    const { taskManagementSkill, discordManagementSkill, gitRepositorySkill, workspaceSkill, remindersSkill, planeSkill, openapiSkill } = await imp("packages/skills/src/index.ts");
    const modules = [taskManagementSkill, discordManagementSkill, gitRepositorySkill, workspaceSkill, remindersSkill, planeSkill, openapiSkill], names = (tools) => JSON.stringify(tools.map((t) => t.name));
    assert(JSON.stringify(skills.map((s) => s.id).sort()) === JSON.stringify(modules.map((m) => m.id).sort()), "skills listed " + skills.map((s) => s.id));
    for (const m of modules) {
      assert(byId[m.id].toolCount === m.tools.length && names(byId[m.id].tools) === names(m.tools), m.id + " lists " + byId[m.id].toolCount + " tools, its module " + m.tools.length);
      assert(byId[m.id].name === m.name && byId[m.id].description === m.description, m.id + " shows " + JSON.stringify([byId[m.id].name, byId[m.id].description]));
    }
    assert(JSON.stringify(byId.git_repositories.groups) === JSON.stringify(["Browse", "Issues & PRs", "Code", "CI", "Repo admin", "Org"]), "git groups");
    assert(byId.workspace.groups.length === 0, "workspace declares no groups");
    const tool = (s, n) => byId[s].tools.find((t) => t.name === n);
    const secrets = tool("git_repositories", "repoSecrets");
    assert(secrets.effect === "danger" && secrets.group === "CI" && /secret/i.test(secrets.description) && !secrets.playbook, "repoSecrets " + JSON.stringify(secrets));
    assert(tool("git_repositories", "repoList").effect === "read" && tool("git_repositories", "repoList").group === "Browse", "repoList");
    for (const n of ["repoLinkIssues", "repoSubIssue"]) assert(tool("git_repositories", n)?.effect === "write" && tool("git_repositories", n).group === "Issues & PRs", n + " " + JSON.stringify(tool("git_repositories", n)));
    assert(tool("git_repositories", "briefRead").playbook === "issue-draft", "briefRead playbook");
    assert(tool("workspace", "postBriefRound").playbook === "issue-draft" && tool("workspace", "postBriefRound").effect === "write", "postBriefRound");
    assert(tool("workspace", "deleteFile").effect === "danger" && !tool("workspace", "deleteFile").group, "deleteFile");
    assert(tool("discord_management", "archiveChannel").effect === "danger", "archiveChannel");
    assert(skills.every((s) => s.tools.every((t) => ["read", "write", "danger"].includes(t.effect))), "every tool has an effect");
    assert((await app.request("/api/admin/tenants/" + alpha.id + "/skills/git_repositories", { method: "PATCH", headers: h, body: JSON.stringify({ isEnabled: !byId.git_repositories.isEnabled }) })).status === 200, "toggle");
    assert((await list(alpha)).find((s) => s.id === "git_repositories").isEnabled === !byId.git_repositories.isEnabled, "alpha git not toggled");
    const betaGit = (await list(beta)).find((s) => s.id === "git_repositories");
    assert(betaGit.isEnabled === byId.git_repositories.isEnabled && betaGit.toolCount === gitRepositorySkill.tools.length, "beta affected by alpha");
    console.log(JSON.stringify({ ok: true }));`;
  const result = Bun.spawnSync({ cmd: ["bun", "--eval", script], cwd: root, env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "t.db")}`, WORKSPACE_DIR: join(dir, "ws"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" } });
  try { expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0); } finally { rmSync(dir, { recursive: true, force: true }); }
});
