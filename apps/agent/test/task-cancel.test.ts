import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const TASKS = "guilds/guild-1/channels/channel-1/tasks";
const task = (f: { id: string; title: string; status?: string; dueAt?: string | null; description?: string }) =>
  `---\nid: "${f.id}"\ntitle: "${f.title}"\nstatus: "${f.status ?? "pending"}"\npriority: "medium"\nassignedTo: {"name":"Dewi"}\ndueAt: ${JSON.stringify(f.dueAt ?? null)}\ncreatedBy: "user-alice"\ncreatedByName: "Alice"\ncreatedAt: "2026-03-01T00:00:00.000Z"\nupdatedAt: "2026-03-01T00:00:00.000Z"\n---\n${f.description ?? ""}\n`;
const contextOf = (call: { role: string; content: unknown }[]) => String(call.findLast((m) => m.role === "user")?.content);
/** Posts the scheduler made on its own: not a reply, and nobody pinged. */
const digests = (s: any) => s.discord.botMessages.filter((m: any) => !m.reference && m.allowedMentions && !m.allowedMentions.users);
const titles = (r: any) => r.tasks.map((t: any) => t.title).join(", ") || "nothing";

discordScenario("cancelling a task with a reason marks it cancelled, keeps the file, and keeps the reason as a progress note", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(`${TASKS}/venue-aaaaaaaa.md`, task({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Book the venue", description: "Two quotes, under 5 million." }));
  s.clock.set("2026-03-10T03:00:00Z");

  s.model.script({ tool: "updateTaskStatus", args: { taskId: "aaaaaaaa", status: "cancelled", reason: "batal, klien mundur" } }, (turn) => turn.toolResults[0].message);
  await s.discord.send(`${s.discord.mention} venue batal, klien mundur`);

  const file = (await s.workspace.read(`${TASKS}/venue-aaaaaaaa.md`))!;
  expect(file).toContain('status: "cancelled"');
  expect(file).toContain('updatedAt: "2026-03-10T03:00:00.000Z"');
  expect(file).toContain("---\nTwo quotes, under 5 million.\n\n## Progress notes\n- 2026-03-10 Alice: Cancelled: batal, klien mundur\n");
  expect(s.discord.botMessages.at(-1)?.content).toBe('Task "Book the venue" status changed to cancelled.');
  expect(s.discord.botMessages.filter((m) => m.components.length > 0)).toEqual([]);
});

discordScenario("cancelling a task without a reason only changes its status and writes no progress note", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(`${TASKS}/venue-aaaaaaaa.md`, task({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Book the venue", description: "Two quotes, under 5 million." }));

  s.model.script({ tool: "updateTaskStatus", args: { taskId: "aaaaaaaa", status: "cancelled" } }, "Cancelled.");
  await s.discord.send(`${s.discord.mention} cancel the venue task`);

  const file = (await s.workspace.read(`${TASKS}/venue-aaaaaaaa.md`))!;
  expect(file).toContain('status: "cancelled"');
  expect(file).toEndWith("---\nTwo quotes, under 5 million.\n");
  expect(s.model.calls).toHaveLength(2);
});

discordScenario("a cancelled task past its due date is never late and leaves the default list, the late list, the turn context and the Digest, but listing cancelled tasks finds it", async (s) => {
  s.clock.set("2026-03-06T20:00:00+07:00");
  await s.workspace.write(`${TASKS}/venue-aaaaaaaa.md`, task({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Book the venue", dueAt: "2026-03-05" }));
  await s.workspace.write(`${TASKS}/invoice-bbbbbbbb.md`, task({ id: "bbbbbbbb-0000-4000-8000-000000000002", title: "Send the invoice", dueAt: "2026-03-05" }));
  await s.guildSettings({ useThreads: false, language: "en", digestChannels: [{ channelId: "channel-1", hour: 8 }] });

  s.model.script({ tool: "updateTaskStatus", args: { taskId: "aaaaaaaa", status: "cancelled", reason: "client pulled out" } }, "Cancelled.");
  await s.discord.send(`${s.discord.mention} the venue is off, client pulled out`);

  s.model.script(
    [{ tool: "listTasks", args: {} }, { tool: "listTasks", args: { late: true } }, { tool: "listTasks", args: { status: "cancelled" } }, { tool: "listTasks", args: { status: "all" } }],
    (turn) => turn.toolResults.map((r: any) => titles(r)).join(" / ") + ` / late: ${turn.toolResults[2].tasks[0].late}`,
  );
  await s.discord.send(`${s.discord.mention} what is on, what is late, and what was cancelled?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Send the invoice / Send the invoice / Book the venue / Send the invoice, Book the venue / late: false");

  const context = contextOf(s.model.calls.at(-2)!);
  expect(context).toContain("pending | due 2026-03-05, late | Dewi | bbbbbbbb | Send the invoice");
  expect(context).not.toContain("Book the venue");

  s.clock.set("2026-03-07T08:00:30+07:00");
  await s.scheduler.tick();
  expect(digests(s).map((m: any) => m.content)).toEqual([
    ["**Late**", "pending | due 2026-03-05, late | Dewi | bbbbbbbb | Send the invoice · 2 days late"].join("\n"),
  ]);
});
