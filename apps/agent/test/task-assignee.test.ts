import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const TASKS = "guilds/guild-1/channels/channel-1/tasks";
const contextOf = (call: { role: string; content: unknown }[]) => String(call.findLast((m) => m.role === "user")?.content);
/** A task file as it was written before assignees were structured: `assignedTo` holds plain text. */
const legacyTask = (f: { id: string; title: string; assignedTo: string | null; status?: string }) =>
  `---\nid: "${f.id}"\ntitle: "${f.title}"\nstatus: "${f.status ?? "pending"}"\npriority: "medium"\nassignedTo: ${JSON.stringify(f.assignedTo)}\ndueAt: null\ncreatedBy: "user-alice"\ncreatedByName: "Alice"\ncreatedAt: "2026-03-01T00:00:00.000Z"\nupdatedAt: "2026-03-01T00:00:00.000Z"\n---\nBring the signed copy.\n`;

discordScenario("an old-format task file with a plain-text assignee lists under the assignee column, filters by name in any case, and links the member of that name on its next change", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(`${TASKS}/contract-aaaaaaaa.md`, legacyTask({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Sign the contract", assignedTo: "Bob" }));
  await s.workspace.write(`${TASKS}/venue-bbbbbbbb.md`, legacyTask({ id: "bbbbbbbb-0000-4000-8000-000000000002", title: "Book the venue", assignedTo: null }));

  s.model.script({ tool: "listTasks", args: { assignedTo: "bob" } }, (turn) => turn.toolResults[0].tasks.map((t: any) => t.title).join(", ") || "none");
  await s.discord.send(`${s.discord.mention} what is Bob on?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Sign the contract");
  const context = contextOf(s.model.calls.at(-2)!);
  expect(context).toContain("Active tasks (status | due | assignee | id | title):");
  expect(context).toContain("pending | no due date | Bob | aaaaaaaa | Sign the contract");
  expect(context).toContain("pending | no due date | unassigned | bbbbbbbb | Book the venue");

  s.model.script({ tool: "updateTaskStatus", args: { taskId: "aaaaaaaa", status: "in_progress" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} Bob started on the contract`);
  expect(s.discord.botMessages.at(-1)?.content).toBe('Task "Sign the contract" status changed to in_progress.');
  const file = (await s.workspace.read(`${TASKS}/contract-aaaaaaaa.md`))!;
  expect(file).toContain('status: "in_progress"');
  expect(file).toContain('assignedTo: {"id":"user-bob","name":"Bob"}');
  expect(file).toContain("Bring the signed copy.");

  s.model.script("ok");
  await s.discord.send(`${s.discord.mention} thanks`);
  expect(contextOf(s.model.calls.at(-1)!)).toContain("in_progress | no due date | Bob | aaaaaaaa | Sign the contract");
});

discordScenario("a task created and then assigned through chat stores a name-only assignee, and its task line shows that name", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.model.script({ tool: "createTask", args: { title: "Print the flyers", assignedTo: "Dewi" } }, (turn) => turn.toolResults[0].task.id.slice(0, 8));
  await s.discord.send(`${s.discord.mention} Dewi prints the flyers`);
  const id = s.discord.botMessages.at(-1)!.content;
  const [path] = (await s.workspace.list(TASKS)).filter((p) => p.endsWith(".md"));
  expect(await s.workspace.read(path!)).toContain('assignedTo: {"name":"Dewi"}');

  s.model.script({ tool: "assignTask", args: { taskId: id, assignedTo: "Pak Budi" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} give the flyers to Pak Budi`);
  expect(s.discord.botMessages.at(-1)?.content).toStartWith('Task "Print the flyers" assigned to @Pak Budi.');
  expect(await s.workspace.read(path!)).toContain('assignedTo: {"name":"Pak Budi"}');

  s.model.script("ok");
  await s.discord.send(`${s.discord.mention} thanks`);
  expect(contextOf(s.model.calls.at(-1)!)).toContain(`pending | no due date | Pak Budi | ${id} | Print the flyers`);
  expect(s.discord.botMessages.filter((m) => m.components.length > 0)).toEqual([]);
});

discordScenario("a member assignee in a task file shows their name and is found by their mention, their id, or their name", async (s) => {
  await s.guildSettings({ useThreads: false });
  const bob = s.discord.bob;
  await s.workspace.write(`${TASKS}/deck-cccccccc.md`, legacyTask({ id: "cccccccc-0000-4000-8000-000000000003", title: "Draft the deck", assignedTo: null }).replace("assignedTo: null", `assignedTo: {"id":"${bob.id}","name":"Bob"}`));
  await s.workspace.write(`${TASKS}/other-dddddddd.md`, legacyTask({ id: "dddddddd-0000-4000-8000-000000000004", title: "Someone else's", assignedTo: "Dewi" }));

  s.model.script(
    [{ tool: "listTasks", args: { assignedTo: `<@${bob.id}>` } }, { tool: "listTasks", args: { assignedTo: bob.id } }, { tool: "listTasks", args: { assignedTo: "BOB" } }],
    (turn) => turn.toolResults.map((r: any) => r.tasks.map((t: any) => `${t.title}:${t.assignedTo.name}`).join(",")).join(" / "),
  );
  await s.discord.send(`${s.discord.mention} what is Bob on?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Draft the deck:Bob / Draft the deck:Bob / Draft the deck:Bob");
  expect(contextOf(s.model.calls.at(-2)!)).toContain("pending | no due date | Bob | cccccccc | Draft the deck");

  s.model.script({ tool: "updateTaskStatus", args: { taskId: "cccccccc", status: "completed" } }, "Done.");
  await s.discord.send(`${s.discord.mention} the deck is done`);
  expect(await s.workspace.read(`${TASKS}/deck-cccccccc.md`)).toContain(`assignedTo: {"id":"${bob.id}","name":"Bob"}`);
});
