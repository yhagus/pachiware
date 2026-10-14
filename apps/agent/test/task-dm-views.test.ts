import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
interface Seed { n: number; title: string; folder: string; assignedTo?: unknown; createdBy?: string; dueAt?: string; status?: string }
const taskFile = (f: Seed) =>
  `---\nid: "${id(f.n)}"\ntitle: ${JSON.stringify(f.title)}\nstatus: "${f.status ?? "pending"}"\npriority: "medium"\nassignedTo: ${JSON.stringify(f.assignedTo ?? null)}\ndueAt: ${JSON.stringify(f.dueAt ?? null)}\ncreatedBy: "${f.createdBy ?? "user-bob"}"\ncreatedByName: "${f.createdBy === "user-alice" ? "Alice" : "Bob"}"\ncreatedAt: "2026-10-01T00:00:${String(f.n % 60).padStart(2, "0")}.000Z"\nupdatedAt: "2026-10-01T00:00:00.000Z"\n---\n`;
async function seed(s: Scenario, tasks: Seed[]) {
  for (const t of tasks) await s.workspace.write(`${t.folder}/tasks/task-${t.n}.md`, taskFile(t));
}
const alice = { id: "user-alice", name: "Alice" }, bob = { id: "user-bob", name: "Bob" };
/** A scoped list as a person would read it: one line per channel group, then how many tasks there are in all. */
const plan = (turn: { toolResults: any[] }) => {
  const r = turn.toolResults.at(-1);
  if (r.error) return `error: ${r.error}`;
  return [...r.groups.map((g: any) => `${g.group}: ${g.tasks.map((t: any) => t.title).join(", ")}`), `${r.groups.reduce((n: number, g: any) => n + g.tasks.length, 0)} of ${r.total}`].join("\n");
};

/**
 * Alice is in Acme (guild-1: #launch, #board she is denied) and Beta (guild-2: #ops, #vault she is denied).
 * Gamma (guild-3: #studio) has the bot and Bob but not Alice.
 */
async function threeGuilds(s: Scenario) {
  s.discord.channel("channel-1").name = "launch";
  s.discord.channel("channel-2").name = "board";
  s.discord.deny("channel-2", s.discord.alice.id, ["ViewChannel"]);
  await s.discord.joinGuild("guild-2", "Beta", { members: [s.discord.alice, s.discord.bob] });
  s.discord.channel("beta-ops", { guild: "guild-2" }).name = "ops";
  s.discord.channel("beta-vault", { guild: "guild-2" }).name = "vault";
  s.discord.deny("beta-vault", s.discord.alice.id, ["ViewChannel"]);
  await s.discord.joinGuild("guild-3", "Gamma", { members: [s.discord.bob] });
  s.discord.channel("gamma-studio", { guild: "guild-3" }).name = "studio";
  await seed(s, [
    { n: 1, title: "Print the flyers", folder: "guilds/guild-1/channels/channel-1", assignedTo: alice, dueAt: "2026-10-20" },
    { n: 2, title: "Order the badges", folder: "guilds/guild-1/channels/channel-1", assignedTo: bob, createdBy: "user-alice" },
    { n: 3, title: "Review the budget", folder: "guilds/guild-1/channels/channel-2", assignedTo: alice, createdBy: "user-alice" },
    { n: 4, title: "Renew the domain", folder: "guilds/guild-2/channels/beta-ops", assignedTo: alice, dueAt: "2026-10-16" },
    { n: 5, title: "Rotate the keys", folder: "guilds/guild-2/channels/beta-ops", assignedTo: bob, createdBy: "user-alice", dueAt: "2026-10-18" },
    { n: 6, title: "Audit the safe", folder: "guilds/guild-2/channels/beta-vault", assignedTo: alice, createdBy: "user-alice" },
    { n: 7, title: "Mix the track", folder: "guilds/guild-3/channels/gamma-studio", assignedTo: alice, createdBy: "user-alice" },
    { n: 8, title: "Water the plants", folder: "guilds/guild-3/channels/gamma-studio", assignedTo: bob, createdBy: "user-alice" },
    { n: 9, title: "Call the dentist", folder: "dms/user-alice", createdBy: "user-alice" },
  ]);
}

discordScenario("mine from a DM lists Alice's tasks from every guild she shares with the bot plus her Personal tasks, never a denied channel or a guild she is not in", async (s) => {
  await threeGuilds(s);
  const dm = s.discord.channel("dm-alice", { dm: true });
  s.model.script({ tool: "listTasks", args: { scope: "mine" } }, plan);
  await s.discord.send("what's on my plate?", { channel: dm });
  expect(s.discord.botMessages.at(-1)?.content).toBe("#ops (Beta): Renew the domain\n#launch (Acme): Print the flyers\nPersonal tasks: Call the dentist\n3 of 3");
});

discordScenario("delegated from a DM covers both shared guilds, and nothing from a guild Alice is not in", async (s) => {
  await threeGuilds(s);
  const dm = s.discord.channel("dm-alice", { dm: true });
  s.model.script({ tool: "listTasks", args: { scope: "delegated" } }, plan);
  await s.discord.send("what did I hand out?", { channel: dm });
  expect(s.discord.botMessages.at(-1)?.content).toBe("#ops (Beta): Rotate the keys\n#launch (Acme): Order the badges\n2 of 2");
});

discordScenario("a DM Reminder with tasks posts Alice's mine list across shared guilds, grouped by channel", async (s) => {
  s.clock.set("2026-10-14T20:00:00+07:00");
  await threeGuilds(s);
  const dm = s.discord.channel("dm-alice", { dm: true });
  s.model.script({ tool: "createReminder", args: { text: "morning overview", at: "07:00", withTasks: true } }, "set");
  await s.discord.send("remind me at 07:00 with my tasks", { channel: dm });

  s.clock.set("2026-10-15T07:00:00+07:00");
  await s.scheduler.tick();
  const post = s.discord.botMessages.at(-1)!;
  expect(post.channelId).toBe(dm.id);
  expect(post.content).toBe([
    `<@${alice.id}> Pengingat: morning overview`,
    "Tugas terbuka (status | due | assignee | id | title):",
    "#ops (Beta)",
    "pending | due 2026-10-16 | Alice | 00000004 | Renew the domain",
    "#launch (Acme)",
    "pending | due 2026-10-20 | Alice | 00000001 | Print the flyers",
    "Tugas pribadi",
    "pending | no due date | unassigned | 00000009 | Call the dentist",
  ].join("\n"));
});

discordScenario("a channel Reminder with tasks lists the same mine scope as asking from that channel: the guild's channels Alice can view and her Personal tasks, open ones only", async (s) => {
  s.clock.set("2026-10-14T20:00:00+07:00");
  await s.guildSettings({ useThreads: false, language: "en" });
  await threeGuilds(s);
  s.discord.channel("channel-3").name = "ops";
  await seed(s, [
    { n: 10, title: "Sweep the floor", folder: "guilds/guild-1/channels/channel-3", assignedTo: alice, dueAt: "2026-10-15" },
    { n: 11, title: "Hang the banner", folder: "guilds/guild-1/channels/channel-1", assignedTo: alice, status: "completed" },
    { n: 12, title: "Book the band", folder: "dms/user-alice", createdBy: "user-alice", status: "cancelled" },
  ]);

  s.model.script({ tool: "listTasks", args: { scope: "mine" } }, plan);
  await s.discord.send(`${s.discord.mention} what's on my plate?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("#ops: Sweep the floor\n#launch: Print the flyers\nPersonal tasks: Call the dentist\n3 of 3");

  s.model.script({ tool: "listTasks", args: { scope: "mine", status: "completed" } }, plan);
  await s.discord.send(`${s.discord.mention} what have I finished?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("#launch: Hang the banner\n1 of 1");

  s.model.script({ tool: "createReminder", args: { text: "morning overview", at: "07:00", withTasks: true } }, "set");
  await s.discord.send(`${s.discord.mention} remind me at 07:00 with my tasks`);
  s.clock.set("2026-10-15T07:00:00+07:00");
  await s.scheduler.tick();
  const post = s.discord.botMessages.at(-1)!;
  expect(post.channelId).toBe("channel-1");
  expect(post.content).toBe([
    `<@${alice.id}> Reminder: morning overview`,
    "Open tasks (status | due | assignee | id | title):",
    "#ops",
    "pending | due 2026-10-15 | Alice | 00000010 | Sweep the floor",
    "#launch",
    "pending | due 2026-10-20 | Alice | 00000001 | Print the flyers",
    "Personal tasks",
    "pending | no due date | unassigned | 00000009 | Call the dentist",
  ].join("\n"));
});

/** Tasks in the shared folders people saw before projects: the tenant's, and each guild's. */
async function sharedTasks(s: Scenario) {
  await seed(s, [
    { n: 20, title: "Renew the licence", folder: "shared", assignedTo: alice, dueAt: "2026-10-17" },
    { n: 21, title: "Plan the offsite", folder: "guilds/guild-2/shared", assignedTo: alice },
    { n: 22, title: "Tune the piano", folder: "guilds/guild-3/shared", assignedTo: alice },
    { n: 23, title: "Pay the vendor", folder: "guilds/guild-1/shared", assignedTo: bob, createdBy: "user-alice" },
  ]);
}

discordScenario("from a channel, mine and delegated include the tenant's and that guild's shared tasks as their own group", async (s) => {
  await s.guildSettings({ useThreads: false });
  await threeGuilds(s);
  await sharedTasks(s);

  s.model.script({ tool: "listTasks", args: { scope: "mine" } }, plan);
  await s.discord.send(`${s.discord.mention} what's on my plate?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Shared tasks: Renew the licence\n#launch: Print the flyers\nPersonal tasks: Call the dentist\n3 of 3");

  s.model.script({ tool: "listTasks", args: { scope: "delegated" } }, plan);
  await s.discord.send(`${s.discord.mention} what did I hand out?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("#launch: Order the badges\nShared tasks: Pay the vendor\n2 of 2");
});

discordScenario("from a DM, mine and its Reminder include the shared tasks of the tenant and of every guild Alice is in, never of a guild she is not in", async (s) => {
  s.clock.set("2026-10-14T20:00:00+07:00");
  await threeGuilds(s);
  await sharedTasks(s);
  const dm = s.discord.channel("dm-alice", { dm: true });

  s.model.script({ tool: "listTasks", args: { scope: "mine" } }, plan);
  await s.discord.send("what's on my plate?", { channel: dm });
  expect(s.discord.botMessages.at(-1)?.content).toBe("#ops (Beta): Renew the domain\nShared tasks: Renew the licence, Plan the offsite\n#launch (Acme): Print the flyers\nPersonal tasks: Call the dentist\n5 of 5");

  s.model.script({ tool: "createReminder", args: { text: "morning overview", at: "07:00", withTasks: true } }, "set");
  await s.discord.send("remind me at 07:00 with my tasks", { channel: dm });
  s.clock.set("2026-10-15T07:00:00+07:00");
  await s.scheduler.tick();
  expect(s.discord.botMessages.at(-1)!.content.split("\n").slice(2, 7)).toEqual([
    "#ops (Beta)",
    "pending | due 2026-10-16 | Alice | 00000004 | Renew the domain",
    "Tugas bersama",
    "pending | due 2026-10-17 | Alice | 00000020 | Renew the licence",
    "pending | no due date | Alice | 00000021 | Plan the offsite",
  ]);
});

discordScenario("a Reminder task list cut at Discord's limit ends on a task line, never on a channel heading with no task under it, then counts what was cut", async (s) => {
  s.clock.set("2026-10-14T20:00:00+07:00");
  await s.guildSettings({ useThreads: false, language: "en" });
  s.discord.channel("channel-1").name = "launch";
  s.discord.channel("channel-2").name = "ops";
  // Seven long #launch lines leave room for the "#ops" heading but not for its first task.
  const long: Seed[] = [];
  for (let n = 1; n <= 7; n++) long.push({ n, title: `Launch chore ${n} `.padEnd(200, "x"), folder: "guilds/guild-1/channels/channel-1", assignedTo: alice, dueAt: `2026-10-1${n}` });
  await seed(s, [...long, { n: 8, title: "Rotate the keys ".padEnd(200, "x"), folder: "guilds/guild-1/channels/channel-2", assignedTo: alice, dueAt: "2026-10-25" }]);

  s.model.script({ tool: "createReminder", args: { text: "morning overview", at: "07:00", withTasks: true } }, "set");
  await s.discord.send(`${s.discord.mention} remind me at 07:00 with my tasks`);
  s.clock.set("2026-10-15T07:00:00+07:00");
  await s.scheduler.tick();
  const content = s.discord.botMessages.at(-1)!.content, lines = content.split("\n");
  expect(content.length).toBeLessThanOrEqual(2000);
  expect(lines.slice(1, 3)).toEqual(["Open tasks (status | due | assignee | id | title):", "#launch"]);
  expect(lines.slice(3, -1).every((l) => l.startsWith("pending | "))).toBe(true);
  expect(lines.slice(3, -1).map((l) => l.split(" | ")[3])).toEqual(["00000001", "00000002", "00000003", "00000004", "00000005", "00000006", "00000007"]);
  expect(lines.at(-1)).toBe("…and 1 more task.");
});

discordScenario("a Reminder lists at most twenty tasks, like listTasks, and says how many more there are", async (s) => {
  s.clock.set("2026-10-14T20:00:00+07:00");
  await s.guildSettings({ useThreads: false, language: "en" });
  s.discord.channel("channel-1").name = "launch";
  const many: Seed[] = [];
  for (let n = 1; n <= 23; n++) many.push({ n, title: `Chore ${n}`, folder: "guilds/guild-1/channels/channel-1", assignedTo: alice, dueAt: `2026-11-${String(n).padStart(2, "0")}` });
  await seed(s, many);

  s.model.script({ tool: "createReminder", args: { text: "morning overview", at: "07:00", withTasks: true } }, "set");
  await s.discord.send(`${s.discord.mention} remind me at 07:00 with my tasks`);
  s.clock.set("2026-10-15T07:00:00+07:00");
  await s.scheduler.tick();
  const lines = s.discord.botMessages.at(-1)!.content.split("\n");
  expect(lines.filter((l) => l.startsWith("pending | ")).map((l) => l.split(" | ")[3])).toEqual(many.slice(0, 20).map((t) => id(t.n).slice(0, 8)));
  expect(lines.at(-1)).toBe("…and 3 more tasks.");
});
