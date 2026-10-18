import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { costOf, pairedDifference, summarize, type TrialResult } from "../eval/compare";
import type { Exam } from "../eval/scorecard";
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

  test("sums tokens, model calls, latency, wall time and cost over every trial of a profile", () => {
    const cheap = summary.profiles.find((p) => p.name === "cheap")!, strong = summary.profiles.find((p) => p.name === "strong")!;
    // cheap: six trials of 1000 in and 200 out, one 1-second call, 2 seconds each, $0.0018 each.
    expect(cheap.totals).toEqual({ trials: 6, prompt: 6000, cached: 0, completion: 1200, calls: 6, latencyMs: 6000, ms: 12000, cost: expect.closeTo(0.0108, 8) });
    // strong: one trial of two calls in 4 seconds, five of one call in 1 second; no price.
    expect(strong.totals).toMatchObject({ trials: 6, calls: 7, latencyMs: 9000, cost: null });
    expect(cheap.retrieval).toBeUndefined();
  });

  test("prices cached prompt tokens apart: inside the prompt count for OpenAI-style providers, beside it for Anthropic", () => {
    const usage = { prompt: 1000, cached: 400, completion: 200 }, price = { input: 1, output: 4, cachedInput: 0.1 };
    // 600 uncached at $1/M, 400 cached at $0.10/M, 200 out at $4/M: 600 + 40 + 800 = 1440 millionths.
    expect(costOf(usage, price, "openai")).toBeCloseTo(0.00144, 8);
    // Anthropic's 1000 prompt tokens leave the 400 cache reads out: 1000 + 40 + 800.
    expect(costOf(usage, price, "anthropic")).toBeCloseTo(0.00184, 8);
    // Without a cached price, cached tokens cost what input does: 600 + 400 + 800.
    expect(costOf(usage, { input: 1, output: 4 }, "custom")).toBeCloseTo(0.0018, 8);
    expect(costOf({ prompt: 1000, completion: 200 }, price, "openai")).toBeCloseTo(0.0018, 8);
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
    expect(md).not.toContain("Rapor");
    expect(md).toContain([
      "| Profile | Trials | Tokens in (cached) / out | Model calls | Model latency | Wall time | Cost |",
      "|---|---|---|---|---|---|---|",
      "| cheap | 6 | 6000 (0) / 1200 | 6 | 6.0 s | 12.0 s | $0.0108 |",
      "| strong | 6 | 6000 (0) / 1200 | 7 | 9.0 s | 12.0 s |  |",
    ].join("\n"));
    expect(md).toContain("| cheap | brief-a | 1 | 1000 (0) / 200 | 1 | 1.0 s | 2.0 s | $0.0018 |");
    expect(md).toContain("| strong | brief-a | 1 | 1000 (0) / 200 | 2 | 4.0 s | 2.0 s |  |");
    expect(md).not.toContain("## Retrieval");
  });
});

describe("the Rapor", () => {
  const exam: Exam = {
    version: "1", weights: { capture: 20, recall: 25, tasks: 20, group: 10, loop: 15 },
    briefs: ["cap-a", "cap-b", "rec-a", "rec-b", "task-a", "loop-a"], holdout: ["cap-b", "rec-b"],
    areas: { "cap-a": "capture", "cap-b": "capture", "rec-a": "recall", "rec-b": "recall", "task-a": "tasks", "loop-a": "loop", "off-exam": "tasks" },
  };
  const trials = [
    trial("p", "cap-a", 1, [true, false]), trial("p", "cap-b", 1, [true]),
    trial("p", "rec-a", 1, [true, true]), trial("p", "rec-a", 2, [false, false]), trial("p", "rec-b", 1, [false]),
    trial("p", "task-a", 1, [true]), trial("p", "loop-a", 1, []), trial("p", "off-exam", 1, [false]),
    trial("q", "off-exam", 1, [true]),
  ];
  const profiles = [{ name: "p", provider: "openai", model: "m-p" }, { name: "q", provider: "openai", model: "m-q" }];

  test("scores each area as the mean of its briefs, and the total as the weighted mean over the areas that ran", () => {
    const [p, q] = summarize(trials, profiles, exam).profiles;
    // capture (0.5 + 1) / 2 = 0.75, its holdout cap-b 1; recall (0.5 + 0) / 2 = 0.25, holdout rec-b 0; tasks 1 (off-exam is no exam brief);
    // group ran nothing; loop 0. Total (20 * 0.75 + 25 * 0.25 + 20 * 1 + 15 * 0) / (20 + 25 + 20 + 15) = 41.25 / 80.
    expect(p!.rapor).toEqual({
      version: "1", total: 0.515625,
      areas: [
        { area: "capture", weight: 20, score: 0.75, briefs: 2, holdoutScore: 1 },
        { area: "recall", weight: 25, score: 0.25, briefs: 2, holdoutScore: 0 },
        { area: "tasks", weight: 20, score: 1, briefs: 1, holdoutScore: null },
        { area: "group", weight: 10, score: null, briefs: 0, holdoutScore: null },
        { area: "loop", weight: 15, score: 0, briefs: 1, holdoutScore: null },
      ],
    });
    expect(q!.rapor!.total).toBeNull();
    expect(summarize(trials, profiles).profiles[0]!.rapor).toBeUndefined();
  });

  test("the report opens with the Rapor of each profile and has a table per area", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-rapor-"));
    writeReport(dir, { kind: "assistant", judge: { provider: "anthropic", model: "claude-judge" }, rubricVersion: "0.1", trials: 2, startedAt: "2026-10-18T00:00:00.000Z", profiles }, trials, exam);
    const md = readFileSync(join(dir, "report.md"), "utf8");
    expect(md).toStartWith("# Rapor v1: 51.6 (p), none (q)\n\nDaily-behaviour eval, 2026-10-18T00:00:00.000Z. Judge: anthropic / claude-judge. Rubric 0.1. 2 trials per brief.\n");
    expect(md).toContain([
      "## Rapor per area: p",
      "",
      "| Area | Weight | Score | Briefs | Holdout score |",
      "|---|---|---|---|---|",
      "| capture | 20 | 75.0 | 2 | 100.0 |",
      "| recall | 25 | 25.0 | 2 | 0.0 |",
      "| tasks | 20 | 100.0 | 1 |  |",
      "| group | 10 |  | 0 |  |",
      "| loop | 15 | 0.0 | 1 |  |",
    ].join("\n"));
    expect(md).toContain("## Rapor per area: q");
    expect(JSON.parse(readFileSync(join(dir, "report.json"), "utf8")).summary.profiles[0].rapor).toMatchObject({ version: "1", total: 0.515625 });
  });
});

describe("retrieval in the report", () => {
  /** A trial whose turns all pass, with the retrieval its graded result carries. */
  const scored = (profile: string, fixture: string, n: number, retrieval?: { recallAt5: number; mrr: number }): TrialResult => {
    const t = trial(profile, fixture, n, [true]);
    return { ...t, result: { ...t.result, ...(retrieval && { retrieval: { turns: [], ...retrieval } }) } as TrialResult["result"] };
  };
  const trials = [
    scored("p", "a", 1, { recallAt5: 1, mrr: 1 }), scored("p", "a", 2, { recallAt5: 0.5, mrr: 0.5 }),
    scored("p", "b", 1, { recallAt5: 0, mrr: 0.25 }), scored("p", "c", 1),
  ];
  const profiles = [{ name: "p", provider: "openai", model: "m-p" }];

  test("averages trials per brief, then the briefs that name gold, and the report shows both", () => {
    const [p] = summarize(trials, profiles).profiles;
    // a: recall (1 + 0.5) / 2 = 0.75, MRR 0.75; b: 0 and 0.25; c names no gold. Over a and b: recall 0.375, MRR 0.5.
    expect(p!.retrieval).toEqual({ recallAt5: 0.375, mrr: 0.5, briefs: { a: { recallAt5: 0.75, mrr: 0.75 }, b: { recallAt5: 0, mrr: 0.25 } } });
    const dir = mkdtempSync(join(tmpdir(), "eval-retrieval-"));
    writeReport(dir, { kind: "assistant", judge: { provider: "anthropic", model: "claude-judge" }, rubricVersion: "0.2", trials: 2, startedAt: "2026-10-19T00:00:00.000Z", profiles }, trials);
    const md = readFileSync(join(dir, "report.md"), "utf8");
    expect(md).toContain(["| Profile | Recall@5 | MRR | Briefs with gold |", "|---|---|---|---|", "| p | 0.38 | 0.50 | 2 |"].join("\n"));
    expect(md).toContain(["| Brief | p recall@5 | p MRR |", "|---|---|---|", "| a | 0.75 | 0.75 |", "| b | 0.00 | 0.25 |"].join("\n"));
  });

  test("an exam with a name heads the report with it", () => {
    const exam: Exam = { name: "Lived-in", version: "1", weights: { capture: 10, recall: 50, tasks: 20, group: 10, loop: 10 }, briefs: ["a", "b"], holdout: ["b"], areas: { a: "recall", b: "recall", c: "tasks" } };
    const dir = mkdtempSync(join(tmpdir(), "eval-lived-in-report-"));
    writeReport(dir, { kind: "assistant", exam: "lived-in", judge: { provider: "anthropic", model: "claude-judge" }, rubricVersion: "0.2", trials: 2, startedAt: "2026-10-19T00:00:00.000Z", profiles }, trials, exam);
    const md = readFileSync(join(dir, "report.md"), "utf8");
    expect(md).toStartWith("# Lived-in v1: 100.0 (p)\n");
    expect(md).toContain("## Lived-in per area: p");
    expect(md).toContain("The Lived-in score is out of 100.");
    expect(JSON.parse(readFileSync(join(dir, "report.json"), "utf8")).exam).toBe("lived-in");
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
      "    price: { input: 0.25, output: 2, cachedInput: 0.025 }",
      "  - name: claude",
      "    provider: anthropic",
      "    model: claude-sonnet-5-5",
      "    apiKeyEnv: ANTHROPIC_KEY",
      "    acceptsImages: true",
    ].join("\n"));
    expect(profilesFromEnv({ EVAL_PROFILES: file, OPENAI_KEY: "o", ANTHROPIC_KEY: "a" })).toEqual([
      { name: "cheap", provider: "openai", model: "gpt-mini", baseUrl: null, apiKey: "o", acceptsImages: false, price: { input: 0.25, output: 2, cachedInput: 0.025 } },
      { name: "claude", provider: "anthropic", model: "claude-sonnet-5-5", baseUrl: null, apiKey: "a", acceptsImages: true },
    ]);
    expect(() => profilesFromEnv({ EVAL_PROFILES: file, OPENAI_KEY: "o" })).toThrow("Profile claude reads its key from ANTHROPIC_KEY, which is not set.");
    writeFileSync(file, "profiles:\n  - { name: a, provider: openai, model: m, apiKeyEnv: K }\n  - { name: a, provider: openai, model: n, apiKeyEnv: K }\n");
    expect(() => profilesFromEnv({ EVAL_PROFILES: file, K: "k" })).toThrow("Two profiles are named a.");
    writeFileSync(file, "profiles:\n  - { name: a, provider: openai, model: m, apiKeyEnv: K, price: { input: 1 } }\n");
    expect(() => profilesFromEnv({ EVAL_PROFILES: file, K: "k" })).toThrow("Profile a: price gives input, output and optionally cachedInput, each USD per million tokens.");
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
