/** One line of a matched file, numbered from 1, clipped to MAX_LINE_CHARS. */
export type LineHit = { line: number; text: string };
/** `modified` is when the file last changed (ms), for ordering; `held` is the query words the file holds. */
export type FileMatch = { path: string; lines: LineHit[]; modified: number; held: string[] };
/** The matches of one folder, and how many files were searched there (ranking weighs a word by how few of them hold it). */
export type FolderSearch = { matches: FileMatch[]; searched: number };
/** A match as the agent reads it: the path it reads the file by, and the lines that matched. */
export type ShownMatch = { path: string; lines: LineHit[] };

const MAX_LINES = 3, MAX_LINE_CHARS = 200;

/** The distinct words of a query, lower-cased, with punctuation trimmed from their ends (inner marks such as "inv-00042" stay). */
export function queryWords(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
  return [...new Set(words)];
}

/** `query` and each of `queries` that is text, in that order: the wordings a tool was asked to search. */
export const wordingsOf = (query: unknown, queries: unknown): string[] => [query, ...(Array.isArray(queries) ? queries : [])].filter((q): q is string => typeof q === "string");

/** The words of every query, each query's words kept apart, empty queries dropped. */
export function queriesWords(queries: string[]): string[][] {
  return queries.map(queryWords).filter((q) => q.length);
}

/**
 * The words a file holds somewhere in its name or text, in any order and case, and up to three lines holding the most
 * of them (ties go to the earlier line). Null when it holds none. A file matched only through its name may return no lines.
 */
export function matchFile(words: string[], name: string, text: string): { held: string[]; lines: LineHit[] } | null {
  const lower = text.toLowerCase(), lowerName = name.toLowerCase();
  const held = words.filter((w) => lowerName.includes(w) || lower.includes(w));
  if (!held.length) return null;
  const lines = text.split("\n");
  return { held, lines: lower.split("\n")
    .map((l, i) => ({ i, held: held.filter((w) => l.includes(w)).length }))
    .filter((l) => l.held > 0)
    .sort((a, b) => b.held - a.held || a.i - b.i)
    .slice(0, MAX_LINES)
    .map(({ i }) => ({ line: i + 1, text: lines[i]!.slice(0, MAX_LINE_CHARS) })) };
}

/** The most files one search returns. */
export const MAX_MATCHES = 50;

/** The date a file's name starts with ("2026-10-14-pricing.md"), or "" when it starts with none. */
const nameDate = (path: string) => /^\d{4}-\d{2}-\d{2}/.exec(path.split("/").pop()!)?.[0] ?? "";
/** Newest first by the date each file name starts with, files without one after those with; then by when the file last changed. */
export const newestFirst = <T extends Pick<FileMatch, "path" | "modified">>(matches: readonly T[]): T[] =>
  [...matches].sort((a, b) => nameDate(b.path).localeCompare(nameDate(a.path)) || b.modified - a.modified);

/**
 * Best match first. A file holding every word of some query comes before one that does not; then by score, the sum of
 * each held word's BM25 inverse document frequency over the `searched` files, so a word few files hold weighs more;
 * then newest first. How often a word occurs and how long the file is do not count, so equally matching files keep date order.
 */
export function ranked<T extends FileMatch>(found: readonly T[], queries: string[][], searched: number): T[] {
  const holders = new Map<string, number>();
  for (const m of found) for (const w of m.held) holders.set(w, (holders.get(w) ?? 0) + 1);
  const idf = (w: string) => { const n = holders.get(w) ?? 0; return Math.log(1 + (Math.max(searched, n) - n + 0.5) / (n + 0.5)); };
  const keyed = found.map((m) => {
    const held = new Set(m.held);
    return { m, whole: queries.some((q) => q.every((w) => held.has(w))) ? 1 : 0, score: m.held.reduce((sum, w) => sum + idf(w), 0) };
  });
  const order = new Map(newestFirst(found).map((m, i) => [m, i]));
  return keyed.sort((a, b) => b.whole - a.whole || b.score - a.score || order.get(a.m)! - order.get(b.m)!).map((k) => k.m);
}

/** Matches best first (see `ranked`), at most MAX_MATCHES, with the total and how many were left out. */
export function capMatches<T extends FileMatch>(found: T[], queries: string[][], searched: number) {
  const matches = ranked(found, queries, searched).slice(0, MAX_MATCHES);
  return { matches, total: found.length, leftOut: found.length - matches.length };
}

export const shownMatch = (m: FileMatch & { shown: string }): ShownMatch => ({ path: m.shown, lines: m.lines });
