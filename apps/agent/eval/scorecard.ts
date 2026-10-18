/**
 * The Rapor's exam, `scorecard.yaml`: its version, the weight of each area, the daily-behaviour briefs it scores, and those
 * among them held out, which nothing is ever tuned to. Any change to it is a new version, and only reports at one version compare.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AREAS, loadAssistantFixtures, type Area, type AssistantFixture } from "./assistantFixtures";
import { EVAL_DIR } from "./repository";

export interface Scorecard { version: string; weights: Record<Area, number>; briefs: string[]; holdout: string[] }
/** The scorecard with each brief's area, all the Rapor needs. */
export interface Exam extends Scorecard { areas: Record<string, Area> }

const names = (value: unknown, key: string) => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new Error(`scorecard.yaml ${key} is a list of brief names`);
  const seen = new Set<string>();
  for (const v of value as string[]) { if (seen.has(v)) throw new Error(`scorecard.yaml names ${v} twice`); seen.add(v); }
  return value as string[];
};

export function loadExam(fixtures: AssistantFixture[] = loadAssistantFixtures(), path = join(EVAL_DIR, "scorecard.yaml")): Exam {
  const raw = Bun.YAML.parse(readFileSync(path, "utf8")) as any;
  if (typeof raw?.version !== "string" && typeof raw?.version !== "number") throw new Error("scorecard.yaml has no version");
  const missing = AREAS.find((a) => typeof raw.weights?.[a] !== "number" || !(raw.weights[a] > 0));
  if (missing) throw new Error(`scorecard.yaml weights every area with a positive number; ${missing} has none`);
  const briefs = names(raw.briefs, "briefs"), holdout = names(raw.holdout ?? [], "holdout");
  const areas = Object.fromEntries(fixtures.map((f) => [f.name, f.facts.area]));
  for (const b of briefs) if (!(b in areas)) throw new Error(`scorecard.yaml names ${b}, which is no brief under assistant/`);
  for (const b of holdout) if (!briefs.includes(b)) throw new Error(`scorecard.yaml holds out ${b}, which is not among its briefs`);
  return { version: String(raw.version), weights: Object.fromEntries(AREAS.map((a) => [a, raw.weights[a]])) as Record<Area, number>, briefs, holdout, areas };
}
