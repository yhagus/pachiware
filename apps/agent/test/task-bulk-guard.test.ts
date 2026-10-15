import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const TASKS = "guilds/guild-1/channels/channel-1/tasks";
const task = (n: number) =>
  `---\nid: "${String(n).repeat(8)}-0000-4000-8000-00000000000${n}"\ntitle: "Task ${n}"\nstatus: "pending"\npriority: "medium"\nassignedTo: {"name":"Dewi"}\ndueAt: null\ncreatedBy: "user-alice"\ncreatedByName: "Alice"\ncreatedAt: "2026-03-01T00:00:00.000Z"\nupdatedAt: "2026-03-01T00:00:00.000Z"\n---\n`;
const cancel = (n: number) => ({ tool: "updateTaskStatus", args: { taskId: String(n).repeat(8), status: "cancelled" } });
const cancelByFullId = (n: number) => ({ tool: "updateTaskStatus", args: { taskId: `${String(n).repeat(8)}-0000-4000-8000-00000000000${n}`, status: "cancelled" } });

discordScenario("a response that would cancel four tasks changes none of them and asks the model to list them and wait for a yes", async (s) => {
  await s.guildSettings({ useThreads: false });
  for (const n of [1, 2, 3, 4]) await s.workspace.write(`${TASKS}/t${n}.md`, task(n));

  s.model.script([1, 2, 3, 4].map(cancel), (turn) => turn.toolResults.map((r: any) => r.error).join("\n"));
  await s.discord.send(`${s.discord.mention} cancel all of Dewi's tasks`);

  for (const n of [1, 2, 3, 4]) expect(await s.workspace.read(`${TASKS}/t${n}.md`)).toContain('status: "pending"');
  const errors = s.discord.botMessages.at(-1)!.content.split("\n");
  expect(errors).toHaveLength(4);
  for (const e of errors) {
    expect(e).toStartWith("confirmation_required:");
    expect(e).toContain("status | due | assignee | id | title");
  }
});

discordScenario("after the refusal, the asker's yes on the next turn lets the same four cancels run, even named by their full ids, and a fresh bulk after that is stopped again", async (s) => {
  await s.guildSettings({ useThreads: false });
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) await s.workspace.write(`${TASKS}/t${n}.md`, task(n));

  s.model.script([1, 2, 3, 4].map(cancel), "These four would be cancelled. Go ahead?");
  await s.discord.send(`${s.discord.mention} cancel all of Dewi's tasks in the first batch`);
  s.model.script([1, 2, 3, 4].map(cancelByFullId), (turn) => turn.toolResults.map((r: any) => r.message ?? r.error).join("\n"));
  await s.discord.send(`${s.discord.mention} yes`);

  for (const n of [1, 2, 3, 4]) expect(await s.workspace.read(`${TASKS}/t${n}.md`)).toContain('status: "cancelled"');
  expect(s.discord.botMessages.at(-1)!.content).toBe([1, 2, 3, 4].map((n) => `Task "Task ${n}" status changed to cancelled.`).join("\n"));

  s.model.script([5, 6, 7, 8].map(cancel), (turn) => turn.toolResults[0].error);
  await s.discord.send(`${s.discord.mention} and cancel the other four too`);
  for (const n of [5, 6, 7, 8]) expect(await s.workspace.read(`${TASKS}/t${n}.md`)).toContain('status: "pending"');
  expect(s.discord.botMessages.at(-1)!.content).toStartWith("confirmation_required:");
});

discordScenario("on the yes turn the stored refusals still tell the model to make the same calls again", async (s) => {
  await s.guildSettings({ useThreads: false });
  const text = (m: { content: any }) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));

  s.model.script([1, 2, 3, 4].map(cancel), "These four would be cancelled. Go ahead?", "ok");
  await s.discord.send(`${s.discord.mention} cancel all of Dewi's tasks`);
  await s.discord.send(`${s.discord.mention} yes`);

  const rows = s.model.calls.at(-1)!.filter((m) => m.role === "tool").map(text);
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    expect(row).toContain('"success":false');
    expect(row).toContain("status | due | assignee | id | title");
    expect(row).toContain("After the yes, make the same calls again.");
  }
});

discordScenario("a yes to assigning four tasks to Bob does not let assigning them to Alice through", async (s) => {
  await s.guildSettings({ useThreads: false });
  for (const n of [1, 2, 3, 4]) await s.workspace.write(`${TASKS}/t${n}.md`, task(n));
  const assign = (who: string) => [1, 2, 3, 4].map((n) => ({ tool: "assignTask", args: { taskId: String(n).repeat(8), assignedTo: who } }));

  s.model.script(assign("Bob"), "These four would go to Bob. Go ahead?");
  await s.discord.send(`${s.discord.mention} give Dewi's tasks to Bob`);
  s.model.script(assign("Alice"), (turn) => turn.toolResults[0].error ?? "assigned");
  await s.discord.send(`${s.discord.mention} yes`);

  expect(s.discord.botMessages.at(-1)!.content).toStartWith("confirmation_required:");
  for (const n of [1, 2, 3, 4]) expect(await s.workspace.read(`${TASKS}/t${n}.md`)).toContain('assignedTo: {"name":"Dewi"}');
});

discordScenario("the remembered bulk lasts one turn and belongs to the asker: another member's yes or a later turn does not unlock it", async (s) => {
  await s.guildSettings({ useThreads: false });
  for (const n of [1, 2, 3, 4]) await s.workspace.write(`${TASKS}/t${n}.md`, task(n));

  s.model.script([1, 2, 3, 4].map(cancel), "These four would be cancelled. Go ahead?");
  await s.discord.send(`${s.discord.mention} cancel all of Dewi's tasks`);
  s.model.script([1, 2, 3, 4].map(cancel), (turn) => turn.toolResults[0].error);
  await s.discord.send(`${s.discord.mention} yes`, { author: s.discord.bob });
  expect(s.discord.botMessages.at(-1)!.content).toStartWith("confirmation_required:");

  s.model.script("Okay, waiting.");
  await s.discord.send(`${s.discord.mention} hmm, let me think`);
  s.model.script([1, 2, 3, 4].map(cancel), (turn) => turn.toolResults[0].error);
  await s.discord.send(`${s.discord.mention} yes`);
  expect(s.discord.botMessages.at(-1)!.content).toStartWith("confirmation_required:");
  for (const n of [1, 2, 3, 4]) expect(await s.workspace.read(`${TASKS}/t${n}.md`)).toContain('status: "pending"');
});

discordScenario("the count is per turn: three creates run, a fourth task change later in the same turn is refused, and a read in the same response still runs", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(`${TASKS}/t1.md`, task(1));

  s.model.script(
    ["Venue", "Catering", "Invites"].map((title) => ({ tool: "createTask", args: { title } })),
    [{ tool: "listTasks", args: {} }, cancel(1)],
    (turn) => `${turn.toolResults[3].tasks.length} | ${turn.toolResults[4].error}`,
  );
  await s.discord.send(`${s.discord.mention} add venue, catering and invites, then drop task 1`);

  expect(s.discord.botMessages.at(-1)!.content).toStartWith("4 | confirmation_required:");
  expect(await s.workspace.read(`${TASKS}/t1.md`)).toContain('status: "pending"');
  expect((await s.workspace.list(TASKS)).filter((p) => p.endsWith(".md"))).toHaveLength(4);
});

discordScenario("an approved bulk of twelve cancels runs in full, past the per-tool write limit of ten a minute", async (s) => {
  await s.guildSettings({ useThreads: false });
  const all = Array.from({ length: 12 }, (_, i) => i + 1);
  const id = (n: number) => `${n}`.padStart(8, "0");
  for (const n of all) await s.workspace.write(`${TASKS}/t${n}.md`, task(1).replaceAll("11111111", id(n)).replace('"Task 1"', `"Task ${n}"`));
  const calls = all.map((n) => ({ tool: "updateTaskStatus", args: { taskId: id(n), status: "cancelled" } }));

  s.model.script(calls, "These twelve would be cancelled. Go ahead?");
  await s.discord.send(`${s.discord.mention} cancel everything`);
  s.model.script(calls, (turn) => `${turn.toolResults.filter((r: any) => r.error).length} refused`);
  await s.discord.send(`${s.discord.mention} yes`);

  expect(s.discord.botMessages.at(-1)!.content).toBe("0 refused");
  for (const n of all) expect(await s.workspace.read(`${TASKS}/t${n}.md`)).toContain('status: "cancelled"');
});
