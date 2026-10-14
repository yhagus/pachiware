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

discordScenario("a channel Reminder with tasks lists the same mine scope as asking from that channel: the guild's channels Alice can view and her Personal tasks", async (s) => {
  s.clock.set("2026-10-14T20:00:00+07:00");
  await s.guildSettings({ useThreads: false, language: "en" });
  await threeGuilds(s);
  s.discord.channel("channel-3").name = "ops";
  await seed(s, [{ n: 10, title: "Sweep the floor", folder: "guilds/guild-1/channels/channel-3", assignedTo: alice, dueAt: "2026-10-15" }]);

  s.model.script({ tool: "listTasks", args: { scope: "mine" } }, plan);
  await s.discord.send(`${s.discord.mention} what's on my plate?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("#ops: Sweep the floor\n#launch: Print the flyers\nPersonal tasks: Call the dentist\n3 of 3");

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
