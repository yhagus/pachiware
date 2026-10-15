import type { SearchableWorkspaceStore, WorkspaceStore } from "./store.js";
import { isBinaryDocument } from "./extract.js";
import { matchFile, type FileMatch } from "./search.js";

type Indexed = { version: string; text: string };
const under = (path: string, folder: string) => !folder || path === folder || path.startsWith(folder + "/");

/**
 * The Workspace store with an in-process index of file texts per tenant, which search reads instead of every file.
 * Built lazily: a file is read the first time a search reaches it and again only when its version changed, so a file
 * changed outside the bot is read anew. The store's own writes, moves and removes update the index at once.
 * The index holds no access decisions: whoever searches decides which folders it may search.
 */
export class IndexedWorkspaceStore implements SearchableWorkspaceStore {
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
      if (lines) matches.push({ path: file.path, lines, modified: file.modified });
    }
    const present = new Set(files.map((f) => f.path));
    for (const path of [...index.keys()]) if (under(path, folder) && !present.has(path)) index.delete(path);
    return matches;
  }
}
