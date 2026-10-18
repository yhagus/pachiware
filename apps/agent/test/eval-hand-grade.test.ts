import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAssistantFixtures } from "../eval/assistantFixtures";
import { ASSISTANT_RUBRIC_VERSION, gradeAssistantWithJudge } from "../eval/assistantJudge";
import { gradeAssistantRun } from "../eval/assistantRun";
import { loadCalibration } from "../eval/calibration";
import { agreement, gradedItems, handGradesText, keep, runName, sample } from "../eval/hand-grade";
import { EVAL_DIR } from "../eval/repository";

const BRIEFS = ["minutes-from-talk", "member-joins-thread", "recall-decision-replaced", "progress-note", "bulk-cancel", "remember-forget"];
/** The scripted judge: yes on every must-cover fact and every act-or-ask question, no on every support question. */
const verdictOf = (criterion: string): "yes" | "no" => (criterion === "supported" ? "no" : "yes");
const ask = async (_system: string, user: string) => JSON.stringify({ reasoning: "scripted", verdict: /Look only at the bot's replies in turn/.test(user) ? "no" : "yes" });

/** A finished daily-behaviour run judged by the scripted judge, from the recorded dry runs of BRIEFS. */
async function judgedRun() {
  const run = join(mkdtempSync(join(tmpdir(), "eval-hand-")), "assistant-2026-10-19T00-00-00-000Z");
  mkdirSync(join(run, "trials"), { recursive: true });
  const fixtures = loadAssistantFixtures();
  for (const name of BRIEFS) {
    const fixture = fixtures.find((f) => f.name === name)!, recorded = JSON.parse(readFileSync(join(EVAL_DIR, "recorded", "assistant", `${name}.json`), "utf8"));
    const result = await gradeAssistantWithJudge(gradeAssistantRun(recorded, fixture), fixture, ask);
    writeFileSync(join(run, "trials", `p--${name}--1.json`), JSON.stringify({ profile: "p", trial: 1, result, usage: { prompt: 0, completion: 0, calls: 0, latencyMs: 0, ms: 0 } }));
  }
  writeFileSync(join(run, "report.json"), JSON.stringify({ kind: "assistant", rubricVersion: ASSISTANT_RUBRIC_VERSION, judge: { provider: "p", model: "m" }, profiles: [] }));
  return run;
}

describe("hand grades", () => {
  test("sample 20 judge items or more, blind, spread over the briefs, as many the judge said no to as yes, the same every time", async () => {
    const run = await judgedRun(), grades = sample(run, 20);
    expect(grades.run).toBe("assistant-2026-10-19T00-00-00-000Z");
    expect(grades.items).toHaveLength(20);
    expect(grades.items.map((i) => i.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(grades.items.map((i) => i.trial)).size).toBe(BRIEFS.length);
    expect(grades.items.filter((i) => verdictOf(i.criterion) === "no")).toHaveLength(10);
    // Each item carries the judge's whole question, and nothing of its answer.
    for (const i of grades.items) {
      expect(i.question).toContain("## Question");
      expect(i.human).toBeNull();
      expect(JSON.stringify(i)).not.toContain("scripted");
    }
    expect(grades.instructions).toContain("You grade the replies of a Discord bot");
    expect(sample(run, 20)).toEqual(grades);
    expect(() => sample(run, 19)).toThrow("Sample 20 items at least: a rubric freezes only on 20 graded items or more");
  });

  test("the file a person grades reads back whole; agreement counts the graded items, and keep adds them to calibration once", async () => {
    const run = await judgedRun(), grades = sample(run);
    const text = handGradesText(grades);
    expect(gradedItems(text)).toEqual({ run: grades.run, rubric: ASSISTANT_RUBRIC_VERSION, graded: [], left: 24 });
    expect((Bun.YAML.parse(text) as any).items.map((i: any) => i.question)).toEqual(grades.items.map((i) => i.question));

    // The person agrees with the judge on 18 items, disagrees on 2, and leaves 4 ungraded.
    const opposite = (v: "yes" | "no") => (v === "yes" ? "no" : "yes");
    const graded = grades.items.map((i) => ({ ...i, human: i.id > 20 ? null : i.id <= 2 ? opposite(verdictOf(i.criterion)) : verdictOf(i.criterion), note: i.id <= 2 ? "I read it the other way" : "" }));
    writeFileSync(join(run, "hand-grades.yaml"), handGradesText({ ...grades, items: graded }));
    const said = agreement(run);
    expect(said).toStartWith("Agreement with the human grades in hand-grades.yaml: 18 of 20 items (90%).");
    expect(said).toContain("The rubric freezes at 1.0 at 90% or more on at least 20 items: met");
    expect(said).toContain("I read it the other way");
    expect(said).toEndWith("4 items are not graded yet.");

    const calibration = mkdtempSync(join(tmpdir(), "eval-calibration-"));
    writeFileSync(join(calibration, `${ASSISTANT_RUBRIC_VERSION}.yaml`), "# Human grades.\n[]\n");
    expect(keep(join(run, "hand-grades.yaml"), calibration).added).toBe(20);
    expect(keep(join(run, "hand-grades.yaml"), calibration).added).toBe(0);
    const kept = loadCalibration(ASSISTANT_RUBRIC_VERSION, calibration);
    expect(kept).toHaveLength(20);
    expect(kept[0]).toMatchObject({ run: grades.run, trial: graded[0]!.trial, criterion: graded[0]!.criterion, note: "I read it the other way" });
    expect(readFileSync(join(calibration, `${ASSISTANT_RUBRIC_VERSION}.yaml`), "utf8")).toStartWith("# Human grades.\n- { run: ");
  });

  test("a rejudged folder belongs to its run; an issue-draft run and a grade that is neither yes nor no are refused", () => {
    expect(runName("/x/results/assistant-1/rejudged-0.2")).toBe("assistant-1");
    expect(runName("/x/results/assistant-1")).toBe("assistant-1");
    const run = mkdtempSync(join(tmpdir(), "eval-hand-drafts-"));
    writeFileSync(join(run, "report.json"), JSON.stringify({ kind: "drafts", rubricVersion: "0.1" }));
    expect(() => sample(run)).toThrow("is an issue-draft run; hand grades sample daily-behaviour runs");
    expect(() => gradedItems('run: r\nrubric: "0.2"\nitems:\n  - { id: 1, trial: t, criterion: fact 1, human: maybe }\n')).toThrow("Item 1: human is yes, no, or empty to skip it, not maybe");
  });
});
