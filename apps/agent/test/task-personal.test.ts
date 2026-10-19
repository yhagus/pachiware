import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const PERSONAL = "dms/user-alice/tasks";
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const taskFile = (n: number, title: string, assignedTo: unknown = null) =>
  `---\nid: "${id(n)}"\ntitle: ${JSON.stringify(title)}\nstatus: "pending"\npriority: "medium"\nassignedTo: ${JSON.stringify(assignedTo)}\ndueAt: null\ncreatedBy: "user-alice"\ncreatedByName: "Alice"\ncreatedAt: "2026-10-01T00:00:${String(n).padStart(2, "0")}.000Z"\nupdatedAt: "2026-10-01T00:00:00.000Z"\n---\n`;
const contextOf = (call: { role: string; content: unknown }[]) => String(call.findLast((m) => m.role === "user")?.content);
const lastResult = (turn: { toolResults: any[] }) => JSON.stringify(turn.toolResults.at(-1));
const titles = (turn: { toolResults: any[] }) => turn.toolResults.at(-1).tasks.map((t: any) => t.title).join(", ") || "none";
const files = async (s: Scenario, folder: string) => (await s.workspace.list(folder)).filter((p) => p.endsWith(".md"));

discordScenario("a task created in a DM is a Personal task: kept in the person's DM folder and not listed from a guild channel", async (s) => {
  await s.guildSettings({ useThreads: false });
  const dm = s.discord.channel("dm-alice", { dm: true });
  s.model.script({ tool: "createTask", args: { title: "Call the dentist" } }, lastResult);
  await s.discord.send("task: call the dentist", { channel: dm });
  const [path] = await files(s, PERSONAL);
  expect(await s.workspace.read(path!)).toContain('title: "Call the dentist"');
  expect(await files(s, "guilds/guild-1/channels/channel-1/tasks")).toEqual([]);

  s.model.script({ tool: "listTasks", args: {} }, titles);
  await s.discord.send(`${s.discord.mention} what tasks are open here?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("none");
  expect(contextOf(s.model.calls.at(-1)!)).not.toContain("Call the dentist");
});

discordScenario("the turn context in a DM lists the person's Personal tasks only, not tenant-wide or project tasks", async (s) => {
  const dm = s.discord.channel("dm-alice", { dm: true });
  await s.workspace.write(`${PERSONAL}/dentist.md`, taskFile(1, "Call the dentist"));
  await s.workspace.write("shared/tasks/audit.md", taskFile(2, "Tenant-wide audit"));
  await s.workspace.write("guilds/guild-1/channels/channel-1/tasks/flyers.md", taskFile(3, "Print the flyers", { id: "user-alice", name: "Alice" }));
  await s.workspace.write("dms/user-bob/tasks/gym.md", taskFile(4, "Bob's gym"));
  s.model.script("ok");
  await s.discord.send("what's on today?", { channel: dm });
  const context = contextOf(s.model.calls[0]!);
  expect(context).toContain("Call the dentist");
  expect(context).not.toContain("Tenant-wide audit");
  expect(context).not.toContain("Print the flyers");
  expect(context).not.toContain("Bob's gym");

  s.model.script({ tool: "listTasks", args: {} }, titles);
  await s.discord.send("list my tasks", { channel: dm });
  expect(s.discord.botMessages.at(-1)?.content).toBe("Call the dentist");
});

/** A scoped list as a person would read it: one line per group, then how many tasks there are in all. */
const plan = (turn: { toolResults: any[] }) => {
  const r = turn.toolResults.at(-1);
  if (r.error) return `error: ${r.error}`;
  return [...r.groups.map((g: any) => `${g.group}: ${g.tasks.map((t: any) => t.title).join(", ")}`), `${r.groups.reduce((n: number, g: any) => n + g.tasks.length, 0)} of ${r.total}`].join("\n");
};

discordScenario("mine from a guild channel includes the asker's Personal tasks as their own group, and nobody else's", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.channel("channel-1").name = "launch";
  await s.workspace.write("guilds/guild-1/channels/channel-1/tasks/flyers.md", taskFile(1, "Print the flyers", { id: "user-alice", name: "Alice" }));
  await s.workspace.write(`${PERSONAL}/dentist.md`, taskFile(2, "Call the dentist"));
  await s.workspace.write(`${PERSONAL}/plumber.md`, taskFile(3, "Fix the sink", { name: "Dewi" }));
  await s.workspace.write("dms/user-bob/tasks/gym.md", taskFile(4, "Bob's gym", { id: "user-bob", name: "Bob" }));

  s.model.script({ tool: "listTasks", args: { scope: "mine" } }, plan);
  await s.discord.send(`${s.discord.mention} what's on my plate?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("#launch: Print the flyers\nPersonal tasks: Call the dentist, Fix the sink\n3 of 3");

  s.model.script({ tool: "listTasks", args: { scope: "mine" } }, plan);
  await s.discord.send(`${s.discord.mention} what's on my plate?`, { author: s.discord.bob });
  expect(s.discord.botMessages.at(-1)?.content).toBe("Personal tasks: Bob's gym\n1 of 1");
});

discordScenario("delegated leaves out the asker's Personal tasks, even one recorded for someone by name", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.channel("channel-1").name = "launch";
  await s.workspace.write("guilds/guild-1/channels/channel-1/tasks/badges.md", taskFile(1, "Order the badges", { id: "user-bob", name: "Bob" }));
  await s.workspace.write(`${PERSONAL}/plumber.md`, taskFile(2, "Fix the sink", { name: "Dewi" }));

  s.model.script({ tool: "listTasks", args: { scope: "delegated" } }, plan);
  await s.discord.send(`${s.discord.mention} what did I hand out?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("#launch: Order the badges\n1 of 1");
});

discordScenario("mine in a DM lists the person's Personal tasks as their own group", async (s) => {
  const dm = s.discord.channel("dm-alice", { dm: true });
  await s.workspace.write(`${PERSONAL}/dentist.md`, taskFile(2, "Call the dentist"));
  s.model.script({ tool: "listTasks", args: { scope: "mine" } }, plan);
  await s.discord.send("what's on my plate?", { channel: dm });
  expect(s.discord.botMessages.at(-1)?.content).toBe("Personal tasks: Call the dentist\n1 of 1");
});

discordScenario("from a DM a person files a task into a project by naming its channel, as its creator", async (s) => {
  const dm = s.discord.channel("dm-alice", { dm: true });
  s.discord.channel("channel-2").name = "laporan-q4";
  const TASKS = "guilds/guild-1/channels/channel-2/tasks";

  s.model.script({ tool: "createTask", args: { title: "Draft the Q4 report", channel: "#laporan-q4", assignedTo: "bob" } }, lastResult);
  await s.discord.send("catat di #laporan-q4: draft the Q4 report, for Bob", { channel: dm });
  expect(JSON.parse(s.discord.botMessages.filter((m) => m.channelId === dm.id).at(-1)!.content).success).toBe(true);
  // Bob is told in #laporan-q4, where the task is and he can view it, not in the DM (#260).
  expect(s.discord.botMessages.filter((m) => m.allowedMentions?.users?.length).map((m) => [m.channelId, m.allowedMentions!.users])).toEqual([["channel-2", ["user-bob"]]]);
  const [path] = await files(s, TASKS);
  const file = (await s.workspace.read(path!))!;
  expect(file).toContain('title: "Draft the Q4 report"');
  expect(file).toContain('createdBy: "user-alice"');
  expect(file).toContain('assignedTo: {"id":"user-bob","name":"Bob"}');
  expect(await files(s, PERSONAL)).toEqual([]);

  s.model.script({ tool: "createTask", args: { title: "Collect the receipts", channel: "<#channel-2>" } }, lastResult);
  await s.discord.send("file in <#channel-2>: collect the receipts", { channel: dm });
  expect(await files(s, TASKS)).toHaveLength(2);
  expect(s.discord.botMessages.filter((m) => m.components.length > 0)).toEqual([]);

  s.model.script({ tool: "listTasks", args: {} }, titles);
  await s.discord.send(`${s.discord.mention} tasks?`, { channel: "channel-2" });
  expect(s.discord.botMessages.at(-1)?.content).toContain("Draft the Q4 report");
});

discordScenario("filing from a DM into a channel the person cannot view, or one that does not exist, is refused and creates nothing", async (s) => {
  const dm = s.discord.channel("dm-alice", { dm: true });
  s.discord.channel("channel-2").name = "board";
  s.discord.deny("channel-2", s.discord.alice.id, ["ViewChannel"]);

  s.model.script({ tool: "createTask", args: { title: "Approve the hires", channel: "#board" } }, lastResult);
  await s.discord.send("catat di #board: approve the hires", { channel: dm });
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content).error).toMatch(/cannot view #board.*Nothing was created/);

  s.model.script({ tool: "createTask", args: { title: "Approve the hires", channel: "<#channel-2>" } }, lastResult);
  await s.discord.send("catat di <#channel-2>: approve the hires", { channel: dm });
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content).error).toMatch(/cannot view #board.*Nothing was created/);

  s.model.script({ tool: "createTask", args: { title: "Approve the hires", channel: "#nowhere" } }, lastResult);
  await s.discord.send("catat di #nowhere: approve the hires", { channel: dm });
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content).error).toMatch(/#nowhere.*Nothing was created/);

  expect(await files(s, "guilds/guild-1/channels/channel-2/tasks")).toEqual([]);
  expect(await files(s, PERSONAL)).toEqual([]);
});

discordScenario("a Personal task can be assigned to the person or to a name only, and handing it to another member is refused", async (s) => {
  const dm = s.discord.channel("dm-alice", { dm: true }), bob = s.discord.bob;
  const FILE = `${PERSONAL}/dentist.md`;
  await s.workspace.write(FILE, taskFile(1, "Call the dentist"));

  s.model.script({ tool: "assignTask", args: { taskId: "00000001", assignedTo: `<@${bob.id}>` } }, lastResult);
  await s.discord.send(`give the dentist call to <@${bob.id}>`, { channel: dm });
  const { error } = JSON.parse(s.discord.botMessages.at(-1)!.content);
  expect(error).toMatch(/Personal task/);
  expect(error).toMatch(/belongs in a project/);
  expect(await s.workspace.read(FILE)).toContain("assignedTo: null");

  s.model.script({ tool: "createTask", args: { title: "Fix the sink", assignedTo: `<@${bob.id}>` } }, lastResult);
  await s.discord.send(`task for <@${bob.id}>: fix the sink`, { channel: dm });
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content).error).toMatch(/belongs in a project/);
  expect(await files(s, PERSONAL)).toEqual([FILE]);

  s.model.script({ tool: "assignTask", args: { taskId: "00000001", assignedTo: "me" } }, lastResult);
  await s.discord.send("that one is mine", { channel: dm });
  expect(await s.workspace.read(FILE)).toContain('assignedTo: {"id":"user-alice","name":"Alice"}');

  s.model.script({ tool: "assignTask", args: { taskId: "00000001", assignedTo: "Bob" } }, lastResult);
  await s.discord.send("Bob (my brother) will call", { channel: dm });
  expect(await s.workspace.read(FILE)).toContain('assignedTo: {"name":"Bob"}');

  s.model.script({ tool: "createTask", args: { title: "Water the plants", assignedTo: `<@${s.discord.alice.id}>` } }, lastResult);
  await s.discord.send(`task for <@${s.discord.alice.id}>: water the plants`, { channel: dm });
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content).success).toBe(true);
  expect(await files(s, PERSONAL)).toHaveLength(2);
  expect(s.discord.botMessages.filter((m) => m.components.length > 0)).toEqual([]);
});

discordScenario("in a DM a typed name is recorded by name only, and the result says so without claiming no member matched, since no member lookup happens there", async (s) => {
  const dm = s.discord.channel("dm-alice", { dm: true });
  await s.workspace.write(`${PERSONAL}/dentist.md`, taskFile(1, "Call the dentist"));

  s.model.script({ tool: "createTask", args: { title: "Fix the sink", assignedTo: "Bob" } }, lastResult);
  await s.discord.send("task for Bob: fix the sink", { channel: dm });
  const created = JSON.parse(s.discord.botMessages.at(-1)!.content);
  expect(created.message).toContain("Bob was recorded by name only");
  expect(created.message).not.toMatch(/no server member matches/);

  s.model.script({ tool: "assignTask", args: { taskId: "00000001", assignedTo: "Dewi" } }, lastResult);
  await s.discord.send("give the dentist call to Dewi", { channel: dm });
  const assigned = JSON.parse(s.discord.botMessages.at(-1)!.content);
  expect(assigned.message).toContain("Dewi was recorded by name only");
  expect(assigned.message).not.toMatch(/no server member matches/);
});
