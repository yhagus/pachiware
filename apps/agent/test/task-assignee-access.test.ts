import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const TASKS = "guilds/guild-1/channels/channel-1/tasks";
const FILE = `${TASKS}/flyers-aaaaaaaa.md`;
const ID = "aaaaaaaa-0000-4000-8000-000000000001";
const taskFile = (assignedTo: unknown = null) =>
  `---\nid: "${ID}"\ntitle: "Print the flyers"\nstatus: "pending"\npriority: "medium"\nassignedTo: ${JSON.stringify(assignedTo)}\ndueAt: null\ncreatedBy: "user-alice"\ncreatedByName: "Alice"\ncreatedAt: "2026-03-01T00:00:00.000Z"\nupdatedAt: "2026-03-01T00:00:00.000Z"\n---\nTwo hundred copies.\n`;
const lastResult = (turn: { toolResults: any[] }) => JSON.stringify(turn.toolResults.at(-1));

discordScenario("assigning a task to a member who cannot view its channel fails and names the channel and both ways out", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.channel("channel-1").name = "launch";
  s.discord.deny("channel-1", s.discord.bob.id, ["ViewChannel"]);
  await s.workspace.write(FILE, taskFile());
  const before = await s.workspace.read(FILE);
  s.model.script({ tool: "assignTask", args: { taskId: "aaaaaaaa", assignedTo: `<@${s.discord.bob.id}>` } }, lastResult);
  await s.discord.send(`${s.discord.mention} give the flyers to <@${s.discord.bob.id}>`);
  const { error } = JSON.parse(s.discord.botMessages.at(-1)!.content);
  expect(error).toContain("Bob");
  expect(error).toContain("#launch");
  expect(error).toMatch(/add (them|Bob) to #launch/i);
  expect(error).toMatch(/assign someone else/i);
  expect(await s.workspace.read(FILE)).toBe(before);
  expect(s.discord.botMessages.filter((m) => m.components.length > 0)).toEqual([]);
});

discordScenario("creating a task for a member who cannot view the channel files nothing", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.channel("channel-1").name = "launch";
  s.discord.deny("channel-1", s.discord.bob.id, ["ViewChannel"]);
  s.model.script({ tool: "createTask", args: { title: "Book the venue", assignedTo: `<@${s.discord.bob.id}>` } }, lastResult);
  await s.discord.send(`${s.discord.mention} <@${s.discord.bob.id}> books the venue`);
  const { error } = JSON.parse(s.discord.botMessages.at(-1)!.content);
  expect(error).toContain("#launch");
  expect(error).toMatch(/assign someone else/i);
  expect(await s.workspace.list(TASKS)).toEqual([]);
});

discordScenario("assigning a member who can view the channel works as before, though someone else is denied", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.deny("channel-1", s.discord.bob.id, ["ViewChannel"]);
  await s.workspace.write(FILE, taskFile());
  s.model.script({ tool: "assignTask", args: { taskId: "aaaaaaaa", assignedTo: "me" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} I'll print the flyers`);
  expect(s.discord.botMessages.at(-1)?.content).toBe('Task "Print the flyers" assigned to @Alice.');
  expect(await s.workspace.read(FILE)).toContain(`assignedTo: {"id":"${s.discord.alice.id}","name":"Alice"}`);
});

discordScenario("a name-only assignee is never refused for access", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.deny("channel-1", s.discord.bob.id, ["ViewChannel"]);
  await s.workspace.write(FILE, taskFile());
  s.model.script({ tool: "assignTask", args: { taskId: "aaaaaaaa", assignedTo: "Dewi" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} Dewi prints the flyers`);
  expect(s.discord.botMessages.at(-1)?.content).toStartWith('Task "Print the flyers" assigned to @Dewi.');
  expect(await s.workspace.read(FILE)).toContain('assignedTo: {"name":"Dewi"}');
});

discordScenario("a name-only assignee is linked to a member only when that member can view the channel", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.deny("channel-1", s.discord.bob.id, ["ViewChannel"]);
  await s.workspace.write(FILE, taskFile("Bob"));
  s.model.script({ tool: "setTaskDueDate", args: { taskId: "aaaaaaaa", dueAt: "2026-03-10" } }, lastResult);
  await s.discord.send(`${s.discord.mention} the flyers are due on the 10th`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content).success).toBe(true);
  const file = await s.workspace.read(FILE);
  expect(file).toContain('dueAt: "2026-03-10"');
  expect(file).toContain('assignedTo: {"name":"Bob"}');

  await s.workspace.write(FILE, taskFile("Alice"));
  s.model.script({ tool: "setTaskDueDate", args: { taskId: "aaaaaaaa", dueAt: "2026-03-11" } }, lastResult);
  await s.discord.send(`${s.discord.mention} make it the 11th`);
  expect(await s.workspace.read(FILE)).toContain(`assignedTo: {"id":"${s.discord.alice.id}","name":"Alice"}`);
});

discordScenario("a task in a thread is checked against the thread's parent channel", async (s) => {
  s.discord.channel("channel-1").name = "launch";
  const thread = s.discord.channel("thread-1", { thread: true, parentId: "channel-1", private: true, members: [s.discord.alice.id] });
  await s.workspace.write(FILE, taskFile());

  // Bob can view #launch but was never added to the private thread: the parent decides, so he can be assigned.
  s.model.script({ tool: "assignTask", args: { taskId: "aaaaaaaa", assignedTo: `<@${s.discord.bob.id}>` } }, lastResult);
  await s.discord.send(`${s.discord.mention} give the flyers to <@${s.discord.bob.id}>`, { channel: thread });
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content).success).toBe(true);
  expect(await s.workspace.read(FILE)).toContain(`assignedTo: {"id":"${s.discord.bob.id}","name":"Bob"}`);

  s.discord.history([{ content: "hi", author: { id: "user-carol", name: "Carol" } }]);
  s.discord.deny("channel-1", "user-carol", ["ViewChannel"]);
  const before = await s.workspace.read(FILE);
  s.model.script({ tool: "assignTask", args: { taskId: "aaaaaaaa", assignedTo: "<@user-carol>" } }, lastResult);
  await s.discord.send(`${s.discord.mention} give the flyers to <@user-carol>`, { channel: thread });
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content).error).toContain("#launch");
  expect(await s.workspace.read(FILE)).toBe(before);
});
