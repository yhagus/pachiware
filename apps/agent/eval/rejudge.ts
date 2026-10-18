/**
 * Grades a finished run again with the current rubric and the EVAL_JUDGE_* judge, without running the bot:
 * `bun apps/agent/eval/rejudge.ts apps/agent/eval/results/<run>`. Used while calibrating the rubric by hand.
 * Results go to `<run>/rejudged-<rubric version>/`; the original run is left as it was. A daily-behaviour run
 * (report.json `kind: assistant`) is regraded with its own rubric. The human grades `calibration/<rubric version>.yaml` keeps
 * for this run are compared with the new verdicts, and the agreement printed.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { LIVED_IN_DIR, loadAssistantFixtures, loadEveryAssistantFixture, type AssistantFixture } from "./assistantFixtures";
import { agreementText, loadCalibration } from "./calibration";
import { ASSISTANT_RUBRIC_VERSION, gradeAssistantWithJudge, type AssistantJudged } from "./assistantJudge";
import { gradeAssistantRun, type AssistantOutput, type AssistantResult } from "./assistantRun";
import type { TrialResult } from "./compare";
import { loadFixtures } from "./fixtures";
import { assertJudgeOutside, gradeWithJudge, judgeFromEnv, judgeOverHttp, RUBRIC_VERSION, type Ask, type JudgedResult } from "./judge";
import { writeReport, type RunMeta } from "./report";
import { EVAL_DIR } from "./repository";
import { loadExam, loadLivedInExam } from "./scorecard";

/** A daily-behaviour trial's output graded by code again, against the fixture as it is now. */
export function recheck(result: AssistantResult, fixture: AssistantFixture): AssistantResult {
  const { failures: _, passed: __, ...output } = result;
  return gradeAssistantRun(output as AssistantOutput, fixture);
}

/** Resolves to the new folder and, when `calibration/<version>.yaml` grades this run, how often the judge agrees with the person (also kept as agreement.md). */
export async function rejudge(runDir: string, ask: Ask, judge: RunMeta["judge"], calibration = join(EVAL_DIR, "calibration")): Promise<{ dir: string; agreement: string | null }> {
  const meta = JSON.parse(readFileSync(join(runDir, "report.json"), "utf8")) as RunMeta;
  assertJudgeOutside(judge, meta.profiles);
  const assistant = meta.kind === "assistant", version = assistant ? ASSISTANT_RUBRIC_VERSION : RUBRIC_VERSION;
  const briefs = assistant ? loadEveryAssistantFixture() : loadFixtures(), fixtures = new Map<string, any>(briefs.map((f) => [f.name, f]));
  const out = join(runDir, `rejudged-${version}`);
  mkdirSync(join(out, "trials"), { recursive: true });
  const trials: TrialResult[] = [], byName = new Map<string, TrialResult["result"]>();
  for (const file of readdirSync(join(runDir, "trials")).filter((f) => f.endsWith(".json")).sort()) {
    const trial = JSON.parse(readFileSync(join(runDir, "trials", file), "utf8")) as TrialResult;
    const fixture = fixtures.get(trial.result.fixture);
    if (!fixture) throw new Error(`${file}: no fixture named ${trial.result.fixture}`);
    const { judged, coverage, questionRate, verdicts, ...checked } = trial.result;
    // A daily-behaviour trial holds its whole output, so its code checks are run again against the current facts too.
    const result = assistant
      ? await gradeAssistantWithJudge(recheck(checked as AssistantJudged, fixture), fixture, ask)
      : await gradeWithJudge({ ...(checked as JudgedResult), passed: !checked.failures.length }, fixture, ask);
    const again = { ...trial, result };
    writeFileSync(join(out, "trials", file), `${JSON.stringify(again, null, 2)}\n`);
    trials.push(again);
    byName.set(file.slice(0, -".json".length), result);
  }
  const exam = !assistant ? undefined : meta.exam === "lived-in" ? loadLivedInExam(loadAssistantFixtures(LIVED_IN_DIR)) : loadExam(loadAssistantFixtures());
  writeReport(out, { ...meta, judge, rubricVersion: version }, trials, exam);
  const agreement = agreementText(version, basename(runDir), byName, loadCalibration(version, calibration));
  if (agreement) writeFileSync(join(out, "agreement.md"), `${agreement}\n`);
  return { dir: out, agreement };
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: bun apps/agent/eval/rejudge.ts <run folder>");
  const judge = judgeFromEnv();
  const { dir: out, agreement } = await rejudge(dir, judgeOverHttp(judge), { provider: judge.provider, model: judge.model });
  console.log(`Report: ${join(out, "report.md")}`);
  console.log(agreement ?? "No human grade in calibration/ names this run.");
}
