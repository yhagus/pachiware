/**
 * Grades a finished run again with the current rubric and the EVAL_JUDGE_* judge, without running the bot:
 * `bun apps/agent/eval/rejudge.ts apps/agent/eval/results/<run>`. Used while calibrating the rubric by hand.
 * Results go to `<run>/rejudged-<rubric version>/`; the original run is left as it was. A daily-behaviour run
 * (report.json `kind: assistant`) is regraded with its own rubric.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAssistantFixtures } from "./assistantFixtures";
import { ASSISTANT_RUBRIC_VERSION, gradeAssistantWithJudge, type AssistantJudged } from "./assistantJudge";
import type { TrialResult } from "./compare";
import { loadFixtures } from "./fixtures";
import { assertJudgeOutside, gradeWithJudge, judgeFromEnv, judgeOverHttp, RUBRIC_VERSION, type Ask, type JudgedResult } from "./judge";
import { writeReport, type RunMeta } from "./report";

export async function rejudge(runDir: string, ask: Ask, judge: RunMeta["judge"]): Promise<string> {
  const meta = JSON.parse(readFileSync(join(runDir, "report.json"), "utf8")) as RunMeta;
  assertJudgeOutside(judge, meta.profiles);
  const assistant = meta.kind === "assistant", version = assistant ? ASSISTANT_RUBRIC_VERSION : RUBRIC_VERSION;
  const fixtures = new Map<string, any>((assistant ? loadAssistantFixtures() : loadFixtures()).map((f) => [f.name, f]));
  const out = join(runDir, `rejudged-${version}`);
  mkdirSync(join(out, "trials"), { recursive: true });
  const trials: TrialResult[] = [];
  for (const file of readdirSync(join(runDir, "trials")).filter((f) => f.endsWith(".json")).sort()) {
    const trial = JSON.parse(readFileSync(join(runDir, "trials", file), "utf8")) as TrialResult;
    const fixture = fixtures.get(trial.result.fixture);
    if (!fixture) throw new Error(`${file}: no fixture named ${trial.result.fixture}`);
    const { judged, coverage, questionRate, verdicts, ...checked } = trial.result;
    const result = assistant
      ? await gradeAssistantWithJudge({ ...(checked as AssistantJudged), passed: !checked.failures.length }, fixture, ask)
      : await gradeWithJudge({ ...(checked as JudgedResult), passed: !checked.failures.length }, fixture, ask);
    const again = { ...trial, result };
    writeFileSync(join(out, "trials", file), `${JSON.stringify(again, null, 2)}\n`);
    trials.push(again);
  }
  writeReport(out, { ...meta, judge, rubricVersion: version }, trials);
  return out;
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: bun apps/agent/eval/rejudge.ts <run folder>");
  const judge = judgeFromEnv();
  console.log(`Report: ${join(await rejudge(dir, judgeOverHttp(judge), { provider: judge.provider, model: judge.model }), "report.md")}`);
}
