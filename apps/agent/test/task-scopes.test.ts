import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
interface Seed { n: number; title: string; channel?: string; assignedTo?: unknown; createdBy?: string; dueAt?: string; status?: string }
const taskFile = (f: Seed) =>
  `---\nid: "${id(f.n)}"\ntitle: ${JSON.stringify(f.title)}\nstatus: "${f.status ?? "pending"}"\npriority: "medium"\nassignedTo: ${JSON.stringify(f.assignedTo ?? null)}\ndueAt: ${JSON.stringify(f.dueAt ?? null)}\ncreatedBy: "${f.createdBy ?? "user-bob"}"\ncreatedByName: "${f.createdBy === "user-alice" ? "Alice" : "Bob"}"\ncreatedAt: "2026-10-01T00:00:${String(f.n % 60).padStart(2, "0")}.000Z"\nupdatedAt: "2026-10-01T00:00:00.000Z"\n---\n`;
async function seed(s: Scenario, tasks: Seed[]) {
  for (const t of tasks) await s.workspace.write(`guilds/guild-1/channels/${t.channel ?? "channel-1"}/tasks/task-${t.n}.md`, taskFile(t));
}
const alice = { id: "user-alice", name: "Alice" }, bob = { id: "user-bob", name: "Bob" };
/** A scoped list as a person would read it: one line per channel group, then how many tasks there are in all. */
const plan = (turn: { toolResults: any[] }) => {
  const r = turn.toolResults.at(-1);
  if (r.error) return `error: ${r.error}`;
  return [...r.groups.map((g: any) => `${g.group}: ${g.tasks.map((t: any) => t.title).join(", ")}`), `${r.groups.reduce((n: number, g: any) => n + g.tasks.length, 0)} of ${r.total}`].join("\n");
};

discordScenario("mine lists the asker's tasks from every channel of the guild she can view, grouped by channel and sorted by due date", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.channel("channel-1").name = "launch";
  s.discord.channel("channel-2").name = "ops";
  s.discord.channel("channel-3").name = "board";
  s.discord.deny("channel-3", s.discord.alice.id, ["ViewChannel"]);
  await seed(s, [
    { n: 1, title: "Print the flyers", assignedTo: alice, dueAt: "2026-10-20" },
    { n: 2, title: "Book the venue", assignedTo: alice, dueAt: "2026-10-16" },
    { n: 3, title: "Sort the photos", assignedTo: "Alice" },
    { n: 4, title: "Order the badges", assignedTo: bob, dueAt: "2026-10-15" },
    { n: 5, title: "Renew the domain", channel: "channel-2", assignedTo: alice, dueAt: "2026-10-15" },
    { n: 6, title: "Rotate the keys", channel: "channel-2", assignedTo: bob },
    { n: 7, title: "Review the budget", channel: "channel-3", assignedTo: alice, dueAt: "2026-10-14" },
    { n: 8, title: "Archive old logs", channel: "channel-gone", assignedTo: alice, dueAt: "2026-10-14" },
  ]);

  s.model.script({ tool: "listTasks", args: { scope: "mine" } }, plan);
  await s.discord.send(`${s.discord.mention} what's on my plate?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("#ops: Renew the domain\n#launch: Book the venue, Print the flyers, Sort the photos\n4 of 4");
});

discordScenario("a task assigned to the asker in a channel she is denied is never returned, from any scope", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.channel("channel-2").name = "board";
  s.discord.deny("channel-2", s.discord.alice.id, ["ViewChannel"]);
  await seed(s, [
    { n: 1, title: "Review the budget", channel: "channel-2", assignedTo: alice, createdBy: "user-alice" },
    { n: 2, title: "Approve the hires", channel: "channel-2", assignedTo: bob, createdBy: "user-alice" },
  ]);

  s.model.script({ tool: "listTasks", args: { scope: "mine" } }, plan);
  await s.discord.send(`${s.discord.mention} my tasks?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("0 of 0");

  s.model.script({ tool: "listTasks", args: { scope: "delegated" } }, plan);
  await s.discord.send(`${s.discord.mention} what did I hand out?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("0 of 0");
});

discordScenario("delegated lists the tasks the asker created that someone else is assigned, not her own or unassigned ones", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.channel("channel-1").name = "launch";
  s.discord.channel("channel-2").name = "ops";
  await seed(s, [
    { n: 1, title: "Order the badges", assignedTo: bob, createdBy: "user-alice", dueAt: "2026-10-18" },
    { n: 2, title: "Call the caterer", assignedTo: { name: "Dewi" }, createdBy: "user-alice", dueAt: "2026-10-16" },
    { n: 3, title: "Print the flyers", assignedTo: alice, createdBy: "user-alice" },
    { n: 4, title: "Sort the photos", assignedTo: "Alice", createdBy: "user-alice" },
    { n: 5, title: "Clean the stage", createdBy: "user-alice" },
    { n: 6, title: "Hire a DJ", assignedTo: bob, createdBy: "user-bob" },
    { n: 7, title: "Rotate the keys", channel: "channel-2", assignedTo: bob, createdBy: "user-alice" },
  ]);

  s.model.script({ tool: "listTasks", args: { scope: "delegated" } }, plan);
  await s.discord.send(`${s.discord.mention} what did I delegate?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("#launch: Call the caterer, Order the badges\n#ops: Rotate the keys\n3 of 3");
});

discordScenario("with more than twenty matching tasks, twenty are returned and the real total says how many more there are", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.channel("channel-2").name = "ops";
  const many: Seed[] = [];
  for (let n = 1; n <= 25; n++) many.push({ n, title: `Chore ${n}`, channel: n % 2 ? "channel-1" : "channel-2", assignedTo: alice, dueAt: `2026-11-${String(n).padStart(2, "0")}` });
  await seed(s, many);

  s.model.script({ tool: "listTasks", args: { scope: "mine" } }, (turn) => { const r = turn.toolResults.at(-1); return `${r.groups.reduce((n: number, g: any) => n + g.tasks.length, 0)} of ${r.total}, ${r.more} more`; });
  await s.discord.send(`${s.discord.mention} everything on my plate`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("20 of 25, 5 more");
});

discordScenario("here and an omitted scope list only this channel's tasks, as before", async (s) => {
  await s.guildSettings({ useThreads: false });
  await seed(s, [
    { n: 1, title: "Print the flyers", assignedTo: alice },
    { n: 2, title: "Order the badges", assignedTo: bob },
    { n: 3, title: "Renew the domain", channel: "channel-2", assignedTo: alice },
  ]);
  const flat = (turn: { toolResults: any[] }) => { const r = turn.toolResults.at(-1); return `${r.total}: ${r.tasks.map((t: any) => t.title).sort().join(", ")}`; };

  s.model.script({ tool: "listTasks", args: {} }, flat);
  await s.discord.send(`${s.discord.mention} tasks?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("2: Order the badges, Print the flyers");

  s.model.script({ tool: "listTasks", args: { scope: "here" } }, flat);
  await s.discord.send(`${s.discord.mention} tasks here?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("2: Order the badges, Print the flyers");
});
