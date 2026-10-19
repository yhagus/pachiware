import { expect } from "bun:test";
import { discordScenario, type FakeChannel, type Scenario } from "./support/discordScenario";

// A Task is changed by its id from any channel whose tasks the asker can view, as listTasks scope anywhere reads them (#260).

const GENERAL = "guilds/guild-1/channels/channel-1/tasks", MOBILE = "guilds/guild-1/channels/channel-2/tasks", DIREKSI = "guilds/guild-1/channels/channel-3/tasks";
const RUNBOOK = `${GENERAL}/runbook-c0000011.md`, REGRESSION = `${MOBILE}/regression-pass-c0000027.md`, BUDGET = `${DIREKSI}/budget-c0000031.md`;
const id = (n: number) => `c00000${n}-0000-4000-8000-000000000000`;
interface Seed { n: number; title: string; status: string; dueAt: string; assignee: string }
const taskFile = (f: Seed) =>
  `---\nid: "${id(f.n)}"\ntitle: ${JSON.stringify(f.title)}\nstatus: "${f.status}"\npriority: "medium"\nassignedTo: {"name":"${f.assignee}"}\ndueAt: "${f.dueAt}"\ncreatedBy: "user-bob"\ncreatedByName: "Bob"\ncreatedAt: "2026-09-20T00:00:00.000Z"\nupdatedAt: "2026-09-20T00:00:00.000Z"\n---\n`;

/** #general (channel-1), where people ask, with a Task of its own; #mobile (channel-2), a Public channel; #direksi (channel-3), which @everyone cannot view and Alice can. */
async function threeChannels(s: Scenario) {
  await s.guildSettings({ language: "en", useThreads: false });
  s.clock.set("2026-10-14T03:05:00Z"); // 10:05 in Asia/Jakarta
  s.discord.channel("channel-1").name = "general";
  s.discord.channel("channel-2").name = "mobile";
  s.discord.channel("channel-3").name = "direksi";
  s.discord.hide("channel-3");
  await s.workspace.write(RUNBOOK, taskFile({ n: 11, title: "Update the on-call runbook", status: "pending", dueAt: "2026-10-10", assignee: "Dewi" }));
  await s.workspace.write(REGRESSION, taskFile({ n: 27, title: "Regression pass on the 0.9 beta build", status: "in_progress", dueAt: "2026-10-12", assignee: "Joko" }));
  await s.workspace.write(BUDGET, taskFile({ n: 31, title: "Budget for the beta devices", status: "pending", dueAt: "2026-10-20", assignee: "Dewi" }));
}
/** Every tool result of the turn as the model read it: its error, else its message, else the whole result. */
const said = (turn: { toolResults: any[] }) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? r.message ?? r));
const reply = (s: Scenario) => JSON.parse(s.discord.botMessages.at(-1)!.content);

discordScenario("asked in #general, a Task in #mobile the asker can view is marked done and given a new due date in its own file, with History, and showTask reads it", async (s) => {
  await threeChannels(s);
  s.model.script(
    { tool: "listTasks", args: { scope: "anywhere", query: "regression pass" } },
    (turn) => {
      const taskId = turn.toolResults[0].groups[0].tasks[0].id.slice(0, 8);
      return [{ tool: "updateTaskStatus", args: { taskId, status: "completed" } }, { tool: "setTaskDueDate", args: { taskId, dueAt: "2026-10-16" } }];
    },
    { tool: "showTask", args: { taskId: "c0000027" } },
    said,
  );
  await s.discord.send(`${s.discord.mention} Joko's regression pass is done, and move its due date to Friday`);
  const [, status, due, shown] = reply(s);
  expect(status).toBe('Task "Regression pass on the 0.9 beta build" status changed to completed.');
  expect(due).toBe('Task "Regression pass on the 0.9 beta build" is due 2026-10-16.');
  expect(shown.task).toBe("completed | due 2026-10-16 | Joko | c0000027 | Regression pass on the 0.9 beta build");

  const file = (await s.workspace.read(REGRESSION))!;
  expect(file).toContain('status: "completed"');
  expect(file).toContain('dueAt: "2026-10-16"');
  expect(file).toContain('completedAt: "2026-10-14T03:05:00.000Z"');
  expect(file).toContain("## History\n- 2026-10-14 10:05 Alice: status in_progress → completed\n- 2026-10-14 10:05 Alice: due 2026-10-12 → 2026-10-16\n");
  expect(await s.workspace.files(MOBILE)).toEqual([REGRESSION]);
  expect(await s.workspace.files(GENERAL)).toEqual([RUNBOOK]);
});

discordScenario("an asker who cannot view #mobile gets not found from #general and nothing changes; Bob, who can view it, changes it from there", async (s) => {
  await threeChannels(s);
  s.discord.deny("channel-2", s.discord.alice.id, ["ViewChannel"]);
  const before = await s.workspace.read(REGRESSION);
  const markDone = async (author: Scenario["discord"]["alice"]) => {
    s.model.script({ tool: "updateTaskStatus", args: { taskId: "c0000027", status: "completed" } }, said);
    await s.discord.send(`${s.discord.mention} Joko's regression pass is done`, { author });
    return reply(s)[0];
  };

  expect(await markDone(s.discord.alice)).toBe("Task with ID c0000027 not found.");
  expect(await s.workspace.read(REGRESSION)).toBe(before);

  expect(await markDone(s.discord.bob)).toBe('Task "Regression pass on the 0.9 beta build" status changed to completed.');
  expect(await s.workspace.read(REGRESSION)).toContain("## History\n- 2026-10-14 10:05 Bob: status in_progress → completed\n");
});

discordScenario("a Task of a channel that is not a Public channel is not changed from #general, where the refusal names nothing of it, and is changed from a DM", async (s) => {
  await threeChannels(s);
  const before = await s.workspace.read(BUDGET);
  const redate = async (text: string, channel: FakeChannel | string) => {
    s.model.script({ tool: "setTaskDueDate", args: { taskId: "c0000031", dueAt: "2026-10-23" } }, said);
    await s.discord.send(text, { channel });
    return reply(s)[0];
  };

  const refused = await redate(`${s.discord.mention} push the devices budget to next Friday`, "channel-1");
  expect(refused).toBe("Task with ID c0000031 cannot be shown or changed in this channel. Nothing was changed. Do not say what or where it is; suggest asking in a DM instead.");
  expect(await s.workspace.read(BUDGET)).toBe(before);

  expect(await redate("push the devices budget to next Friday", s.discord.channel(`dm-${s.discord.alice.id}`, { dm: true }))).toBe('Task "Budget for the beta devices" is due 2026-10-23.');
  expect(await s.workspace.read(BUDGET)).toContain("## History\n- 2026-10-14 10:05 Alice: due 2026-10-20 → 2026-10-23\n");
});
