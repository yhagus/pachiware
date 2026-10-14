import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const SOURCE = "guilds/guild-1/channels/channel-1/tasks", DEST = "guilds/guild-1/channels/channel-2/tasks";
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const taskFile = (n: number, title: string, assignedTo: unknown = null, body = "") =>
  `---\nid: "${id(n)}"\ntitle: ${JSON.stringify(title)}\nstatus: "in_progress"\npriority: "high"\nassignedTo: ${JSON.stringify(assignedTo)}\ndueAt: "2026-10-20"\ncreatedBy: "user-bob"\ncreatedByName: "Bob"\ncreatedAt: "2026-10-01T00:00:00.000Z"\nupdatedAt: "2026-10-01T00:00:00.000Z"\n---\n${body}`;
const lastResult = (turn: { toolResults: any[] }) => JSON.stringify(turn.toolResults.at(-1));
const reply = (s: Scenario) => JSON.parse(s.discord.botMessages.at(-1)!.content);
const files = async (s: Scenario, folder: string) => (await s.workspace.list(folder)).filter((p) => p.endsWith(".md"));
const noConfirm = (s: Scenario) => expect(s.discord.botMessages.filter((m) => m.components.length > 0)).toEqual([]);

discordScenario("a task moves to another project channel, keeping its id and fields, with a Progress note naming where it came from and who moved it", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.clock.set("2026-10-14T03:00:00Z");
  s.discord.channel("channel-1").name = "umum";
  s.discord.channel("channel-2").name = "laporan-q4";
  await s.workspace.write(`${SOURCE}/q4-report-00000001.md`, taskFile(1, "Draft the Q4 report", { name: "Dewi" }, "- [ ] numbers\n- [x] outline\n"));

  s.model.script({ tool: "moveTask", args: { taskId: "00000001", channel: "#laporan-q4" } }, lastResult);
  await s.discord.send(`${s.discord.mention} tugas ini salah channel, pindahkan ke #laporan-q4`);
  expect(reply(s).success).toBe(true);
  expect(await files(s, SOURCE)).toEqual([]);
  expect(await files(s, DEST)).toEqual([`${DEST}/q4-report-00000001.md`]);
  const file = (await s.workspace.read(`${DEST}/q4-report-00000001.md`))!;
  for (const kept of [`id: "${id(1)}"`, 'title: "Draft the Q4 report"', 'status: "in_progress"', 'priority: "high"', 'assignedTo: {"name":"Dewi"}', 'dueAt: "2026-10-20"', 'createdBy: "user-bob"', "- [ ] numbers\n- [x] outline"]) expect(file).toContain(kept);
  expect(file).toContain("## Progress notes\n- 2026-10-14 Alice: Moved from #umum");
  noConfirm(s);

  s.model.script({ tool: "showTask", args: { taskId: "00000001" } }, lastResult);
  await s.discord.send(`${s.discord.mention} show the Q4 report task`, { channel: "channel-2" });
  expect(reply(s).task).toContain("Draft the Q4 report");
});

discordScenario("a move is refused, with nothing changed, when the asker cannot view the destination or the source", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.channel("channel-1").name = "umum";
  s.discord.channel("channel-2").name = "board";
  const FILE = `${SOURCE}/q4-report-00000001.md`, original = taskFile(1, "Draft the Q4 report", { name: "Dewi" });
  await s.workspace.write(FILE, original);
  s.discord.deny("channel-2", s.discord.alice.id, ["ViewChannel"]);

  s.model.script({ tool: "moveTask", args: { taskId: "00000001", channel: "#board" } }, lastResult);
  await s.discord.send(`${s.discord.mention} move this to #board`);
  expect(reply(s).error).toMatch(/cannot view #board.*Nothing was changed/);

  s.model.script({ tool: "moveTask", args: { taskId: "00000001", channel: "#nowhere" } }, lastResult);
  await s.discord.send(`${s.discord.mention} move this to #nowhere`);
  expect(reply(s).error).toMatch(/#nowhere.*Nothing was changed/);

  s.discord.channel("channel-3").name = "laporan-q4";
  s.discord.deny("channel-1", s.discord.alice.id, ["ViewChannel"]);
  s.model.script({ tool: "moveTask", args: { taskId: "00000001", channel: "#laporan-q4" } }, lastResult);
  await s.discord.send(`${s.discord.mention} move this to #laporan-q4`);
  expect(reply(s).error).toMatch(/cannot view #umum.*Nothing was changed/);

  expect(await s.workspace.read(FILE)).toBe(original);
  expect(await files(s, DEST)).toEqual([]);
  expect(await files(s, "guilds/guild-1/channels/channel-3/tasks")).toEqual([]);
});

discordScenario("a move is refused when the member Assignee cannot view the destination; a name-only Assignee does not block it", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.channel("channel-2").name = "board";
  const FILE = `${SOURCE}/q4-report-00000001.md`, original = taskFile(1, "Draft the Q4 report", { id: "user-bob", name: "Bob" });
  await s.workspace.write(FILE, original);
  await s.workspace.write(`${SOURCE}/venue-00000002.md`, taskFile(2, "Book the venue", { name: "Dewi" }));
  s.discord.deny("channel-2", s.discord.bob.id, ["ViewChannel"]);

  s.model.script({ tool: "moveTask", args: { taskId: "00000001", channel: "#board" } }, lastResult);
  await s.discord.send(`${s.discord.mention} move the Q4 report to #board`);
  const { error } = reply(s);
  expect(error).toMatch(/Bob cannot view #board, so they cannot be this task's assignee/);
  expect(error).toMatch(/Nothing was changed/);
  expect(error).toMatch(/Add them to #board, or assign someone else/);
  expect(await s.workspace.read(FILE)).toBe(original);

  s.model.script({ tool: "moveTask", args: { taskId: "00000002", channel: "#board" } }, lastResult);
  await s.discord.send(`${s.discord.mention} move the venue task to #board`);
  expect(reply(s).success).toBe(true);
  expect(await files(s, DEST)).toEqual([`${DEST}/venue-00000002.md`]);
  expect(await s.workspace.read(`${DEST}/venue-00000002.md`)).toContain('assignedTo: {"name":"Dewi"}');
  noConfirm(s);
});

discordScenario("a Personal task moves into a project from a DM, and keeps the asker as its Assignee", async (s) => {
  s.clock.set("2026-10-14T03:00:00Z");
  const dm = s.discord.channel("dm-alice", { dm: true });
  s.discord.channel("channel-2").name = "laporan-q4";
  const PERSONAL = "dms/user-alice/tasks";
  await s.workspace.write(`${PERSONAL}/numbers-00000003.md`, taskFile(3, "Check the Q4 numbers", { id: "user-alice", name: "Alice" }));

  s.model.script({ tool: "moveTask", args: { taskId: "00000003", channel: "#laporan-q4" } }, lastResult);
  await s.discord.send("pindahkan tugas ini ke #laporan-q4", { channel: dm });
  expect(reply(s).success).toBe(true);
  expect(await files(s, PERSONAL)).toEqual([]);
  const file = (await s.workspace.read(`${DEST}/numbers-00000003.md`))!;
  expect(file).toContain(`id: "${id(3)}"`);
  expect(file).toContain('assignedTo: {"id":"user-alice","name":"Alice"}');
  expect(file).toContain("- 2026-10-14 Alice: Moved from Personal tasks");
  noConfirm(s);
});

discordScenario("there is no way to move a project's task into a DM", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.channel("dm-alice", { dm: true });
  const FILE = `${SOURCE}/q4-report-00000001.md`, original = taskFile(1, "Draft the Q4 report", { name: "Dewi" });
  await s.workspace.write(FILE, original);

  for (const channel of ["<#dm-alice>", "#dm-alice"]) {
    s.model.script({ tool: "moveTask", args: { taskId: "00000001", channel } }, lastResult);
    await s.discord.send(`${s.discord.mention} move this to my DM`);
    expect(reply(s).error).toMatch(/Nothing was changed/);
  }
  expect(await s.workspace.read(FILE)).toBe(original);
  expect(await files(s, "dms/user-alice/tasks")).toEqual([]);
});

discordScenario("a guild's shared task moves into one of that guild's channels; a tenant-wide shared task, or a move into another guild, is refused with nothing changed", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.channel("channel-2").name = "laporan-q4";
  await s.discord.joinGuild("guild-2", "Beta", { members: [s.discord.alice, s.discord.bob] });
  s.discord.channel("beta-ops", { guild: "guild-2" }).name = "ops";
  const GUILD_SHARED = "guilds/guild-1/shared/tasks/q4-report-00000001.md", TENANT_SHARED = "shared/tasks/audit-00000002.md";
  const guildTask = taskFile(1, "Draft the Q4 report", { name: "Dewi" }), tenantTask = taskFile(2, "Run the audit", { name: "Dewi" });
  await s.workspace.write(GUILD_SHARED, guildTask);
  await s.workspace.write(TENANT_SHARED, tenantTask);

  s.model.script({ tool: "moveTask", args: { taskId: "00000002", channel: "#laporan-q4" } }, lastResult);
  await s.discord.send(`${s.discord.mention} move the audit to #laporan-q4`);
  expect(reply(s).error).toMatch(/shared tasks of the whole workspace.*Nothing was changed/);
  expect(await s.workspace.read(TENANT_SHARED)).toBe(tenantTask);

  s.model.script({ tool: "moveTask", args: { taskId: "00000001", channel: "#ops" } }, lastResult);
  await s.discord.send(`${s.discord.mention} move the Q4 report to #ops`);
  expect(reply(s).error).toMatch(/only moves into one of its own server's channels.*Nothing was changed/);
  expect(await s.workspace.read(GUILD_SHARED)).toBe(guildTask);

  s.model.script({ tool: "moveTask", args: { taskId: "00000001", channel: "#laporan-q4" } }, lastResult);
  await s.discord.send(`${s.discord.mention} move the Q4 report to #laporan-q4`);
  expect(reply(s).success).toBe(true);
  expect(await s.workspace.read(GUILD_SHARED)).toBeNull();
  expect(await files(s, DEST)).toEqual([`${DEST}/q4-report-00000001.md`]);
  expect(await s.workspace.read(`${DEST}/q4-report-00000001.md`)).toContain("Alice: Moved from the shared tasks");
  expect(await s.workspace.read(TENANT_SHARED)).toBe(tenantTask);
});
