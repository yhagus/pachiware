/**
 * Grades a finished run's drafts again with the current rubric and the EVAL_JUDGE_* judge, without running the bot:
 * `bun apps/agent/eval/rejudge.ts apps/agent/eval/results/<run>`. Used while calibrating the rubric by hand (#49).
 * Results go to `<run>/rejudged-<rubric version>/`; the original run is left as it was.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TrialResult } from "./compare";
import { loadFixtures } from "./fixtures";
import { assertJudgeOutside, gradeWithJudge, judgeFromEnv, judgeOverHttp, RUBRIC_VERSION, type Ask } from "./judge";
import { writeReport, type RunMeta } from "./report";

export async function rejudge(runDir: string, ask: Ask, judge: RunMeta["judge"]): Promise<string> {
  const meta = JSON.parse(readFileSync(join(runDir, "report.json"), "utf8")) as RunMeta;
  assertJudgeOutside(judge, meta.profiles);
  const fixtures = new Map(loadFixtures().map((f) => [f.name, f]));
  const out = join(runDir, `rejudged-${RUBRIC_VERSION}`);
  mkdirSync(join(out, "trials"), { recursive: true });
  const trials: TrialResult[] = [];
  for (const file of readdirSync(join(runDir, "trials")).filter((f) => f.endsWith(".json")).sort()) {
    const trial = JSON.parse(readFileSync(join(runDir, "trials", file), "utf8")) as TrialResult;
    const fixture = fixtures.get(trial.result.fixture);
    if (!fixture) throw new Error(`${file}: no fixture named ${trial.result.fixture}`);
    const { judged, coverage, questionRate, verdicts, ...checked } = trial.result;
    const again = { ...trial, result: await gradeWithJudge({ ...checked, passed: !checked.failures.length }, fixture, ask) };
    writeFileSync(join(out, "trials", file), `${JSON.stringify(again, null, 2)}\n`);
    trials.push(again);
  }
  writeReport(out, { ...meta, judge, rubricVersion: RUBRIC_VERSION }, trials);
  return out;
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: bun apps/agent/eval/rejudge.ts <run folder>");
  const judge = judgeFromEnv();
  console.log(`Report: ${join(await rejudge(dir, judgeOverHttp(judge), { provider: judge.provider, model: judge.model }), "report.md")}`);
}
