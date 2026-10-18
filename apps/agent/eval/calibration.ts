/**
 * Human grades kept beside the rubric (#49): `calibration/<rubric version>.yaml` lists items a person graded from a run's
 * trial files, `{run, trial, turn, criterion, human: yes|no, note}`. Rejudging a run at that version prints how often the
 * judge's verdict equals the person's, overall and per criterion, with every disagreement and every item naming nothing in the run.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScoredResult } from "./compare";
import type { Verdict } from "./judge";
import { EVAL_DIR } from "./repository";

/**
 * `run` is the run folder's name and `trial` a trial file's name without `.json`. `criterion` is `fact <n>` (the nth must-cover fact)
 * or `question <n>` (a draft run's nth question) without a `turn`; or `behaviour` or `supported` with the `turn`, or `invented` with the draft's number as `turn`.
 */
export interface CalibrationItem { run: string; trial: string; turn?: number; criterion: string; human: "yes" | "no"; note?: string }

/** The bar to freeze a rubric at 1.0. */
export const FREEZE = { agreement: 0.9, items: 20 };

export function loadCalibration(version: string, dir = join(EVAL_DIR, "calibration")): CalibrationItem[] {
  const path = join(dir, `${version}.yaml`);
  if (!existsSync(path)) return [];
  const raw = Bun.YAML.parse(readFileSync(path, "utf8")) ?? [];
  if (!Array.isArray(raw)) throw new Error(`calibration/${version}.yaml is a list of graded items`);
  raw.forEach((item: any, i) => {
    if (typeof item?.run !== "string" || typeof item.trial !== "string" || typeof item.criterion !== "string" || (item.human !== "yes" && item.human !== "no") || (item.turn !== undefined && !Number.isInteger(item.turn))) {
      throw new Error(`calibration/${version}.yaml item ${i + 1} needs a run, a trial, a criterion, human: yes or no, and a whole turn when it names one`);
    }
  });
  return raw;
}

const key = (criterion: string, turn?: number) => (turn === undefined ? criterion : `${criterion}@${turn}`);

/** Every verdict the judge gave on a trial, by criterion and turn. */
function verdictsOf(result: ScoredResult): Map<string, Verdict> {
  const j = result.judged as any, out = new Map<string, Verdict>();
  (j.facts ?? []).forEach((f: any, i: number) => out.set(key(`fact ${i + 1}`), f.verdict));
  for (const t of j.turns ?? []) { out.set(key("behaviour", t.n), t.behaviour.verdict); out.set(key("supported", t.n), t.supported.verdict); }
  (j.questions ?? []).forEach((q: any, i: number) => out.set(key(`question ${i + 1}`), q.verdict));
  for (const d of j.drafts ?? []) out.set(key("invented", d.n), d.verdict);
  return out;
}

const share = (agreed: number, of: number, noun = "") => `${agreed} of ${of}${noun}${of ? ` (${Math.round((agreed / of) * 100)}%)` : ""}`;

/** The agreement text for the items of `run`, or null when the file grades nothing of it. */
export function agreementText(version: string, run: string, trials: Map<string, ScoredResult>, items: CalibrationItem[]): string | null {
  const mine = items.filter((i) => i.run === run);
  if (!mine.length) return null;
  const where = (i: CalibrationItem) => `${i.trial}, ${i.criterion}${i.turn === undefined ? "" : `, turn ${i.turn}`}`;
  const criteria = new Map<string, { graded: number; agreed: number }>(), disagreements: string[] = [], unmatched: string[] = [];
  for (const item of mine) {
    const result = trials.get(item.trial), verdict = result && verdictsOf(result).get(key(item.criterion, item.turn));
    if (!result) { unmatched.push(`- ${where(item)}: no such trial.`); continue; }
    if (!verdict) { unmatched.push(`- ${where(item)}: the trial has no such criterion.`); continue; }
    const kind = item.criterion.split(" ")[0]!, tally = criteria.get(kind) ?? { graded: 0, agreed: 0 };
    criteria.set(kind, { graded: tally.graded + 1, agreed: tally.agreed + (verdict === item.human ? 1 : 0) });
    if (verdict !== item.human) disagreements.push(`- ${where(item)}: the judge said ${verdict}, the person ${item.human}.${item.note ? ` ${item.note}` : ""}`);
  }
  const graded = [...criteria.values()].reduce((a, c) => a + c.graded, 0), agreed = [...criteria.values()].reduce((a, c) => a + c.agreed, 0);
  const frozen = graded >= FREEZE.items && agreed / graded >= FREEZE.agreement;
  return [
    `Agreement with the human grades in calibration/${version}.yaml: ${share(agreed, graded, " items")}.`,
    ...[...criteria].sort(([a], [b]) => a.localeCompare(b)).map(([kind, c]) => `- ${kind}: ${share(c.agreed, c.graded)}`),
    `The rubric freezes at 1.0 at ${FREEZE.agreement * 100}% or more on at least ${FREEZE.items} items: ${frozen ? "met; set it to 1.0 and record it under Frozen rubric versions in README.md" : `not yet, ${graded} graded`}.`,
    ...(disagreements.length ? ["", "Disagreements:", ...disagreements] : []),
    ...(unmatched.length ? ["", "Not in the run:", ...unmatched] : []),
  ].join("\n");
}
