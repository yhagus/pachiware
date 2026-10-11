/**
 * The offline git provider for evals: GitHub's REST shapes served from a local checkout of this repository at the
 * pinned commit, so the real git skill runs unchanged with no network and no token. Plug `offlineGitHub` into a
 * fetch stub (the Discord scenario harness's `s.http.on`).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const EVAL_DIR = import.meta.dir;
const ROOT = resolve(EVAL_DIR, "../../..");

export interface PinnedIssue { number: number; title: string; body: string }
export interface PinnedRepo { repo: string; branch: string; commit: string; labels: string[]; issues: PinnedIssue[] }

export function pinnedRepo(file = join(EVAL_DIR, "repository.yaml")): PinnedRepo {
  const raw = Bun.YAML.parse(readFileSync(file, "utf8")) as any;
  if (!/^[0-9a-f]{40}$/.test(raw?.commit ?? "")) throw new Error(`${file}: commit must be a full 40-character sha`);
  return { repo: raw.repo, branch: raw.branch ?? "main", commit: raw.commit, labels: raw.labels ?? [], issues: raw.issues ?? [] };
}

function git(args: string[], options: { cwd?: string } = {}) {
  const run = Bun.spawnSync({ cmd: ["git", ...args], cwd: options.cwd ?? ROOT });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(run.stderr).trim()}`);
  return new TextDecoder().decode(run.stdout);
}

/** Every path (files and their folders) in the tree of `commit`, read from this clone's objects. */
export function pinnedTree(commit: string): Set<string> {
  const files = git(["ls-tree", "-r", "--name-only", "-z", commit]).split("\0").filter(Boolean);
  const all = new Set(files);
  for (const f of files) for (let i = f.indexOf("/"); i > 0; i = f.indexOf("/", i + 1)) all.add(f.slice(0, i));
  return all;
}

const checkouts = new Map<string, string>();
/** `git archive` of `commit` unpacked into a temporary folder, once per process; removed when the process exits. */
export function checkoutAt(commit: string): string {
  const known = checkouts.get(commit);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), "pachiware-eval-repo-"));
  const archive = join(dir, ".archive.tar");
  git(["archive", "--format=tar", "-o", archive, commit]);
  const untar = Bun.spawnSync({ cmd: ["tar", "-xf", archive, "-C", dir] });
  if (untar.exitCode !== 0) throw new Error(`could not unpack ${commit}: ${new TextDecoder().decode(untar.stderr)}`);
  rmSync(archive);
  checkouts.set(commit, dir);
  if (checkouts.size === 1) process.on("exit", () => { for (const d of checkouts.values()) rmSync(d, { recursive: true, force: true }); });
  return dir;
}

// GitHub's code search skips files above 384 KB.
const SEARCHABLE = 384 * 1024;
const missing = () => new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });

/** A repository open beside the pinned one that holds only a README, for briefs that could belong to either. */
export interface StubRepo { repo: string; readme: string }

function stubRepo(stub: StubRepo, path: string, url: URL): unknown {
  const sha = new Bun.CryptoHasher("sha1").update(stub.repo).digest("hex"), rest = path.slice(`/repos/${stub.repo}`.length);
  if (rest === "") return { full_name: stub.repo, default_branch: "main", private: false, html_url: `https://github.com/${stub.repo}` };
  if (rest === "/labels") return [];
  if (rest === "/commits/main" || rest === `/commits/${sha}`) return { sha, commit: { message: "Initial commit", author: { name: "yhagus", date: "2026-01-01T00:00:00Z" } }, html_url: `https://github.com/${stub.repo}/commit/${sha}`, files: [] };
  if (rest === "/contents/README.md" && [sha, "main", null].includes(url.searchParams.get("ref"))) return { type: "file", path: "README.md", encoding: "base64", content: Buffer.from(stub.readme).toString("base64") };
  return missing();
}

/** A request handler answering the GitHub endpoints a playbook run reads; `undefined` for anything else. Writes get 403. */
export function offlineGitHub(pin: PinnedRepo, dir: string, stubs: StubRepo[] = []) {
  const web = `https://github.com/${pin.repo}`;
  const head = git(["log", "-1", "--format=%s%x00%an%x00%aI", pin.commit]).trim().split("\0");
  const atPin = (ref: string | null) => ref === pin.commit || ref === pin.branch;
  const local = (path: string) => {
    const full = resolve(dir, path);
    return full === dir || full.startsWith(`${dir}/`) ? full : null;
  };
  const issueOf = (i: PinnedIssue) => ({ number: i.number, title: i.title, body: i.body, state: "open", html_url: `${web}/issues/${i.number}`, user: { login: "yhagus" }, labels: [], assignees: [] });
  const termsOf = (q: string) => q.split(/\s+/).filter((t) => t && !/^(repo|is|in|language|path):/.test(t)).map((t) => t.toLowerCase());
  const files = () => [...new Bun.Glob("**/*").scanSync({ cwd: dir, onlyFiles: true, dot: true })].sort();

  return (req: { method: string; url: string; body?: unknown }): unknown => {
    const url = new URL(req.url);
    if (url.hostname !== "api.github.com") return undefined;
    if (req.method !== "GET") return new Response(JSON.stringify({ message: "The eval repository is read-only" }), { status: 403 });
    const path = url.pathname, q = url.searchParams.get("q") ?? "";

    if (path === "/user/repos") return [pin.repo, ...stubs.map((s) => s.repo)].map((full_name) => ({ full_name, default_branch: full_name === pin.repo ? pin.branch : "main", private: false, description: null }));
    const searched = /(?:^|\s)repo:(\S+)/.exec(q)?.[1];
    if (searched && searched !== pin.repo && path.startsWith("/search/")) return { total_count: 0, items: [] };
    const stub = stubs.find((s) => path === `/repos/${s.repo}` || path.startsWith(`/repos/${s.repo}/`));
    if (stub) return stubRepo(stub, path, url);
    if (path === "/search/issues") {
      const terms = termsOf(q);
      return { items: pin.issues.filter((i) => terms.every((t) => `${i.title}\n${i.body}`.toLowerCase().includes(t))).map(issueOf) };
    }
    if (path === "/search/code") {
      const terms = termsOf(q);
      const items = files().filter((f) => {
        if (statSync(join(dir, f)).size > SEARCHABLE) return false;
        const text = `${f}\n${readFileSync(join(dir, f), "utf8")}`.toLowerCase();
        return terms.every((t) => text.includes(t));
      });
      return { total_count: items.length, items: items.slice(0, 30).map((f) => ({ path: f, html_url: `${web}/blob/${pin.commit}/${f}` })) };
    }

    const prefix = `/repos/${pin.repo}`;
    if (path !== prefix && !path.startsWith(`${prefix}/`)) return missing();
    const rest = path.slice(prefix.length);
    if (rest === "") return { full_name: pin.repo, default_branch: pin.branch, private: false, html_url: web };
    if (rest === "/labels") return Number(url.searchParams.get("page") ?? 1) > 1 ? [] : pin.labels.map((name) => ({ name, color: "ededed", description: null }));
    const commit = /^\/commits\/([^/]+)$/.exec(rest);
    if (commit) return atPin(decodeURIComponent(commit[1]!))
      ? { sha: pin.commit, commit: { message: head[0], author: { name: head[1], date: head[2] } }, html_url: `${web}/commit/${pin.commit}`, files: [] }
      : missing();
    const issue = /^\/issues\/(\d+)$/.exec(rest);
    if (issue) { const found = pin.issues.find((i) => i.number === Number(issue[1])); return found ? issueOf(found) : missing(); }
    const contents = /^\/contents\/(.+)$/.exec(rest);
    if (contents) {
      if (!atPin(url.searchParams.get("ref") ?? pin.branch)) return missing();
      const rel = contents[1]!.split("/").map(decodeURIComponent).join("/"), full = local(rel);
      if (!full || !existsSync(full)) return missing();
      if (statSync(full).isDirectory()) return readdirSync(full, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({ name: e.name, path: `${rel}/${e.name}`, type: e.isDirectory() ? "dir" : "file" }));
      return { type: "file", path: rel, encoding: "base64", content: readFileSync(full).toString("base64") };
    }
    return missing();
  };
}
