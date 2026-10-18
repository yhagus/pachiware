import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAssistantFixtures } from "../eval/assistantFixtures";
import { ASSISTANT_RUBRIC_VERSION, gradeAssistantWithJudge } from "../eval/assistantJudge";
import { gradeAssistantRun, type AssistantOutput } from "../eval/assistantRun";
import type { Ask } from "../eval/judge";
import { rejudge } from "../eval/rejudge";
import { EVAL_DIR } from "../eval/repository";
import { writeReport } from "../eval/report";
import { loadExam } from "../eval/scorecard";

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
  test("a quiet turn is graded by code alone: the judge is asked nothing about it", async () => {
    const quiet = { ...fixture, facts: { ...fixture.facts, turns: [fixture.facts.turns[0]!, { quiet: true as const, reaction: ["👍"] }] } };
    const output: AssistantOutput = { ...recorded, turns: [recorded.turns[0]!, { ...recorded.turns[1]!, replies: [], reactions: ["👍"] }] };
    const { ask, prompts } = scriptedJudge([]);
    const graded = await gradeAssistantWithJudge(gradeAssistantRun(output, quiet), quiet, ask);
    expect(prompts).toHaveLength(fixture.facts.mustCover.length + 2);
    expect(prompts.some((p) => p.user.includes("Look only at turn 2"))).toBe(false);
    expect(graded.verdicts.map((v) => [v.n, v.passed])).toEqual([[1, true], [2, true]]);
  });

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
  const { dir: out } = await rejudge(run, again, { provider: "custom", model: "new-judge" });
  expect(out).toBe(join(run, `rejudged-${ASSISTANT_RUBRIC_VERSION}`));
  expect(prompts.length).toBeGreaterThan(0);
  expect(prompts.every((p) => p.system.includes(`administrative assistant`) && p.system.includes(`Rubric ${ASSISTANT_RUBRIC_VERSION}`) && !p.system.includes("issue drafts"))).toBe(true);
  const md = readFileSync(join(out, "report.md"), "utf8");
  // task-casual-english is the only brief run, a tasks brief: its trial scores 1 of 2 turns.
  expect(md).toStartWith(`# Rapor v1: 50.0 (a)\n\nDaily-behaviour eval, 2026-10-14T00:00:00.000Z. Judge: custom / new-judge. Rubric ${ASSISTANT_RUBRIC_VERSION}. 1 trial per brief.\n`);
  expect(md).toContain("- Trial 1, turn 2: fail. unsupported: Nothing supports it.");
});

test("the report of the recorded runs, every criterion judged yes, opens with the Rapor and scores each area", async () => {
  const dir = join(EVAL_DIR, "recorded", "assistant");
  const trials = await Promise.all(readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map(async (f) => {
    const run: AssistantOutput = JSON.parse(readFileSync(join(dir, f), "utf8")), brief = fixtures.find((x) => x.name === run.fixture)!;
    return { profile: "dry run", trial: 1, result: await gradeAssistantWithJudge(gradeAssistantRun(run, brief), brief, scriptedJudge([]).ask), usage: { prompt: 0, completion: 0, calls: 0, latencyMs: 0, ms: 0 } };
  }));
  const out = mkdtempSync(join(tmpdir(), "eval-assistant-rapor-"));
  writeReport(out, { kind: "assistant", judge: { provider: "custom", model: "judge" }, rubricVersion: ASSISTANT_RUBRIC_VERSION, trials: 1, startedAt: "2026-10-18T00:00:00.000Z", profiles: [{ name: "dry run", provider: "scripted", model: "dry run" }] }, trials, loadExam(fixtures));
  const md = readFileSync(join(out, "report.md"), "utf8");
  expect(md).toStartWith("# Rapor v1: 100.0 (dry run)\n");
  expect(md).toContain([
    "| Area | Weight | Score | Briefs | Holdout score |",
    "|---|---|---|---|---|",
    "| capture | 20 | 100.0 | 4 |  |",
    "| recall | 25 | 100.0 | 11 |  |",
    "| tasks | 20 | 100.0 | 12 |  |",
    "| group | 10 | 100.0 | 1 |  |",
    "| loop | 15 | 100.0 | 1 |  |",
  ].join("\n"));
});

test("the judge reads another member's turn under their name, a burst line by line, and the Minutes the bot wrote", async () => {
  const graded = async (name: string) => {
    const brief = fixtures.find((f) => f.name === name)!, run: AssistantOutput = JSON.parse(readFileSync(join(EVAL_DIR, "recorded", "assistant", `${name}.json`), "utf8"));
    const { ask, prompts } = scriptedJudge([]);
    await gradeAssistantWithJudge(gradeAssistantRun(run, brief), brief, ask);
    return prompts.map((p) => p.user);
  };
  const thread = await graded("member-joins-thread");
  expect(thread.some((p) => p.includes("### Turn 2\nBob: tambahin satu lagi buat aku ya: cetak name tag peserta\nBot: "))).toBe(true);
  expect(thread.some((p) => p.includes("### Turn 3\nBob: name tag-nya dicetak 60 buah ya\nAuthor: oke Bob, makasih\nBot: "))).toBe(true);
  const minutes = await graded("minutes-from-talk");
  expect(minutes.find((p) => p.includes("Recorded state after turn 1"))).toContain("Minutes and Daily logs the bot wrote:\n#### minutes/2026-10-14-harga-paket.md\n# Harga paket");
});
