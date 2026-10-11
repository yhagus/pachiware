/**
 * Eval fixtures, one folder per brief under `briefs/`: `brief.md` (posted as the author's message), `answers.md` (the
 * author's reply to round 1), `facts.yaml` (the brief's language, edge cases, must-cover points, known gaps, the
 * repository facts a draft may state, and any stub repository open beside the pinned one), and any images, attached
 * to the brief in file-name order.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Language } from "./checks";
import { EVAL_DIR, type StubRepo } from "./repository";

export const EDGE_CASES = ["one-line", "vague", "duplicate", "ambiguous-repository", "mixed-language", "screenshot"] as const;
export type EdgeCase = (typeof EDGE_CASES)[number];
export interface Facts { language: Language; cases: EdgeCase[]; mustCover: string[]; knownGaps: string[]; repoFacts: string[]; alsoOpen: StubRepo[] }
export interface FixtureImage { name: string; contentType: string; bytes: Uint8Array }
export interface Fixture { name: string; brief: string; answers: string; facts: Facts; images: FixtureImage[] }

const IMAGE_TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

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
    const cases = list(raw.cases ?? [], `${name} cases`);
    if (cases.some((c) => !(EDGE_CASES as readonly string[]).includes(c))) throw new Error(`Fixture ${name}: cases are ${EDGE_CASES.join(", ")}`);
    const alsoOpen = (raw.alsoOpen ?? []).map((s: any) => {
      if (typeof s?.repo !== "string" || typeof s?.readme !== "string") throw new Error(`Fixture ${name}: each alsoOpen entry has a repo and a readme`);
      return { repo: s.repo, readme: s.readme };
    });
    const facts: Facts = { language: raw.language, cases: cases as EdgeCase[], mustCover: list(raw.mustCover, `${name} mustCover`), knownGaps: list(raw.knownGaps ?? [], `${name} knownGaps`), repoFacts: list(raw.repoFacts ?? [], `${name} repoFacts`), alsoOpen };
    if (!facts.mustCover.length) throw new Error(`Fixture ${name} names no must-cover point`);
    const brief = file("brief.md").trim(), answers = file("answers.md").trim();
    if (!brief || !answers) throw new Error(`Fixture ${name} has an empty brief or answers`);
    const images = readdirSync(join(dir, name)).filter((f) => IMAGE_TYPES[extname(f).toLowerCase()]).sort()
      .map((f) => ({ name: f, contentType: IMAGE_TYPES[extname(f).toLowerCase()]!, bytes: new Uint8Array(readFileSync(join(dir, name, f))) }));
    if (cases.includes("screenshot") && !images.length) throw new Error(`Fixture ${name} is a screenshot brief without an image`);
    return { name, brief, answers, facts, images };
  });
}
