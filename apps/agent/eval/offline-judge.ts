/**
 * Judging a daily-behaviour run that ran with EVAL_JUDGE_PROVIDER=offline, without a judge API: the judge's questions are written
 * out, answered elsewhere (by a person, or by a model outside the compared profiles in another tool), and graded in.
 *
 *   bun apps/agent/eval/offline-judge.ts prompts <run>                              writes <run>/judge-prompts.jsonl
 *   bun apps/agent/eval/offline-judge.ts grade <run> <answers.jsonl> <provider> <model>   regrades the run into <run>/rejudged-<rubric>/
 *
 * The questions are byte for byte those an HTTP judge gets (`gradeAssistantWithJudge`). One that cannot change a verdict is not
 * written and grades as unknown: a turn's questions when its code checks already failed it, and every question of a trial whose
 * every turn they failed. An answer is `{"id", "reasoning", "verdict": "yes" | "no" | "unknown"}`, one JSON object a line.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAssistantFixtures, type AssistantFixture } from "./assistantFixtures";
import { gradeAssistantWithJudge, type AssistantJudged } from "./assistantJudge";
import type { TrialResult } from "./compare";
import type { Ask, Verdict } from "./judge";
import { rejudge } from "./rejudge";

export interface JudgePrompt { id: string; trial: string; question: "fact" | "behaviour" | "supported"; turn?: number; system: string; user: string }
export interface JudgeAnswer { id: string; reasoning: string; verdict: Verdict }

export const promptId = (system: string, user: string) => createHash("sha256").update(`${system}\0${user}`).digest("hex").slice(0, 16);
const PROMPTS = "judge-prompts.jsonl";
const TURN = /Look only at (the bot's replies in )?turn (\d+)\./;

/** Every question of the run's trials that can change a verdict, each once. */
export async function judgePrompts(runDir: string, fixtures: AssistantFixture[] = loadAssistantFixtures()): Promise<JudgePrompt[]> {
  const byName = new Map(fixtures.map((f) => [f.name, f])), out = new Map<string, JudgePrompt>();
  for (const file of readdirSync(join(runDir, "trials")).filter((f) => f.endsWith(".json")).sort()) {
    const trial = JSON.parse(readFileSync(join(runDir, "trials", file), "utf8")) as TrialResult;
    const fixture = byName.get(trial.result.fixture);
    if (!fixture) throw new Error(`${file}: no fixture named ${trial.result.fixture}`);
    const { judged, coverage, questionRate, verdicts, ...checked } = trial.result as AssistantJudged;
    const failed = new Set(checked.failures.map((f) => f.turn)), every = fixture.facts.turns.every((_, i) => failed.has(i + 1));
    const ask: Ask = async (system, user) => {
      const turn = TURN.exec(user), n = turn ? Number(turn[2]) : undefined;
      if (every || (n !== undefined && failed.has(n))) return "";
      const id = promptId(system, user);
      if (!out.has(id)) out.set(id, { id, trial: file.slice(0, -".json".length), question: turn ? (turn[1] ? "supported" : "behaviour") : "fact", ...(n !== undefined && { turn: n }), system, user });
      return "";
    };
    await gradeAssistantWithJudge({ ...checked, passed: !checked.failures.length } as AssistantJudged, fixture, ask);
  }
  return [...out.values()];
}

/**
 * An ask answering from `answers`; a question never written grades unknown. Every written question must have an answer: the judge's
 * grade turns a failed ask into unknown, so a missing one is refused here, before any trial is regraded.
 */
export function answering(prompts: JudgePrompt[], answers: JudgeAnswer[]): Ask {
  const byId = new Map(answers.map((a) => [a.id, a])), missing = prompts.filter((p) => !byId.has(p.id));
  if (missing.length) throw new Error(`${missing.length} questions have no answer, the first ${missing[0]!.id} (${missing[0]!.trial}, ${missing[0]!.question})`);
  for (const a of answers) if (!["yes", "no", "unknown"].includes(a.verdict)) throw new Error(`Answer ${a.id}: verdict is yes, no or unknown, not ${a.verdict}`);
  return async (system, user) => {
    const id = promptId(system, user), answer = byId.get(id);
    // parseVerdict reads the last flat JSON object, so braces in the reasoning would hide the verdict.
    if (answer) return JSON.stringify({ reasoning: answer.reasoning.replace(/[{}]/g, (b) => (b === "{" ? "(" : ")")), verdict: answer.verdict });
    return "";
  };
}

const lines = <T>(path: string): T[] => readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);

if (import.meta.main) {
  const [command, runDir, answersPath, provider, model] = process.argv.slice(2);
  if (command === "prompts" && runDir) {
    const prompts = await judgePrompts(runDir);
    writeFileSync(join(runDir, PROMPTS), prompts.map((p) => JSON.stringify(p)).join("\n") + "\n");
    console.log(`${prompts.length} questions: ${join(runDir, PROMPTS)}`);
  } else if (command === "grade" && runDir && answersPath && provider && model) {
    const { dir } = await rejudge(runDir, answering(lines<JudgePrompt>(join(runDir, PROMPTS)), lines<JudgeAnswer>(answersPath)), { provider, model });
    console.log(`Report: ${join(dir, "report.md")}`);
  } else throw new Error("Usage: offline-judge.ts prompts <run> | grade <run> <answers.jsonl> <provider> <model>");
}
