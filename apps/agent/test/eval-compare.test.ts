import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pairedDifference, summarize, type TrialResult } from "../eval/compare";
import { profilesFromEnv } from "../eval/profiles";
import { writeReport } from "../eval/report";

/** A trial whose drafts pass as listed; usage defaults to one 1-second model call. */
function trial(profile: string, fixture: string, n: number, passes: boolean[], usage: Partial<TrialResult["usage"]> = {}): TrialResult {
  const verdicts = passes.map((passed, i) => ({ n: i + 1, passed, reasons: passed ? [] : [`coverage: draft ${i + 1} misses a fact`] }));
  return {
    profile, trial: n,
    result: { fixture, repo: "yhagus/pachiware", commit: "74a06a07dd20518acfd50f1dd23c3ea625472d72", transcript: [], drafts: [], failures: [], judged: { facts: [], questions: [], drafts: [] },
      coverage: passes.length ? passes.filter(Boolean).length / passes.length : 0, questionRate: 0.5, verdicts, passed: passes.length > 0 && passes.every(Boolean) },
    usage: { prompt: 1000, completion: 200, calls: 1, latencyMs: 1000, ms: 2000, ...usage },
  };
}

describe("pairedDifference", () => {
  test("is the mean of per-brief differences with the standard error of that mean", () => {
    const a = new Map([["x", 0.5], ["y", 0.5], ["z", 1]]), b = new Map([["x", 1], ["y", 0.5], ["z", 1], ["only-b", 0]]);
    const d = pairedDifference(a, b);
    // Differences 0.5, 0, 0: mean 1/6, sample sd 0.2887, se 0.2887 / sqrt(3) = 0.1667.
    expect(d.n).toBe(3);
    expect(d.mean).toBeCloseTo(0.1667, 4);
    expect(d.se).toBeCloseTo(0.1667, 4);
  });

  test("one shared brief has no standard error", () => {
    expect(pairedDifference(new Map([["x", 0]]), new Map([["x", 1]]))).toEqual({ n: 1, mean: 1, se: null });
  });
});

describe("summarize", () => {
  const trials = [
    trial("cheap", "brief-a", 1, [true, false]), trial("cheap", "brief-a", 2, [true, true]), trial("cheap", "brief-a", 3, [false, false]),
    trial("cheap", "brief-b", 1, [true]), trial("cheap", "brief-b", 2, [true]), trial("cheap", "brief-b", 3, [true]),
    trial("strong", "brief-a", 1, [true, true], { latencyMs: 4000, calls: 2 }), trial("strong", "brief-a", 2, [true, true]), trial("strong", "brief-a", 3, [true, false]),
    trial("strong", "brief-b", 1, [true]), trial("strong", "brief-b", 2, [true]), trial("strong", "brief-b", 3, []),
  ];
  const profiles = [{ name: "cheap", provider: "openai", model: "gpt-mini", price: { input: 1, output: 4 } }, { name: "strong", provider: "anthropic", model: "claude-x" }];
  const summary = summarize(trials, profiles);

  test("averages trials per brief before averaging briefs, and counts pass^k per brief", () => {
    const cheap = summary.profiles.find((p) => p.name === "cheap")!, strong = summary.profiles.find((p) => p.name === "strong")!;
    // cheap: brief-a trials score 0.5, 1, 0 -> 0.5; brief-b 1. strong: brief-a 1, 1, 0.5 -> 5/6; brief-b 1, 1, 0 -> 2/3.
    expect(cheap.briefScores).toEqual({ "brief-a": 0.5, "brief-b": 1 });
    expect(cheap.score).toBeCloseTo(0.75);
    expect(strong.score).toBeCloseTo(0.75);
    expect(cheap.trialsPerBrief).toBe(3);
    expect(cheap.passK).toBe(0.5);
    expect(strong.passK).toBe(0);
  });

  test("reports tokens, cost when the profile has a price, and latency per model call", () => {
    const cheap = summary.profiles.find((p) => p.name === "cheap")!, strong = summary.profiles.find((p) => p.name === "strong")!;
    expect(cheap.tokens).toEqual({ prompt: 1000, completion: 200 });
    // 1000 in at $1/M plus 200 out at $4/M.
    expect(cheap.costPerRun).toBeCloseTo(0.0018, 6);
    expect(strong.costPerRun).toBeNull();
    expect(cheap.latencyPerCallMs).toBe(1000);
    // strong: 4000 + 5 * 1000 ms over 2 + 5 calls.
    expect(strong.latencyPerCallMs).toBeCloseTo(9000 / 7);
    expect(cheap.secondsPerRun).toBe(2);
  });

  test("pairs every profile with each later one", () => {
    expect(summary.pairs).toHaveLength(1);
    expect(summary.pairs[0]).toMatchObject({ a: "cheap", b: "strong", n: 2 });
    // Differences: brief-a 5/6 - 1/2 = 1/3, brief-b 2/3 - 1 = -1/3.
    expect(summary.pairs[0]!.mean).toBeCloseTo(0);
    expect(summary.pairs[0]!.se).toBeCloseTo(1 / 3);
  });

  test("the report records judge, rubric version and trials, compares profiles, and lists each failing draft with its reasons", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-compare-"));
    writeReport(dir, { judge: { provider: "anthropic", model: "claude-judge" }, rubricVersion: "0.1", trials: 3, repo: "yhagus/pachiware", commit: "74a06a07dd20518acfd50f1dd23c3ea625472d72", startedAt: "2026-10-11T00:00:00.000Z", profiles }, trials);
    const json = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
    expect(json).toMatchObject({ judge: { provider: "anthropic", model: "claude-judge" }, rubricVersion: "0.1", trials: 3 });
    expect(json.summary.pairs[0]).toMatchObject({ a: "cheap", b: "strong" });
    expect(json.results).toHaveLength(12);
    const md = readFileSync(join(dir, "report.md"), "utf8");
    expect(md).toContain("Judge: anthropic / claude-judge. Rubric 0.1. 3 trials per brief.");
    expect(md).toContain("| cheap | openai / gpt-mini | 0.75 | 50% | 0.75 | 50% | 1000 / 200 | $0.0018 | 1.0 s | 2 s |");
    expect(md).toContain("| strong vs cheap | 2 | +0.00 | 0.33 |");
    expect(md).toContain("| brief-a | 0.50 | 0.83 |");
    expect(md).toContain("- Trial 1, draft 2: fail. coverage: draft 2 misses a fact");
    expect(md).toContain("- Trial 3: no draft was posted.");
    expect(md).not.toContain("Trial 2, draft 1");
  });
});

describe("profilesFromEnv", () => {
  test("reads compared profiles from the file EVAL_PROFILES names, with each key from the env variable it points at", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-profiles-"));
    const file = join(dir, "profiles.yaml");
    writeFileSync(file, [
      "profiles:",
      "  - name: cheap",
      "    provider: openai",
      "    model: gpt-mini",
      "    apiKeyEnv: OPENAI_KEY",
      "    price: { input: 0.25, output: 2 }",
      "  - name: claude",
      "    provider: anthropic",
      "    model: claude-sonnet-5-5",
      "    apiKeyEnv: ANTHROPIC_KEY",
      "    acceptsImages: true",
    ].join("\n"));
    expect(profilesFromEnv({ EVAL_PROFILES: file, OPENAI_KEY: "o", ANTHROPIC_KEY: "a" })).toEqual([
      { name: "cheap", provider: "openai", model: "gpt-mini", baseUrl: null, apiKey: "o", acceptsImages: false, price: { input: 0.25, output: 2 } },
      { name: "claude", provider: "anthropic", model: "claude-sonnet-5-5", baseUrl: null, apiKey: "a", acceptsImages: true },
    ]);
    expect(() => profilesFromEnv({ EVAL_PROFILES: file, OPENAI_KEY: "o" })).toThrow("Profile claude reads its key from ANTHROPIC_KEY, which is not set.");
    writeFileSync(file, "profiles:\n  - { name: a, provider: openai, model: m, apiKeyEnv: K }\n  - { name: a, provider: openai, model: n, apiKeyEnv: K }\n");
    expect(() => profilesFromEnv({ EVAL_PROFILES: file, K: "k" })).toThrow("Two profiles are named a.");
  });

  test("the committed example file loads", () => {
    const file = join(import.meta.dir, "../eval/profiles.example.yaml");
    expect(profilesFromEnv({ EVAL_PROFILES: file, OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a", LOCAL_LLM_KEY: "l" }).map((p) => p.provider)).toEqual(["openai", "anthropic", "custom"]);
  });

  test("without a file, one profile comes from EVAL_PROVIDER, EVAL_MODEL and EVAL_API_KEY", () => {
    expect(profilesFromEnv({ EVAL_MODEL: "gpt-mini", EVAL_API_KEY: "k", EVAL_ACCEPTS_IMAGES: "1" })).toEqual([{ name: "gpt-mini", provider: "openai", model: "gpt-mini", baseUrl: null, apiKey: "k", acceptsImages: true }]);
    expect(() => profilesFromEnv({ EVAL_MODEL: "gpt-mini" })).toThrow("EVAL_API_KEY");
  });
});
