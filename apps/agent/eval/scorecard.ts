/**
 * An exam: `scorecard.yaml` (the Rapor) or `lived-in/scorecard.yaml` (the lived-in exam): its name, version, the weight of each area, the
 * daily-behaviour briefs it scores, and those among them held out, which nothing is ever tuned to. Any change to it is a new version, and
 * only reports at one version compare.
 *
 * The held-out briefs are drawn, not chosen (#252): `holdout: { draw, seed }` holds out `draw` briefs, at least one per area while
 * the areas last, ranked by a hash of the seed, the version and the brief's name. Every version bump draws afresh, so a fix tuned against
 * one version's holdouts meets other ones at the next. `spent` lists briefs used to tune while they were held out, which no draw picks
 * again; `fixed` pins the held-out set of a version from before draws, so its reports keep comparing. A plain list is a fixed set.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AREAS, LIVED_IN_DIR, loadAssistantFixtures, type Area, type AssistantFixture } from "./assistantFixtures";
import { EVAL_DIR } from "./repository";

export interface Scorecard {
  /** What the report calls the exam's score: "Rapor" unless the file names it. */
  name?: string;
  version: string; weights: Record<Area, number>; briefs: string[]; holdout: string[];
}
/** The scorecard with each brief's area, all the Rapor needs. */
export interface Exam extends Scorecard { areas: Record<string, Area> }
export interface HoldoutDraw { draw: number; seed: string; spent?: string[] }

export const RAPOR_SCORECARD = join(EVAL_DIR, "scorecard.yaml");
export const LIVED_IN_SCORECARD = join(EVAL_DIR, "lived-in", "scorecard.yaml");

const names = (value: unknown, key: string) => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new Error(`scorecard.yaml ${key} is a list of brief names`);
  const seen = new Set<string>();
  for (const v of value as string[]) { if (seen.has(v)) throw new Error(`scorecard.yaml names ${v} twice`); seen.add(v); }
  return value as string[];
};

const rank = (seed: string, version: string, brief: string) => createHash("sha256").update(`${seed}/${version}/${brief}`).digest("hex");

/**
 * The briefs a version holds out: of the briefs not `spent`, the best-ranked of each area in turn (in the order of AREAS) until `draw`
 * are picked or every area has one, then the best-ranked of the rest. Listed in the order of `briefs`.
 */
export function drawHoldout(briefs: string[], areas: Record<string, Area>, version: string, rule: HoldoutDraw): string[] {
  const spent = new Set(rule.spent ?? []), open = briefs.filter((b) => !spent.has(b)).sort((a, b) => rank(rule.seed, version, a).localeCompare(rank(rule.seed, version, b)));
  if (!Number.isInteger(rule.draw) || rule.draw < 1 || rule.draw > open.length) throw new Error(`scorecard.yaml holdout.draw is a whole number from 1 to ${open.length}, the briefs not spent`);
  const picked: string[] = [];
  for (const area of AREAS) {
    const best = open.find((b) => areas[b] === area);
    if (best && picked.length < rule.draw) picked.push(best);
  }
  for (const b of open) if (picked.length < rule.draw && !picked.includes(b)) picked.push(b);
  return briefs.filter((b) => picked.includes(b));
}

function holdoutOf(raw: unknown, version: string, briefs: string[], areas: Record<string, Area>): string[] {
  if (raw === undefined || Array.isArray(raw)) return names(raw ?? [], "holdout");
  const rule = raw as { draw?: unknown; seed?: unknown; spent?: unknown; fixed?: Record<string, unknown> };
  if (typeof rule !== "object" || rule === null) throw new Error("scorecard.yaml holdout is a list of brief names, or { draw, seed } with optional spent and fixed");
  const fixed = rule.fixed?.[version];
  if (fixed !== undefined) return names(fixed, `holdout.fixed.${version}`);
  if (typeof rule.seed !== "string" || !rule.seed) throw new Error("scorecard.yaml holdout.seed is the text the draw is ranked by");
  const spent = names(rule.spent ?? [], "holdout.spent");
  for (const b of spent) if (!briefs.includes(b)) throw new Error(`scorecard.yaml holdout.spent names ${b}, which is not among its briefs`);
  return drawHoldout(briefs, areas, version, { draw: rule.draw as number, seed: rule.seed, spent });
}

export function loadExam(fixtures: AssistantFixture[] = loadAssistantFixtures(), path = RAPOR_SCORECARD): Exam {
  const raw = Bun.YAML.parse(readFileSync(path, "utf8")) as any;
  if (typeof raw?.version !== "string" && typeof raw?.version !== "number") throw new Error("scorecard.yaml has no version");
  const missing = AREAS.find((a) => typeof raw.weights?.[a] !== "number" || !(raw.weights[a] > 0));
  if (missing) throw new Error(`scorecard.yaml weights every area with a positive number; ${missing} has none`);
  if (raw.name !== undefined && (typeof raw.name !== "string" || !raw.name.trim())) throw new Error("scorecard.yaml name is the exam's name, such as Lived-in");
  const version = String(raw.version), briefs = names(raw.briefs, "briefs");
  const areas = Object.fromEntries(fixtures.map((f) => [f.name, f.facts.area]));
  for (const b of briefs) if (!(b in areas)) throw new Error(`scorecard.yaml names ${b}, which is no brief under assistant/`);
  const holdout = holdoutOf(raw.holdout, version, briefs, areas);
  for (const b of holdout) if (!briefs.includes(b)) throw new Error(`scorecard.yaml holds out ${b}, which is not among its briefs`);
  return { ...(raw.name ? { name: raw.name } : {}), version, weights: Object.fromEntries(AREAS.map((a) => [a, raw.weights[a]])) as Record<Area, number>, briefs, holdout, areas };
}

/** The lived-in exam (#252): its sessions under lived-in/sessions/, scored by lived-in/scorecard.yaml. */
export const loadLivedInExam = (fixtures: AssistantFixture[] = loadAssistantFixtures(LIVED_IN_DIR)) => loadExam(fixtures, LIVED_IN_SCORECARD);
