import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();

// Runs a scenario in its own process with a throwaway database and Workspace directory, as skills.test.ts does.
function scenario(body: string, dir = mkdtempSync(join(tmpdir(), "pachiware-ws-"))) {
  const script = `
    const assert = (c, m) => { if (!c) throw new Error(m); };
    const imp = (p) => import(${JSON.stringify(root + "/")} + p);
    const { runMigrations } = await imp("packages/db/src/migrate.ts"); const { runSeed } = await imp("packages/db/src/seed.ts");
    const { db } = await imp("packages/db/src/index.ts"); const { createTenant } = await imp("packages/db/src/tenancy.ts");
    const { skillRegistry } = await imp("packages/skills/src/registry.ts");
    await runMigrations(); await runSeed();
    const alpha = await createTenant({ name: "Alpha", slug: "alpha" }), beta = await createTenant({ name: "Beta", slug: "beta" });
    let n = 0;
    const call = (tenant, name, args, ctx = {}) => skillRegistry.executeTool({ id: "t" + n++, name, arguments: args },
      { db, tenantId: tenant.id, guildId: "g1", channelId: "c1", parentChannelId: "c1", userId: "u1", confirmed: true, ...ctx });
    ${body}
    console.log(JSON.stringify({ ok: true }));`;
  const result = Bun.spawnSync({ cmd: ["bun", "--eval", script], cwd: root, env: { ...process.env, DATABASE_URL: `sqlite:${join(dir, "t.db")}`, WORKSPACE_DIR: join(dir, "ws"), PLATFORM_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), NODE_ENV: "test" } });
  try { expect(result.exitCode, new TextDecoder().decode(result.stderr) + new TextDecoder().decode(result.stdout)).toBe(0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("workspace notes (ticket: agent can keep notes in its own channel folder)", () => {
  test("a note is read back, kept per tenant, and unsafe paths are refused", () => {
    const dir = mkdtempSync(join(tmpdir(), "pachiware-ws-"));
    scenario(`
      const w = await call(alpha, "writeFile", { path: "channel/notes.md", content: "hello" });
      assert(w.success, "write failed: " + w.error);
      const r = await call(alpha, "readFile", { path: "channel/notes.md" });
      assert(r.success && r.data.content === "hello", "note not read back");
      const l = await call(alpha, "listFiles", { path: "channel/" });
      assert(l.success && l.data.entries.some((e) => e.path === "channel/notes.md"), "note not listed");
      const other = await call(beta, "readFile", { path: "channel/notes.md" });
      assert(!other.success, "another tenant read the note");
      for (const path of ["channel/../x.md", "/etc/passwd", "channel/a\\\\b.md", "nowhere/x.md", "channel//x.md"]) {
        const bad = await call(alpha, "writeFile", { path, content: "x" });
        assert(!bad.success, "accepted unsafe path " + path);
      }
      const big = await call(alpha, "writeFile", { path: "channel/big.md", content: "x".repeat(300000) });
      assert(!big.success, "oversized file accepted");
      const fs = await import("node:fs"), ws = ${JSON.stringify(dir + "/ws/")} + alpha.id + "/guilds/g1/channels/c1";
      fs.mkdirSync(${JSON.stringify(dir + "/outside")}, { recursive: true }); fs.writeFileSync(${JSON.stringify(dir + "/outside/secret.md")}, "secret");
      fs.symlinkSync(${JSON.stringify(dir + "/outside")}, ws + "/escape");
      const esc = await call(alpha, "readFile", { path: "channel/escape/secret.md" });
      assert(!esc.success, "symlink escape read a file outside the workspace");
      const escW = await call(alpha, "writeFile", { path: "channel/escape/new.md", content: "x" });
      assert(!escW.success && !fs.existsSync(${JSON.stringify(dir + "/outside/new.md")}), "symlink escape wrote outside the workspace");
    `, dir);
  });

  test("visibility follows channel, guild, tenant, thread and DM", () => {
    scenario(`
      const fs = await import("node:fs");
      const here = { guildId: "g1", channelId: "c1", parentChannelId: "c1", guildName: "Team", channelName: "general" };
      for (const [path, content] of [["channel/a.md", "chan"], ["guild/a.md", "guild"], ["tenant/a.md", "tenant"]]) assert((await call(alpha, "writeFile", { path, content }, here)).success, "write " + path);
      // another channel of the same guild sees the guild and tenant notes but not this channel's
      const other = { guildId: "g1", channelId: "c2", parentChannelId: "c2" };
      assert((await call(alpha, "readFile", { path: "guild/a.md" }, other)).data.content === "guild", "guild shared not reachable");
      assert((await call(alpha, "readFile", { path: "tenant/a.md" }, other)).data.content === "tenant", "tenant shared not reachable");
      assert((await call(alpha, "readFile", { path: "channel/a.md" }, other)).error.includes("not found"), "channel notes leaked to another channel");
      // another guild sees only tenant shared
      const g2 = { guildId: "g2", channelId: "c1", parentChannelId: "c1" };
      assert(!(await call(alpha, "readFile", { path: "guild/a.md" }, g2)).success, "guild notes leaked to another guild");
      assert(!(await call(alpha, "readFile", { path: "channel/a.md" }, g2)).success, "channel notes leaked to another guild");
      // a thread uses its parent channel's folder
      const thread = { guildId: "g1", channelId: "t9", parentChannelId: "c1" };
      assert((await call(alpha, "readFile", { path: "channel/a.md" }, thread)).data.content === "chan", "thread did not use its parent channel");
      // a DM has its own folder and the tenant's shared, no guild or channel
      const dm = { guildId: undefined, channelId: "d1", parentChannelId: undefined, userId: "u1", userName: "Dewi" };
      assert((await call(alpha, "writeFile", { path: "dm/me.md", content: "mine" }, dm)).success, "dm write failed");
      assert(!(await call(alpha, "readFile", { path: "channel/a.md" }, dm)).success, "dm reached a channel");
      assert((await call(alpha, "readFile", { path: "tenant/a.md" }, dm)).data.content === "tenant", "dm cannot read tenant shared");
      assert(!(await call(alpha, "readFile", { path: "dm/me.md" }, { ...dm, userId: "u2" })).success, "dm of another user reachable");
      assert(fs.readFileSync(process.env.WORKSPACE_DIR + "/" + alpha.id + "/dms/u1/.name", "utf8") === "Dewi", "DM name file missing");
      // readable names sit beside the id folders and stay out of agent listings
      const listed = await call(alpha, "listFiles", { path: "channel/" }, here);
      const named = fs.readFileSync(process.env.WORKSPACE_DIR + "/" + alpha.id + "/guilds/g1/channels/c1/.name", "utf8");
      assert(named === "#general", "channel name file missing: " + named);
      assert(listed.data.entries.every((e) => !e.path.split("/").pop().startsWith(".")), "name file listed to the agent");
    `);
  });

  test("stale writes are refused, writes leave no partial files, and move, delete and search work", () => {
    scenario(`
      const fs = await import("node:fs"), dir = process.env.WORKSPACE_DIR + "/" + alpha.id + "/guilds/g1/channels/c1";
      const w1 = await call(alpha, "writeFile", { path: "channel/plan.md", content: "v1" });
      assert(w1.success && w1.data.version, "first write failed");
      // overwriting needs the version just read
      assert(!(await call(alpha, "writeFile", { path: "channel/plan.md", content: "blind" })).success, "overwrite without a version accepted");
      const w2 = await call(alpha, "writeFile", { path: "channel/plan.md", content: "v2", version: w1.data.version });
      assert(w2.success, "update with current version refused: " + w2.error);
      const stale = await call(alpha, "writeFile", { path: "channel/plan.md", content: "v3", version: w1.data.version });
      assert(!stale.success && /changed/i.test(stale.error), "stale write accepted: " + stale.error);
      assert((await call(alpha, "readFile", { path: "channel/plan.md" })).data.content === "v2", "stale write changed the file");
      assert(fs.readdirSync(dir).every((f) => !f.includes(".tmp")), "temp file left behind");
      // search finds by content and by name, within the visible folders only
      await call(alpha, "writeFile", { path: "channel/ideas/launch.md", content: "Ship the Beta\\nthen celebrate" });
      const hit = await call(alpha, "searchFiles", { query: "beta", path: "channel/" });
      assert(hit.success && hit.data.matches.some((m) => m.path === "channel/ideas/launch.md" && m.line === 1), "content search missed");
      const byName = await call(alpha, "searchFiles", { query: "launch", path: "channel/" });
      assert(byName.data.matches.some((m) => m.path === "channel/ideas/launch.md"), "name search missed");
      assert(!(await call(alpha, "searchFiles", { query: "beta", path: "other/" })).success, "search left the visible folders");
      // move keeps content, refuses to overwrite
      const mv = await call(alpha, "moveFile", { from: "channel/ideas/launch.md", to: "channel/done/launch.md" });
      assert(mv.success, "move failed: " + mv.error);
      assert((await call(alpha, "readFile", { path: "channel/done/launch.md" })).success && !(await call(alpha, "readFile", { path: "channel/ideas/launch.md" })).success, "move did not move");
      const clash = await call(alpha, "moveFile", { from: "channel/done/launch.md", to: "channel/plan.md" });
      assert(!clash.success, "move overwrote an existing file");
      // delete removes a file or empty folder, never a non-empty one
      assert(!(await call(alpha, "deleteFile", { path: "channel/done" })).success, "non-empty folder deleted");
      assert((await call(alpha, "deleteFile", { path: "channel/done/launch.md" })).success, "file delete failed");
      assert((await call(alpha, "deleteFile", { path: "channel/done" })).success, "empty folder delete failed");
      assert(!(await call(alpha, "readFile", { path: "channel/done/launch.md" })).success, "file still there");
      // risky tools ask a person first
      const ask = await call(alpha, "deleteFile", { path: "channel/plan.md" }, { confirmed: false, botId: undefined });
      assert(!ask.success || ask.data?.pending, "delete ran without confirmation");
      assert((await call(alpha, "readFile", { path: "channel/plan.md" })).success, "unconfirmed delete removed the file");
    `);
  });

  test("tasks are Markdown files filed by channel, with the same four tools", () => {
    scenario(`
      const fs = await import("node:fs"), ws = process.env.WORKSPACE_DIR + "/" + alpha.id;
      const made = await call(alpha, "createTask", { title: "Fix the login bug!", description: "Users get a 500\\nafter reset", priority: "high", discordChannelId: "legacy-channel" });
      assert(made.success, "createTask failed: " + made.error);
      const task = made.data.task, dir = ws + "/guilds/g1/channels/c1/tasks";
      const files = fs.readdirSync(dir).filter((name) => !name.startsWith("."));
      assert(files.length === 1 && /^fix-the-login-bug-[a-z0-9]{4,}\\.md$/.test(files[0]), "unexpected task file " + files);
      const raw = fs.readFileSync(dir + "/" + files[0], "utf8");
      assert(raw.startsWith("---\\n") && raw.includes('status: "pending"') && raw.includes("Users get a 500"), "task file shape: " + raw);
      assert(task.id && task.status === "pending" && task.priority === "high", "task result shape");
      // listing: visible here, filtered, never from another channel or tenant
      assert((await call(alpha, "listTasks", {})).data.tasks.length === 1, "task not listed");
      assert((await call(alpha, "listTasks", { status: "completed" })).data.tasks.length === 0, "status filter ignored");
      assert((await call(alpha, "listTasks", {}, { channelId: "c2", parentChannelId: "c2" })).data.tasks.length === 0, "task leaked to another channel");
      assert((await call(beta, "listTasks", {})).data.tasks.length === 0, "task leaked to another tenant");
      // update and assign by id, validated
      const done = await call(alpha, "updateTaskStatus", { taskId: task.id, status: "in_progress" });
      assert(done.success && done.data.task.status === "in_progress", "status update failed: " + done.error);
      assert(!(await call(alpha, "updateTaskStatus", { taskId: task.id, status: "bogus" })).success, "invalid status accepted");
      assert((await call(alpha, "assignTask", { taskId: task.id, assignedTo: "dewi" })).data.task.assignedTo === "dewi", "assign failed");
      assert((await call(alpha, "listTasks", { assignedTo: "dewi", status: "in_progress" })).data.tasks.length === 1, "assignee filter failed");
      assert(!(await call(beta, "updateTaskStatus", { taskId: task.id, status: "completed" })).success, "another tenant updated the task");
      assert(!(await call(alpha, "createTask", { title: "  " })).success, "empty title accepted");
      assert(!(await call(alpha, "createTask", { title: "x", priority: "asap" })).success, "invalid priority accepted");
      // moving a task into a subfolder keeps its id; a broken file is rejected, not trusted
      assert((await call(alpha, "moveFile", { from: "channel/tasks/" + files[0], to: "channel/tasks/web/" + files[0] })).success, "move failed");
      assert((await call(alpha, "updateTaskStatus", { taskId: task.id, status: "completed" })).data.task.status === "completed", "moved task lost its id");
      assert((await call(alpha, "moveFile", { from: "channel/tasks/web/" + files[0], to: "channel/tasks/web/login-fix.md" })).success, "rename failed");
      assert((await call(alpha, "updateTaskStatus", { taskId: task.id, status: "pending" })).success, "renamed task lost its id");
      fs.writeFileSync(dir + "/web/broken-zzzzzzzz.md", "---\\nstatus: nope\\n---\\nx");
      const listed = await call(alpha, "listTasks", { status: "all" });
      assert(listed.success && listed.data.tasks.length === 1, "broken task file was listed: " + JSON.stringify(listed.data));
      // from a context with no channel, tasks go to the tenant's shared folder (as the old tests do)
      const bare = await skillRegistry.executeTool({ id: "x", name: "createTask", arguments: { title: "Tenant wide" } }, { db, tenantId: alpha.id });
      assert(bare.success && fs.existsSync(ws + "/shared/tasks"), "tenant-wide task not filed in shared");
    `);
  });

  test("MEMORY.md from tenant, guild and channel loads into the per-turn prompt, capped, and active tasks come from files", () => {
    scenario(`
      const { SystemPromptBuilder } = await imp("apps/agent/src/loop/prompt.ts");
      const here = { guildId: "g1", channelId: "c1", parentChannelId: "c1" };
      const turn = (tenant, c = here) => SystemPromptBuilder.buildDynamic({ tenantId: tenant.id, platform: "discord", ...c, skillContext: { parentChannelId: c.parentChannelId } });
      assert(!(await turn(alpha)).includes("Memory"), "memory section shown with no memory");
      await call(alpha, "writeFile", { path: "tenant/MEMORY.md", content: "Company uses Bun." });
      await call(alpha, "writeFile", { path: "guild/MEMORY.md", content: "Team prefers short answers." });
      await call(alpha, "writeFile", { path: "channel/MEMORY.md", content: "This channel plans the launch." });
      const text = await turn(alpha);
      const order = ["Company uses Bun.", "Team prefers short answers.", "This channel plans the launch."].map((x) => text.indexOf(x));
      assert(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], "memory missing or out of order: " + text);
      // another channel gets tenant and guild memory, not this channel's
      const other = await turn(alpha, { guildId: "g1", channelId: "c2", parentChannelId: "c2" });
      assert(other.includes("Team prefers short answers.") && !other.includes("launch"), "channel memory leaked: " + other);
      assert(!(await turn(beta)).includes("Bun"), "memory leaked to another tenant");
      // a long memory file is cut at the cap
      require("node:fs").writeFileSync(process.env.WORKSPACE_DIR + "/" + alpha.id + "/guilds/g1/channels/c1/MEMORY.md", "a".repeat(20000));
      const capped = await turn(alpha);
      assert(capped.length < 12000 && capped.includes("truncated"), "memory not capped: " + capped.length);
      // active tasks are listed from files
      await call(alpha, "createTask", { title: "Ship launch page" });
      const withTask = await turn(alpha);
      assert(withTask.includes("Active tasks:") && withTask.includes("Ship launch page (pending)"), "active tasks missing: " + withTask);
    `);
  });

  test("the tasks table exports into task files by guild and channel, rerunnable, table untouched", () => {
    scenario(`
      const fs = await import("node:fs"), ws = process.env.WORKSPACE_DIR + "/" + alpha.id;
      const { tasks } = await imp("packages/db/src/index.ts"), { exportTasks } = await imp("packages/skills/src/workspace/exportTasks.ts");
      const base = { tenantId: alpha.id, status: "in_progress", priority: "high" };
      await db.insert(tasks).values([
        { ...base, title: "Channel task", description: "body", assignedTo: "dewi", discordGuildId: "g1", discordChannelId: "c1" },
        { ...base, title: "Guild only", discordGuildId: "g1" },
        { ...base, title: "No place" },
        { ...base, title: "Channel without guild", discordChannelId: "c9" },
        { tenantId: beta.id, title: "Other tenant" },
      ]);
      const first = await exportTasks();
      assert(first.written === 5, "wrote " + first.written);
      const files = (path) => fs.readdirSync(path).filter((name) => !name.startsWith("."));
      assert(files(ws + "/guilds/g1/channels/c1/tasks").length === 1, "channel task not filed in its channel");
      assert(files(ws + "/guilds/g1/shared/tasks").length === 1, "guild task not filed in guild shared");
      assert(files(ws + "/shared/tasks").length === 2, "unplaced tasks not in tenant shared");
      assert(files(process.env.WORKSPACE_DIR + "/" + beta.id + "/shared/tasks").length === 1, "other tenant task not filed under its own tenant");
      // the agent reads them back with its own tools
      const listed = await call(alpha, "listTasks", { status: "in_progress" });
      assert(listed.data.tasks.some((t) => t.title === "Channel task" && t.assignedTo === "dewi"), "exported task not readable");
      // rerun: nothing duplicated, even after the agent moved one into a subfolder
      const only = files(ws + "/guilds/g1/channels/c1/tasks")[0];
      await call(alpha, "moveFile", { from: "channel/tasks/" + only, to: "channel/tasks/web/renamed.md" });
      const second = await exportTasks();
      assert(second.written === 0 && second.skipped === 5, "rerun wrote " + second.written);
      assert(files(ws + "/guilds/g1/channels/c1/tasks").every((n) => n === "web"), "moved task duplicated");
      assert((await db.select().from(tasks)).length === 5, "tasks table was changed");
    `);
  });
});
