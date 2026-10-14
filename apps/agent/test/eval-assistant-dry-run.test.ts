/**
 * One scripted dry run per daily-behaviour brief: the model script makes the tool calls the persona asks for, the
 * run goes through the real bot against the fake clock, and the output passes every code check. With EVAL_RECORD=1
 * each run is written to apps/agent/eval/recorded/assistant/, where eval-assistant-checks.test.ts re-checks it.
 */
import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const EVAL = () => process.cwd() + "/apps/agent/eval";
const contextLines = (turn: { messages: { role: string; content: unknown }[] }, pattern: RegExp) => String(turn.messages.findLast((m) => m.role === "user")?.content).match(pattern) ?? [];

async function dryRun(s: Scenario, name: string) {
  const { runAssistantFixture, gradeAssistantRun } = await import(`${EVAL()}/assistantRun.ts`);
  const { loadAssistantFixtures } = await import(`${EVAL()}/assistantFixtures.ts`);
  const fixture = loadAssistantFixtures().find((f: any) => f.name === name)!;
  const output = await runAssistantFixture(s, fixture);
  if (process.env.EVAL_RECORD === "1") {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(`${EVAL()}/recorded/assistant`, { recursive: true });
    writeFileSync(`${EVAL()}/recorded/assistant/${name}.json`, `${JSON.stringify({ profile: { provider: "scripted", model: "dry run" }, ...output }, null, 2)}\n`);
  }
  const graded = gradeAssistantRun(output, fixture);
  expect(graded.failures).toEqual([]);
  expect(graded.passed).toBe(true);
  return output;
}

discordScenario("dry run: task-casual-indonesian files one task due Friday and lists it in the fixed format", async (s) => {
  s.model.script(
    { tool: "createTask", args: { title: "Kirim invoice ke Pak Budi", dueAt: "2026-10-16" } },
    "Dicatat: kirim invoice ke Pak Budi, jatuh tempo Jumat 16 Oktober 2026.",
    (turn) => `Jatuh tempo minggu ini:\n${contextLines(turn, /^pending \| .*$/gm).join("\n")}`,
  );
  const output = await dryRun(s, "task-casual-indonesian");
  expect(output.turns[0].state.tasks).toEqual([{ title: "Kirim invoice ke Pak Budi", status: "pending", dueAt: "2026-10-16", assignedTo: null, createdByName: "Alice" }]);
  expect(output.turns[1].replies[0]).toMatch(/^Jatuh tempo minggu ini:\npending \| due 2026-10-16 \| unassigned \| [0-9a-f]{8} \| Kirim invoice ke Pak Budi$/);
});

discordScenario("dry run: task-casual-english files Bob's task due tomorrow, then asks on \"the other one\"", async (s) => {
  s.model.script(
    { tool: "createTask", args: { title: "Book the venue", assignedTo: "Bob", dueAt: "2026-10-15" } },
    "Added: Book the venue, Bob, due Thursday 15 October.",
    "Which task do you mean? The only one here is Book the venue, and it is already Bob's.",
  );
  const output = await dryRun(s, "task-casual-english");
  expect(output.turns[1].state).toEqual(output.turns[0].state);
  expect(output.turns.map((t: any) => t.confirm)).toEqual([false, false]);
});

discordScenario("dry run: due-dates-relative reads Friday, in two hours and tomorrow against the fixed clock", async (s) => {
  s.model.script(
    { tool: "createTask", args: { title: "Send the deck to the client", dueAt: "2026-10-16" } }, "Added: Send the deck to the client, due Friday 16 October.",
    { tool: "createTask", args: { title: "Call the venue", dueAt: "2026-10-14T11:00" } }, "Added: Call the venue, due today at 11:00.",
    { tool: "createTask", args: { title: "Renew the domain", dueAt: "2026-10-15" } }, "Added: Renew the domain, due tomorrow, Thursday 15 October.",
  );
  const output = await dryRun(s, "due-dates-relative");
  expect(output.turns[2].state.tasks.map((t: any) => t.dueAt)).toEqual(["2026-10-14T11:00:00+07:00", "2026-10-15", "2026-10-16"]);
});

discordScenario("dry run: status-by-title changes two seeded tasks without Confirm and lists what is open", async (s) => {
  s.model.script(
    { tool: "updateTaskStatus", args: { taskId: "00000001-0000-4000-8000-000000000000", status: "completed" } }, "Book the venue is completed.",
    { tool: "updateTaskStatus", args: { taskId: "00000002-0000-4000-8000-000000000000", status: "in_progress" } }, "Send the invoice is in progress.",
    (turn) => `Still open:\n${contextLines(turn, /^in_progress \| .*$/gm).join("\n")}`,
  );
  const output = await dryRun(s, "status-by-title");
  expect(output.turns[2].replies).toEqual(["Still open:\nin_progress | due 2026-10-16 | Alice | 00000002 | Send the invoice"]);
});

discordScenario("dry run: remember-forget keeps a channel line, a server line with Manage Server, and forgets the first", async (s) => {
  s.model.script(
    { tool: "remember", args: { level: "channel", text: "Bob prefers to be pinged in the morning" } }, "Kept.",
    { tool: "remember", args: { level: "guild", text: "Releases go out on Thursdays" } }, "Kept for the whole server.",
    { tool: "forget", args: { level: "channel", match: "Bob" } }, (turn) => `Removed ${turn.toolResults[0].removed} line about Bob.`,
  );
  const output = await dryRun(s, "remember-forget");
  expect(output.turns[2].state.memory).toEqual({ channel: [], guild: ["- 2026-10-14 (Alice): Releases go out on Thursdays"] });
});

discordScenario("dry run: file-search files the PDF with its text and finds the budget line", async (s) => {
  s.model.script(
    "Filed as q3-report.pdf under files/, with its text beside it.",
    { tool: "searchFiles", args: { query: "budget", path: "channel/files" } }, (turn) => `q3-report.md: ${turn.toolResults[0].matches[0].text}`,
  );
  const output = await dryRun(s, "file-search");
  expect(output.turns[1].replies).toEqual(["q3-report.md: The Q3 budget is 12 million."]);
});

discordScenario("dry run: reminder-weekly sets Monday and Thursday 09:00 and the tick posts the first one with a ping", async (s) => {
  s.model.script(
    { tool: "createReminder", args: { text: "post the standup", recurrence: "weekly", weekdays: ["monday", "thursday"], time: "09:00" } },
    "Set: every Monday and Thursday at 09:00, first on Thursday 15 October at 09:00.",
  );
  const output = await dryRun(s, "reminder-weekly");
  expect(output.posts).toEqual([{ text: `<@${s.discord.alice.id}> Reminder: post the standup`, pings: [s.discord.alice.id] }]);
});

discordScenario("dry run: a judge over HTTP grades a daily-behaviour trial, and the report reads per turn", async (s) => {
  const { runAssistantTrial } = await import(`${EVAL()}/assistantRun.ts`);
  const { loadAssistantFixtures } = await import(`${EVAL()}/assistantFixtures.ts`);
  const { ASSISTANT_RUBRIC_VERSION } = await import(`${EVAL()}/assistantJudge.ts`);
  const { judgeOverHttp } = await import(`${EVAL()}/judge.ts`);
  const { writeReport } = await import(`${EVAL()}/report.ts`);
  const { mkdtempSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const fixture = loadAssistantFixtures().find((f: any) => f.name === "task-casual-english")!;
  s.model.script(
    { tool: "createTask", args: { title: "Book the venue", assignedTo: "Bob", dueAt: "2026-10-15" } },
    "Added: Book the venue, Bob, due Thursday 15 October.",
    "Which task do you mean? The only one here is Book the venue, and it is already Bob's.",
  );
  const judged: any[] = [];
  s.http.on("POST judge.example.test/v1/chat/completions", (req) => {
    judged.push(req.body);
    const user: string = req.body.messages[1].content;
    const no = /after turn 2/.test(user) && /Is every statement/.test(user);
    return { choices: [{ message: { content: no ? 'It names a task that is not there.\n{"reasoning": "It names a task that is not there.", "verdict": "no"}' : 'Settled by the state.\n{"reasoning": "Settled by the state.", "verdict": "yes"}' } }] };
  });
  const trial = await runAssistantTrial(s, fixture, judgeOverHttp({ provider: "custom", model: "judge-model", baseUrl: "https://judge.example.test/v1", apiKey: "jk" }));
  expect(judged).toHaveLength(fixture.facts.mustCover.length + 2 * fixture.messages.length);
  expect(judged.every((b) => b.system === undefined && b.messages[0].content.includes(`Rubric ${ASSISTANT_RUBRIC_VERSION}`))).toBe(true);
  expect(trial.result.failures).toEqual([]);
  expect(trial.result).toMatchObject({ coverage: 1, questionRate: 1, passed: false, verdicts: [{ n: 1, label: "turn 1", passed: true, reasons: [] }, { n: 2, label: "turn 2", passed: false, reasons: ["unsupported: It names a task that is not there."] }] });
  expect(trial.usage).toMatchObject({ calls: 0, prompt: 0 });

  const dir = mkdtempSync(join(tmpdir(), "eval-assistant-report-"));
  writeReport(dir, { kind: "assistant", judge: { provider: "custom", model: "judge-model" }, rubricVersion: ASSISTANT_RUBRIC_VERSION, trials: 1, startedAt: "2026-10-14T00:00:00.000Z", profiles: [{ name: "a", provider: "openai", model: "m-a" }] }, [{ profile: "a", trial: 1, ...trial }]);
  const md = readFileSync(join(dir, "report.md"), "utf8");
  expect(md).toContain("# Daily-behaviour eval, 2026-10-14T00:00:00.000Z");
  expect(md).toContain(`Judge: custom / judge-model. Rubric ${ASSISTANT_RUBRIC_VERSION}. 1 trial per brief.\n`);
  expect(md).toContain("| task-casual-english | 0.50 |");
  expect(md).toContain("- Trial 1, turn 2: fail. unsupported: It names a task that is not there.");
});
