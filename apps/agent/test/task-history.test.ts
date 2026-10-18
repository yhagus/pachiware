import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

// A task keeps a History of the field changes made through the bot, and the day it was completed (#250).

const TASKS = "guilds/guild-1/channels/channel-1/tasks";
const task = (f: { id: string; title: string; status?: string; assignee?: string }) =>
  `---\nid: "${f.id}"\ntitle: "${f.title}"\nstatus: "${f.status ?? "pending"}"\npriority: "medium"\nassignedTo: ${f.assignee ? `{"name":"${f.assignee}"}` : "null"}\ndueAt: null\ncreatedBy: "user-alice"\ncreatedByName: "Alice"\ncreatedAt: "2026-03-01T00:00:00.000Z"\nupdatedAt: "2026-03-01T00:00:00.000Z"\n---\nTwo quotes, under 5 million.\n`;

discordScenario("completing a task stamps completedAt and adds a History line with who and when; opening it again clears completedAt and adds another", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(`${TASKS}/venue-aaaaaaaa.md`, task({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Book the venue", assignee: "Dewi" }));

  s.clock.set("2026-03-10T03:05:00Z"); // 10:05 Asia/Jakarta
  s.model.script({ tool: "updateTaskStatus", args: { taskId: "aaaaaaaa", status: "completed" } }, "Done.");
  await s.discord.send(`${s.discord.mention} the venue is booked`);
  let file = (await s.workspace.read(`${TASKS}/venue-aaaaaaaa.md`))!;
  expect(file).toContain('updatedAt: "2026-03-10T03:05:00.000Z"\ncompletedAt: "2026-03-10T03:05:00.000Z"\n---\n');
  expect(file).toContain("Two quotes, under 5 million.\n\n## History\n- 2026-03-10 10:05 Alice: status pending → completed\n");

  s.clock.set("2026-03-11T02:00:00Z");
  s.model.script({ tool: "updateTaskStatus", args: { taskId: "aaaaaaaa", status: "in_progress" } }, "Reopened.");
  await s.discord.send(`${s.discord.mention} actually the venue cancelled, reopen it`, { author: s.discord.bob });
  file = (await s.workspace.read(`${TASKS}/venue-aaaaaaaa.md`))!;
  expect(file).not.toContain("completedAt");
  expect(file).toContain("## History\n- 2026-03-10 10:05 Alice: status pending → completed\n- 2026-03-11 09:00 Bob: status completed → in_progress\n");
});

discordScenario("a reassignment and a new due date are each kept in History, after the Progress notes, and showTask shows the latest lines", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(`${TASKS}/venue-aaaaaaaa.md`, task({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Book the venue", assignee: "Dewi" }));
  s.clock.set("2026-03-10T03:05:00Z");
  s.model.script(
    [{ tool: "addProgressNote", args: { taskId: "aaaaaaaa", text: "Called two venues" } }, { tool: "assignTask", args: { taskId: "aaaaaaaa", assignedTo: "Rina" } }, { tool: "setTaskDueDate", args: { taskId: "aaaaaaaa", dueAt: "2026-03-13" } }],
    "ok",
  );
  await s.discord.send(`${s.discord.mention} called two venues; Rina takes it over, due Friday`);
  const file = (await s.workspace.read(`${TASKS}/venue-aaaaaaaa.md`))!;
  expect(file).toContain("## Progress notes\n- 2026-03-10 Alice: Called two venues\n\n## History\n- 2026-03-10 10:05 Alice: assignee Dewi → Rina\n- 2026-03-10 10:05 Alice: due none → 2026-03-13\n");

  let shown: any;
  s.model.script({ tool: "showTask", args: { taskId: "aaaaaaaa" } }, (turn) => { shown = turn.toolResults[0]; return "ok"; });
  await s.discord.send(`${s.discord.mention} how is the venue going?`);
  expect(shown.history).toEqual(["- 2026-03-10 10:05 Alice: assignee Dewi → Rina", "- 2026-03-10 10:05 Alice: due none → 2026-03-13"]);
  expect(shown.notes).toEqual(["- 2026-03-10 Alice: Called two venues"]);
  expect(shown.completedAt).toBeUndefined();
});

discordScenario("recall names the day a completed task was completed", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  await s.workspace.write(`${TASKS}/loudness-aaaaaaaa.md`, task({ id: "aaaaaaaa-0000-4000-8000-000000000002", title: "Audio normalization to -14 LUFS" }));
  s.clock.set("2026-03-10T03:05:00Z");
  s.model.script({ tool: "updateTaskStatus", args: { taskId: "aaaaaaaa", status: "completed" } }, "Done.");
  await s.discord.send(`${s.discord.mention} normalization is done`);

  let found: any;
  s.model.script({ tool: "recall", args: { queries: ["audio normalization", "normalisasi audio"] } }, (turn) => { found = turn.toolResults[0]; return "ok"; });
  await s.discord.send(`${s.discord.mention} is audio normalization done?`);
  expect(found.tasks[0].label).toContain('Task "Audio normalization to -14 LUFS" (completed 2026-03-10)');
});

// The Assignee is told once (#250): one message per turn pings each member someone else gave a task to.
discordScenario("a task given to another member pings them once with its title and due date; one taken by the asker pings nobody", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.model.script([{ tool: "createTask", args: { title: "Book the venue", assignedTo: "<@user-bob>", dueAt: "2026-10-16" } }, { tool: "createTask", args: { title: "Order the banners", assignedTo: "Bob" } }, { tool: "createTask", args: { title: "Call the caterer", assignedTo: "me" } }], "Three tasks made.");
  await s.discord.send(`${s.discord.mention} buat task: Bob booking venue sampai Jumat, Bob pesan banner, saya telepon katering`);
  const pings = s.discord.botMessages.filter((m) => m.allowedMentions?.users);
  expect(pings).toHaveLength(1);
  expect(pings[0]!.content).toBe("<@user-bob> ada 2 task untukmu:\n- **Book the venue** (tenggat 2026-10-16)\n- **Order the banners**");
  expect(pings[0]!.allowedMentions).toEqual({ users: ["user-bob"] });
});

discordScenario("tasks made from Minutes ping their member Assignees too", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  s.clock.set("2026-10-14T02:00:00Z");
  const [start] = s.discord.history([{ content: "Bob writes the notes by Thursday", author: s.discord.bob, at: s.clock.now() - 60_000 }]);
  s.model.script(JSON.stringify({ title: "Release day", decided: [], open: [], actions: [{ owner: "Bob", task: "Write the release notes", due: "Thursday", ref: 1 }] }));
  await s.discord.contextMenu("Write minutes", start!);
  await s.discord.send("make item 1 a task", { replyTo: s.discord.botMessages.at(-1)! });
  const ping = s.discord.botMessages.filter((m) => m.allowedMentions?.users).at(-1)!;
  expect(ping.content).toBe("<@user-bob> a task is yours:\n- **Write the release notes** (due 2026-10-15)");
});

// taskSummary answers "how is the project going?" with counts per project (#250).
const seeded = (f: { id: string; title: string; status: string; assignee?: string; dueAt?: string; completedAt?: string }) =>
  `---\nid: "${f.id}"\ntitle: "${f.title}"\nstatus: "${f.status}"\npriority: "medium"\nassignedTo: ${f.assignee ? `{"name":"${f.assignee}"}` : "null"}\ndueAt: ${f.dueAt ? `"${f.dueAt}"` : "null"}\ncreatedBy: "user-alice"\ncreatedByName: "Alice"\ncreatedAt: "2026-10-01T00:00:00.000Z"\nupdatedAt: "2026-10-01T00:00:00.000Z"\n${f.completedAt ? `completedAt: "${f.completedAt}"\n` : ""}---\n`;

discordScenario("taskSummary counts pending, in progress, late, due this week and completed last week per project, and who holds the open ones", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  s.clock.set("2026-10-14T02:00:00Z"); // Wednesday 09:00 in Jakarta
  const id = (n: number) => `aaaaaaaa-0000-4000-8000-00000000000${n}`;
  const files: [string, Parameters<typeof seeded>[0]][] = [
    ["a", { id: id(1), title: "Book the venue", status: "pending", assignee: "Dewi", dueAt: "2026-10-10" }],
    ["b", { id: id(2), title: "Print banners", status: "in_progress", assignee: "Dewi", dueAt: "2026-10-16" }],
    ["c", { id: id(3), title: "Write the press release", status: "pending" }],
    ["d", { id: id(4), title: "Pick a caterer", status: "completed", completedAt: "2026-10-12T03:00:00.000Z" }],
    ["e", { id: id(5), title: "Draft the agenda", status: "completed", completedAt: "2026-09-20T03:00:00.000Z" }],
    ["f", { id: id(6), title: "Old idea", status: "cancelled" }],
  ];
  for (const [name, f] of files) await s.workspace.write(`${TASKS}/${name}-${f.id.slice(0, 8)}.md`, seeded(f));
  let result: any;
  s.model.script({ tool: "taskSummary", args: {} }, (turn) => { result = turn.toolResults[0]; return "ok"; });
  await s.discord.send(`${s.discord.mention} how is the project going?`);
  expect(result.projects).toHaveLength(1);
  expect(result.projects[0]).toMatchObject({ pending: 2, inProgress: 1, late: 1, dueThisWeek: 1, completedLastWeek: 1, openByAssignee: { Dewi: 2, unassigned: 1 } });
});
