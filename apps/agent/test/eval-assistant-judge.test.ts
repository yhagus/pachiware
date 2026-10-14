import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAssistantFixtures } from "../eval/assistantFixtures";
import { ASSISTANT_RUBRIC_VERSION, gradeAssistantWithJudge } from "../eval/assistantJudge";
import { gradeAssistantRun, type AssistantOutput } from "../eval/assistantRun";
import type { Ask } from "../eval/judge";
import { rejudge } from "../eval/rejudge";
import { EVAL_DIR } from "../eval/repository";
import { writeReport } from "../eval/report";

const fixtures = loadAssistantFixtures();
const fixture = fixtures.find((f) => f.name === "task-casual-english")!;
const recorded: AssistantOutput = JSON.parse(readFileSync(join(EVAL_DIR, "recorded", "assistant", "task-casual-english.json"), "utf8"));
const verdict = (v: string, why = "Checked against the state.") => `${why}\n{"reasoning": ${JSON.stringify(why)}, "verdict": "${v}"}`;

function scriptedJudge(answers: [RegExp, string][]) {
  const prompts: { system: string; user: string }[] = [];
  const ask: Ask = async (system, user) => {
    prompts.push({ system, user });
    return answers.find(([match]) => match.test(user))?.[1] ?? verdict("yes");
  };
  return { ask, prompts };
}

describe("grading a daily-behaviour run with the judge", () => {
  test("asks one question per must-cover fact and two per turn, with the conversation and the recorded state in the prompt", async () => {
    const { ask, prompts } = scriptedJudge([]);
    const graded = await gradeAssistantWithJudge(gradeAssistantRun(recorded, fixture), fixture, ask);
    expect(prompts).toHaveLength(fixture.facts.mustCover.length + 2 * recorded.turns.length);
    for (const p of prompts) {
      expect(p.system).toContain(`Rubric ${ASSISTANT_RUBRIC_VERSION}`);
      expect(p.system).not.toContain("issue drafts");
      expect(p.user).toContain(`Author: ${fixture.messages[0]}`);
    }
    const fact = prompts.find((p) => p.user.includes(`must convey this fact:\n${fixture.facts.mustCover[0]}`))!;
    expect(fact.user).toContain("pending | due 2026-10-15 | Bob | Book the venue (created by Alice)");
    const clear = prompts.find((p) => p.user.includes("Look only at turn 1. The request is clear."))!;
    expect(clear.user).not.toContain("### Turn 2");
    const ambiguous = prompts.find((p) => p.user.includes("Look only at turn 2. The request is ambiguous: there is only one task here"))!;
    expect(ambiguous.user).toContain("### Turn 2");
    const supported = prompts.find((p) => p.user.includes("Recorded state after turn 2"))!;
    expect(supported.user).toContain("Is every statement they make about tasks, Memory, files or Reminders");
    expect(graded).toMatchObject({ coverage: 1, questionRate: 1, passed: true, verdicts: [{ n: 1, label: "turn 1", passed: true, reasons: [] }, { n: 2, label: "turn 2", passed: true, reasons: [] }] });
  });

  test("a turn fails with a reason per failure: code checks, coverage under 80%, acting on an ambiguous request, an unsupported claim", async () => {
    const { ask } = scriptedJudge([
      [/must convey this fact/, verdict("no", "The due date is never said.")],
      [/Look only at turn 2\. The request is ambiguous/, verdict("no", "It assigned a task instead of asking.")],
      [/Recorded state after turn 1/, verdict("no", "It says the venue is booked; no task says so.")],
    ]);
    const broken: AssistantOutput = { ...recorded, turns: recorded.turns.map((t) => (t.n === 1 ? { ...t, confirm: true } : t)) };
    const graded = await gradeAssistantWithJudge(gradeAssistantRun(broken, fixture), fixture, ask);
    expect(graded.coverage).toBe(0);
    expect(graded.questionRate).toBe(0.5);
    expect(graded.passed).toBe(false);
    const coverage = "coverage: 0 of 1 must-cover facts conveyed, under 80%. Missing: Booking the venue is Bob's task, due tomorrow, Thursday 15 October 2026 (The due date is never said.)";
    expect(graded.verdicts).toEqual([
      { n: 1, label: "turn 1", passed: false, reasons: ["confirm: A Confirm button was offered; nothing here needs one.", coverage, "unsupported: It says the venue is booked; no task says so."] },
      { n: 2, label: "turn 2", passed: false, reasons: [coverage, "acted: It assigned a task instead of asking."] },
    ]);
  });

  test("unknown is not coverage, and an unknown behaviour or support verdict does not fail a turn", async () => {
    const { ask } = scriptedJudge([[/./, verdict("unknown")]]);
    const graded = await gradeAssistantWithJudge(gradeAssistantRun(recorded, fixture), fixture, ask);
    expect(graded.coverage).toBe(0);
    expect(graded.questionRate).toBe(0);
    expect(graded.verdicts.map((v) => v.reasons.map((r) => r.split(":")[0]))).toEqual([["coverage"], ["coverage"]]);
  });

  test("a judge call that throws is recorded as unknown with the error", async () => {
    const graded = await gradeAssistantWithJudge(gradeAssistantRun(recorded, fixture), fixture, async () => { throw new Error("socket hang up"); });
    expect(graded.judged.turns[0]!.behaviour).toEqual({ verdict: "unknown", reasoning: "The judge call failed: socket hang up" });
  });

  test("a run where the bot never replied fails every turn", async () => {
    const graded = await gradeAssistantWithJudge(gradeAssistantRun({ ...recorded, turns: [] }, fixture), fixture, scriptedJudge([]).ask);
    expect(graded.passed).toBe(false);
    expect(graded.coverage).toBe(0);
    expect(graded.verdicts.map((v) => [v.n, v.passed, v.reasons[0]])).toEqual([[1, false, "reply: The bot did not reply."], [2, false, "reply: The bot did not reply."]]);
  });
});

test("bun run eval:assistant refuses to start when the judge's model is a compared profile's", () => {
  const run = Bun.spawnSync({
    cmd: ["bun", "test", "./apps/agent/eval/assistant.eval.ts"], cwd: join(import.meta.dir, "../../.."),
    env: { PATH: process.env.PATH, HOME: process.env.HOME, EVAL_LIVE: "1", EVAL_MODEL: "gpt-5-mini", EVAL_API_KEY: "k", EVAL_JUDGE_MODEL: "gpt-5-mini", EVAL_JUDGE_API_KEY: "j" },
  });
  const output = new TextDecoder().decode(run.stderr) + new TextDecoder().decode(run.stdout);
  expect(run.exitCode).not.toBe(0);
  expect(output).toContain("The judge model gpt-5-mini is also the model of profile gpt-5-mini; pick a judge outside the compared profiles.");
  expect(output).not.toContain("trial 1");
});

test("rejudge regrades a daily-behaviour run with the assistant rubric, not the issue-draft one", async () => {
  const { ask } = scriptedJudge([]);
  const graded = await gradeAssistantWithJudge(gradeAssistantRun(recorded, fixture), fixture, ask);
  const run = mkdtempSync(join(tmpdir(), "eval-assistant-run-"));
  mkdirSync(join(run, "trials"));
  const trial = { profile: "a", trial: 1, result: graded, usage: { prompt: 10, completion: 2, calls: 1, latencyMs: 100, ms: 1000 } };
  writeFileSync(join(run, "trials", "a--task-casual-english--1.json"), JSON.stringify(trial));
  writeReport(run, { kind: "assistant", judge: { provider: "custom", model: "old-judge" }, rubricVersion: "0.0", trials: 1, startedAt: "2026-10-14T00:00:00.000Z", profiles: [{ name: "a", provider: "openai", model: "m-a" }] }, [trial]);
  const { prompts, ask: again } = scriptedJudge([[/Recorded state after turn 2/, verdict("no", "Nothing supports it.")]]);
  const out = await rejudge(run, again, { provider: "custom", model: "new-judge" });
  expect(out).toBe(join(run, `rejudged-${ASSISTANT_RUBRIC_VERSION}`));
  expect(prompts.length).toBeGreaterThan(0);
  expect(prompts.every((p) => p.system.includes(`administrative assistant`) && p.system.includes(`Rubric ${ASSISTANT_RUBRIC_VERSION}`) && !p.system.includes("issue drafts"))).toBe(true);
  const md = readFileSync(join(out, "report.md"), "utf8");
  expect(md).toContain(`# Daily-behaviour eval, 2026-10-14T00:00:00.000Z\n\nJudge: custom / new-judge. Rubric ${ASSISTANT_RUBRIC_VERSION}. 1 trial per brief.\n`);
  expect(md).toContain("- Trial 1, turn 2: fail. unsupported: Nothing supports it.");
});
