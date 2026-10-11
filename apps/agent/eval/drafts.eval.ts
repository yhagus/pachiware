/**
 * Live issue-draft eval: every fixture runs through the real bot with a real profile, against the pinned repository
 * served offline. Run it with `bun run eval`; it needs EVAL_LIVE=1, EVAL_API_KEY and EVAL_MODEL (see run.ts for
 * EVAL_PROVIDER and EVAL_BASE_URL). Plain `bun test` never picks up `*.eval.ts`.
 * Reports land in apps/agent/eval/results/<run>/ as report.json and report.md, plus one JSON per brief.
 */
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discordScenario } from "../test/support/discordScenario";
import { loadFixtures } from "./fixtures";
import { EVAL_DIR, pinnedRepo } from "./repository";
import { writeReport } from "./report";

const env = process.env;
const LIVE = env.EVAL_LIVE === "1" && !!env.EVAL_API_KEY;
const PER_BRIEF_MS = 15 * 60_000;

if (!LIVE) test.skip("the live eval runs only with EVAL_LIVE=1 and EVAL_API_KEY set", () => {});
else {
  // The parent process names the run; each brief's subprocess inherits it.
  env.EVAL_RUN_DIR ||= join(EVAL_DIR, "results", new Date().toISOString().replace(/[:.]/g, "-"));
  env.EVAL_STARTED_AT ||= new Date().toISOString();
  const runDir = env.EVAL_RUN_DIR, pin = pinnedRepo();

  for (const fixture of loadFixtures()) {
    discordScenario(`brief ${fixture.name}`, async (s) => {
      const { gradeRun, liveProfileFromEnv, runFixture, tokensUsed, useLiveProfile } = await import("./run");
      const profile = liveProfileFromEnv();
      await useLiveProfile(s, profile, env.EVAL_API_KEY!);
      const started = Date.now();
      const output = await runFixture(s, fixture, pin);
      const result = gradeRun(output, fixture, pin, { ms: Date.now() - started, tokens: await tokensUsed(s) });
      mkdirSync(join(runDir, "briefs"), { recursive: true });
      writeFileSync(join(runDir, "briefs", `${fixture.name}.json`), `${JSON.stringify({ profile, ...result }, null, 2)}\n`);
      expect(result.failures).toEqual([]);
    }, PER_BRIEF_MS);
  }

  if (!env.PACHIWARE_SCENARIO) afterAll(() => {
    const dir = join(runDir, "briefs");
    const results = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))) : [];
    writeReport(runDir, { profile: { provider: env.EVAL_PROVIDER || "openai", model: env.EVAL_MODEL ?? "" }, repo: pin.repo, commit: pin.commit, startedAt: env.EVAL_STARTED_AT! }, results);
    console.log(`Eval report: ${join(runDir, "report.md")}`);
  });
}
