import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAssistantFixtures } from "../eval/assistantFixtures";
import { ASSISTANT_RUBRIC_VERSION, gradeAssistantWithJudge } from "../eval/assistantJudge";
import { gradeAssistantRun } from "../eval/assistantRun";
import { loadCalibration } from "../eval/calibration";
import { RUBRIC_VERSION } from "../eval/judge";
import { EVAL_DIR } from "../eval/repository";
import { rejudge } from "../eval/rejudge";

test("rejudge grades a finished run's drafts again with the current rubric, without running the bot, into a new folder", async () => {
  const recorded = JSON.parse(readFileSync(join(EVAL_DIR, "recorded", "thread-replies-debounced.json"), "utf8"));
  const run = mkdtempSync(join(tmpdir(), "eval-run-"));
  mkdirSync(join(run, "trials"));
  const old = { ...recorded, failures: [], passed: false, judged: { facts: [], questions: [], drafts: [] }, coverage: 0, questionRate: null, verdicts: [{ n: 1, passed: false, reasons: ["coverage: stale"] }] };
  writeFileSync(join(run, "trials", "a--thread-replies-debounced--1.json"), JSON.stringify({ profile: "a", trial: 1, result: old, usage: { prompt: 1, completion: 1, calls: 1, latencyMs: 5, ms: 9 } }));
  writeFileSync(join(run, "report.json"), JSON.stringify({ judge: { provider: "openai", model: "old-judge" }, rubricVersion: "0.0", trials: 1, repo: recorded.repo, commit: recorded.commit, startedAt: "2026-10-11T00:00:00.000Z", profiles: [{ name: "a", provider: "openai", model: "m-a" }] }));

  const prompts: string[] = [];
  const { dir: out, agreement } = await rejudge(run, async (_system, user) => { prompts.push(user); return '{"reasoning": "Covered.", "verdict": "yes"}'; }, { provider: "anthropic", model: "new-judge" });
  expect(agreement).toBeNull();

  expect(out).toBe(join(run, `rejudged-${RUBRIC_VERSION}`));
  expect(prompts.length).toBeGreaterThan(0);
  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  expect(report).toMatchObject({ judge: { provider: "anthropic", model: "new-judge" }, rubricVersion: RUBRIC_VERSION, trials: 1 });
  expect(report.results[0].result.verdicts).toEqual([{ n: 1, passed: true, reasons: [] }]);
  expect(report.results[0].usage.latencyMs).toBe(5);
  expect(readFileSync(join(out, "trials", "a--thread-replies-debounced--1.json"), "utf8")).toContain('"passed": true');
});

test("rejudge prints how often the judge agrees with the human grades of its rubric version, overall and per criterion, and reports items naming nothing in the run", async () => {
  const fixture = loadAssistantFixtures().find((f) => f.name === "task-casual-english")!;
  const recorded = JSON.parse(readFileSync(join(EVAL_DIR, "recorded", "assistant", "task-casual-english.json"), "utf8"));
  const root = mkdtempSync(join(tmpdir(), "eval-calibration-")), run = join(root, "assistant-run-1"), calibration = join(root, "calibration");
  mkdirSync(join(run, "trials"), { recursive: true });
  mkdirSync(calibration);
  const graded = await gradeAssistantWithJudge(gradeAssistantRun(recorded, fixture), fixture, async () => '{"reasoning": "Old.", "verdict": "yes"}');
  for (const n of [1, 2]) writeFileSync(join(run, "trials", `a--task-casual-english--${n}.json`), JSON.stringify({ profile: "a", trial: n, result: graded, usage: { prompt: 1, completion: 1, calls: 1, latencyMs: 5, ms: 9 } }));
  writeFileSync(join(run, "report.json"), JSON.stringify({ kind: "assistant", judge: { provider: "openai", model: "old-judge" }, rubricVersion: "0.0", trials: 2, startedAt: "2026-10-18T00:00:00.000Z", profiles: [{ name: "a", provider: "openai", model: "m-a" }] }));
  // The judge says yes to all but turn 2's support, in both trials; the person agrees on all but trial 2's.
  const item = (trial: number, criterion: string, human: string, turn?: number, rest = "") => `- { run: assistant-run-1, trial: a--task-casual-english--${trial}, ${turn === undefined ? "" : `turn: ${turn}, `}criterion: ${criterion}, human: ${human}${rest} }`;
  writeFileSync(join(calibration, `${ASSISTANT_RUBRIC_VERSION}.yaml`), [
    ...[1, 2].flatMap((t) => [item(t, "fact 1", "yes"), item(t, "behaviour", "yes", 1), item(t, "supported", "yes", 1), item(t, "behaviour", "yes", 2)]),
    item(1, "supported", "no", 2),
    item(2, "supported", "yes", 2, ", note: the reply names only the task in the state"),
    item(3, "supported", "yes", 1),
    item(1, "supported", "yes", 3),
    "- { run: assistant-run-0, trial: a--task-casual-english--1, criterion: fact 1, human: no }",
  ].join("\n"));
  const ask = async (_system: string, user: string) => `{"reasoning": "Checked.", "verdict": "${/Recorded state after turn 2/.test(user) ? "no" : "yes"}"}`;
  const { dir, agreement } = await rejudge(run, ask, { provider: "anthropic", model: "new-judge" }, calibration);
  const expected = [
    `Agreement with the human grades in calibration/${ASSISTANT_RUBRIC_VERSION}.yaml: 9 of 10 items (90%).`,
    "- behaviour: 4 of 4 (100%)",
    "- fact: 2 of 2 (100%)",
    "- supported: 3 of 4 (75%)",
    "The rubric freezes at 1.0 at 90% or more on at least 20 items: not yet, 10 graded.",
    "",
    "Disagreements:",
    "- a--task-casual-english--2, supported, turn 2: the judge said no, the person yes. the reply names only the task in the state",
    "",
    "Not in the run:",
    "- a--task-casual-english--3, supported, turn 1: no such trial.",
    "- a--task-casual-english--1, supported, turn 3: the trial has no such criterion.",
  ].join("\n");
  expect(agreement).toBe(expected);
  expect(readFileSync(join(dir, "agreement.md"), "utf8")).toBe(`${expected}\n`);
});

test("a calibration item without a run, a trial, a criterion or a yes or no is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "eval-calibration-"));
  writeFileSync(join(dir, "0.1.yaml"), "- { run: r, trial: t, criterion: fact 1, human: maybe }\n");
  expect(() => loadCalibration("0.1", dir)).toThrow("calibration/0.1.yaml item 1 needs a run, a trial, a criterion, human: yes or no, and a whole turn when it names one");
  expect(loadCalibration("0.2", dir)).toEqual([]);
});

test("rejudge refuses a judge whose model is one of the run's profiles", async () => {
  const run = mkdtempSync(join(tmpdir(), "eval-run-"));
  mkdirSync(join(run, "trials"));
  writeFileSync(join(run, "report.json"), JSON.stringify({ profiles: [{ name: "a", provider: "openai", model: "m-a" }] }));
  await expect(rejudge(run, async () => "", { provider: "openai", model: "m-a" })).rejects.toThrow("pick a judge outside the compared profiles");
});
