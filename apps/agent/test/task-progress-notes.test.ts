import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const TASKS = "guilds/guild-1/channels/channel-1/tasks";
/** A task file as it was written before Progress notes existed: the body is the description alone. */
const oldTask = (f: { id: string; title: string; description?: string }) =>
  `---\nid: "${f.id}"\ntitle: "${f.title}"\nstatus: "in_progress"\npriority: "medium"\nassignedTo: {"name":"Bob"}\ndueAt: null\ncreatedBy: "user-alice"\ncreatedByName: "Alice"\ncreatedAt: "2026-03-01T00:00:00.000Z"\nupdatedAt: "2026-03-01T00:00:00.000Z"\n---\n${f.description ?? ""}\n`;

discordScenario("a progress note told to the bot is kept under the task's description with the date and the reporter's name, and moves updatedAt", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(`${TASKS}/venue-aaaaaaaa.md`, oldTask({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Book the venue", description: "Two quotes, under 5 million." }));
  s.clock.set("2026-03-10T03:00:00Z"); // 10:00 Asia/Jakarta

  s.model.script({ tool: "addProgressNote", args: { taskId: "aaaaaaaa", text: "Called two venues, waiting on quotes" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} venue update: called two venues, waiting on quotes`);
  expect(s.discord.botMessages.at(-1)?.content).toBe('Progress note added to "Book the venue".');

  const file = (await s.workspace.read(`${TASKS}/venue-aaaaaaaa.md`))!;
  expect(file).toContain("---\nTwo quotes, under 5 million.\n\n## Progress notes\n- 2026-03-10 Alice: Called two venues, waiting on quotes\n");
  expect(file).toContain('updatedAt: "2026-03-10T03:00:00.000Z"');
  expect(s.discord.botMessages.filter((m) => m.components.length > 0)).toEqual([]);
});

discordScenario("several progress notes from different people keep their order, and each one moves updatedAt", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(`${TASKS}/venue-aaaaaaaa.md`, oldTask({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Book the venue", description: "Two quotes, under 5 million." }));

  s.clock.set("2026-03-10T03:00:00Z");
  s.model.script({ tool: "addProgressNote", args: { taskId: "aaaaaaaa", text: "Called two venues" } }, "Noted.");
  await s.discord.send(`${s.discord.mention} called two venues`);
  expect(await s.workspace.read(`${TASKS}/venue-aaaaaaaa.md`)).toContain('updatedAt: "2026-03-10T03:00:00.000Z"');

  s.clock.set("2026-03-12T09:30:00Z");
  s.model.script({ tool: "addProgressNote", args: { taskId: "aaaaaaaa", text: "Quote from Hotel Mulia is 4.2 million" } }, "Noted.");
  await s.discord.send(`${s.discord.mention} Hotel Mulia quoted 4.2 million`, { author: s.discord.bob });

  const file = (await s.workspace.read(`${TASKS}/venue-aaaaaaaa.md`))!;
  expect(file).toContain('updatedAt: "2026-03-12T09:30:00.000Z"');
  expect(file).toContain("---\nTwo quotes, under 5 million.\n\n## Progress notes\n- 2026-03-10 Alice: Called two venues\n- 2026-03-12 Bob: Quote from Hotel Mulia is 4.2 million\n");
});

/** What a person reads when the bot answers from showTask: the task line, the description, the latest notes, and the count of older ones. */
const detailReply = (r: any) => [r.task, r.description ?? "(no description)", ...r.notes, `older notes: ${r.olderNotes}`].join("\n");

discordScenario("asking about a task with five progress notes shows its line, its description, the three latest notes, and that two are older", async (s) => {
  await s.guildSettings({ useThreads: false });
  const notes = ["- 2026-03-02 Alice: Listed five venues", "- 2026-03-03 Bob: Two are booked that week", "- 2026-03-05 Alice: Visited Hotel Mulia", "- 2026-03-06 Bob: Asked for a discount", "- 2026-03-09 Alice: Waiting on the final quote"];
  await s.workspace.write(`${TASKS}/venue-aaaaaaaa.md`, oldTask({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Book the venue", description: `Two quotes, under 5 million.\n\n## Progress notes\n${notes.join("\n")}` }));

  s.model.script({ tool: "showTask", args: { taskId: "aaaaaaaa" } }, (turn) => detailReply(turn.toolResults[0]));
  await s.discord.send(`${s.discord.mention} where are we on the venue?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe([
    "in_progress | no due date | Bob | aaaaaaaa | Book the venue",
    "Two quotes, under 5 million.",
    "- 2026-03-05 Alice: Visited Hotel Mulia",
    "- 2026-03-06 Bob: Asked for a discount",
    "- 2026-03-09 Alice: Waiting on the final quote",
    "older notes: 2",
  ].join("\n"));
});

discordScenario("asking about a task without progress notes shows its line and description only", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(`${TASKS}/venue-aaaaaaaa.md`, oldTask({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Book the venue", description: "Two quotes, under 5 million." }));

  s.model.script({ tool: "showTask", args: { taskId: "aaaaaaaa" } }, (turn) => detailReply(turn.toolResults[0]));
  await s.discord.send(`${s.discord.mention} what is the venue task?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("in_progress | no due date | Bob | aaaaaaaa | Book the venue\nTwo quotes, under 5 million.\nolder notes: 0");
});

discordScenario("a task created without a description takes a progress note, keeps listing, and its detail view has no description", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.clock.set("2026-03-10T03:00:00Z");
  s.model.script({ tool: "createTask", args: { title: "Print the flyers" } }, (turn) => turn.toolResults[0].task.id.slice(0, 8));
  await s.discord.send(`${s.discord.mention} track printing the flyers`);
  const id = s.discord.botMessages.at(-1)!.content;

  s.model.script({ tool: "addProgressNote", args: { taskId: id, text: "Proof sent to\nthe printer" } }, "Noted.");
  await s.discord.send(`${s.discord.mention} flyers: proof sent to the printer`);

  s.model.script([{ tool: "showTask", args: { taskId: id } }, { tool: "listTasks", args: {} }], (turn) => `${detailReply(turn.toolResults[0])}\n${turn.toolResults[1].tasks.map((t: any) => t.title).join(",")}`);
  await s.discord.send(`${s.discord.mention} how are the flyers?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe(`pending | no due date | unassigned | ${id} | Print the flyers\n(no description)\n- 2026-03-10 Alice: Proof sent to the printer\nolder notes: 0\nPrint the flyers`);
  expect(s.discord.botMessages.filter((m) => m.components.length > 0)).toEqual([]);
});
