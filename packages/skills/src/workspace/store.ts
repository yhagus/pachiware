import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { IndexedWorkspaceStore } from "./searchIndex.js";
import type { FolderSearch } from "./search.js";

export const MAX_FILE_BYTES = 256 * 1024;
/** Filed documents (PDF, DOCX, ...) are stored as bytes and never read back as text through `read`. */
export const MAX_BLOB_BYTES = 10 * 1024 * 1024;
export const MAX_LIST_ENTRIES = 500;

export class WorkspaceConflict extends Error {}

export interface WorkspaceEntry { path: string; type: "file" | "dir"; size?: number }

/** What every storage driver offers. Paths are tenant-relative and already validated by resolvePath; a driver adds the tenant prefix and refuses anything that would leave it. */
export interface WorkspaceStore {
  read(tenantId: string, path: string): Promise<{ content: string; version: string } | null>;
  /** A file's bytes as stored, whatever its type, up to MAX_BLOB_BYTES; null when there is no file. */
  readBytes(tenantId: string, path: string): Promise<{ bytes: Uint8Array; version: string } | null>;
  readFrontmatter(tenantId: string, path: string): Promise<{ content: string; version: string } | null>;
  /**
   * Replacing an existing file needs the version last read; a file that changed since is refused (WorkspaceConflict). A file is at most
   * MAX_FILE_BYTES unless `maxBytes` allows more, up to MAX_BLOB_BYTES, for a file only the bot's own tools read back (`readBytes`).
   */
  write(tenantId: string, path: string, content: string, expectedVersion?: string, options?: { maxBytes?: number }): Promise<{ version: string }>;
  /** A new binary file; refuses to replace one. */
  writeBytes(tenantId: string, path: string, bytes: Uint8Array): Promise<{ version: string }>;
  list(tenantId: string, path: string): Promise<WorkspaceEntry[]>;
  /** Every file below a folder, at any depth, with its version and when it last changed (ms), in the order a walk of `list` gives. Names starting with "." and everything inside them are left out. No entry cap. */
  files(tenantId: string, path: string): Promise<{ path: string; version: string; modified: number }[]>;
  /** Refuses to overwrite. */
  move(tenantId: string, from: string, to: string): Promise<void>;
  /** A file, or a folder only when empty. */
  remove(tenantId: string, path: string): Promise<void>;
}

/** A store that can also search a folder's files for words, as `workspaceStore()` gives it. */
export interface SearchableWorkspaceStore extends WorkspaceStore {
  /**
   * Every file under a folder (a tenant-relative store path) that holds any of the query terms (`queryTerms`), in the order a walk
   * of the folder gives. Hidden files are skipped, and a Document read through its Markdown matches by name only. `nameOf` gives the name a file is
   * matched by, from its store path. Uncapped: the caller caps.
   */
  searchFolder(tenantId: string, folder: string, terms: string[], nameOf: (path: string) => string): Promise<FolderSearch>;
}

const versionOf = (stat: { mtimeMs: number; size: number }) => `${stat.mtimeMs}-${stat.size}`;

/** Local-disk driver. ponytail: one instance only; the s3 driver replaces it for several, behind the same contract. */
export class LocalWorkspaceStore implements WorkspaceStore {
  constructor(private root: string) {}
  // Per-file queue so the version check and the rename of two turns never interleave in this process.
  private locks = new Map<string, Promise<unknown>>();
  private serial<T>(key: string, job: () => T): Promise<Awaited<T>> {
    const run = (this.locks.get(key) ?? Promise.resolve()).then(job, job) as Promise<Awaited<T>>;
    const tail = run.catch(() => {}); this.locks.set(key, tail);
    void tail.then(() => { if (this.locks.get(key) === tail) this.locks.delete(key); });
    return run;
  }

  /** Absolute path under the tenant folder; refuses anything whose real location (symlinks followed) is outside it. */
  private locate(tenantId: string, path: string) {
    const base = resolve(this.root, tenantId);
    mkdirSync(base, { recursive: true });
    const realBase = realpathSync(base), target = resolve(base, path);
    let probe = target;
    while (true) {
      try { var real = realpathSync(probe); break; } catch { const up = dirname(probe); if (up === probe) throw new Error("Path is outside the workspace"); probe = up; }
    }
    if (real !== realBase && !real.startsWith(realBase + sep)) throw new Error("Path is outside the workspace");
    return { base: realBase, target: join(real, relative(probe, target)) };
  }

  async read(tenantId: string, path: string) {
    const { target } = this.locate(tenantId, path);
    try {
      const stat = statSync(target);
      if (!stat.isFile()) return null;
      if (stat.size > MAX_FILE_BYTES) throw new Error("File is too large to read");
      return { content: readFileSync(target, "utf8"), version: versionOf(stat) };
    } catch (e: any) { if (e.code === "ENOENT" || e.code === "ENOTDIR") return null; throw e; }
  }

  async readBytes(tenantId: string, path: string) {
    const { target } = this.locate(tenantId, path);
    try {
      const stat = statSync(target);
      if (!stat.isFile()) return null;
      if (stat.size > MAX_BLOB_BYTES) throw new Error("File is too large to read");
      return { bytes: new Uint8Array(readFileSync(target)), version: versionOf(stat) };
    } catch (e: any) { if (e.code === "ENOENT" || e.code === "ENOTDIR") return null; throw e; }
  }

  async write(tenantId: string, path: string, content: string, expectedVersion?: string, options: { maxBytes?: number } = {}) {
    const max = Math.min(options.maxBytes ?? MAX_FILE_BYTES, MAX_BLOB_BYTES);
    if (Buffer.byteLength(content) > max) throw new Error(`File is too large (max ${max >= 1024 * 1024 ? `${max / 1024 / 1024} MB` : `${max / 1024} KB`})`);
    return this.serial(`${tenantId}/${path}`, () => {
      const { target } = this.locate(tenantId, path);
      let current: ReturnType<typeof statSync> | null = null;
      try { current = statSync(target); } catch {}
      if (current?.isDirectory()) throw new Error("A folder with that name exists");
      if (current && expectedVersion === undefined) throw new WorkspaceConflict("File already exists. Read it first and pass its version to replace it.");
      if (current && versionOf(current) !== expectedVersion) throw new WorkspaceConflict("File changed since you read it. Read it again and redo your edit.");
      if (!current && expectedVersion !== undefined) throw new WorkspaceConflict("File no longer exists.");
      return this.place(tenantId, path, target, content);
    });
  }

  async writeBytes(tenantId: string, path: string, bytes: Uint8Array) {
    if (bytes.byteLength > MAX_BLOB_BYTES) throw new Error(`File is too large (max ${MAX_BLOB_BYTES / 1024 / 1024} MB)`);
    return this.serial(`${tenantId}/${path}`, () => {
      const { target } = this.locate(tenantId, path);
      if (existsSync(target)) throw new WorkspaceConflict("File already exists.");
      return this.place(tenantId, path, target, bytes);
    });
  }

  private place(tenantId: string, path: string, target: string, content: string | Uint8Array) {
    mkdirSync(dirname(target), { recursive: true });
    const final = this.locate(tenantId, path).target; // a symlinked parent swapped in meanwhile is caught here
    const temp = join(dirname(final), `.${basename(final)}.${crypto.randomUUID().slice(0, 8)}.tmp`);
    try { writeFileSync(temp, content); renameSync(temp, final); } finally { rmSync(temp, { force: true }); }
    return { version: versionOf(statSync(final)) };
  }

  async readFrontmatter(tenantId: string, path: string) {
    const { target } = this.locate(tenantId, path);
    if (!existsSync(target)) return null;
    const stat = statSync(target);
    if (!stat.isFile()) return null;
    const fd = openSync(target, "r");
    try {
      const buffer = Buffer.alloc(1024);
      let header = "";
      while (Buffer.byteLength(header) < 16 * 1024) {
        const count = readSync(fd, buffer, 0, buffer.length, null);
        if (!count) break;
        header += buffer.subarray(0, count).toString("utf8");
        const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(header);
        if (match) return { content: match[0], version: versionOf(stat) };
        if (!header.startsWith("---")) return null;
      }
      return null;
    } finally { closeSync(fd); }
  }

  async list(tenantId: string, path: string) {
    const { base, target } = this.locate(tenantId, path);
    let names: string[];
    try { names = readdirSync(target); } catch (e: any) { if (e.code === "ENOENT" || e.code === "ENOTDIR") return []; throw e; }
    if (names.filter((name) => !name.startsWith(".")).length > MAX_LIST_ENTRIES) throw new Error(`Folder has too many entries (max ${MAX_LIST_ENTRIES})`);
    return names.sort().flatMap((name) => {
      const full = join(target, name);
      try {
        const stat = statSync(full), real = realpathSync(full);
        if (real !== base && !real.startsWith(base + sep)) return [];
        return [{ path: relative(base, full).split(sep).join("/"), type: stat.isDirectory() ? "dir" as const : "file" as const, ...(stat.isFile() ? { size: stat.size } : {}) }];
      } catch { return []; }
    });
  }

  async files(tenantId: string, path: string) {
    const { base, target } = this.locate(tenantId, path);
    const found: { path: string; version: string; modified: number }[] = [], walked = new Set<string>();
    const walk = (dir: string) => {
      let names: string[];
      try { names = readdirSync(dir); } catch { return; }
      for (const name of names.sort()) {
        if (name.startsWith(".")) continue;
        const full = join(dir, name);
        try {
          const stat = statSync(full), real = realpathSync(full);
          if (real !== base && !real.startsWith(base + sep)) continue;
          if (stat.isFile()) found.push({ path: relative(base, full).split(sep).join("/"), version: versionOf(stat), modified: stat.mtimeMs });
          else if (stat.isDirectory() && !walked.has(real)) { walked.add(real); walk(full); }
        } catch {}
      }
    };
    try { walked.add(realpathSync(target)); } catch { return found; }
    walk(target);
    return found;
  }

  async move(tenantId: string, from: string, to: string) {
    const a = this.locate(tenantId, from), b = this.locate(tenantId, to);
    return this.serial(`${tenantId}/${to}`, () => {
      if (!existsSync(a.target)) throw new Error(`"${from}" not found`);
      if (existsSync(b.target)) throw new Error(`"${to}" already exists`);
      mkdirSync(dirname(b.target), { recursive: true });
      this.locate(tenantId, to);
      renameSync(a.target, b.target);
    });
  }

  async remove(tenantId: string, path: string) {
    const { base, target } = this.locate(tenantId, path);
    if (target === base) throw new Error("Cannot delete the workspace root");
    return this.serial(`${tenantId}/${path}`, () => {
      const stat = statSync(target, { throwIfNoEntry: false });
      if (!stat) throw new Error(`"${path}" not found`);
      if (stat.isDirectory()) { if (readdirSync(target).some((n) => !n.startsWith(".name"))) throw new Error("Folder is not empty"); rmSync(target, { recursive: true }); }
      else rmSync(target);
    });
  }
}

let store: SearchableWorkspaceStore | null = null;
/** The configured driver, behind the search index. Local disk is the default; WORKSPACE_DRIVER=s3 is reserved for a later release. */
export function workspaceStore(): SearchableWorkspaceStore {
  if (store) return store;
  const driver = process.env.WORKSPACE_DRIVER || "local";
  if (driver !== "local") throw new Error(`Workspace driver "${driver}" is not available yet`);
  return (store = new IndexedWorkspaceStore(new LocalWorkspaceStore(process.env.WORKSPACE_DIR || "./data/workspace")));
}
