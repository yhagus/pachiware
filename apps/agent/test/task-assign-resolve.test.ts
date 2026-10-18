import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const TASKS = "guilds/guild-1/channels/channel-1/tasks";
const FILE = `${TASKS}/flyers-aaaaaaaa.md`;
const ID = "aaaaaaaa-0000-4000-8000-000000000001";
/** A task file; `assignedTo` is written as given, so a string is the plain-text format from before assignees were structured. */
const taskFile = (assignedTo: unknown = null, title = "Print the flyers") =>
  `---\nid: "${ID}"\ntitle: "${title}"\nstatus: "pending"\npriority: "medium"\nassignedTo: ${JSON.stringify(assignedTo)}\ndueAt: null\ncreatedBy: "user-alice"\ncreatedByName: "Alice"\ncreatedAt: "2026-03-01T00:00:00.000Z"\nupdatedAt: "2026-03-01T00:00:00.000Z"\n---\nTwo hundred copies.\n`;
type Sent = { discord: { botMessages: { content: string; components: unknown[]; allowedMentions?: { users?: string[] } }[] } };
/** No Confirm button, and no ping but the one a member gets when someone else gives them a task (#250): `pinged` in order. */
const noConfirmNoPing = (s: Sent, pinged: string[] = []) => {
  expect(s.discord.botMessages.filter((m) => m.components.length > 0)).toEqual([]);
  expect(s.discord.botMessages.flatMap((m) => m.allowedMentions?.users ?? [])).toEqual(pinged);
};
/** The bot's last message that is not an Assignee's ping. */
const reply = (s: Sent) => s.discord.botMessages.filter((m) => !m.allowedMentions?.users).at(-1);

discordScenario("assigning a task by mention stores the member's id and display name", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(FILE, taskFile());
  s.model.script({ tool: "assignTask", args: { taskId: "aaaaaaaa", assignedTo: `<@${s.discord.bob.id}>` } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} give the flyers to <@${s.discord.bob.id}>`);
  expect(reply(s)?.content).toBe('Task "Print the flyers" assigned to @Bob.');
  expect(await s.workspace.read(FILE)).toContain(`assignedTo: {"id":"${s.discord.bob.id}","name":"Bob"}`);
  noConfirmNoPing(s, [s.discord.bob.id]);
});

discordScenario("assigning a task to \"me\" or \"saya\" stores the asker", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(FILE, taskFile());
  s.model.script({ tool: "assignTask", args: { taskId: "aaaaaaaa", assignedTo: "me" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} I'll print the flyers`);
  expect(reply(s)?.content).toBe('Task "Print the flyers" assigned to @Alice.');
  expect(await s.workspace.read(FILE)).toContain(`assignedTo: {"id":"${s.discord.alice.id}","name":"Alice"}`);

  s.model.script({ tool: "assignTask", args: { taskId: "aaaaaaaa", assignedTo: "Saya" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} flyernya saya yang cetak`, { author: s.discord.bob });
  expect(await s.workspace.read(FILE)).toContain(`assignedTo: {"id":"${s.discord.bob.id}","name":"Bob"}`);
  noConfirmNoPing(s);
});

discordScenario("a name matching one member by display name or username, in any letter case, links that member", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.history([{ content: "hi all", author: { id: "user-dewi", name: "Dewi Lestari", username: "dewil" } }]);
  await s.workspace.write(FILE, taskFile());
  s.model.script({ tool: "assignTask", args: { taskId: "aaaaaaaa", assignedTo: "bob" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} give the flyers to bob`);
  expect(reply(s)?.content).toBe('Task "Print the flyers" assigned to @Bob.');
  expect(await s.workspace.read(FILE)).toContain(`assignedTo: {"id":"${s.discord.bob.id}","name":"Bob"}`);

  s.model.script({ tool: "assignTask", args: { taskId: "aaaaaaaa", assignedTo: "DEWIL" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} actually DEWIL does them`);
  expect(reply(s)?.content).toBe('Task "Print the flyers" assigned to @Dewi Lestari.');
  expect(await s.workspace.read(FILE)).toContain('assignedTo: {"id":"user-dewi","name":"Dewi Lestari"}');
  noConfirmNoPing(s, [s.discord.bob.id, "user-dewi"]);
});

discordScenario("a name matching two members changes nothing and returns both candidates, for assignTask and createTask", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.history([
    { content: "morning", author: { id: "user-sari-a", name: "Sari", username: "sari.design" } },
    { content: "pagi", author: { id: "user-sari-b", name: "Sari Wulan", username: "sari" } },
  ]);
  await s.workspace.write(FILE, taskFile("Dewi"));
  const before = await s.workspace.read(FILE);
  s.model.script({ tool: "assignTask", args: { taskId: "aaaaaaaa", assignedTo: "sari" } }, (turn) => JSON.stringify(turn.toolResults[0]));
  await s.discord.send(`${s.discord.mention} give the flyers to Sari`);
  const result = JSON.parse(reply(s)!.content);
  expect(result.success).toBe(false);
  expect(result.candidates.map((c: any) => c.id).sort()).toEqual(["user-sari-a", "user-sari-b"]);
  expect(result.message).toContain("Sari Wulan");
  expect(await s.workspace.read(FILE)).toBe(before);

  s.model.script({ tool: "createTask", args: { title: "Book the venue", assignedTo: "Sari" } }, (turn) => String(turn.toolResults[0].candidates.length));
  await s.discord.send(`${s.discord.mention} Sari books the venue`);
  expect(reply(s)?.content).toBe("2");
  expect((await s.workspace.list(TASKS)).filter((p) => p.endsWith(".md"))).toEqual([FILE]);
  noConfirmNoPing(s);
});

discordScenario("an unknown name is stored as a name only and the tool result says so", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(FILE, taskFile());
  s.model.script({ tool: "assignTask", args: { taskId: "aaaaaaaa", assignedTo: "Pak Budi" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} the printer, Pak Budi, has the flyers`);
  expect(reply(s)?.content).toMatch(/^Task "Print the flyers" assigned to @Pak Budi\. Pak Budi was recorded by name only/);
  expect(await s.workspace.read(FILE)).toContain('assignedTo: {"name":"Pak Budi"}');

  s.model.script({ tool: "createTask", args: { title: "Send the invoice", assignedTo: "Vendor Co" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} Vendor Co sends the invoice`);
  expect(reply(s)?.content).toContain("Vendor Co was recorded by name only");
  noConfirmNoPing(s);
});

discordScenario("an old-format task assigned to a member's exact name is linked to that member when any field of it changes", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(FILE, taskFile("bob"));
  s.model.script({ tool: "setTaskDueDate", args: { taskId: "aaaaaaaa", dueAt: "2026-03-20" } }, "Done.");
  await s.discord.send(`${s.discord.mention} flyers are due on the 20th`);
  expect(await s.workspace.read(FILE)).toContain(`assignedTo: {"id":"${s.discord.bob.id}","name":"Bob"}`);
  noConfirmNoPing(s);
});

discordScenario("an old-format name-only assignee matching several members stays a name when the task changes", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.history([
    { content: "morning", author: { id: "user-sari-a", name: "Sari" } },
    { content: "pagi", author: { id: "user-sari-b", name: "Sari W", username: "sari" } },
  ]);
  await s.workspace.write(FILE, taskFile("Sari"));
  s.model.script({ tool: "updateTaskStatus", args: { taskId: "aaaaaaaa", status: "in_progress" } }, "Done.");
  await s.discord.send(`${s.discord.mention} flyers started`);
  expect(await s.workspace.read(FILE)).toContain('assignedTo: {"name":"Sari"}');
});

discordScenario("filtering by assignee finds a member's tasks by mention, display name, or username", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.history([{ content: "hi", author: { id: "user-dewi", name: "Dewi Lestari", username: "dewil" } }]);
  await s.workspace.write(FILE, taskFile({ id: "user-dewi", name: "Dewi" }));
  await s.workspace.write(`${TASKS}/other-bbbbbbbb.md`, taskFile("Bob", "Book the venue").replace(ID, "bbbbbbbb-0000-4000-8000-000000000002"));
  s.model.script(
    ["<@user-dewi>", "dewi lestari", "DewiL"].map((assignedTo) => ({ tool: "listTasks", args: { assignedTo } })),
    (turn) => turn.toolResults.map((r: any) => r.tasks.map((t: any) => t.title).join(",") || "none").join(" / "),
  );
  await s.discord.send(`${s.discord.mention} what is Dewi on?`);
  expect(reply(s)?.content).toBe("Print the flyers / Print the flyers / Print the flyers");
});
