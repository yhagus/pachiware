import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAssistantFixtures } from "../eval/assistantFixtures";
import { gradeAssistantWithJudge } from "../eval/assistantJudge";
import { gradeAssistantRun, type AssistantOutput } from "../eval/assistantRun";
import { judgeFromEnv, offlineAsk } from "../eval/judge";
import { answering, judgePrompts, type JudgeAnswer } from "../eval/offline-judge";
import { rejudge } from "../eval/rejudge";
import { EVAL_DIR } from "../eval/repository";
import { writeReport } from "../eval/report";

const fixture = loadAssistantFixtures().find((f) => f.name === "task-casual-indonesian")!;
const recorded: AssistantOutput = JSON.parse(readFileSync(join(EVAL_DIR, "recorded", "assistant", "task-casual-indonesian.json"), "utf8"));
const usage = { prompt: 10, completion: 2, calls: 1, latencyMs: 100, ms: 1000 };

/** An offline run of one exam brief: trial 1 as recorded, trial 2 with no reply on turn 2, trial 3 with no reply at all. */
async function offlineRun() {
  const run = mkdtempSync(join(tmpdir(), "eval-offline-"));
  mkdirSync(join(run, "trials"));
  const outputs = [recorded, { ...recorded, turns: [recorded.turns[0]!, { ...recorded.turns[1]!, replies: [] }] }, { ...recorded, turns: recorded.turns.map((t) => ({ ...t, replies: [] })) }];
  const trials = await Promise.all(outputs.map(async (output, i) => ({ profile: "a", trial: i + 1, result: await gradeAssistantWithJudge(gradeAssistantRun(output, fixture), fixture, offlineAsk), usage })));
  for (const t of trials) writeFileSync(join(run, "trials", `a--task-casual-indonesian--${t.trial}.json`), JSON.stringify(t));
  writeReport(run, { kind: "assistant", judge: { provider: "offline", model: "offline" }, rubricVersion: "0.1", trials: 3, startedAt: "2026-10-18T00:00:00.000Z", profiles: [{ name: "a", provider: "custom", model: "deepseek-flash" }] }, trials);
  return run;
}

test("EVAL_JUDGE_PROVIDER=offline needs no model or key, and its run asks nothing: every verdict is unknown", async () => {
  expect(judgeFromEnv({ EVAL_JUDGE_PROVIDER: "offline" })).toEqual({ provider: "offline", model: "offline", baseUrl: null, apiKey: "" });
  const graded = await gradeAssistantWithJudge(gradeAssistantRun(recorded, fixture), fixture, offlineAsk);
  expect(graded.judged.facts.map((f) => f.verdict)).toEqual(["unknown", "unknown"]);
  expect(graded.passed).toBe(false);
});

test("the questions written are those that can change a verdict, each once: a turn its code checks failed, or a trial they failed whole, asks none", async () => {
  const prompts = await judgePrompts(await offlineRun());
  // Trial 1: two must-cover facts and two questions on each of two turns. Trial 2: its turn 2 failed, and its turn 1 questions are
  // trial 1's word for word; its facts read a different conversation. Trial 3 failed every turn.
  expect(prompts.map((p) => [p.trial, p.question, p.turn ?? null]).sort()).toEqual([
    ["a--task-casual-indonesian--1", "fact", null], ["a--task-casual-indonesian--1", "fact", null],
    ["a--task-casual-indonesian--1", "behaviour", 1], ["a--task-casual-indonesian--1", "supported", 1],
    ["a--task-casual-indonesian--1", "behaviour", 2], ["a--task-casual-indonesian--1", "supported", 2],
    ["a--task-casual-indonesian--2", "fact", null], ["a--task-casual-indonesian--2", "fact", null],
  ].sort());
  expect(new Set(prompts.map((p) => p.id)).size).toBe(8);
});

test("the code checks are run again against the current facts: a failure stored by an older fixture asks nothing of its turn no more", async () => {
  const run = await offlineRun(), file = join(run, "trials", "a--task-casual-indonesian--1.json"), trial = JSON.parse(readFileSync(file, "utf8"));
  trial.result.failures = [{ turn: 2, check: "format", message: "A check this fixture no longer makes." }];
  writeFileSync(file, JSON.stringify(trial));
  expect((await judgePrompts(run)).filter((p) => p.trial === "a--task-casual-indonesian--1" && p.turn === 2).map((p) => p.question).sort()).toEqual(["behaviour", "supported"]);
});

test("grading the answers in rejudges the run: written questions must be answered, unwritten ones grade unknown", async () => {
  const run = await offlineRun(), prompts = await judgePrompts(run);
  const yes: JudgeAnswer[] = prompts.map((p) => ({ id: p.id, reasoning: "The reply says so {plainly}.", verdict: "yes" }));
  expect(() => answering(prompts, yes.slice(1))).toThrow(`1 questions have no answer, the first ${prompts[0]!.id} (${prompts[0]!.trial}, ${prompts[0]!.question})`);
  const { dir } = await rejudge(run, answering(prompts, yes), { provider: "claude-code", model: "claude-opus-5-5" });
  // Trial 1 passes both turns, trial 2 turn 1 only, trial 3 neither: the brief scores (1 + 0.5 + 0) / 3, the tasks area alone.
  expect(readFileSync(join(dir, "report.md"), "utf8")).toStartWith("# Rapor v3: 50.0 (a)\n\nDaily-behaviour eval, 2026-10-18T00:00:00.000Z. Judge: claude-code / claude-opus-5-5.");
  const trial1 = JSON.parse(readFileSync(join(dir, "trials", "a--task-casual-indonesian--1.json"), "utf8"));
  expect(trial1.result.judged.facts[0]).toEqual({ fact: fixture.facts.mustCover[0], reasoning: "The reply says so (plainly).", verdict: "yes" });
});
