import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const TASKS = "guilds/guild-1/channels/channel-1/tasks";
const contextOf = (call: { role: string; content: unknown }[]) => String(call.findLast((m) => m.role === "user")?.content);
const taskFile = async (s: Scenario) => {
  const [path] = (await s.workspace.list(TASKS)).filter((p) => p.endsWith(".md"));
  return path ? (await s.workspace.read(path))! : null;
};
const idOf = (file: string) => /^id: "([^"]+)"/m.exec(file)![1]!;
const confirmMessages = (s: Scenario) => s.discord.botMessages.filter((m) => m.components.length > 0);

discordScenario("a task due Friday carries its creator, is not late at Friday 09:00 and is late on Saturday, in the guild's zone", async (s) => {
  s.clock.set("2026-10-16T02:00:00Z"); // Friday 09:00 Asia/Jakarta
  s.model.script({ tool: "createTask", args: { title: "Send the invoice", dueAt: "2026-10-16" } }, (turn) => `created ${turn.toolResults[0].task.id.slice(0, 8)}`);
  const ask = await s.discord.send(`${s.discord.mention} create task: send the invoice, due Friday`);
  const file = (await taskFile(s))!;
  expect(file).toContain('dueAt: "2026-10-16"');
  expect(file).toContain('createdBy: "user-alice"');
  expect(file).toContain('createdByName: "Alice"');
  expect(s.discord.botMessages.at(-1)?.content).toBe(`created ${idOf(file).slice(0, 8)}`);

  s.model.script({ tool: "listTasks", args: { late: true } }, (turn) => `late: ${turn.toolResults[0].tasks.map((t: any) => t.title).join(", ") || "nothing"}`);
  await s.discord.send("what is late?", { channel: ask.thread });
  expect(s.discord.botMessages.at(-1)?.content).toBe("late: nothing");
  expect(contextOf(s.model.calls.at(-2)!)).toContain(`pending | due 2026-10-16 | unassigned | ${idOf(file).slice(0, 8)} | Send the invoice`);

  s.clock.set("2026-10-16T17:00:30Z"); // Saturday 00:00:30 Asia/Jakarta
  s.model.script({ tool: "listTasks", args: { late: true } }, (turn) => `late: ${turn.toolResults[0].tasks.map((t: any) => `${t.title} (${t.late})`).join(", ")}`);
  await s.discord.send("and now?", { channel: ask.thread });
  expect(s.discord.botMessages.at(-1)?.content).toBe("late: Send the invoice (true)");
  expect(contextOf(s.model.calls.at(-2)!)).toContain(`pending | due 2026-10-16, late | unassigned | ${idOf(file).slice(0, 8)} | Send the invoice`);

  s.model.script({ tool: "listTasks", args: { dueAfter: "2026-10-12", dueBefore: "2026-10-18" } }, (turn) => `this week: ${turn.toolResults[0].tasks.length}`, { tool: "listTasks", args: { dueAfter: "2026-10-17" } }, (turn) => `next: ${turn.toolResults[0].tasks.length}`);
  await s.discord.send("what is due this week?", { channel: ask.thread });
  await s.discord.send("and after?", { channel: ask.thread });
  expect(s.discord.botMessages.slice(-2).map((m) => m.content)).toEqual(["this week: 1", "next: 0"]);
  expect(confirmMessages(s)).toEqual([]);
});

discordScenario("status, assignee and due date change without Confirm and the file follows; a date-time without offset takes the guild's zone; deleting a file still asks", async (s) => {
  s.clock.set("2026-10-14T03:00:00Z");
  await s.guildSettings({ timezone: "Asia/Tokyo" });
  s.model.script({ tool: "createTask", args: { title: "Book the venue" } }, "Filed.");
  const ask = await s.discord.send(`${s.discord.mention} new task: book the venue`);
  const id = idOf((await taskFile(s))!);

  s.model.script({ tool: "updateTaskStatus", args: { taskId: id, status: "in_progress" } }, (turn) => turn.toolResults[0].task.status);
  await s.discord.send("I started on it", { channel: ask.thread });
  expect(s.discord.botMessages.at(-1)?.content).toBe("in_progress");
  expect(await taskFile(s)).toContain('status: "in_progress"');

  s.model.script({ tool: "assignTask", args: { taskId: id, assignedTo: "Bob" } }, (turn) => turn.toolResults[0].task.assignedTo.name);
  await s.discord.send("Bob takes it", { channel: ask.thread });
  expect(s.discord.botMessages.at(-1)?.content).toBe("Bob");
  expect(await taskFile(s)).toContain('assignedTo: {"id":"user-bob","name":"Bob"}');

  s.model.script({ tool: "setTaskDueDate", args: { taskId: id, dueAt: "2026-10-20T15:00" } }, (turn) => String(turn.toolResults[0].task.dueAt));
  await s.discord.send("due Tuesday 15:00", { channel: ask.thread });
  expect(s.discord.botMessages.at(-1)?.content).toBe("2026-10-20T15:00:00+09:00");
  expect(await taskFile(s)).toContain('dueAt: "2026-10-20T15:00:00+09:00"');

  s.model.script({ tool: "setTaskDueDate", args: { taskId: id, dueAt: null } }, (turn) => String(turn.toolResults[0].task.dueAt));
  await s.discord.send("no due date after all", { channel: ask.thread });
  expect(s.discord.botMessages.at(-1)?.content).toBe("null");
  expect(await taskFile(s)).toContain("dueAt: null");

  s.model.script({ tool: "setTaskDueDate", args: { taskId: id, dueAt: "next week" } }, (turn) => `refused: ${turn.toolResults[0].error}`);
  await s.discord.send("make it next week", { channel: ask.thread });
  expect(s.discord.botMessages.at(-1)?.content).toMatch(/^refused: .*due date/i);
  expect(confirmMessages(s)).toEqual([]);

  const [path] = (await s.workspace.list(TASKS)).filter((p) => p.endsWith(".md"));
  s.model.script({ tool: "deleteFile", args: { path: `channel/tasks/${path!.split("/").pop()}` } }, "Waiting for your Confirm.");
  await s.discord.send("delete that task file", { channel: ask.thread });
  expect(confirmMessages(s)).toHaveLength(1);
  expect(await taskFile(s)).not.toBeNull();
});
