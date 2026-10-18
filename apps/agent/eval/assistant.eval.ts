/**
 * Live daily-behaviour eval: every compared profile runs every brief under assistant/ EVAL_TRIALS times (default 3)
 * through the real bot against the fixed clock, and a pinned judge grades each trial. Run it with `bun run eval:assistant`;
 * README.md in this folder lists the env. Plain `bun test` never picks up `*.eval.ts`.
 * Reports land in apps/agent/eval/results/<run>/ as report.json and report.md, plus one JSON per trial.
 */
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { providerBaseUrl } from "../src/llm/providers";
import { discordScenario } from "../test/support/discordScenario";
import { loadAssistantFixtures } from "./assistantFixtures";
import { ASSISTANT_RUBRIC_VERSION } from "./assistantJudge";
import { assertJudgeOutside, judgeFromEnv, judgeOverHttp, offlineAsk } from "./judge";
import { profilesFromEnv } from "./profiles";
import { EVAL_DIR } from "./repository";
import { writeReport } from "./report";
import { loadExam } from "./scorecard";

const env = process.env;
const PER_TRIAL_MS = 10 * 60_000;

if (env.EVAL_LIVE !== "1") test.skip("the live eval runs only with EVAL_LIVE=1", () => {});
else {
  const judge = judgeFromEnv(), profiles = profilesFromEnv();
  assertJudgeOutside(judge, profiles);
  const exam = loadExam();
  const trials = Number(env.EVAL_TRIALS || 3);
  if (!Number.isInteger(trials) || trials < 1) throw new Error(`EVAL_TRIALS is a whole number of at least 1, not ${env.EVAL_TRIALS}.`);
  // The parent process names the run; each trial's subprocess inherits it.
  env.EVAL_RUN_DIR ||= join(EVAL_DIR, "results", `assistant-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  env.EVAL_STARTED_AT ||= new Date().toISOString();
  const runDir = env.EVAL_RUN_DIR, trialsDir = join(runDir, "trials");
  const fileOf = (profile: string, fixture: string, trial: number) => join(trialsDir, `${profile.replace(/[^\w.-]/g, "_")}--${fixture}--${trial}.json`);

  // EVAL_EXAM=1 runs only the Rapor's exam; the other briefs are regressions.
  const briefs = loadAssistantFixtures().filter((f) => env.EVAL_EXAM !== "1" || exam.briefs.includes(f.name)), offline = judge.provider === "offline";
  for (const profile of profiles) for (const fixture of briefs) for (let trial = 1; trial <= trials; trial++) {
    discordScenario(`${profile.name}: ${fixture.name}, trial ${trial}`, async (s) => {
      const { runAssistantTrial } = await import("./assistantRun");
      const { useLiveProfile } = await import("./run");
      await useLiveProfile(s, profile);
      if (!offline) s.http.passthrough(`POST ${providerBaseUrl(judge.provider, judge.baseUrl)}/`);
      const out = await runAssistantTrial(s, fixture, offline ? offlineAsk : judgeOverHttp(judge));
      mkdirSync(trialsDir, { recursive: true });
      writeFileSync(fileOf(profile.name, fixture.name, trial), `${JSON.stringify({ profile: profile.name, trial, ...out }, null, 2)}\n`);
      // Offline, the judge's half waits for offline-judge.ts; the code checks are known now.
      if (offline) expect(out.result.failures.map((f) => ("turn" in f ? `turn ${f.turn} ${f.check}: ${f.message}` : f.message))).toEqual([]);
      else expect(out.result.verdicts.flatMap((v) => v.reasons)).toEqual([]);
      expect(offline || out.result.passed).toBe(true);
    }, PER_TRIAL_MS);
  }

  if (!env.PACHIWARE_SCENARIO) afterAll(() => {
    const results = existsSync(trialsDir) ? readdirSync(trialsDir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(trialsDir, f), "utf8"))) : [];
    writeReport(runDir, {
      kind: "assistant", judge: { provider: judge.provider, model: judge.model }, rubricVersion: ASSISTANT_RUBRIC_VERSION, trials, startedAt: env.EVAL_STARTED_AT!,
      profiles: profiles.map(({ name, provider, model, price }) => ({ name, provider, model, ...(price ? { price } : {}) })),
    }, results, exam);
    console.log(`Eval report: ${join(runDir, "report.md")}`);
  });
}
