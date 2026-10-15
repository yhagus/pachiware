import type { WorkspaceStore } from "./store.js";
import { isBinaryDocument } from "./extract.js";

/** One line of a matched file, numbered from 1, clipped to MAX_LINE_CHARS. */
export type LineHit = { line: number; text: string };
export type FileMatch = { path: string; lines: LineHit[] };

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

const MAX_MATCHES = 50, MAX_SCANNED = 500;
/**
 * Walks a folder and matches each file; hidden files and folders are skipped, and a binary Document matches by name only
 * (its text is searched in the .md beside it). `nameOf` gives the name a file is matched by, from its store path.
 * ponytail: reads every file per query; the index (#150) replaces the walk.
 */
export async function searchFolder(store: WorkspaceStore, tenantId: string, root: string, words: string[], nameOf: (path: string) => string): Promise<FileMatch[]> {
  const matches: FileMatch[] = [];
  let scanned = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const e of await store.list(tenantId, dir)) {
      if (matches.length >= MAX_MATCHES || scanned >= MAX_SCANNED) return;
      if (e.path.split("/").pop()!.startsWith(".")) continue;
      if (e.type === "dir") { await walk(e.path); continue; }
      scanned++;
      const text = isBinaryDocument(e.path) ? "" : (await store.read(tenantId, e.path).catch(() => null))?.content ?? "";
      const lines = matchFile(words, nameOf(e.path), text);
      if (lines) matches.push({ path: e.path, lines });
    }
  };
  await walk(root);
  return matches;
}
