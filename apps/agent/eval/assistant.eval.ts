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
import { assertJudgeOutside, judgeFromEnv, judgeOverHttp } from "./judge";
import { profilesFromEnv } from "./profiles";
import { EVAL_DIR } from "./repository";
import { writeReport } from "./report";

const env = process.env;
const PER_TRIAL_MS = 10 * 60_000;

if (env.EVAL_LIVE !== "1") test.skip("the live eval runs only with EVAL_LIVE=1", () => {});
else {
  const judge = judgeFromEnv(), profiles = profilesFromEnv();
  assertJudgeOutside(judge, profiles);
  const trials = Number(env.EVAL_TRIALS || 3);
  if (!Number.isInteger(trials) || trials < 1) throw new Error(`EVAL_TRIALS is a whole number of at least 1, not ${env.EVAL_TRIALS}.`);
  // The parent process names the run; each trial's subprocess inherits it.
  env.EVAL_RUN_DIR ||= join(EVAL_DIR, "results", `assistant-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  env.EVAL_STARTED_AT ||= new Date().toISOString();
  const runDir = env.EVAL_RUN_DIR, trialsDir = join(runDir, "trials");
  const fileOf = (profile: string, fixture: string, trial: number) => join(trialsDir, `${profile.replace(/[^\w.-]/g, "_")}--${fixture}--${trial}.json`);

  for (const profile of profiles) for (const fixture of loadAssistantFixtures()) for (let trial = 1; trial <= trials; trial++) {
    discordScenario(`${profile.name}: ${fixture.name}, trial ${trial}`, async (s) => {
      const { runAssistantTrial } = await import("./assistantRun");
      const { useLiveProfile } = await import("./run");
      await useLiveProfile(s, profile);
      s.http.passthrough(`POST ${providerBaseUrl(judge.provider, judge.baseUrl)}/`);
      const out = await runAssistantTrial(s, fixture, judgeOverHttp(judge));
      mkdirSync(trialsDir, { recursive: true });
      writeFileSync(fileOf(profile.name, fixture.name, trial), `${JSON.stringify({ profile: profile.name, trial, ...out }, null, 2)}\n`);
      expect(out.result.verdicts.flatMap((v) => v.reasons)).toEqual([]);
      expect(out.result.passed).toBe(true);
    }, PER_TRIAL_MS);
  }

  if (!env.PACHIWARE_SCENARIO) afterAll(() => {
    const results = existsSync(trialsDir) ? readdirSync(trialsDir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(trialsDir, f), "utf8"))) : [];
    writeReport(runDir, {
      kind: "assistant", judge: { provider: judge.provider, model: judge.model }, rubricVersion: ASSISTANT_RUBRIC_VERSION, trials, startedAt: env.EVAL_STARTED_AT!,
      profiles: profiles.map(({ name, provider, model, price }) => ({ name, provider, model, ...(price ? { price } : {}) })),
    }, results);
    console.log(`Eval report: ${join(runDir, "report.md")}`);
  });
}
