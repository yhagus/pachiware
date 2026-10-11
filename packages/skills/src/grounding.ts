import type { PlaybookBinding } from "./playbooks.js";
import type { BriefDraft, DraftCategory } from "./brief.js";

/**
 * What a brief read from its repositories (#42), kept as `grounding` in the brief's binding file next to the brief state.
 *
 *   candidates: the repositories briefRepositories found open to this thread, each with the git account that reaches it
 *   single:     set when exactly one repository is open; drafts target it without asking
 *   repos:      per repository read for this brief: default branch, the HEAD commit every later read is pinned to, its labels, and the docs read
 *   reads:      every read made for a point, in order; the budget counts them and Context used lists the files and issues among them
 *   spent:      a read was refused because the brief's budget ran out
 */
export interface GroundedRepo { account: string; branch: string; sha: string; labels: string[]; docs: { path: string; url: string }[] }
export type ReadStep = "duplicates" | "issue" | "code" | "files";
export interface GroundingRead { repo: string; point: number; step: ReadStep; target: string; url?: string; title?: string }
export interface BriefGrounding { candidates: { repo: string; account: string }[]; single?: string; repos: Record<string, GroundedRepo>; reads: GroundingRead[]; spent?: boolean }

/** Reads per point and per brief. The repository's own docs and labels, read once per repository, are not counted. */
export const READ_BUDGET = { point: 6, brief: 30 } as const;
/** Repositories one brief may read; each costs a fixed handful of requests. */
export const MAX_BRIEF_REPOS = 3;

export const groundingOf = (b: PlaybookBinding): BriefGrounding => {
  const g = (b.grounding ?? {}) as any;
  return { candidates: Array.isArray(g.candidates) ? g.candidates : [], ...(typeof g.single === "string" ? { single: g.single } : {}), repos: g.repos && typeof g.repos === "object" ? g.repos : {}, reads: Array.isArray(g.reads) ? g.reads : [], ...(g.spent === true ? { spent: true } : {}) };
};

/** Repositories a draft may target: those found open to the thread, plus any already read. */
export const openRepos = (g: BriefGrounding) => [...new Set([...g.candidates.map((c) => c.repo), ...Object.keys(g.repos)])];

export const briefReadsLeft = (g: BriefGrounding) => Math.max(0, READ_BUDGET.brief - g.reads.filter((r) => r.point > 0).length);
/** How many more reads the budget allows for `point`. */
export const readsLeft = (g: BriefGrounding, point: number) =>
  Math.max(0, Math.min(READ_BUDGET.point - g.reads.filter((r) => r.point === point).length, briefReadsLeft(g)));

const ORDER: Record<ReadStep, ReadStep | null> = { duplicates: null, issue: "duplicates", code: "duplicates", files: "code" };
/** The step that has to come first for this point in this repository, or null when `step` may run now. */
export function missingStep(g: BriefGrounding, repo: string, point: number, step: ReadStep): ReadStep | null {
  const before = ORDER[step];
  return before && !g.reads.some((r) => r.repo === repo && r.point === point && r.step === before) ? before : null;
}

const CATEGORY_LABELS: Record<DraftCategory, string[]> = { bug: ["bug"], feature: ["feature", "enhancement"], chore: ["chore", "maintenance"], docs: ["docs", "documentation"] };
const bare = (label: string) => label.toLowerCase().replace(/^(type|kind)\s*[:/]\s*/, "").trim();
/** The repository's own label for a Category ("bug", "type: bug", "enhancement" for feature), if it has one. */
export const categoryLabel = (category: DraftCategory | undefined, labels: string[]) =>
  category ? CATEGORY_LABELS[category].map((want) => labels.find((l) => bare(l) === want)).find(Boolean) : undefined;

/** The labels a draft would be created with: its Category's label, then the ones chosen for it. None without a repository. */
export function proposedLabels(g: BriefGrounding, d: BriefDraft): string[] {
  const repo = d.repo && g.repos[d.repo];
  if (!repo) return [];
  const mapped = categoryLabel(d.category, repo.labels);
  return [...new Set([...(mapped ? [mapped] : []), ...(d.labels ?? [])])];
}

/** The files and issues a draft's point was grounded in, as links pinned to the commit read; empty when nothing was read. */
export function contextUsed(g: BriefGrounding, d: BriefDraft): { title: string; url: string }[] {
  const repo = d.repo && g.repos[d.repo];
  if (!repo) return [];
  const read = g.reads.filter((r) => r.repo === d.repo && r.point === d.point && r.url && (r.step === "files" || r.step === "issue"));
  const out = [...repo.docs.map((x) => ({ title: x.path, url: x.url })), ...read.map((r) => ({ title: r.step === "issue" ? `${r.target} ${r.title ?? ""}`.trim() : r.target, url: r.url! }))];
  return out.filter((x, i) => out.findIndex((y) => y.url === x.url) === i);
}

/** The open question a draft gets when the budget ran out before its point was searched for duplicates or in the code. */
export function uncheckedQuestion(g: BriefGrounding, d: BriefDraft): { question: string; recommendation: string } | null {
  if (!d.repo || !g.repos[d.repo] || !(g.spent || readsLeft(g, d.point) === 0)) return null;
  const did = (step: ReadStep) => g.reads.some((r) => r.repo === d.repo && r.point === d.point && r.step === step);
  const missed = [!did("duplicates") && "an existing issue", !did("code") && "the code it touches"].filter(Boolean);
  if (!missed.length) return null;
  return { question: `The reading budget ran out before I checked ${d.repo} for ${missed.join(" or ")}. Should someone check before this is picked up?`, recommendation: "Yes, check before starting the work." };
}
