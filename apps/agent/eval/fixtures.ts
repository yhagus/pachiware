/**
 * Eval fixtures, one folder per brief under `briefs/`: `brief.md` (posted as the author's message), `answers.md` (the
 * author's reply to round 1), and `facts.yaml` (the brief's language, must-cover points, known gaps, and the
 * repository facts a draft may state).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Language } from "./checks";
import { EVAL_DIR } from "./repository";

export interface Facts { language: Language; mustCover: string[]; knownGaps: string[]; repoFacts: string[] }
export interface Fixture { name: string; brief: string; answers: string; facts: Facts }

const list = (value: unknown, where: string) => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new Error(`${where} must be a list of strings`);
  return value as string[];
};

export function loadFixtures(dir = join(EVAL_DIR, "briefs")): Fixture[] {
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().map((name) => {
    const file = (f: string) => {
      const path = join(dir, name, f);
      if (!existsSync(path)) throw new Error(`Fixture ${name} has no ${f}`);
      return readFileSync(path, "utf8");
    };
    const raw = Bun.YAML.parse(file("facts.yaml")) as any;
    if (raw?.language !== "en" && raw?.language !== "id") throw new Error(`Fixture ${name}: facts.yaml language is en or id`);
    const facts: Facts = { language: raw.language, mustCover: list(raw.mustCover, `${name} mustCover`), knownGaps: list(raw.knownGaps ?? [], `${name} knownGaps`), repoFacts: list(raw.repoFacts ?? [], `${name} repoFacts`) };
    if (!facts.mustCover.length) throw new Error(`Fixture ${name} names no must-cover point`);
    const brief = file("brief.md").trim(), answers = file("answers.md").trim();
    if (!brief || !answers) throw new Error(`Fixture ${name} has an empty brief or answers`);
    return { name, brief, answers, facts };
  });
}
