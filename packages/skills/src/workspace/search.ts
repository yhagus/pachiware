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

/** The most files one search returns. */
export const MAX_MATCHES = 50;

type Indexed = { version: string; text: string };
const under = (path: string, folder: string) => !folder || path === folder || path.startsWith(folder + "/");

/**
 * The Workspace store with an in-process index of file texts per tenant, which search reads instead of every file.
 * Built lazily: a file is read the first time a search reaches it and again only when its version changed, so a file
 * changed outside the bot is read anew. The store's own writes, moves and removes update the index at once.
 * The index holds no access decisions: whoever searches decides which folders it may search.
 */
export class IndexedWorkspaceStore implements WorkspaceStore {
  private tenants = new Map<string, Map<string, Indexed>>();
  constructor(private inner: WorkspaceStore) {}

  private index(tenantId: string) {
    let index = this.tenants.get(tenantId);
    if (!index) this.tenants.set(tenantId, (index = new Map()));
    return index;
  }
  /** Drops a path and, when it was a folder, everything under it; returns what was dropped. */
  private drop(tenantId: string, path: string) {
    const index = this.index(tenantId), dropped: [string, Indexed][] = [];
    for (const entry of index) if (under(entry[0], path)) dropped.push(entry);
    for (const [key] of dropped) index.delete(key);
    return dropped;
  }

  read(tenantId: string, path: string) { return this.inner.read(tenantId, path); }
  readFrontmatter(tenantId: string, path: string) { return this.inner.readFrontmatter(tenantId, path); }
  list(tenantId: string, path: string) { return this.inner.list(tenantId, path); }
  files(tenantId: string, path: string) { return this.inner.files(tenantId, path); }

  async write(tenantId: string, path: string, content: string, expectedVersion?: string) {
    const written = await this.inner.write(tenantId, path, content, expectedVersion);
    this.index(tenantId).set(path, { version: written.version, text: isBinaryDocument(path) ? "" : content });
    return written;
  }
  async writeBytes(tenantId: string, path: string, bytes: Uint8Array) {
    const written = await this.inner.writeBytes(tenantId, path, bytes);
    this.drop(tenantId, path);
    return written;
  }
  async move(tenantId: string, from: string, to: string) {
    await this.inner.move(tenantId, from, to);
    const index = this.index(tenantId);
    for (const [path, entry] of this.drop(tenantId, from)) index.set(to + path.slice(from.length), entry);
  }
  async remove(tenantId: string, path: string) {
    await this.inner.remove(tenantId, path);
    this.drop(tenantId, path);
  }

  /**
   * Every file under a folder (a tenant-relative store path) that matches the words, in the order a walk of the folder
   * gives. Hidden files and folders are skipped, and a binary Document matches by name only (its text is searched in the
   * .md beside it). `nameOf` gives the name a file is matched by, from its store path. Uncapped: the caller caps.
   */
  async searchFolder(tenantId: string, folder: string, words: string[], nameOf: (path: string) => string): Promise<FileMatch[]> {
    const index = this.index(tenantId), files = await this.inner.files(tenantId, folder);
    const matches: FileMatch[] = [];
    for (const file of files) {
      let entry = index.get(file.path);
      if (entry?.version !== file.version) {
        const read = isBinaryDocument(file.path) ? null : await this.inner.read(tenantId, file.path).catch(() => null);
        entry = { version: read?.version ?? file.version, text: read?.content ?? "" };
        index.set(file.path, entry);
      }
      const lines = matchFile(words, nameOf(file.path), entry.text);
      if (lines) matches.push({ path: file.path, lines });
    }
    const present = new Set(files.map((f) => f.path));
    for (const path of [...index.keys()]) if (under(path, folder) && !present.has(path)) index.delete(path);
    return matches;
  }
}
