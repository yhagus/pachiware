/** One line of a matched file, numbered from 1, clipped to MAX_LINE_CHARS. */
export type LineHit = { line: number; text: string };
/** `modified` is when the file last changed (ms), for ordering. */
export type FileMatch = { path: string; lines: LineHit[]; modified: number };
/** A match as the agent reads it: the path it reads the file by, and the lines that matched. */
export type ShownMatch = { path: string; lines: LineHit[] };

const MAX_LINES = 3, MAX_LINE_CHARS = 200;

/** The distinct words of a query, lower-cased, with punctuation trimmed from their ends (inner marks such as "inv-00042" stay). */
export function queryWords(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
  return [...new Set(words)];
}

/**
 * Whether a file matches: every word occurs somewhere in its name or text, in any order and case.
 * Returns null when it does not, else up to three lines holding the most query words (ties go to the earlier line).
 * A file matched only through its name may return no lines.
 */
export function matchFile(words: string[], name: string, text: string): LineHit[] | null {
  if (!words.length) return null;
  const lower = text.toLowerCase(), lowerName = name.toLowerCase();
  if (!words.every((w) => lowerName.includes(w) || lower.includes(w))) return null;
  const lines = text.split("\n");
  return lower.split("\n")
    .map((l, i) => ({ i, held: words.filter((w) => l.includes(w)).length }))
    .filter((l) => l.held > 0)
    .sort((a, b) => b.held - a.held || a.i - b.i)
    .slice(0, MAX_LINES)
    .map(({ i }) => ({ line: i + 1, text: lines[i]!.slice(0, MAX_LINE_CHARS) }));
}

/** The most files one search returns. */
export const MAX_MATCHES = 50;

/** The date a file's name starts with ("2026-10-14-pricing.md"), or "" when it starts with none. */
const nameDate = (path: string) => /^\d{4}-\d{2}-\d{2}/.exec(path.split("/").pop()!)?.[0] ?? "";
/** Newest first by the date each file name starts with, files without one after those with; then by when the file last changed. */
export const newestFirst = <T extends Pick<FileMatch, "path" | "modified">>(matches: readonly T[]): T[] =>
  [...matches].sort((a, b) => nameDate(b.path).localeCompare(nameDate(a.path)) || b.modified - a.modified);

/** Matches newest first, at most MAX_MATCHES, with the total and how many were left out. */
export function capMatches<T extends FileMatch>(found: T[]) {
  const matches = newestFirst(found).slice(0, MAX_MATCHES);
  return { matches, total: found.length, leftOut: found.length - matches.length };
}

export const shownMatch = (m: FileMatch & { shown: string }): ShownMatch => ({ path: m.shown, lines: m.lines });
