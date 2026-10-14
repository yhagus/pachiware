import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const TASKS = "guilds/guild-1/channels/channel-1/tasks";
const contextOf = (call: { role: string; content: unknown }[]) => String(call.findLast((m) => m.role === "user")?.content);
const titles = (data: any) => data.tasks?.map((t: any) => t.title).sort().join(", ") || `none${data.error ? `: ${data.error}` : ""}`;
const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
interface Seed { n: number; title: string; body?: string; status?: string; assignedTo?: string; dueAt?: string }
const taskFile = (f: Seed) =>
  `---\nid: "${id(f.n)}"\ntitle: ${JSON.stringify(f.title)}\nstatus: "${f.status ?? "pending"}"\npriority: "medium"\nassignedTo: ${f.assignedTo ? JSON.stringify({ name: f.assignedTo }) : "null"}\ndueAt: ${JSON.stringify(f.dueAt ?? null)}\ncreatedBy: "user-alice"\ncreatedByName: "Alice"\ncreatedAt: "2026-10-0${1 + (f.n % 9)}T00:00:00.000Z"\nupdatedAt: "2026-10-01T00:00:00.000Z"\n---\n${f.body ?? ""}\n`;
/** A channel with more tasks than the turn context shows: twelve fillers plus the tasks a test names. */
async function seed(s: Scenario, extra: Seed[]) {
  for (let n = 1; n <= 12; n++) await s.workspace.write(`${TASKS}/filler-${n}.md`, taskFile({ n, title: `Routine chore ${n}`, body: "Nothing special here." }));
  for (const f of extra) await s.workspace.write(`${TASKS}/task-${f.n}.md`, taskFile(f));
}

discordScenario("with more than ten tasks in the channel, a query finds a task by a word in its title or a word only in its description, in any letter case", async (s) => {
  await s.guildSettings({ useThreads: false });
  await seed(s, [
    { n: 20, title: "Renew the Domain", body: "Before it lapses." },
    { n: 21, title: "Call the printer", body: "Ask about the BROCHURE proofs and the paper stock." },
  ]);

  s.model.script({ tool: "listTasks", args: { query: "domain" } }, (turn) => titles(turn.toolResults[0]));
  await s.discord.send(`${s.discord.mention} what about the domain task?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Renew the Domain");

  s.model.script({ tool: "listTasks", args: { query: "Brochure" } }, (turn) => titles(turn.toolResults[0]));
  await s.discord.send(`${s.discord.mention} the brochure one`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Call the printer");

  s.model.script({ tool: "listTasks", args: { query: "venue" } }, (turn) => titles(turn.toolResults[0]));
  await s.discord.send(`${s.discord.mention} the venue one`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("none");
});

discordScenario("a task found by its description among more than ten has its title, description and priority edited without Confirm; other fields stay and updatedAt moves", async (s) => {
  s.clock.set("2026-10-14T03:00:00Z");
  await s.guildSettings({ useThreads: false });
  await seed(s, [{ n: 40, title: "Call the printer", body: "Ask about the brochure proofs.", status: "in_progress", assignedTo: "Bob", dueAt: "2026-10-20" }]);
  const path = `${TASKS}/task-40.md`, before = (await s.workspace.read(path))!;

  s.model.script({ tool: "listTasks", args: { query: "brochure" } }, (turn) => ({ tool: "editTask", args: { taskId: turn.toolResults[0].tasks[0].id.slice(0, 8), title: "Call the print shop" } }), (turn) => turn.toolResults.at(-1).message);
  await s.discord.send(`${s.discord.mention} rename the brochure task to "Call the print shop"`);
  expect(s.discord.botMessages.at(-1)?.content).toContain("Call the print shop");
  let file = (await s.workspace.read(path))!;
  expect(file).toContain('title: "Call the print shop"');
  expect(file).toContain("Ask about the brochure proofs.");
  expect(file).toContain('updatedAt: "2026-10-14T03:00:00.000Z"');
  expect(file.replace(/^(title|updatedAt): .*$/gm, "")).toBe(before.replace(/^(title|updatedAt): .*$/gm, ""));

  s.clock.set("2026-10-15T03:00:00Z");
  s.model.script({ tool: "editTask", args: { taskId: "00000040", description: "Ask about the brochure proofs and the paper stock.", priority: "urgent" } }, (turn) => turn.toolResults[0].task.priority);
  await s.discord.send(`${s.discord.mention} it's urgent, and ask about the paper stock too`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("urgent");
  file = (await s.workspace.read(path))!;
  expect(file).toContain('priority: "urgent"');
  expect(file).toContain("\n---\nAsk about the brochure proofs and the paper stock.\n");
  expect(file).not.toContain("\nAsk about the brochure proofs.\n");
  expect(file).toContain('title: "Call the print shop"');
  expect(file).toContain('status: "in_progress"');
  expect(file).toContain('assignedTo: {"name":"Bob"}');
  expect(file).toContain('dueAt: "2026-10-20"');
  expect(file).toContain('createdAt: "2026-10-05T00:00:00.000Z"');
  expect(file).toContain('updatedAt: "2026-10-15T03:00:00.000Z"');
  expect(s.discord.botMessages.filter((m) => m.components.length > 0)).toEqual([]);
});

discordScenario("an edit with an empty title, a title over 200 characters, or an unknown priority is refused and the file stays", async (s) => {
  await s.guildSettings({ useThreads: false });
  await seed(s, [{ n: 50, title: "Book the venue", body: "Seats for forty." }]);
  const path = `${TASKS}/task-50.md`, before = (await s.workspace.read(path))!;

  s.model.script(
    { tool: "editTask", args: { taskId: "00000050", title: "   " } }, (turn) => `refused: ${turn.toolResults[0].error}`,
    { tool: "editTask", args: { taskId: "00000050", title: "x".repeat(201) } }, (turn) => `refused: ${turn.toolResults[0].error}`,
    { tool: "editTask", args: { taskId: "00000050", priority: "someday" } }, (turn) => `refused: ${turn.toolResults[0].error}`,
  );
  for (const text of ["clear the title", "make the title huge", "priority someday"]) await s.discord.send(`${s.discord.mention} ${text}`);
  const replies = s.discord.botMessages.slice(-3).map((m) => m.content);
  expect(replies[0]).toMatch(/^refused: .*title/i);
  expect(replies[1]).toMatch(/^refused: .*title.*200/i);
  expect(replies[2]).toMatch(/^refused: .*priority/i);
  expect(await s.workspace.read(path)).toBe(before);
});

discordScenario("a query matching several tasks returns all of them, and it narrows together with the status, assignee and due-date filters", async (s) => {
  s.clock.set("2026-10-14T03:00:00Z");
  await s.guildSettings({ useThreads: false });
  await seed(s, [
    { n: 30, title: "Invoice for Acme", assignedTo: "Bob", dueAt: "2026-10-10" },
    { n: 31, title: "Chase payment", body: "The invoice from Globex is overdue.", assignedTo: "Dewi", dueAt: "2026-10-20" },
    { n: 32, title: "File the invoice", status: "completed", assignedTo: "Bob" },
  ]);

  s.model.script({ tool: "listTasks", args: { query: "invoice" } }, (turn) => titles(turn.toolResults[0]));
  await s.discord.send(`${s.discord.mention} update the invoice task`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Chase payment, File the invoice, Invoice for Acme");

  s.model.script(
    { tool: "listTasks", args: { query: "invoice", status: "pending" } }, (turn) => titles(turn.toolResults[0]),
    { tool: "listTasks", args: { query: "INVOICE", assignedTo: "bob" } }, (turn) => titles(turn.toolResults[0]),
    { tool: "listTasks", args: { query: "invoice", late: true } }, (turn) => titles(turn.toolResults[0]),
    { tool: "listTasks", args: { query: "invoice", dueAfter: "2026-10-15" } }, (turn) => titles(turn.toolResults[0]),
    { tool: "listTasks", args: { query: "invoice globex" } }, (turn) => titles(turn.toolResults[0]),
  );
  for (const text of ["pending ones", "Bob's", "late ones", "due later", "the Globex one"]) await s.discord.send(`${s.discord.mention} ${text}`);
  expect(s.discord.botMessages.slice(-5).map((m) => m.content)).toEqual([
    "Chase payment, Invoice for Acme",
    "File the invoice, Invoice for Acme",
    "Invoice for Acme",
    "Chase payment",
    "Chase payment",
  ]);
});
