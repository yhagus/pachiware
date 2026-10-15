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
    const { repositories } = await imp("packages/db/src/index.ts");
    const { skillRegistry } = await imp("packages/skills/src/registry.ts");
    await runMigrations(); await runSeed();
    const alpha = await repositories().tenants.create({ name: "Alpha", slug: "alpha" }), beta = await repositories().tenants.create({ name: "Beta", slug: "beta" });
    let n = 0;
    const call = (tenant, name, args, ctx = {}) => skillRegistry.executeTool({ id: "t" + n++, name, arguments: args },
      { tenantId: tenant.id, guildId: "g1", channelId: "c1", parentChannelId: "c1", userId: "u1", confirmed: true, ...ctx });
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
      const w = await call(alpha, "writeFile", { path: "channel/notes/notes.md", content: "hello" });
      assert(w.success, "write failed: " + w.error);
      const r = await call(alpha, "readFile", { path: "channel/notes/notes.md" });
      assert(r.success && r.data.content === "hello", "note not read back");
      const l = await call(alpha, "listFiles", { path: "channel/notes/" });
      assert(l.success && l.data.entries.some((e) => e.path === "channel/notes/notes.md"), "note not listed");
      const other = await call(beta, "readFile", { path: "channel/notes/notes.md" });
      assert(!other.success, "another tenant read the note");
      for (const path of ["channel/../x.md", "/etc/passwd", "channel/a\\\\b.md", "nowhere/x.md", "channel//x.md"]) {
        const bad = await call(alpha, "writeFile", { path, content: "x" });
        assert(!bad.success, "accepted unsafe path " + path);
      }
      const big = await call(alpha, "writeFile", { path: "channel/notes/big.md", content: "x".repeat(300000) });
      assert(!big.success, "oversized file accepted");
      const fs = await import("node:fs"), ws = ${JSON.stringify(dir + "/ws/")} + alpha.id + "/guilds/g1/channels/c1";
      fs.mkdirSync(${JSON.stringify(dir + "/outside")}, { recursive: true }); fs.writeFileSync(${JSON.stringify(dir + "/outside/secret.md")}, "secret");
      fs.symlinkSync(${JSON.stringify(dir + "/outside")}, ws + "/notes/escape");
      const esc = await call(alpha, "readFile", { path: "channel/notes/escape/secret.md" });
      assert(!esc.success, "symlink escape read a file outside the workspace");
      const escW = await call(alpha, "writeFile", { path: "channel/notes/escape/new.md", content: "x" });
      assert(!escW.success && !fs.existsSync(${JSON.stringify(dir + "/outside/new.md")}), "symlink escape wrote outside the workspace");
    `, dir);
  });

  test("visibility follows channel, guild, tenant, thread and DM", () => {
    scenario(`
      const fs = await import("node:fs");
      const here = { guildId: "g1", channelId: "c1", parentChannelId: "c1", guildName: "Team", channelName: "general" };
      for (const [path, content] of [["channel/notes/a.md", "chan"], ["guild/a.md", "guild"], ["tenant/a.md", "tenant"]]) assert((await call(alpha, "writeFile", { path, content }, here)).success, "write " + path);
      // another channel of the same guild sees the guild and tenant notes but not this channel's
      const other = { guildId: "g1", channelId: "c2", parentChannelId: "c2" };
      assert((await call(alpha, "readFile", { path: "guild/a.md" }, other)).data.content === "guild", "guild shared not reachable");
      assert((await call(alpha, "readFile", { path: "tenant/a.md" }, other)).data.content === "tenant", "tenant shared not reachable");
      assert((await call(alpha, "readFile", { path: "channel/notes/a.md" }, other)).error.includes("not found"), "channel notes leaked to another channel");
      // another guild sees only tenant shared
      const g2 = { guildId: "g2", channelId: "c1", parentChannelId: "c1" };
      assert(!(await call(alpha, "readFile", { path: "guild/a.md" }, g2)).success, "guild notes leaked to another guild");
      assert(!(await call(alpha, "readFile", { path: "channel/notes/a.md" }, g2)).success, "channel notes leaked to another guild");
      // a thread uses its parent channel's folder
      const thread = { guildId: "g1", channelId: "t9", parentChannelId: "c1" };
      assert((await call(alpha, "readFile", { path: "channel/notes/a.md" }, thread)).data.content === "chan", "thread did not use its parent channel");
      // a DM has its own folder and the tenant's shared, no guild or channel
      const dm = { guildId: undefined, channelId: "d1", parentChannelId: undefined, userId: "u1", userName: "Dewi" };
      assert((await call(alpha, "writeFile", { path: "dm/notes/me.md", content: "mine" }, dm)).success, "dm write failed");
      assert(!(await call(alpha, "readFile", { path: "channel/notes/a.md" }, dm)).success, "dm reached a channel");
      assert((await call(alpha, "readFile", { path: "tenant/a.md" }, dm)).data.content === "tenant", "dm cannot read tenant shared");
      assert(!(await call(alpha, "readFile", { path: "dm/notes/me.md" }, { ...dm, userId: "u2" })).success, "dm of another user reachable");
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
      const w1 = await call(alpha, "writeFile", { path: "channel/notes/plan.md", content: "v1" });
      assert(w1.success && w1.data.version, "first write failed");
      // overwriting needs the version just read
      assert(!(await call(alpha, "writeFile", { path: "channel/notes/plan.md", content: "blind" })).success, "overwrite without a version accepted");
      const w2 = await call(alpha, "writeFile", { path: "channel/notes/plan.md", content: "v2", version: w1.data.version });
      assert(w2.success, "update with current version refused: " + w2.error);
      const stale = await call(alpha, "writeFile", { path: "channel/notes/plan.md", content: "v3", version: w1.data.version });
      assert(!stale.success && /changed/i.test(stale.error), "stale write accepted: " + stale.error);
      assert((await call(alpha, "readFile", { path: "channel/notes/plan.md" })).data.content === "v2", "stale write changed the file");
      assert(fs.readdirSync(dir).every((f) => !f.includes(".tmp")), "temp file left behind");
      // search finds by content and by name, within the visible folders only
      await call(alpha, "writeFile", { path: "channel/notes/ideas/launch.md", content: "Ship the Beta\\nthen celebrate" });
      const hit = await call(alpha, "searchFiles", { query: "beta", path: "channel/" });
      assert(hit.success && hit.data.matches.some((m) => m.path === "channel/notes/ideas/launch.md" && m.lines[0]?.line === 1), "content search missed");
      const byName = await call(alpha, "searchFiles", { query: "launch", path: "channel/" });
      assert(byName.data.matches.some((m) => m.path === "channel/notes/ideas/launch.md"), "name search missed");
      assert(!(await call(alpha, "searchFiles", { query: "beta", path: "other/" })).success, "search left the visible folders");
      // move keeps content, refuses to overwrite
      const mv = await call(alpha, "moveFile", { from: "channel/notes/ideas/launch.md", to: "channel/notes/done/launch.md" });
      assert(mv.success, "move failed: " + mv.error);
      assert((await call(alpha, "readFile", { path: "channel/notes/done/launch.md" })).success && !(await call(alpha, "readFile", { path: "channel/notes/ideas/launch.md" })).success, "move did not move");
      const clash = await call(alpha, "moveFile", { from: "channel/notes/done/launch.md", to: "channel/notes/plan.md" });
      assert(!clash.success, "move overwrote an existing file");
      // delete removes a file or empty folder, never a non-empty one
      assert(!(await call(alpha, "deleteFile", { path: "channel/notes/done" })).success, "non-empty folder deleted");
      assert((await call(alpha, "deleteFile", { path: "channel/notes/done/launch.md" })).success, "file delete failed");
      assert((await call(alpha, "deleteFile", { path: "channel/notes/done" })).success, "empty folder delete failed");
      assert(!(await call(alpha, "readFile", { path: "channel/notes/done/launch.md" })).success, "file still there");
      // risky tools ask a person first
      const ask = await call(alpha, "deleteFile", { path: "channel/notes/plan.md" }, { confirmed: false, botId: undefined });
      assert(!ask.success || ask.data?.pending, "delete ran without confirmation");
      assert((await call(alpha, "readFile", { path: "channel/notes/plan.md" })).success, "unconfirmed delete removed the file");
    `);
  });

  test("a task file without dueAt or creator stays valid; due dates are checked, read in the place's zone, and filtered by bounds", () => {
    scenario(`
      const fs = await import("node:fs"), ws = process.env.WORKSPACE_DIR + "/" + alpha.id, dir = ws + "/guilds/g1/channels/c1/tasks";
      const { setClock } = await imp("packages/skills/src/clock.ts");
      setClock(() => Date.parse("2026-10-14T03:00:00Z"));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dir + "/old-task-0a0a0a0a.md", '---\\nid: "0a0a0a0a-0000-4000-8000-000000000001"\\ntitle: "Old task"\\nstatus: "pending"\\npriority: "low"\\nassignedTo: null\\ncreatedAt: "2026-01-01T00:00:00.000Z"\\nupdatedAt: "2026-01-01T00:00:00.000Z"\\n---\\n');
      const old = (await call(alpha, "listTasks", {})).data.tasks[0];
      assert(old && old.title === "Old task" && old.dueAt === null && old.createdBy === null && old.late === false, "old file not read: " + JSON.stringify(old));
      // a creator comes from the turn; a date-only due date is kept as is, a wall-clock time takes the place's zone
      const made = await call(alpha, "createTask", { title: "Pay rent", dueAt: "2026-10-31" }, { userName: "Dewi" });
      assert(made.success && made.data.task.dueAt === "2026-10-31" && made.data.task.createdBy === "u1" && made.data.task.createdByName === "Dewi", "createTask due: " + JSON.stringify(made));
      const timed = await call(alpha, "createTask", { title: "Call the vendor", dueAt: "2026-10-15 09:30" }, { timezone: "Asia/Tokyo" });
      assert(timed.data.task.dueAt === "2026-10-15T09:30:00+09:00", "wall-clock due: " + timed.data.task.dueAt);
      const utc = await call(alpha, "createTask", { title: "Deploy", dueAt: "2026-10-14T02:00:00Z" });
      assert(utc.data.task.dueAt === "2026-10-14T02:00:00Z", "offset due kept: " + utc.data.task.dueAt);
      for (const bad of ["tomorrow", "2026-02-30", "2026-10-14T25:00", 42]) assert(!(await call(alpha, "createTask", { title: "x", dueAt: bad })).success, "accepted due " + bad);
      // set, clear, and refuse through setTaskDueDate without Confirm
      const set = await call(alpha, "setTaskDueDate", { taskId: old.id, dueAt: "2026-10-13" }, { confirmed: false, botId: undefined });
      assert(set.success && set.data.task.dueAt === "2026-10-13" && !set.data.pending, "setTaskDueDate: " + JSON.stringify(set));
      assert(fs.readFileSync(dir + "/old-task-0a0a0a0a.md", "utf8").includes('dueAt: "2026-10-13"'), "file not updated");
      assert(!(await call(alpha, "setTaskDueDate", { taskId: old.id, dueAt: "soon" })).success, "bad due accepted");
      // filters: late, bounds inclusive by day, undated tasks left out of due filters
      const titles = async (args, ctx) => (await call(alpha, "listTasks", args, ctx)).data.tasks.map((t) => t.title);
      assert(JSON.stringify(await titles({ late: true })) === JSON.stringify(["Old task", "Deploy"]), "late: " + JSON.stringify(await titles({ late: true })));
      assert(JSON.stringify(await titles({ late: false })) === JSON.stringify(["Call the vendor", "Pay rent"]), "not late: " + JSON.stringify(await titles({ late: false })));
      assert(JSON.stringify(await titles({ dueAfter: "2026-10-14", dueBefore: "2026-10-15" })) === JSON.stringify(["Deploy", "Call the vendor"]), "bounds: " + JSON.stringify(await titles({ dueAfter: "2026-10-14", dueBefore: "2026-10-15" })));
      assert(JSON.stringify(await titles({ dueAfter: "2026-10-14T03:00:00Z" })) === JSON.stringify(["Call the vendor", "Pay rent"]), "exact bound: " + JSON.stringify(await titles({ dueAfter: "2026-10-14T03:00:00Z" })));
      assert(!(await call(alpha, "listTasks", { dueBefore: "friday" })).success, "bad bound accepted");
      // the same zone question answered for the per-turn list: end of day in Asia/Tokyo comes before the end of day in Asia/Jakarta
      setClock(() => Date.parse("2026-10-30T15:30:00Z"));
      assert(JSON.stringify(await titles({ late: true }, { timezone: "Asia/Tokyo" })) === JSON.stringify(["Old task", "Deploy", "Call the vendor"]), "late in Tokyo");
      setClock(() => Date.parse("2026-10-31T16:30:00Z"));
      assert(!(await titles({ late: true })).includes("Pay rent"), "late at Oct 31 23:30 in Jakarta");
      setClock(() => Date.parse("2026-10-31T17:00:30Z"));
      assert((await titles({ late: true })).includes("Pay rent"), "not late at Nov 1 00:00:30 in Jakarta");
      const done = await call(alpha, "updateTaskStatus", { taskId: made.data.task.id, status: "completed" }, { confirmed: false, botId: undefined });
      assert(done.success && !done.data.pending && !(await titles({ late: true })).includes("Pay rent"), "a completed task is never late");
      const { SystemPromptBuilder } = await imp("apps/agent/src/loop/prompt.ts");
      const turn = await SystemPromptBuilder.buildDynamic({ tenantId: alpha.id, platform: "discord", guildId: "g1", channelId: "c1", skillContext: { parentChannelId: "c1" } });
      assert(/^pending \\| due 2026-10-13, late \\| unassigned \\| 0a0a0a0a \\| Old task$/m.test(turn) && !turn.includes("Pay rent"), "turn list: " + turn);
    `);
  });

  test("tasks are Markdown files filed by channel, with the same five tools", () => {
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
      assert((await call(alpha, "assignTask", { taskId: task.id, assignedTo: "dewi" })).data.task.assignedTo?.name === "dewi", "assign failed");
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
      const bare = await skillRegistry.executeTool({ id: "x", name: "createTask", arguments: { title: "Tenant wide" } }, { tenantId: alpha.id });
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
      assert(withTask.includes("Active tasks (status | due | assignee | id | title):") && /^pending \\| no due date \\| unassigned \\| [0-9a-f]{8} \\| Ship launch page$/m.test(withTask), "active tasks missing: " + withTask);
    `);
  });

  test("the tasks table exports into task files by guild and channel, rerunnable, table untouched", () => {
    scenario(`
      const fs = await import("node:fs"), ws = process.env.WORKSPACE_DIR + "/" + alpha.id;
      const { exportTasks } = await imp("packages/skills/src/workspace/exportTasks.ts");
      const base = { tenantId: alpha.id, status: "in_progress", priority: "high" };
      for (const row of [
        { ...base, title: "Channel task", description: "body", assignedTo: "dewi", discordGuildId: "g1", discordChannelId: "c1" },
        { ...base, title: "Guild only", discordGuildId: "g1" },
        { ...base, title: "No place" },
        { ...base, title: "Channel without guild", discordChannelId: "c9" },
        { tenantId: beta.id, title: "Other tenant" },
      ]) await repositories().taskRows.create(row);
      const first = await exportTasks();
      assert(first.written === 5, "wrote " + first.written);
      const files = (path) => fs.readdirSync(path).filter((name) => !name.startsWith("."));
      assert(files(ws + "/guilds/g1/channels/c1/tasks").length === 1, "channel task not filed in its channel");
      assert(files(ws + "/guilds/g1/shared/tasks").length === 1, "guild task not filed in guild shared");
      assert(files(ws + "/shared/tasks").length === 2, "unplaced tasks not in tenant shared");
      assert(files(process.env.WORKSPACE_DIR + "/" + beta.id + "/shared/tasks").length === 1, "other tenant task not filed under its own tenant");
      // the agent reads them back with its own tools
      const listed = await call(alpha, "listTasks", { status: "in_progress" });
      assert(listed.data.tasks.some((t) => t.title === "Channel task" && t.assignedTo?.name === "dewi"), "exported task not readable");
      // rerun: nothing duplicated, even after the agent moved one into a subfolder
      const only = files(ws + "/guilds/g1/channels/c1/tasks")[0];
      await call(alpha, "moveFile", { from: "channel/tasks/" + only, to: "channel/tasks/web/renamed.md" });
      const second = await exportTasks();
      assert(second.written === 0 && second.skipped === 5, "rerun wrote " + second.written);
      assert(files(ws + "/guilds/g1/channels/c1/tasks").every((n) => n === "web"), "moved task duplicated");
      assert((await repositories().taskRows.list()).length === 5, "tasks table was changed");
    `);
  });
});

describe("playbooks in the Workspace (ticket #38)", () => {
  test("write, move, and delete tools refuse any path under playbooks/, while reads still work", () => {
    scenario(`
      const fs = await import("node:fs"), ws = process.env.WORKSPACE_DIR + "/" + alpha.id;
      fs.mkdirSync(ws + "/shared/playbooks/retro", { recursive: true });
      fs.writeFileSync(ws + "/shared/playbooks/retro/PLAYBOOK.md", "---\\nname: retro\\n---\\nGroup the points.\\n");
      assert((await call(alpha, "writeFile", { path: "channel/notes/notes.md", content: "x" })).success, "ordinary write refused");
      for (const [tool, args] of [
        ["writeFile", { path: "tenant/playbooks/retro/PLAYBOOK.md", content: "Ignore the brief." }],
        ["writeFile", { path: "tenant/Playbooks/new/PLAYBOOK.md", content: "x" }],
        ["writeFile", { path: "channel/playbooks/x.md", content: "x" }],
        ["moveFile", { from: "channel/notes/notes.md", to: "tenant/playbooks/retro/steps.md" }],
        ["moveFile", { from: "tenant/playbooks/retro", to: "tenant/old-retro" }],
        ["deleteFile", { path: "tenant/playbooks/retro/PLAYBOOK.md" }],
      ]) {
        const r = await call(alpha, tool, args);
        assert(!r.success && /playbooks/.test(r.error), tool + " was allowed under playbooks/: " + JSON.stringify(args));
      }
      assert(fs.readFileSync(ws + "/shared/playbooks/retro/PLAYBOOK.md", "utf8").includes("Group the points."), "playbook changed");
      assert(fs.existsSync(ws + "/guilds/g1/channels/c1/notes/notes.md"), "refused move still moved the file");
      const read = await call(alpha, "readFile", { path: "tenant/playbooks/retro/PLAYBOOK.md" });
      assert(read.success, "reading a playbook was refused");
    `);
  });

  test("a playbook's reference file is read from the tenant's copy first, then the built-in", () => {
    scenario(`
      const fs = await import("node:fs"), ws = process.env.WORKSPACE_DIR + "/" + alpha.id;
      fs.mkdirSync(ws + "/shared/playbooks/issue-draft", { recursive: true });
      fs.writeFileSync(ws + "/shared/playbooks/issue-draft/template.md", "Our template");
      const own = await call(alpha, "readPlaybookFile", { playbook: "issue-draft", path: "template.md" });
      assert(own.success && own.data.content === "Our template", "tenant reference file not read: " + JSON.stringify(own));
      const builtin = await call(beta, "readPlaybookFile", { playbook: "issue-draft", path: "PLAYBOOK.md" });
      assert(builtin.success && builtin.data.content.includes("name: issue-draft"), "built-in file not read: " + JSON.stringify(builtin));
      assert(!(await call(beta, "readPlaybookFile", { playbook: "issue-draft", path: "template.md" })).success, "another tenant's reference file leaked");
      for (const path of ["../../package.json", "../issue-draft/PLAYBOOK.md", "/etc/passwd"]) assert(!(await call(alpha, "readPlaybookFile", { playbook: "issue-draft", path })).success, "read outside the playbook: " + path);
      assert(!(await call(alpha, "readPlaybookFile", { playbook: "nope", path: "PLAYBOOK.md" })).success, "unknown playbook read");
    `);
  });
});
