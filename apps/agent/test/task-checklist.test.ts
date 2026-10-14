import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const TASKS = "guilds/guild-1/channels/channel-1/tasks";
const LAUNCH = `${TASKS}/launch-aaaaaaaa.md`;
const taskFile = (f: { id: string; title: string; description?: string; dueAt?: string | null; assignedTo?: string }) =>
  `---\nid: "${f.id}"\ntitle: "${f.title}"\nstatus: "in_progress"\npriority: "medium"\nassignedTo: ${f.assignedTo ? JSON.stringify({ name: f.assignedTo }) : "null"}\ndueAt: ${JSON.stringify(f.dueAt ?? null)}\ncreatedBy: "user-alice"\ncreatedByName: "Alice"\ncreatedAt: "2026-03-01T00:00:00.000Z"\nupdatedAt: "2026-03-01T00:00:00.000Z"\n---\n${f.description ?? ""}\n`;
/** Two of five done. */
const CHECKLIST = "Steps for the launch.\n\n- [x] Book the venue\n- [ ] Send the invitations\n- [x] Order the banner\n- [ ] Brief the speakers\n- [ ] Print the badges";
const launch = (f: { description?: string; dueAt?: string } = {}) => taskFile({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Plan the launch", description: f.description ?? CHECKLIST, dueAt: f.dueAt, assignedTo: "Dewi" });

discordScenario("ticking a checklist item by its text marks it done in the file and moves updatedAt; unticking reverses it", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(LAUNCH, launch());
  s.clock.set("2026-03-10T03:00:00Z");

  s.model.script({ tool: "tickChecklistItem", args: { taskId: "aaaaaaaa", item: "send the invitations" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} invitations are out`);
  let file = (await s.workspace.read(LAUNCH))!;
  expect(file).toContain("---\nSteps for the launch.\n\n- [x] Book the venue\n- [x] Send the invitations\n- [x] Order the banner\n- [ ] Brief the speakers\n- [ ] Print the badges\n");
  expect(file).toContain('updatedAt: "2026-03-10T03:00:00.000Z"');
  expect(s.discord.botMessages.at(-1)?.content).toContain("Send the invitations");

  s.clock.set("2026-03-11T03:00:00Z");
  s.model.script({ tool: "tickChecklistItem", args: { taskId: "aaaaaaaa", item: "Book the venue", done: false } }, "Unticked.");
  await s.discord.send(`${s.discord.mention} the venue cancelled on us, untick it`);
  file = (await s.workspace.read(LAUNCH))!;
  expect(file).toContain("\n- [ ] Book the venue\n");
  expect(file).toContain('updatedAt: "2026-03-11T03:00:00.000Z"');
  expect(s.discord.botMessages.filter((m) => m.components.length > 0)).toEqual([]);
});

discordScenario("ticking by position ticks that item; an item that does not exist is refused and the file stays as it was", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(LAUNCH, launch());
  s.clock.set("2026-03-10T03:00:00Z");

  s.model.script({ tool: "tickChecklistItem", args: { taskId: "aaaaaaaa", item: "4" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} tick item 4 on the launch`);
  expect(await s.workspace.read(LAUNCH)).toContain("\n- [x] Brief the speakers\n- [ ] Print the badges\n");
  expect(s.discord.botMessages.at(-1)?.content).toBe('Ticked "Brief the speakers" on "Plan the launch" (3/5).');

  const before = await s.workspace.read(LAUNCH);
  s.clock.set("2026-03-11T03:00:00Z");
  s.model.script(
    [{ tool: "tickChecklistItem", args: { taskId: "aaaaaaaa", item: "9" } }, { tool: "tickChecklistItem", args: { taskId: "aaaaaaaa", item: "rent the projector" } }, { tool: "tickChecklistItem", args: { taskId: "aaaaaaaa", item: "the b" } }],
    (turn) => turn.toolResults.map((r: any) => r.error).join("\n"),
  );
  await s.discord.send(`${s.discord.mention} tick item 9, the projector, and the b one`);
  expect(await s.workspace.read(LAUNCH)).toBe(before);
  expect(s.discord.botMessages.at(-1)?.content).toBe([
    "There is no checklist item 9: the checklist has 5 items.",
    'No checklist item matches "rent the projector".',
    '"the b" matches several checklist items: "Order the banner", "Print the badges". Name one by its position.',
  ].join("\n"));
});

const contextOf = (call: { role: string; content: unknown }[]) => String(call.findLast((m) => m.role === "user")?.content);
const TIDY = `${TASKS}/tidy-bbbbbbbb.md`;
const tidy = (dueAt?: string) => taskFile({ id: "bbbbbbbb-0000-4000-8000-000000000002", title: "Tidy the drive", description: "Old exports go to the archive.", dueAt });

discordScenario("a task with two of five items done ends its title with (2/5) in a task list and in the turn context; a task without a checklist has no suffix", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(LAUNCH, launch());
  await s.workspace.write(TIDY, tidy());

  s.model.script({ tool: "listTasks", args: {} }, (turn) => turn.toolResults[0].tasks.map((t: any) => t.line).sort().join("\n"));
  await s.discord.send(`${s.discord.mention} what are the tasks here?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe([
    "in_progress | no due date | Dewi | aaaaaaaa | Plan the launch (2/5)",
    "in_progress | no due date | unassigned | bbbbbbbb | Tidy the drive",
  ].join("\n"));
  const context = contextOf(s.model.calls.at(-2)!);
  expect(context).toContain("in_progress | no due date | Dewi | aaaaaaaa | Plan the launch (2/5)\n");
  expect(context).toContain("in_progress | no due date | unassigned | bbbbbbbb | Tidy the drive");
  expect(context).not.toContain("Tidy the drive (");
});

/** Posts the scheduler made on its own: not a reply, and nobody pinged. */
const digests = (s: any) => s.discord.botMessages.filter((m: any) => !m.reference && m.allowedMentions && !m.allowedMentions.users);

discordScenario("the Digest ends a task's title with its checklist progress, and leaves a task without a checklist bare", async (s) => {
  s.clock.set("2026-03-06T20:00:00+07:00");
  await s.workspace.write(LAUNCH, launch({ dueAt: "2026-03-07" }));
  await s.workspace.write(TIDY, tidy("2026-03-06"));
  await s.guildSettings({ useThreads: false, language: "en", digestChannels: [{ channelId: "channel-1", hour: 8 }] });

  s.clock.set("2026-03-07T08:00:30+07:00");
  await s.scheduler.tick();
  expect(digests(s).at(-1)?.content).toBe([
    "**Due today**",
    "in_progress | due 2026-03-07 | Dewi | aaaaaaaa | Plan the launch (2/5)",
    "**Late**",
    "in_progress | due 2026-03-06, late | unassigned | bbbbbbbb | Tidy the drive · 1 day late",
  ].join("\n"));
});

discordScenario("the detail view shows every checklist item with its state and position, and its line carries the progress", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(LAUNCH, launch({ description: `${CHECKLIST}\n\n## Progress notes\n- 2026-03-02 Alice: Venue booked` }));
  await s.workspace.write(TIDY, tidy());

  s.model.script(
    [{ tool: "showTask", args: { taskId: "aaaaaaaa" } }, { tool: "showTask", args: { taskId: "bbbbbbbb" } }],
    (turn) => turn.toolResults.map((r: any) => [r.task, ...r.checklist].join("\n")).join("\n--\n"),
  );
  await s.discord.send(`${s.discord.mention} where are the launch and the drive at?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe([
    "in_progress | no due date | Dewi | aaaaaaaa | Plan the launch (2/5)",
    "1. [x] Book the venue",
    "2. [ ] Send the invitations",
    "3. [x] Order the banner",
    "4. [ ] Brief the speakers",
    "5. [ ] Print the badges",
    "--",
    "in_progress | no due date | unassigned | bbbbbbbb | Tidy the drive",
  ].join("\n"));
});
