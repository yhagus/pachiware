import { headCommit, readBlob, repoTree, type GitConn, type TreeFile } from "./git.js";
import { now } from "./clock.js";
import { extensionOf } from "./workspace/extract.js";
import { addKeywords } from "./workspace/keywords.js";
import { checkSegments } from "./workspace/paths.js";
import { MAX_FILE_BYTES, workspaceStore } from "./workspace/store.js";
import type { Completion } from "./types.js";

/**
 * The documentation mirror (#248): the text files of a repository's default branch that an admin's path patterns match, copied into a
 * channel's `files/docs/<owner>/<repo>/` folder as Documents, so `searchFiles` and `recall` find them like any kept file (ADR 0013).
 * A hidden manifest beside them records the commit and each file's blob sha, so a refresh rewrites only what changed upstream.
 */

/** The file types a mirror copies; anything else the patterns match is left out. */
export const DOC_EXTENSIONS = ["md", "mdx", "markdown", "txt", "rst", "adoc"];
/** The most files one source mirrors; further matches are counted in the manifest, not copied. */
export const MAX_MIRRORED_FILES = 200;
export const MAX_DOC_PATTERNS = 20;
const MAX_PATTERN = 200;
/** Hidden, like `.documents/`: listings, `searchFiles` and `recall` skip names starting with ".". */
const MANIFEST = ".mirror.json";
const PATTERN_SEGMENT = /^[\p{L}\p{N}._ *-]+$/u;

export type DocSkipReason = "tooLarge" | "path" | "unreadable";
export type DocSkip = { path: string; reason: DocSkipReason };
/** What a mirror folder holds and why: `files` maps each mirrored path to its blob sha; `leftOut` counts matches past MAX_MIRRORED_FILES. */
export interface MirrorManifest {
  repo: string; branch: string; commit: string; paths: string[]; files: Record<string, string>; skipped: DocSkip[]; leftOut: number;
  /** The provider cut the tree listing, so some matches may be missing. */ truncated?: true;
  /** The channel's Git scope stopped allowing the repository; set once, when the refresh first found it. */ notAllowed?: true;
  refreshedAt: string;
}
export type MirrorResult = { status: "unchanged" } | { status: "mirrored"; commit: string; written: string[]; removed: string[]; skipped: DocSkip[]; leftOut: number };

/** Why a path pattern cannot be saved, or null: folder and file names with `*` inside a name and `**` for any depth; never `/` first, `.` or `..`, or other glob syntax. */
export function docPatternError(pattern: string): string | null {
  const p = pattern.trim();
  if (!p) return "a path pattern must not be empty";
  if (p.length > MAX_PATTERN) return `a path pattern has at most ${MAX_PATTERN} characters`;
  if (p.split("/").some((s) => !s || s === "." || s === ".." || !PATTERN_SEGMENT.test(s))) return `"${p}" is not a path pattern: use folder and file names, * and **, such as docs/** or adr/*.md`;
  return null;
}

/** Whether the repository path matches one of `patterns`: `*` stays inside one name, `**` crosses folders; case counts. */
export const matchesDocPaths = (patterns: string[], path: string) => patterns.some((p) => new Bun.Glob(p).match(path));

/** The Workspace folder (tenant-relative) where a channel's mirror of `repo` lives. */
export const mirrorFolder = (guildId: string, channelId: string, repo: string) => `guilds/${guildId}/channels/${channelId}/files/docs/${repo}`;

/**
 * The files of `tree` to mirror: text files matching a pattern, in the order of the patterns, then by path, at most MAX_MIRRORED_FILES.
 * A file over the Workspace's text limit (when the provider gives its size), or whose path is no Workspace path (too deep, or a name the
 * agent's paths refuse), is skipped and listed.
 */
export function pickDocs(tree: TreeFile[], patterns: string[], repo: string): { wanted: TreeFile[]; skipped: DocSkip[]; leftOut: number } {
  const texts = tree.filter((f) => DOC_EXTENSIONS.includes(extensionOf(f.path))).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const taken = new Set<string>(), mirrorable: TreeFile[] = [], skipped: DocSkip[] = [];
  for (const pattern of patterns.map((p) => new Bun.Glob(p))) {
    for (const file of texts) {
      if (taken.has(file.path) || !pattern.match(file.path)) continue;
      taken.add(file.path);
      if (!workspacePath(repo, file.path)) skipped.push({ path: file.path, reason: "path" });
      else if (file.size !== undefined && file.size > MAX_FILE_BYTES) skipped.push({ path: file.path, reason: "tooLarge" });
      else mirrorable.push(file);
    }
  }
  return { wanted: mirrorable.slice(0, MAX_MIRRORED_FILES), skipped, leftOut: Math.max(0, mirrorable.length - MAX_MIRRORED_FILES) };
}

/** Whether `channel/files/docs/<repo>/<path>` is a path the agent can read the file by. */
function workspacePath(repo: string, path: string) {
  try { checkSegments(["files", "docs", ...repo.split("/"), ...path.split("/")]); return true; } catch { return false; }
}

export async function readManifest(tenantId: string, folder: string): Promise<MirrorManifest | null> {
  const file = await workspaceStore().read(tenantId, `${folder}/${MANIFEST}`).catch(() => null);
  try { const m = file && JSON.parse(file.content); return m && typeof m.files === "object" && m.files ? m : null; } catch { return null; }
}

async function writeManifest(tenantId: string, folder: string, manifest: MirrorManifest) {
  await replace(tenantId, `${folder}/${MANIFEST}`, JSON.stringify(manifest, null, 2));
}

/** Writes over whatever is there: the mirror is the only writer of its folder. */
async function replace(tenantId: string, path: string, content: string) {
  const store = workspaceStore();
  await store.write(tenantId, path, content, (await store.read(tenantId, path))?.version);
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Brings the mirror of `repo` in `folder` up to its default branch. Nothing is read past the head commit when the commit, the patterns and
 * every mirrored file are as the manifest left them and nothing was unreadable. Otherwise a file whose blob changed (or whose copy is gone) is
 * written again and gets its keyword head (`addKeywords`, with `complete`); a file no longer matched upstream is deleted. Only files the
 * manifest lists are ever deleted. A file that cannot be read keeps its old copy and is retried on the next refresh.
 */
export async function mirrorSource(input: { tenantId: string; folder: string; conn: GitConn; repo: string; paths: string[]; complete?: Completion }): Promise<MirrorResult> {
  const { tenantId, folder, conn, repo, paths, complete } = input, store = workspaceStore();
  const before = await readManifest(tenantId, folder);
  const head = await headCommit(conn, repo);
  const present = new Set((await store.files(tenantId, folder)).map((f) => f.path.slice(folder.length + 1)));
  const old = before?.files ?? {};
  if (before && before.commit === head.commit && sameList(before.paths ?? [], paths) && !before.notAllowed
    && !before.skipped?.some((s) => s.reason === "unreadable") && Object.keys(old).every((p) => present.has(p))) return { status: "unchanged" };

  const tree = await repoTree(conn, repo, head.commit);
  const { wanted, skipped, leftOut } = pickDocs(tree.files, paths, repo);
  const files: Record<string, string> = {}, written: string[] = [];
  for (const file of wanted) {
    if (old[file.path] === file.sha && present.has(file.path)) { files[file.path] = file.sha; continue; }
    const target = `${folder}/${file.path}`;
    try {
      const bytes = await readBlob(conn, repo, file.sha);
      if (bytes.byteLength > MAX_FILE_BYTES) { skipped.push({ path: file.path, reason: "tooLarge" }); continue; }
      await replace(tenantId, target, new TextDecoder().decode(bytes));
    } catch {
      skipped.push({ path: file.path, reason: "unreadable" });
      if (old[file.path] && present.has(file.path)) files[file.path] = old[file.path]!;
      continue;
    }
    files[file.path] = file.sha;
    written.push(file.path);
    await addKeywords(tenantId, target, complete);
  }
  const removed = Object.keys(old).filter((p) => !(p in files) && present.has(p));
  for (const path of removed) await store.remove(tenantId, `${folder}/${path}`).catch(() => {});
  await pruneFolders(tenantId, folder, removed);
  // At most MAX_MIRRORED_FILES skips are listed, the unreadable first, since they decide whether the next refresh reads the tree again.
  const listed = [...skipped.filter((s) => s.reason === "unreadable"), ...skipped.filter((s) => s.reason !== "unreadable")].slice(0, MAX_MIRRORED_FILES);
  await writeManifest(tenantId, folder, {
    repo, branch: head.branch, commit: head.commit, paths, files, skipped: listed, leftOut, ...(tree.truncated ? { truncated: true as const } : {}), refreshedAt: new Date(now()).toISOString(),
  });
  return { status: "mirrored", commit: head.commit, written, removed, skipped, leftOut };
}

/** Marks the mirror in `folder` as no longer allowed by the Git scope; true only the first time, so the caller logs it once. Its files stay. */
export async function noteNotAllowed(tenantId: string, folder: string, repo: string): Promise<boolean> {
  const before = await readManifest(tenantId, folder);
  if (before?.notAllowed) return false;
  const manifest: MirrorManifest = before ?? { repo, branch: "", commit: "", paths: [], files: {}, skipped: [], leftOut: 0, refreshedAt: "" };
  await writeManifest(tenantId, folder, { ...manifest, notAllowed: true });
  return true;
}

/** Deletes a mirror an admin removed: the files its manifest lists, the manifest, and the folders left empty up to `files/`. */
export async function dropMirror(tenantId: string, folder: string): Promise<void> {
  const store = workspaceStore(), manifest = await readManifest(tenantId, folder);
  if (!manifest) return;
  const listed = Object.keys(manifest.files);
  for (const path of listed) await store.remove(tenantId, `${folder}/${path}`).catch(() => {});
  await store.remove(tenantId, `${folder}/${MANIFEST}`).catch(() => {});
  await pruneFolders(tenantId, folder, listed);
  const files = folder.slice(0, folder.indexOf("/files/docs/") + "/files".length);
  for (let dir = folder; dir.length > files.length; dir = dir.slice(0, dir.lastIndexOf("/"))) if (!(await removeIfEmpty(tenantId, dir))) break;
}

/** Removes the folders under `folder` that held `paths` and are now empty, deepest first. */
async function pruneFolders(tenantId: string, folder: string, paths: string[]) {
  const dirs = new Set<string>();
  for (const path of paths) for (let i = path.lastIndexOf("/"); i > 0; i = path.lastIndexOf("/", i - 1)) dirs.add(path.slice(0, i));
  for (const dir of [...dirs].sort((a, b) => b.split("/").length - a.split("/").length)) await removeIfEmpty(tenantId, `${folder}/${dir}`);
}

const removeIfEmpty = async (tenantId: string, dir: string) => {
  if ((await workspaceStore().list(tenantId, dir).catch(() => [{}])).length) return false;
  return workspaceStore().remove(tenantId, dir).then(() => true, () => false);
};
