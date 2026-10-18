import { isoInZone } from "../clock.js";
import { scoreOf, type TermCounts } from "./terms.js";

export { queriesTerms, wordingsOf } from "./terms.js";

/** One line of a matched file, numbered from 1, clipped to 200 characters. */
export type LineHit = { line: number; text: string };
/**
 * `modified` is when the file last changed (ms), for ordering; `held` is the query terms the file holds, `counts` how often
 * each occurs in its name, keyword header and body, and `length` how many words its body has.
 */
export type FileMatch = { path: string; lines: LineHit[]; modified: number; held: string[]; counts: TermCounts; length: number };
/**
 * The matches of one folder, how many files were searched there (ranking weighs a term by how few of them hold it), and
 * how many body words those files hold in all (ranking compares a file's length with the average).
 */
export type FolderSearch = { matches: FileMatch[]; searched: number; words: number };
/** A match as the agent reads it: the path it reads the file by, the lines that matched, and `partial` when it holds only some words of every query. */
export type ShownMatch = { path: string; lines: LineHit[]; partial?: true };

/** The most files one search returns. */
export const MAX_MATCHES = 50;

/** The date a file's name starts with ("2026-10-14-pricing.md"), or "" when it starts with none. */
export const nameDate = (path: string) => /^\d{4}-\d{2}-\d{2}/.exec(path.split("/").pop()!)?.[0] ?? "";
/** Newest first by the date each file name starts with, files without one after those with; then by when the file last changed. */
export const newestFirst = <T extends Pick<FileMatch, "path" | "modified">>(matches: readonly T[]): T[] =>
  [...matches].sort((a, b) => nameDate(b.path).localeCompare(nameDate(a.path)) || b.modified - a.modified);

/**
 * Best match first, by `scoreOf` (BM25 over name, keyword header and body, scaled by how fully the best-covered query is
 * held), each term weighed by its BM25 inverse document frequency over the `searched` files; equal scores keep newest first.
 */
export function ranked<T extends FileMatch>(found: readonly T[], queries: string[][], searched: number, words: number): T[] {
  const holders = new Map<string, number>();
  for (const m of found) for (const t of m.held) holders.set(t, (holders.get(t) ?? 0) + 1);
  const idf = (t: string) => { const n = holders.get(t) ?? 0; return Math.log(1 + (Math.max(searched, n) - n + 0.5) / (n + 0.5)); };
  const average = searched ? words / searched : 0;
  const order = new Map(newestFirst(found).map((m, i) => [m, i]));
  return found.map((m) => ({ m, score: scoreOf(m, queries, idf, average) }))
    .sort((a, b) => b.score - a.score || order.get(a.m)! - order.get(b.m)!).map((k) => k.m);
}

/** A strong match holds every term of at least one query, in any of its name, keyword header and body; any other match is partial. */
export const isStrong = (m: Pick<FileMatch, "held">, queries: string[][]) => queries.some((q) => q.every((t) => m.held.includes(t)));

/**
 * Matches best first (see `ranked`), at most MAX_MATCHES, each marked strong or not, with the total and how many were left out.
 * `nothingStrong` when there are matches and none of them is strong.
 */
export function capMatches<T extends FileMatch>(found: T[], queries: string[][], searched: number, words: number) {
  const matches = ranked(found, queries, searched, words).slice(0, MAX_MATCHES).map((m) => ({ ...m, strong: isStrong(m, queries) }));
  return { matches, total: found.length, leftOut: found.length - matches.length, nothingStrong: matches.length > 0 && !matches.some((m) => m.strong) };
}

export const shownMatch = (m: FileMatch & { shown: string; strong: boolean }): ShownMatch => ({ path: m.shown, lines: m.lines, ...(m.strong ? {} : { partial: true as const }) });

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * The files a search keeps for `since` and `until` (dates, both ends included): by the date a file's name starts with, or, when
 * it starts with none, by the day in `timeZone` the file last changed. Null when neither is given; throws on a malformed date.
 */
export function dateRange(since: unknown, until: unknown, timeZone: string): ((m: Pick<FileMatch, "path" | "modified">) => boolean) | null {
  const from = since === undefined || since === null || since === "" ? null : String(since), to = until === undefined || until === null || until === "" ? null : String(until);
  for (const d of [from, to]) if (d !== null && !DAY.test(d)) throw new Error(`"${d.slice(0, 40)}" is not a date: use YYYY-MM-DD`);
  if (from === null && to === null) return null;
  return (m) => {
    const day = nameDate(m.path) || isoInZone(timeZone, m.modified).slice(0, 10);
    return (from === null || day >= from) && (to === null || day <= to);
  };
}
