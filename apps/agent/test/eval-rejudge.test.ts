import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const out = await rejudge(run, async (_system, user) => { prompts.push(user); return '{"reasoning": "Covered.", "verdict": "yes"}'; }, { provider: "anthropic", model: "new-judge" });

  expect(out).toBe(join(run, `rejudged-${RUBRIC_VERSION}`));
  expect(prompts.length).toBeGreaterThan(0);
  const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
  expect(report).toMatchObject({ judge: { provider: "anthropic", model: "new-judge" }, rubricVersion: RUBRIC_VERSION, trials: 1 });
  expect(report.results[0].result.verdicts).toEqual([{ n: 1, passed: true, reasons: [] }]);
  expect(report.results[0].usage.latencyMs).toBe(5);
  expect(readFileSync(join(out, "trials", "a--thread-replies-debounced--1.json"), "utf8")).toContain('"passed": true');
});

test("rejudge refuses a judge whose model is one of the run's profiles", async () => {
  const run = mkdtempSync(join(tmpdir(), "eval-run-"));
  mkdirSync(join(run, "trials"));
  writeFileSync(join(run, "report.json"), JSON.stringify({ profiles: [{ name: "a", provider: "openai", model: "m-a" }] }));
  await expect(rejudge(run, async () => "", { provider: "openai", model: "m-a" })).rejects.toThrow("pick a judge outside the compared profiles");
});
