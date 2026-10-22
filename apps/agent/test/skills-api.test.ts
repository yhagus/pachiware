import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();

function run(body: string, beforeSeed = "") {
  const dir = mkdtempSync(join(tmpdir(), "pachiware-skillsapi-"));
  const script = `
    const assert = (c, m) => { if (!c) throw new Error(m); };
    const imp = (p) => import(${JSON.stringify(root + "/")} + p);
    const { runMigrations } = await imp("packages/db/src/migrate.ts"); const { runSeed } = await imp("packages/db/src/seed.ts");
    const { repositories } = await imp("packages/db/src/index.ts");
    await runMigrations();
    ${beforeSeed}
    await runSeed();
    const { createServer } = await imp("apps/agent/src/server.ts"); const app = createServer();
    const skills = await imp("packages/skills/src/index.ts");
    const t = await repositories().tenants.create({ name: "A", slug: "a" }), key = await repositories().tenants.issueApiKey("a");
    await repositories().tenants.linkApiKey(t.id, key.keyId);
    const headers = { Authorization: "Bearer " + key.raw, "Content-Type": "application/json", "X-Tenant-Id": t.id };
    ${body}
    console.log(JSON.stringify({ ok: true }));`;
  const result = Bun.spawnSync({ cmd: ["bun", "--eval", script], cwd: root, env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "t.db")}`, WORKSPACE_DIR: join(dir, "ws"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"), PLATFORM_ADMIN_KEY: "k", NODE_ENV: "test" } });
  try { expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("the seed stores no copy of a skill's tools, and clears the copy an older version stored", () => run(`
  const stored = await repositories().skills.list();
  assert(stored.length === 7, "skills stored " + stored.map((s) => s.id));
  assert(stored.every((s) => JSON.stringify(s.toolDefinitions) === "[]"), "copies kept: " + JSON.stringify(stored.filter((s) => s.toolDefinitions.length).map((s) => [s.id, s.toolDefinitions.map((d) => d.name)])));
`, `
  // The task tools as servers before #134 stored them: a free-text assignee and three statuses.
  const old = [{ name: "createTask", description: "Creates a new task in the current Workspace folder.", parameters: { type: "object", properties: { title: { type: "string" }, assignedTo: { type: "string" } }, required: ["title"] } },
    { name: "updateTaskStatus", description: "Updates the status of a specific task by ID.", parameters: { type: "object", properties: { taskId: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed"] } }, required: ["taskId", "status"] } }];
  await repositories().skills.register({ id: "task_management", name: "Task Management", description: "Create, view, update status, and assign tasks stored in the Workspace.", defaultEnabled: true, toolDefinitions: old, handlerType: "builtin", config: {} });
`));

test("GET /api/v1/skills lists each skill's name, description and tools as its module declares them", () => run(`
  await repositories().skills.register({ id: "task_management", name: "Tasks (old)", description: "Old text.", defaultEnabled: true, toolDefinitions: [], handlerType: "builtin", config: {} });
  const res = await app.request("/api/v1/skills", { headers });
  assert(res.status === 200, "status " + res.status);
  const listed = Object.fromEntries((await res.json()).skills.map((s) => [s.id, s]));
  const modules = [skills.taskManagementSkill, skills.discordManagementSkill, skills.gitRepositorySkill, skills.workspaceSkill, skills.remindersSkill, skills.planeSkill, skills.openapiSkill];
  assert(JSON.stringify(Object.keys(listed).sort()) === JSON.stringify(modules.map((m) => m.id).sort()), "skills listed " + Object.keys(listed));
  for (const m of modules) {
    const s = listed[m.id];
    assert(JSON.stringify(s.tools) === JSON.stringify(m.tools) && s.toolCount === m.tools.length, m.id + " lists " + s.toolCount + " tools, its module " + m.tools.length);
    assert(s.name === m.name && s.description === m.description, m.id + " shows " + JSON.stringify([s.name, s.description]));
    assert(!("toolDefinitions" in s), m.id + " still carries toolDefinitions");
  }
  assert(listed.task_management.isEnabled === true && listed.git_repositories.isEnabled === false, "tenant state");
`));

test("a skill only the database knows offers the model none of the tools it stored", () => run(`
  await repositories().skills.register({ id: "ghost", name: "Ghost", description: "No module.", defaultEnabled: true, toolDefinitions: [{ name: "ghostTool", description: "Haunts.", parameters: { type: "object", properties: {} } }], handlerType: "builtin", config: {} });
  await repositories().skills.enable(t.id, "ghost");
  const offered = (await skills.skillRegistry.getActiveTools(t.id)).map((d) => d.name);
  assert(!offered.includes("ghostTool") && offered.includes("createTask"), "offered " + offered);
`));
