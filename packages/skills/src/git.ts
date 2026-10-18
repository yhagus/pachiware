import { holdsQuery, queriesTerms } from "./workspace/terms.js";

export type GitProvider = "github" | "gitlab";
export const GIT_PROVIDERS: GitProvider[] = ["github", "gitlab"];

/** github.com / gitlab.com typed as a "self-hosted" URL would hit /api/v3 on the wrong server; treat them as the default host. */
export const isDefaultGitHost = (url: string) => /^(www\.)?(github|gitlab)\.com$/i.test(new URL(url).host);

// baseUrl is the host root (e.g. https://gitlab.example.com); null means github.com / gitlab.com.
export function apiRoot(provider: GitProvider, baseUrl: string | null): string {
  const host = baseUrl?.replace(/\/+$/, "");
  if (provider === "github") return host ? `${host}/api/v3` : "https://api.github.com";
  return `${host ?? "https://gitlab.com"}/api/v4`;
}

export function authHeaders(provider: GitProvider, token: string, oauth = false): Record<string, string> {
  return provider === "github" || oauth
    ? { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" }
    : { "PRIVATE-TOKEN": token };
}

/** Validates the token against the provider and returns the account's login. Throws on any failure. */
export async function fetchGitUsername(provider: GitProvider, baseUrl: string | null, token: string, oauth = false): Promise<string> {
  const res = await fetch(`${apiRoot(provider, baseUrl)}/user`, { headers: authHeaders(provider, token, oauth), signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Provider returned ${res.status}`);
  const user: any = await res.json();
  const name = provider === "github" ? user?.login : user?.username;
  if (typeof name !== "string" || !name) throw new Error("Provider returned no username");
  return name;
}

export interface GitConn { provider: GitProvider; baseUrl: string | null; token: string; oauth?: boolean }
export interface GitRepo { repo: string; defaultBranch: string; private: boolean; description: string | null }

export async function call(c: GitConn, path: string, init: { method?: string; body?: unknown; text?: boolean } = {}): Promise<any> {
  const res = await fetch(path.startsWith("http") ? path : `${apiRoot(c.provider, c.baseUrl)}${path}`, {
    method: init.method ?? "GET",
    headers: { ...authHeaders(c.provider, c.token, c.oauth), ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${c.provider} returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? {} : init.text ? res.text() : res.json();
}
// "owner/name" for GitHub; GitLab takes the url-encoded full path as project id.
export const repoRef = (c: GitConn, repo: string) => {
  if (!/^[\w.-]+(\/[\w.-]+)+$/.test(repo)) throw new Error(`Invalid repo "${repo}"; use owner/name`);
  return c.provider === "github" ? `/repos/${repo}` : `/projects/${encodeURIComponent(repo)}`;
};
export const cleanPath = (p: string) => {
  const path = p.replace(/^\/+/, "");
  if (!path || path.split("/").some((s) => s === ".." || s === ".")) throw new Error("Invalid path");
  return path;
};
export const fileUrl = (c: GitConn, repo: string, path: string) =>
  c.provider === "github" ? `${repoRef(c, repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}` : `${repoRef(c, repo)}/repository/files/${encodeURIComponent(path)}`;

export async function listRepos(c: GitConn, query?: string): Promise<GitRepo[]> {
  const q = query?.trim().toLowerCase();
  const rows: any[] = (c.provider === "github"
    ? await call(c, "/user/repos?per_page=100&sort=updated")
    : await call(c, `/projects?membership=true&per_page=100&order_by=last_activity_at${q ? `&search=${encodeURIComponent(q)}` : ""}`)) ?? [];
  return rows
    .map((r) => ({ repo: r.full_name ?? r.path_with_namespace, defaultBranch: r.default_branch ?? "main", private: r.private ?? r.visibility !== "public", description: r.description ?? null }))
    .filter((r) => !q || r.repo.toLowerCase().includes(q));
}
export async function defaultBranch(c: GitConn, repo: string): Promise<string> {
  const r = await call(c, repoRef(c, repo));
  if (!r) throw new Error(`Repository ${repo} not found or not accessible`);
  return r.default_branch;
}
export async function readFile(c: GitConn, repo: string, path: string, ref?: string) {
  const p = cleanPath(path), at = ref ?? await defaultBranch(c, repo);
  const r = await call(c, `${fileUrl(c, repo, p)}?ref=${encodeURIComponent(at)}`);
  if (!r) {
    // A directory has no file entry; list it instead.
    const tree = c.provider === "github" ? null : await call(c, `${repoRef(c, repo)}/repository/tree?path=${encodeURIComponent(p)}&ref=${encodeURIComponent(at)}`);
    if (tree?.length) return { type: "dir", entries: tree.map((e: any) => ({ name: e.name, type: e.type === "tree" ? "dir" : "file" })) };
    throw new Error(`${p} not found at ${at}`);
  }
  if (Array.isArray(r)) return { type: "dir", entries: r.map((e: any) => ({ name: e.name, type: e.type === "dir" ? "dir" : "file" })) };
  const text = Buffer.from(r.content, "base64").toString("utf8");
  // ponytail: output capped at 20k chars; add paging by line range when larger files matter.
  return { type: "file", ref: at, content: text.slice(0, 20000), truncated: text.length > 20000 };
}
/** Returns the default branch, or throws when `branch` is it: plain writes go to another branch, only repoWriteDefaultBranch writes there. */
async function assertNotDefaultBranch(c: GitConn, repo: string, branch: string) {
  if (typeof branch !== "string" || !branch.trim()) throw new Error("branch is required");
  const base = await defaultBranch(c, repo);
  if (branch.trim().replace(/^refs\/heads\//, "") === base) throw new Error(`Refusing to write to the default branch "${base}"; use another branch and open a pull request (writing there directly is repoWriteDefaultBranch, owner only)`);
  return base;
}
/** Commits a file to `branch` (created from the default branch if missing). Never writes to the default branch. */
export async function writeFile(c: GitConn, repo: string, path: string, content: string, message: string, branch: string) {
  const p = cleanPath(path), base = await assertNotDefaultBranch(c, repo, branch);
  const gh = c.provider === "github", ref = repoRef(c, repo);
  const branchInfo = gh ? await call(c, `${ref}/branches/${encodeURIComponent(branch)}`) : await call(c, `${ref}/repository/branches/${encodeURIComponent(branch)}`);
  if (!branchInfo) {
    if (gh) {
      const head = await call(c, `${ref}/git/ref/heads/${encodeURIComponent(base)}`);
      await call(c, `${ref}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: head.object.sha } });
    } else await call(c, `${ref}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(base)}`, { method: "POST" });
  }
  const existing = await call(c, `${fileUrl(c, repo, p)}?ref=${encodeURIComponent(branch)}`);
  const b64 = Buffer.from(content, "utf8").toString("base64");
  if (gh) await call(c, fileUrl(c, repo, p), { method: "PUT", body: { message, content: b64, branch, ...(existing?.sha ? { sha: existing.sha } : {}) } });
  else await call(c, fileUrl(c, repo, p), { method: existing ? "PUT" : "POST", body: { branch, content: b64, encoding: "base64", commit_message: message } });
  return { repo, path: p, branch, created: !existing };
}
export async function openPullRequest(c: GitConn, repo: string, branch: string, title: string, body?: string) {
  const base = await defaultBranch(c, repo), ref = repoRef(c, repo);
  const r = c.provider === "github"
    ? await call(c, `${ref}/pulls`, { method: "POST", body: { title, head: branch, base, body } })
    : await call(c, `${ref}/merge_requests`, { method: "POST", body: { source_branch: branch, target_branch: base, title, description: body } });
  return { url: r.html_url ?? r.web_url, number: r.number ?? r.iid };
}

export type ItemKind = "issue" | "merge_request";
export const must = <T>(v: T | null, what: string): T => { if (v === null) throw new Error(`${what} not found`); return v; };
export function itemPath(c: GitConn, repo: string, number: number, kind: ItemKind) {
  if (!Number.isInteger(number) || number < 1) throw new Error("number must be a positive integer");
  const ref = repoRef(c, repo);
  // GitHub serves comments and closing of both issues and pull requests under /issues.
  return c.provider === "github" ? `${ref}/issues/${number}` : `${ref}/${kind === "issue" ? "issues" : "merge_requests"}/${number}`;
}
export async function commentOn(c: GitConn, repo: string, number: number, kind: ItemKind, body: string) {
  const r = must(await call(c, `${itemPath(c, repo, number, kind)}/${c.provider === "github" ? "comments" : "notes"}`, { method: "POST", body: { body } }), `#${number} in ${repo}`);
  return { repo, number, url: r.html_url ?? null };
}
/** `id` is GitHub's database id, which its dependencies API takes in place of the number. */
export async function createIssue(c: GitConn, repo: string, title: string, body?: string, labels: string[] = []) {
  const gh = c.provider === "github", tags = labels.length ? { labels: gh ? labels : labels.join(",") } : {};
  const r = must(await call(c, `${repoRef(c, repo)}/issues`, { method: "POST", body: gh ? { title, body, ...tags } : { title, description: body, ...tags } }), repo);
  return { repo, number: r.number ?? r.iid, url: r.html_url ?? r.web_url, ...(gh && typeof r.id === "number" ? { id: r.id } : {}) };
}
/**
 * Records that issue `blocked` waits on `blocker` in the same repository: a GitHub issue dependency, or a GitLab
 * "blocks" link (Premium). Throws where the platform has no such link.
 */
export async function linkBlockedBy(c: GitConn, repo: string, blocker: { number: number; id?: number }, blocked: number) {
  const ref = repoRef(c, repo);
  if (c.provider === "github") {
    if (!blocker.id) throw new Error(`#${blocker.number} has no database id to link`);
    must(await call(c, `${ref}/issues/${blocked}/dependencies/blocked_by`, { method: "POST", body: { issue_id: blocker.id } }), `#${blocked} in ${repo}`);
  } else must(await call(c, `${ref}/issues/${blocker.number}/links`, { method: "POST", body: { target_project_id: repo, target_issue_iid: blocked, link_type: "blocks" } }), `#${blocker.number} in ${repo}`);
}
/** GitHub's database id for issue `number`, which its dependency and sub-issue APIs take in place of the number. */
async function githubIssueId(c: GitConn, repo: string, number: number): Promise<number> {
  return must(await call(c, itemPath(c, repo, number, "issue")), `#${number} in ${repo}`).id;
}
export async function linkIssues(c: GitConn, repo: string, issue: number, blockedBy: number) {
  const blocker = c.provider === "github" ? { number: blockedBy, id: await githubIssueId(c, repo, blockedBy) } : { number: blockedBy };
  await linkBlockedBy(c, repo, blocker, issue);
  return { repo, issue, blockedBy };
}
/**
 * Puts `child` under `parent` or takes it out again. GitHub has native sub-issues; GitLab (outside Premium epics) has
 * none, so the child is a "relates_to" link plus a task list line in the parent's description.
 */
export async function subIssue(c: GitConn, repo: string, parent: number, child: number, action: "attach" | "detach") {
  const path = itemPath(c, repo, parent, "issue"), where = `#${parent} in ${repo}`;
  if (c.provider === "github") {
    const body = { sub_issue_id: await githubIssueId(c, repo, child) };
    must(await call(c, action === "attach" ? `${path}/sub_issues` : `${path}/sub_issue`, { method: action === "attach" ? "POST" : "DELETE", body }), where);
    return { repo, parent, child, action };
  }
  if (action === "attach") must(await call(c, `${path}/links`, { method: "POST", body: { target_project_id: repo, target_issue_iid: child, link_type: "relates_to" } }), where);
  else {
    const links: any[] = must(await call(c, `${path}/links`), where);
    const link = links.find((l) => l.iid === child);
    if (link) await call(c, `${path}/links/${link.issue_link_id}`, { method: "DELETE" });
  }
  const description = String(must(await call(c, path), where).description ?? "");
  const line = new RegExp(`^- \\[[ xX]\\] #${child}\\b.*$`, "m");
  const next = action === "attach"
    ? (line.test(description) ? description : `${description.replace(/\s+$/, "")}${description.trim() ? "\n" : ""}- [ ] #${child}`)
    : description.replace(new RegExp(`\\n?^- \\[[ xX]\\] #${child}\\b.*$`, "m"), "");
  if (next !== description) await call(c, path, { method: "PUT", body: { description: next } });
  return { repo, parent, child, action };
}
export async function mergeMergeRequest(c: GitConn, repo: string, number: number) {
  const ref = repoRef(c, repo), gh = c.provider === "github";
  if (!Number.isInteger(number) || number < 1) throw new Error("number must be a positive integer");
  const r = must(await call(c, `${ref}/${gh ? "pulls" : "merge_requests"}/${number}/merge`, { method: "PUT", body: {} }), `#${number} in ${repo}`);
  return { repo, number, merged: gh ? !!r.merged : r.state === "merged", message: r.message ?? null };
}
export async function closeItem(c: GitConn, repo: string, number: number, kind: ItemKind) {
  const gh = c.provider === "github";
  must(await call(c, itemPath(c, repo, number, kind), { method: gh ? "PATCH" : "PUT", body: gh ? { state: "closed" } : { state_event: "close" } }), `#${number} in ${repo}`);
  return { repo, number, state: "closed" };
}

export async function updateMergeRequest(c: GitConn, repo: string, number: number, patch: { title?: string; body?: string; target?: string; draft?: boolean }) {
  const ref = repoRef(c, repo), gh = c.provider === "github";
  if (!Number.isInteger(number) || number < 1) throw new Error("number must be a positive integer");
  const body = gh ? { ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.body !== undefined ? { body: patch.body } : {}), ...(patch.target !== undefined ? { base: patch.target } : {}), ...(patch.draft !== undefined ? { draft: patch.draft } : {}) }
    : { ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.body !== undefined ? { description: patch.body } : {}), ...(patch.target !== undefined ? { target_branch: patch.target } : {}), ...(patch.draft !== undefined ? { draft: patch.draft } : {}) };
  const r = must(await call(c, `${ref}/${gh ? "pulls" : "merge_requests"}/${number}`, { method: gh ? "PATCH" : "PUT", body }), `#${number} in ${repo}`);
  return { repo, number, title: r.title, state: normState(r.state), url: r.html_url ?? r.web_url };
}

export async function reopenItem(c: GitConn, repo: string, number: number, kind: ItemKind) {
  const gh = c.provider === "github", r = must(await call(c, itemPath(c, repo, number, kind), { method: gh ? "PATCH" : "PUT", body: gh ? { state: "open" } : { state_event: "reopen" } }), `#${number} in ${repo}`);
  return { repo, number, state: normState(r.state) };
}

export async function reviewMergeRequest(c: GitConn, repo: string, number: number, event: "approve" | "request_changes" | "comment", body?: string) {
  const ref = repoRef(c, repo), gh = c.provider === "github";
  if (!Number.isInteger(number) || number < 1) throw new Error("number must be a positive integer");
  if (gh) {
    const r = must(await call(c, `${ref}/pulls/${number}/reviews`, { method: "POST", body: { event: event === "request_changes" ? "REQUEST_CHANGES" : event === "approve" ? "APPROVE" : "COMMENT", body: body ?? "" } }), `#${number} in ${repo}`);
    return { repo, number, event, id: r.id ?? null };
  }
  if (event === "approve") {
    const r = must(await call(c, `${ref}/merge_requests/${number}/approve`, { method: "POST" }), `#${number} in ${repo}`);
    return { repo, number, event, approved: true, id: r.id ?? null };
  }
  const r = must(await call(c, `${ref}/merge_requests/${number}/notes`, { method: "POST", body: { body: body ?? (event === "request_changes" ? "Changes requested" : "") } }), `#${number} in ${repo}`);
  return { repo, number, event, approved: false, id: r.id ?? null };
}

export async function requestReviewers(c: GitConn, repo: string, number: number, reviewers: string[]) {
  const ref = repoRef(c, repo), gh = c.provider === "github";
  if (!reviewers.length) throw new Error("reviewers must contain at least one username");
  if (!gh) {
    const ids: number[] = [];
    for (const reviewer of reviewers) {
      const found: any[] = (await call(c, `${ref}/members/all?search=${encodeURIComponent(reviewer)}&per_page=100`)) ?? [];
      const match = found.find((x) => x.username?.toLowerCase() === reviewer.toLowerCase() || x.name?.toLowerCase() === reviewer.toLowerCase());
      if (!match?.id) throw new Error(`GitLab reviewer "${reviewer}" was not found`);
      ids.push(match.id);
    }
    const r = must(await call(c, `${ref}/merge_requests/${number}`, { method: "PUT", body: { reviewer_ids: ids } }), `#${number} in ${repo}`);
    return { repo, number, reviewers: (r.reviewers ?? []).map((x: any) => x.username ?? x.name) };
  }
  const r = must(await call(c, `${ref}/pulls/${number}/requested_reviewers`, { method: "POST", body: { reviewers } }), `#${number} in ${repo}`);
  return { repo, number, reviewers: (r.requested_reviewers ?? []).map((x: any) => x.login) };
}

export async function mergeRequestDiff(c: GitConn, repo: string, number: number) {
  const ref = repoRef(c, repo), gh = c.provider === "github";
  const r: any[] = gh ? (await call(c, `${ref}/pulls/${number}/files?per_page=100`)) ?? [] : ((await call(c, `${ref}/merge_requests/${number}/changes`))?.changes ?? []);
  return { repo, number, files: r.slice(0, 100).map((f: any) => gh ? { path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: String(f.patch ?? "").slice(0, 12000) } : { path: f.new_path, status: f.new_file ? "added" : f.deleted_file ? "removed" : f.renamed_file ? "renamed" : "modified", diff: String(f.diff ?? "").slice(0, 12000) }), truncated: r.length > 100 };
}

export async function repoChecks(c: GitConn, repo: string, refName: string) {
  const path = repoRef(c, repo), gh = c.provider === "github";
  if (gh) {
    const [checks, status] = await Promise.all([call(c, `${path}/commits/${encodeURIComponent(refName)}/check-runs?per_page=100`), call(c, `${path}/commits/${encodeURIComponent(refName)}/status`)]);
    return { ref: refName, checks: (checks?.check_runs ?? []).map((x: any) => ({ name: x.name, status: x.status, conclusion: x.conclusion, url: x.html_url })), statuses: (status?.statuses ?? []).map((x: any) => ({ context: x.context, state: x.state, description: x.description, url: x.target_url })) };
  }
  const rows: any[] = (await call(c, `${path}/repository/commits/${encodeURIComponent(refName)}/statuses`)) ?? [];
  return { ref: refName, checks: rows.map((x) => ({ name: x.name ?? x.context, status: x.status ?? x.state, description: x.description, url: x.target_url ?? x.web_url })), statuses: [] };
}

export async function rebaseMergeRequest(c: GitConn, repo: string, number: number) {
  const ref = repoRef(c, repo), gh = c.provider === "github";
  if (gh) throw new Error("GitHub does not expose a general rebase endpoint; update the branch with the provider UI or git");
  const r = must(await call(c, `${ref}/merge_requests/${number}`, { method: "PUT", body: { rebase: true } }), `#${number} in ${repo}`);
  return { repo, number, rebased: r.rebase_in_progress === false || r.rebase_in_progress === undefined };
}

export async function updateIssue(c: GitConn, repo: string, number: number, patch: { title?: string; body?: string }) {
  const gh = c.provider === "github", r = must(await call(c, itemPath(c, repo, number, "issue"), { method: gh ? "PATCH" : "PUT", body: gh ? patch : { ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.body !== undefined ? { description: patch.body } : {}) } }), `#${number} in ${repo}`);
  return { repo, number, title: r.title, url: r.html_url ?? r.web_url };
}

export async function assignItem(c: GitConn, repo: string, number: number, kind: ItemKind, assignees: string[]) {
  const gh = c.provider === "github", r = must(await call(c, itemPath(c, repo, number, kind), { method: gh ? "PATCH" : "PUT", body: gh ? { assignees } : { assignee_ids: assignees } }), `#${number} in ${repo}`);
  return { repo, number, assignees: (r.assignees ?? []).map((x: any) => x.login ?? x.username) };
}

export async function listLabels(c: GitConn, repo: string, page: number) {
  const rows: any[] = (await call(c, `${repoRef(c, repo)}/${c.provider === "github" ? "labels" : "labels"}?${paged(page)}`)) ?? [];
  return pageOf(rows, rows.map((x) => ({ name: x.name, color: x.color, description: x.description ?? null })));
}
export async function setLabels(c: GitConn, repo: string, number: number, kind: ItemKind, labels: string[]) {
  const gh = c.provider === "github";
  const r = must(await call(c, gh ? `${itemPath(c, repo, number, kind)}/labels` : `${repoRef(c, repo)}/${kind === "issue" ? "issues" : "merge_requests"}/${number}`, { method: "PUT", body: gh ? { labels } : { labels: labels.join(",") } }), `#${number} in ${repo}`);
  return { repo, number, labels: (r ?? []).map((x: any) => x.name ?? x) };
}

export async function lockItem(c: GitConn, repo: string, number: number, kind: ItemKind, locked: boolean) {
  if (c.provider === "gitlab") throw new Error("GitLab does not expose issue or merge request locking through this API");
  const gh = c.provider === "github", path = `${itemPath(c, repo, number, kind)}/${gh ? "lock" : "lock"}`;
  await call(c, path, { method: locked ? "PUT" : "DELETE", ...(locked && !gh ? { body: { lock_reason: "resolved" } } : {}) });
  return { repo, number, locked };
}

export async function editComment(c: GitConn, repo: string, id: number, kind: ItemKind, body: string) {
  const gh = c.provider === "github";
  const path = gh ? (kind === "merge_request" ? `${repoRef(c, repo)}/pulls/comments/${id}` : `/repos/${repo}/issues/comments/${id}`) : `${repoRef(c, repo)}/${kind === "merge_request" ? "merge_requests" : "issues"}/notes/${id}`;
  const r = must(await call(c, path, { method: gh ? "PATCH" : "PUT", body: { body } }), `comment ${id} in ${repo}`);
  return { repo, id, body: r.body };
}
export async function deleteComment(c: GitConn, repo: string, id: number, kind: ItemKind) {
  const gh = c.provider === "github";
  const path = gh ? (kind === "merge_request" ? `${repoRef(c, repo)}/pulls/comments/${id}` : `/repos/${repo}/issues/comments/${id}`) : `${repoRef(c, repo)}/${kind === "merge_request" ? "merge_requests" : "issues"}/notes/${id}`;
  await call(c, path, { method: "DELETE" });
  return { repo, id, deleted: true };
}

export async function createRepo(c: GitConn, name: string, input: any = {}) {
  const body = c.provider === "github" ? { name, description: input.description, private: input.visibility === "private", auto_init: !!input.autoInit } : { name, path: input.path ?? name, description: input.description, visibility: input.visibility ?? "private", namespace_id: input.namespaceId };
  const r = must(await call(c, c.provider === "github" ? "/user/repos" : "/projects", { method: "POST", body }), name);
  return { repo: r.full_name ?? r.path_with_namespace, url: r.html_url ?? r.web_url };
}
export async function updateRepoSettings(c: GitConn, repo: string, input: any) {
  const gh = c.provider === "github", body = gh ? { ...(input.description !== undefined ? { description: input.description } : {}), ...(input.visibility !== undefined ? { visibility: input.visibility } : {}), ...(input.defaultBranch !== undefined ? { default_branch: input.defaultBranch } : {}), ...(input.features ?? {}) } : { ...(input.description !== undefined ? { description: input.description } : {}), ...(input.visibility !== undefined ? { visibility: input.visibility } : {}), ...(input.defaultBranch !== undefined ? { default_branch: input.defaultBranch } : {}), ...(input.features?.issues === false ? { issues_enabled: false } : {}), ...(input.features?.wiki === false ? { wiki_enabled: false } : {}) };
  const r = must(await call(c, repoRef(c, repo), { method: gh ? "PATCH" : "PUT", body }), repo);
  return { repo: r.full_name ?? r.path_with_namespace ?? repo, visibility: r.visibility ?? (r.private ? "private" : "public"), defaultBranch: r.default_branch ?? null };
}
export async function renameRepo(c: GitConn, repo: string, name: string) {
  const r = must(await call(c, repoRef(c, repo), { method: c.provider === "github" ? "PATCH" : "PUT", body: { name, path: name } }), repo);
  return { repo: r.full_name ?? r.path_with_namespace, name };
}
export async function archiveRepo(c: GitConn, repo: string, archived: boolean) {
  const gh = c.provider === "github";
  if (!gh) { await call(c, `${repoRef(c, repo)}/${archived ? "archive" : "unarchive"}`, { method: "POST" }); return { repo, archived }; }
  await call(c, repoRef(c, repo), { method: "PATCH", body: { archived } }); return { repo, archived };
}
export async function deleteRepo(c: GitConn, repo: string) { await call(c, repoRef(c, repo), { method: "DELETE" }); return { repo, deleted: true }; }
export async function forkRepo(c: GitConn, repo: string, input: any = {}) {
  const r = must(await call(c, `${repoRef(c, repo)}/forks`, { method: "POST", body: c.provider === "github" ? { organization: input.organization, name: input.name } : { namespace: input.namespace, path: input.name } }), repo);
  return { repo: r.full_name ?? r.path_with_namespace, url: r.html_url ?? r.web_url };
}
export async function transferRepo(c: GitConn, repo: string, target: string) {
  const r = must(await call(c, c.provider === "github" ? `${repoRef(c, repo)}/transfer` : `${repoRef(c, repo)}/transfer`, { method: c.provider === "github" ? "POST" : "PUT", body: c.provider === "github" ? { new_owner: target } : { namespace: target } }), repo);
  return { repo: r.full_name ?? r.path_with_namespace ?? repo, target };
}
export async function deleteBranch(c: GitConn, repo: string, branch: string) { const ref = repoRef(c, repo); await call(c, c.provider === "github" ? `${ref}/git/refs/heads/${encodeURIComponent(branch)}` : `${ref}/repository/branches/${encodeURIComponent(branch)}`, { method: "DELETE" }); return { repo, branch, deleted: true }; }
export async function protectBranch(c: GitConn, repo: string, branch: string, input: any) {
  const ref = repoRef(c, repo);
  if (c.provider === "github") await call(c, `${ref}/branches/${encodeURIComponent(branch)}/protection`, { method: "PUT", body: { required_status_checks: input.requiredStatusChecks === false ? null : { strict: !!input.strict, contexts: input.contexts ?? [] }, enforce_admins: !!input.enforceAdmins, required_pull_request_reviews: input.requireReviews === false ? null : { required_approving_review_count: input.approvals ?? 1 }, restrictions: null } });
  else await call(c, `${ref}/protected_branches`, { method: "POST", body: { name: branch, push_access_level: input.pushAccessLevel ?? 0, merge_access_level: input.mergeAccessLevel ?? 40, unprotect_access_level: input.unprotectAccessLevel ?? 40 } });
  return { repo, branch, protected: true };
}
export async function getBranchProtection(c: GitConn, repo: string, branch: string) { const r = await call(c, `${repoRef(c, repo)}/${c.provider === "github" ? `branches/${encodeURIComponent(branch)}/protection` : `protected_branches/${encodeURIComponent(branch)}`}`); return { repo, branch, protected: !!r, protection: r }; }
export async function createTag(c: GitConn, repo: string, tag: string, ref?: string) {
  const base = ref ?? await defaultBranch(c, repo), path = repoRef(c, repo);
  if (c.provider === "github") { const head = must(await call(c, `${path}/git/ref/heads/${encodeURIComponent(base)}`), base); await call(c, `${path}/git/refs`, { method: "POST", body: { ref: `refs/tags/${tag}`, sha: head.object.sha } }); }
  else await call(c, `${path}/repository/tags`, { method: "POST", body: { tag_name: tag, ref: base } });
  return { repo, tag, ref: base };
}
export async function deleteTag(c: GitConn, repo: string, tag: string) { const path = repoRef(c, repo); await call(c, c.provider === "github" ? `${path}/git/refs/tags/${encodeURIComponent(tag)}` : `${path}/repository/tags/${encodeURIComponent(tag)}`, { method: "DELETE" }); return { repo, tag, deleted: true }; }
export async function createRelease(c: GitConn, repo: string, input: any) { const path = repoRef(c, repo), body = c.provider === "github" ? { tag_name: input.tag, name: input.name ?? input.tag, body: input.body, draft: !!input.draft, prerelease: !!input.prerelease } : { tag_name: input.tag, name: input.name ?? input.tag, description: input.body, ref: input.ref }; const r = must(await call(c, `${path}/releases`, { method: "POST", body }), repo); return { repo, tag: input.tag, url: r.html_url ?? r._links?.self ?? r.web_url }; }
export async function deleteRelease(c: GitConn, repo: string, idOrTag: string | number) { const path = repoRef(c, repo), url = c.provider === "github" ? `${path}/releases/${encodeURIComponent(String(idOrTag))}` : `${path}/releases/${encodeURIComponent(String(idOrTag))}`; await call(c, url, { method: "DELETE" }); return { repo, release: idOrTag, deleted: true }; }
export async function deleteFile(c: GitConn, repo: string, path: string, message: string, branch: string) { const p = cleanPath(path); await assertNotDefaultBranch(c, repo, branch); const url = fileUrl(c, repo, p), existing = await call(c, `${url}?ref=${encodeURIComponent(branch)}`); if (!existing?.sha) throw new Error(`${p} not found at ${branch}`); await call(c, url, { method: "DELETE", body: c.provider === "github" ? { message, branch, sha: existing.sha } : { branch, commit_message: message } }); return { repo, path: p, branch, deleted: true }; }
export async function moveFile(c: GitConn, repo: string, from: string, to: string, message: string, branch: string) { const src = cleanPath(from), dst = cleanPath(to); await assertNotDefaultBranch(c, repo, branch); if (c.provider === "github") { const old = await readFile(c, repo, src, branch), content = old.type === "file" ? old.content : undefined; if (typeof content !== "string") throw new Error(`${src} is not a file`); await deleteFile(c, repo, src, message, branch); const existing = await call(c, `${fileUrl(c, repo, dst)}?ref=${encodeURIComponent(branch)}`); await call(c, fileUrl(c, repo, dst), { method: "PUT", body: { message, branch, content: Buffer.from(content).toString("base64"), ...(existing?.sha ? { sha: existing.sha } : {}) } }); } else await call(c, `${repoRef(c, repo)}/repository/files/${encodeURIComponent(src)}`, { method: "PUT", body: { branch, new_path: dst, commit_message: message } }); return { repo, from: src, to: dst, branch }; }
type FileChange = { path: string; content: string; delete?: boolean };
/** Commits several changes to `branch`; never the default branch. */
export async function commitFiles(c: GitConn, repo: string, files: FileChange[], message: string, branch: string) { await assertNotDefaultBranch(c, repo, branch); return commit(c, repo, files, message, branch); }
/** Commits straight to the default branch; only the owner-guarded repoWriteDefaultBranch calls it. */
export async function commitToDefaultBranch(c: GitConn, repo: string, files: FileChange[], message: string) { return commit(c, repo, files, message, await defaultBranch(c, repo)); }
async function commit(c: GitConn, repo: string, files: FileChange[], message: string, ref: string) { if (!files.length) throw new Error("files must not be empty"); const path = repoRef(c, repo); if (c.provider === "github") { const base = await call(c, `${path}/git/ref/heads/${encodeURIComponent(ref)}`), tree = await call(c, `${path}/git/trees`, { method: "POST", body: { base_tree: base.object.sha, tree: files.map((f) => ({ path: cleanPath(f.path), mode: "100644", type: "blob", content: f.delete ? "" : f.content })) } }), created = await call(c, `${path}/git/commits`, { method: "POST", body: { message, tree: tree.sha, parents: [base.object.sha] } }); await call(c, `${path}/git/refs/heads/${encodeURIComponent(ref)}`, { method: "PATCH", body: { sha: created.sha } }); } else await call(c, `${path}/repository/commits`, { method: "POST", body: { branch: ref, commit_message: message, actions: files.map((f) => ({ action: f.delete ? "delete" : "upsert", file_path: cleanPath(f.path), content: f.content })) } }); return { repo, branch: ref, files: files.map((f) => f.path), committed: true }; }

export async function runPipeline(c: GitConn, repo: string, ref?: string) { const path = repoRef(c, repo), r = c.provider === "github" ? await call(c, `${path}/actions/workflows`, {}) : await call(c, `${path}/pipeline`, { method: "POST", body: { ref: ref ?? await defaultBranch(c, repo) } }); if (c.provider === "github") { const wf = r?.workflows?.[0]; if (!wf) throw new Error(`No workflow found in ${repo}`); await call(c, `${path}/actions/workflows/${wf.id}/dispatches`, { method: "POST", body: { ref: ref ?? await defaultBranch(c, repo) } }); return { repo, workflow: wf.name, started: true }; } return { repo, id: r.id, started: true }; }
export async function cancelPipeline(c: GitConn, repo: string, id: number) { const path = repoRef(c, repo); await call(c, `${path}/${c.provider === "github" ? `actions/runs/${id}/cancel` : `pipelines/${id}/cancel`}`, { method: "POST" }); return { repo, id, canceled: true }; }
export async function listArtifacts(c: GitConn, repo: string, page: number) { const path = repoRef(c, repo), r = await call(c, `${path}/${c.provider === "github" ? "actions/artifacts" : "jobs/artifacts"}?${paged(page)}`); const rows: any[] = c.provider === "github" ? (r?.artifacts ?? []) : (r ?? []); return pageOf(rows, rows.map((x) => ({ id: x.id, name: x.name, size: x.size_in_bytes ?? x.file_type ?? null, expired: x.expired ?? false, url: x.archive_download_url ?? x.web_url }))); }
export async function downloadArtifact(c: GitConn, repo: string, id: number) { if (c.provider === "gitlab") throw new Error("GitLab artifact download needs a job id and path; use repoArtifacts to list jobs first"); const text = await call(c, `${repoRef(c, repo)}/actions/artifacts/${id}/zip`, { text: true }); return { repo, id, content: String(text).slice(0, 20000), truncated: String(text).length > 20000 }; }
export async function schedules(c: GitConn, repo: string, input: any = {}) { const path = repoRef(c, repo); if (c.provider === "github") { if (input.action === "list") return call(c, `${path}/actions/workflows`); throw new Error("GitHub scheduled workflows are configured in workflow files"); } if (input.action === "list") return call(c, `${path}/pipeline_schedules?${paged(input.page ?? 1)}`); const body = { description: input.description, ref: input.ref, cron: input.cron, active: input.active }; const r = await call(c, `${path}/pipeline_schedules`, { method: input.action === "delete" ? "DELETE" : input.action === "update" ? "PUT" : "POST", body }); return { repo, schedule: r };
}
export async function variables(c: GitConn, repo: string, input: any) { const path = repoRef(c, repo), gh = c.provider === "github"; if (input.action === "list") { const r = await call(c, `${path}/${gh ? "actions/variables" : "variables"}?${paged(input.page ?? 1)}`); const rows: any[] = gh ? (r?.variables ?? []) : (r ?? []); return { names: rows.map((x) => x.name ?? x.key) }; } const url = `${path}/${gh ? "actions/variables" : "variables"}${input.name ? `/${encodeURIComponent(input.name)}` : ""}`; if (input.action === "delete") { await call(c, url, { method: "DELETE" }); return { name: input.name, deleted: true }; } const r = await call(c, url, { method: input.name ? "PATCH" : "POST", body: gh ? { name: input.name, value: input.value } : { key: input.name, value: input.value } }); return { name: r.name ?? r.key, updated: true }; }
export async function secrets(c: GitConn, repo: string, input: any) { const path = repoRef(c, repo), gh = c.provider === "github"; if (input.action === "list") { if (gh) { const r = await call(c, `${path}/actions/secrets?${paged(input.page ?? 1)}`); return { names: (r?.secrets ?? []).map((x: any) => x.name) }; } const r = await call(c, `${path}/variables?${paged(input.page ?? 1)}`); return { names: (r ?? []).map((x: any) => x.key) }; } if (input.action === "delete") { await call(c, `${path}/${gh ? "actions/secrets" : "variables"}/${encodeURIComponent(input.name)}`, { method: "DELETE" }); return { name: input.name, deleted: true }; } if (gh) throw new Error("GitHub secret writes require public-key encryption and are not enabled by this tool yet"); await call(c, `${path}/variables`, { method: "POST", body: { key: input.name, value: input.value, masked: true, protected: !!input.protected } }); return { name: input.name, set: true };
}
export async function runners(c: GitConn, repo: string, input: any = {}) { const path = repoRef(c, repo), gh = c.provider === "github"; if (input.action === "list") { const r = await call(c, `${path}/${gh ? "actions/runners" : "runners"}`); return gh ? r?.runners ?? [] : r ?? []; } if (gh) throw new Error("GitHub runner registration/removal requires a runner token and is not exposed here"); const r = await call(c, `${path}/runners/${input.id}`, { method: input.action === "delete" ? "DELETE" : "PUT", body: input }); return { runner: r, updated: true }; }
export async function member(c: GitConn, repo: string, input: any) { const path = repoRef(c, repo), gh = c.provider === "github"; const user = encodeURIComponent(input.user); if (input.action === "list") { const r = await call(c, `${path}/${gh ? "collaborators" : "members/all"}?${paged(input.page ?? 1)}`); return r ?? []; } const url = `${path}/${gh ? `collaborators/${user}` : `members/${user}`}`; if (input.action === "remove") { await call(c, url, { method: "DELETE" }); return { user: input.user, removed: true }; } const r = await call(c, url, { method: gh ? "PUT" : "PUT", body: gh ? { permission: input.role ?? "push" } : { access_level: input.role ?? 30 } }); return { user: input.user, role: r?.role ?? input.role, updated: true }; }
export async function invitations(c: GitConn, repo: string, input: any = {}) { const path = repoRef(c, repo); if (c.provider === "gitlab") throw new Error("GitLab invitations are managed through group/project members"); const url = `${path}/invitations`; if (input.action === "list") return call(c, url); await call(c, `${url}/${input.id}`, { method: "DELETE" }); return { id: input.id, canceled: true }; }
export async function deployKeys(c: GitConn, repo: string, input: any = {}) { const path = repoRef(c, repo), url = `${path}/${c.provider === "github" ? "keys" : "deploy_keys"}`; if (input.action === "list") return call(c, url); if (input.action === "delete") { await call(c, `${url}/${input.id}`, { method: "DELETE" }); return { id: input.id, deleted: true }; } const r = await call(c, url, { method: "POST", body: c.provider === "github" ? { title: input.title, key: input.key, read_only: input.readOnly !== false } : { title: input.title, key: input.key, can_push: !!input.canPush } }); return { id: r.id, title: r.title, created: true }; }
export async function webhooks(c: GitConn, repo: string, input: any = {}) { const path = repoRef(c, repo), url = `${path}/hooks`; if (input.action === "list") return call(c, url); if (input.action === "delete") { await call(c, `${url}/${input.id}`, { method: "DELETE" }); return { id: input.id, deleted: true }; } const body = c.provider === "github" ? { name: "web", config: { url: input.url, content_type: "json", secret: input.secret }, events: input.events ?? ["push"], active: input.active !== false } : { url: input.url, token: input.secret, push_events: true, enable_ssl_verification: true }; const r = await call(c, url, { method: "POST", body }); return { id: r.id, url: input.url, created: true }; }
export async function securityAlerts(c: GitConn, repo: string) { const path = repoRef(c, repo); if (c.provider === "github") { const [dep, secret, code] = await Promise.all([call(c, `${path}/dependabot/alerts`), call(c, `${path}/secret-scanning/alerts`), call(c, `${path}/code-scanning/alerts`)]); return { dependabot: dep ?? [], secretScanning: secret ?? [], codeScanning: code ?? [] }; } return { vulnerabilities: await call(c, `${path}/vulnerability_findings`) ?? [], dependencyScanning: await call(c, `${path}/dependency_proxy/manifest`)}; }

export async function orgList(c: GitConn, page = 1) { const rows: any[] = (await call(c, c.provider === "github" ? `/user/orgs?${paged(page)}` : `/groups?${paged(page)}`)) ?? []; return pageOf(rows, rows.map((x) => ({ id: x.id, name: x.login ?? x.full_path ?? x.name, url: x.html_url ?? x.web_url }))); }
export async function orgMembers(c: GitConn, org: string, page = 1) { const rows: any[] = (await call(c, c.provider === "github" ? `/orgs/${encodeURIComponent(org)}/members?${paged(page)}` : `/groups/${encodeURIComponent(org)}/members/all?${paged(page)}`)) ?? []; return pageOf(rows, rows.map((x) => ({ id: x.id, username: x.login ?? x.username, role: x.role ?? x.access_level ?? null }))); }
export async function orgTeams(c: GitConn, org: string, page = 1) { if (c.provider === "gitlab") { const rows: any[] = (await call(c, `/groups/${encodeURIComponent(org)}/subgroups?${paged(page)}`)) ?? []; return pageOf(rows, rows.map((x) => ({ id: x.id, name: x.name, path: x.full_path }))); } const rows: any[] = (await call(c, `/orgs/${encodeURIComponent(org)}/teams?${paged(page)}`)) ?? []; return pageOf(rows, rows.map((x) => ({ id: x.id, name: x.name, slug: x.slug }))); }
export async function createGroup(c: GitConn, input: any) { if (c.provider === "github") throw new Error("GitHub organization creation is not available through this account tool"); const r = await call(c, "/groups", { method: "POST", body: { name: input.name, path: input.path ?? input.name, parent_id: input.parentId, visibility: input.visibility } }); return { id: r.id, name: r.full_path ?? r.name, created: true }; }
export async function manageTeam(c: GitConn, org: string, input: any) { if (c.provider === "gitlab") { const url = `/groups/${encodeURIComponent(org)}/members/${encodeURIComponent(input.user)}`; if (input.action === "remove") { await call(c, url, { method: "DELETE" }); return { user: input.user, removed: true }; } const r = await call(c, url, { method: "PUT", body: { access_level: input.role ?? 30 } }); return { user: input.user, role: r.access_level ?? input.role, updated: true }; } if (input.action === "create") { const r = await call(c, `/orgs/${encodeURIComponent(org)}/teams`, { method: "POST", body: { name: input.name, description: input.description, privacy: input.privacy ?? "closed" } }); return { id: r.id, name: r.name, created: true }; } const url = `/orgs/${encodeURIComponent(org)}/teams/${encodeURIComponent(input.team)}/memberships/${encodeURIComponent(input.user)}`; if (input.action === "remove") { await call(c, url, { method: "DELETE" }); return { user: input.user, removed: true }; } const r = await call(c, url, { method: "PUT", body: { role: input.role ?? "member" } }); return { user: input.user, role: r.role, updated: true }; }
export async function wiki(c: GitConn, repo: string, input: any) { if (c.provider === "github") throw new Error("GitHub wiki has no general REST API endpoint"); const path = `${repoRef(c, repo)}/wikis`; if (input.action === "list") return call(c, `${path}?${paged(input.page ?? 1)}`); if (input.action === "delete") { await call(c, `${path}/${encodeURIComponent(input.slug)}`, { method: "DELETE" }); return { slug: input.slug, deleted: true }; } const r = await call(c, `${path}${input.slug ? `/${encodeURIComponent(input.slug)}` : ""}`, { method: input.slug ? "PUT" : "POST", body: { content: input.content, title: input.title, format: input.format ?? "markdown" } }); return { slug: r.slug, title: r.title, updated: true }; }
export async function snippets(c: GitConn, input: any) { const path = c.provider === "github" ? "/gists" : "/snippets"; if (input.action === "list") return call(c, `${path}?${paged(input.page ?? 1)}`); if (input.action === "delete") { await call(c, `${path}/${input.id}`, { method: "DELETE" }); return { id: input.id, deleted: true }; } const body = c.provider === "github" ? { description: input.description, public: !!input.public, files: input.files } : { title: input.title ?? input.description, description: input.description, visibility: input.public ? "public" : "private", files: input.files }; const r = await call(c, path, { method: "POST", body }); return { id: r.id, url: r.html_url ?? r.web_url, created: true }; }
export async function packages(c: GitConn, repo: string, input: any = {}) { if (c.provider === "gitlab") { const rows: any[] = (await call(c, `${repoRef(c, repo)}/packages?${paged(input.page ?? 1)}`)) ?? []; return input.action === "delete" ? (await call(c, `${repoRef(c, repo)}/packages/${input.id}`, { method: "DELETE" }), { id: input.id, deleted: true }) : rows; } const owner = repo.split("/")[0]; const rows: any[] = (await call(c, `/users/${encodeURIComponent(owner)}/packages?package_type=${encodeURIComponent(input.type ?? "container")}`)) ?? []; if (input.action === "delete") { await call(c, `/users/${encodeURIComponent(owner)}/packages/${encodeURIComponent(input.type)}/${encodeURIComponent(input.name)}/versions/${input.versionId}`, { method: "DELETE" }); return { name: input.name, versionId: input.versionId, deleted: true }; } return rows; }
export async function notifications(c: GitConn, page = 1) { return c.provider === "github" ? call(c, `/notifications?${paged(page)}`) : call(c, `/todos?${paged(page)}`); }
export async function stats(c: GitConn, repo: string, input: any = {}) { const path = repoRef(c, repo); if (input.kind === "languages") return call(c, `${path}/languages`); if (input.kind === "traffic") { if (c.provider === "gitlab") throw new Error("GitLab traffic stats are not exposed by this API"); return { views: await call(c, `${path}/traffic/views`), clones: await call(c, `${path}/traffic/clones`) }; } return call(c, `${path}/${c.provider === "github" ? "stats/contributors" : "repository/contributors"}`); }

// Read-only browsing for the console. One page per call; hasMore is true when the provider may have another page.
const PER_PAGE = 30;
export const paged = (p: number) => `per_page=${PER_PAGE}&page=${Math.floor(p) > 0 ? Math.floor(p) : 1}`;
export const pageOf = (raw: any[], items: unknown[]): { items: unknown[]; hasMore: boolean; contributorsOnly?: boolean } => ({ items, hasMore: raw.length === PER_PAGE });
export type GitState = "open" | "closed" | "all";
const stateParam = (c: GitConn, s: GitState) => (c.provider === "gitlab" && s === "open" ? "opened" : s);
const normState = (s: string) => (s === "opened" ? "open" : s);
const names = (labels: any[] = []) => labels.map((l) => (typeof l === "string" ? l : l.name));
const GITLAB_ROLES: Record<number, string> = { 10: "guest", 20: "reporter", 30: "developer", 40: "maintainer", 50: "owner" };

export async function browseRepos(c: GitConn, page: number, query?: string) {
  const gh = c.provider === "github", q = query?.trim();
  let rows: any[];
  if (!q) rows = (await call(c, gh ? `/user/repos?${paged(page)}&sort=updated` : `/projects?membership=true&${paged(page)}&order_by=last_activity_at`)) ?? [];
  else if (gh) {
    // ponytail: GitHub search has no "my repos" scope, so this covers the account's own repos only, not org repos; add `org:` terms if needed.
    const login = await fetchGitUsername(c.provider, c.baseUrl, c.token, c.oauth);
    rows = (await call(c, `/search/repositories?${paged(page)}&q=${encodeURIComponent(`${q} in:name,description user:${login}`)}`))?.items ?? [];
  } else rows = (await call(c, `/projects?membership=true&${paged(page)}&order_by=last_activity_at&search=${encodeURIComponent(q)}`)) ?? [];
  return pageOf(rows, rows.map((r) => ({
    repo: r.full_name ?? r.path_with_namespace, owner: gh ? r.owner.login : r.namespace.full_path,
    private: gh ? r.private : r.visibility !== "public", archived: !!r.archived, fork: gh ? !!r.fork : !!r.forked_from_project,
    description: r.description ?? null, updatedAt: r.updated_at ?? r.last_activity_at ?? null, url: r.html_url ?? r.web_url, defaultBranch: r.default_branch ?? null,
  })));
}
export async function browseMembers(c: GitConn, repo: string, page: number) {
  const ref = repoRef(c, repo);
  if (c.provider === "gitlab") {
    const rows: any[] = (await call(c, `${ref}/members/all?${paged(page)}`)) ?? [];
    return pageOf(rows, rows.map((m) => ({ username: m.username, name: m.name, role: GITLAB_ROLES[m.access_level] ?? String(m.access_level), avatarUrl: m.avatar_url, url: m.web_url })));
  }
  // Listing collaborators needs push access; fall back to contributors for read-only tokens.
  const first: any[] | null = await call(c, `${ref}/collaborators?${paged(page)}`).catch(() => null);
  const collaborators = first !== null;
  const rows: any[] = first ?? (await call(c, `${ref}/contributors?${paged(page)}`)) ?? [];
  return { ...pageOf(rows, rows.map((m) => ({ username: m.login, name: null, role: collaborators ? m.role_name ?? "collaborator" : "contributor", avatarUrl: m.avatar_url, url: m.html_url }))), ...(collaborators ? {} : { contributorsOnly: true }) };
}
/** `labels` keeps issues that carry every one of them; both providers take the names comma-separated. */
export async function browseIssues(c: GitConn, repo: string, page: number, state: GitState, labels: string[] = []) {
  const ref = repoRef(c, repo), gh = c.provider === "github";
  const filter = labels.length ? `&labels=${encodeURIComponent(labels.join(","))}` : "";
  const rows: any[] = (await call(c, `${ref}/issues?state=${stateParam(c, state)}&${paged(page)}${filter}`)) ?? [];
  // GitHub returns pull requests from the issues endpoint too.
  return pageOf(rows, rows.filter((r) => !r.pull_request).map((r) => ({
    number: r.number ?? r.iid, title: r.title, state: normState(r.state), author: (gh ? r.user : r.author)?.[gh ? "login" : "username"] ?? null,
    labels: names(r.labels), url: r.html_url ?? r.web_url, createdAt: r.created_at,
  })));
}
export async function browseMergeRequests(c: GitConn, repo: string, page: number, state: GitState) {
  const ref = repoRef(c, repo), gh = c.provider === "github";
  const rows: any[] = (await call(c, `${ref}/${gh ? "pulls" : "merge_requests"}?state=${stateParam(c, state)}&${paged(page)}`)) ?? [];
  return pageOf(rows, rows.map((r) => ({
    number: r.number ?? r.iid, title: r.title, state: normState(r.state), draft: !!(r.draft ?? r.work_in_progress), merged: gh ? !!r.merged_at : r.state === "merged",
    author: (gh ? r.user : r.author)?.[gh ? "login" : "username"] ?? null, source: gh ? r.head?.ref : r.source_branch, target: gh ? r.base?.ref : r.target_branch,
    labels: names(r.labels), url: r.html_url ?? r.web_url, createdAt: r.created_at,
  })));
}
export async function browseBranches(c: GitConn, repo: string, page: number) {
  const ref = repoRef(c, repo), gh = c.provider === "github";
  const base = gh ? await defaultBranch(c, repo) : null;
  const rows: any[] = (await call(c, `${ref}/${gh ? "branches" : "repository/branches"}?${paged(page)}`)) ?? [];
  return pageOf(rows, rows.map((b) => ({ name: b.name, protected: !!b.protected, default: gh ? b.name === base : !!b.default })));
}

export async function browseCommits(c: GitConn, repo: string, page: number, branch?: string) {
  const ref = repoRef(c, repo), gh = c.provider === "github";
  const sha = branch ? `&${gh ? "sha" : "ref_name"}=${encodeURIComponent(branch)}` : "";
  const rows: any[] = (await call(c, `${ref}/${gh ? "commits" : "repository/commits"}?${paged(page)}${sha}`)) ?? [];
  return pageOf(rows, rows.map((r) => ({
    sha: (r.sha ?? r.id).slice(0, 10), message: String(gh ? r.commit.message : r.title).split("\n")[0],
    author: gh ? r.commit.author?.name ?? null : r.author_name ?? null, date: gh ? r.commit.author?.date ?? null : r.created_at ?? null, url: r.html_url ?? r.web_url,
  })));
}
/** One pull/merge request with its description and changed files (names and status only, no patches). */
export async function getMergeRequest(c: GitConn, repo: string, number: number) {
  if (!Number.isInteger(number) || number < 1) throw new Error("number must be a positive integer");
  const ref = repoRef(c, repo), gh = c.provider === "github";
  const path = `${ref}/${gh ? "pulls" : "merge_requests"}/${number}`;
  const r = await call(c, path);
  if (!r) throw new Error(`#${number} not found in ${repo}`);
  const files: any[] = gh ? (await call(c, `${path}/files?per_page=50`)) ?? [] : (await call(c, `${path}/changes`))?.changes ?? [];
  return {
    number, title: r.title, state: normState(r.state), draft: !!(r.draft ?? r.work_in_progress), merged: gh ? !!r.merged_at : r.state === "merged",
    author: (gh ? r.user : r.author)?.[gh ? "login" : "username"] ?? null, source: gh ? r.head?.ref : r.source_branch, target: gh ? r.base?.ref : r.target_branch,
    description: String(r.body ?? r.description ?? "").slice(0, 4000), labels: names(r.labels), url: r.html_url ?? r.web_url,
    files: files.slice(0, 50).map((f) => gh ? { path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions } : { path: f.new_path, status: f.new_file ? "added" : f.deleted_file ? "removed" : f.renamed_file ? "renamed" : "modified" }),
    filesTruncated: files.length > 50 || (gh && files.length === 50),
  };
}

// CI/CD, tags, releases, search and compare. GitHub "workflow runs" are shown as pipelines.
const pid = (n: number) => { if (!Number.isInteger(n) || n < 1) throw new Error("id must be a positive integer"); return n; };
const refQ = (gh: boolean, ref?: string) => (ref ? `&${gh ? "branch" : "ref"}=${encodeURIComponent(ref)}` : "");

export async function browsePipelines(c: GitConn, repo: string, page: number, branch?: string) {
  const ref = repoRef(c, repo), gh = c.provider === "github";
  const res = await call(c, `${ref}/${gh ? "actions/runs" : "pipelines"}?${paged(page)}${refQ(gh, branch)}`);
  const rows: any[] = (gh ? res?.workflow_runs : res) ?? [];
  return pageOf(rows, rows.map((r) => ({
    id: r.id, name: gh ? r.name : null, status: gh ? r.conclusion ?? r.status : r.status, branch: gh ? r.head_branch : r.ref,
    sha: String(gh ? r.head_sha : r.sha).slice(0, 10), url: r.html_url ?? r.web_url, createdAt: r.created_at,
  })));
}
export async function pipelineJobs(c: GitConn, repo: string, id: number) {
  const ref = repoRef(c, repo), gh = c.provider === "github";
  const res = await call(c, `${ref}/${gh ? `actions/runs/${pid(id)}/jobs` : `pipelines/${pid(id)}/jobs`}?per_page=100`);
  if (!res) throw new Error(`Pipeline ${id} not found in ${repo}`);
  return ((gh ? res.jobs : res) as any[]).map((j) => ({
    id: j.id, name: j.name, stage: gh ? null : j.stage, status: gh ? j.conclusion ?? j.status : j.status, url: j.html_url ?? j.web_url,
    startedAt: j.started_at ?? null, finishedAt: j.completed_at ?? j.finished_at ?? null,
  }));
}
/** The tail of a job log: failures are at the end. */
export async function jobLog(c: GitConn, repo: string, jobId: number) {
  const gh = c.provider === "github";
  const t = await call(c, `${repoRef(c, repo)}/${gh ? "actions/jobs" : "jobs"}/${pid(jobId)}/${gh ? "logs" : "trace"}`, { text: true });
  if (t === null) throw new Error(`Job ${jobId} not found in ${repo}`);
  // ponytail: last 8000 chars only, ANSI codes stripped; add paging if longer logs matter.
  const clean = String(t).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
  return { jobId, log: clean.slice(-8000), truncated: clean.length > 8000 };
}
export async function retryPipeline(c: GitConn, repo: string, id: number) {
  const gh = c.provider === "github", ref = repoRef(c, repo);
  must(await call(c, `${ref}/${gh ? `actions/runs/${pid(id)}/rerun-failed-jobs` : `pipelines/${pid(id)}/retry`}`, { method: "POST" }), `Pipeline ${id} in ${repo}`);
  return { repo, id, retried: true };
}
export async function createBranch(c: GitConn, repo: string, branch: string, from?: string) {
  const gh = c.provider === "github", ref = repoRef(c, repo), base = from ?? await defaultBranch(c, repo);
  if (!/^[\w.\/-]+$/.test(branch) || branch.includes("..")) throw new Error("Invalid branch name");
  if (gh) {
    const head = must(await call(c, `${ref}/git/ref/heads/${encodeURIComponent(base)}`), `branch ${base}`);
    await call(c, `${ref}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: head.object.sha } });
  } else await call(c, `${ref}/repository/branches?branch=${encodeURIComponent(branch)}&ref=${encodeURIComponent(base)}`, { method: "POST" });
  return { repo, branch, from: base };
}
export async function browseTags(c: GitConn, repo: string, page: number) {
  const gh = c.provider === "github";
  const rows: any[] = (await call(c, `${repoRef(c, repo)}/${gh ? "tags" : "repository/tags"}?${paged(page)}`)) ?? [];
  return pageOf(rows, rows.map((t) => ({ name: t.name, sha: String(gh ? t.commit.sha : t.commit?.id).slice(0, 10) })));
}
export async function browseReleases(c: GitConn, repo: string, page: number) {
  const gh = c.provider === "github";
  const rows: any[] = (await call(c, `${repoRef(c, repo)}/releases?${paged(page)}`)) ?? [];
  return pageOf(rows, rows.map((r) => ({
    tag: r.tag_name, name: r.name ?? r.tag_name, prerelease: !!(r.prerelease ?? r.upcoming_release), notes: String(r.body ?? r.description ?? "").slice(0, 1000),
    publishedAt: gh ? r.published_at : r.released_at, url: r.html_url ?? r._links?.self ?? null,
  })));
}
export async function getCommit(c: GitConn, repo: string, sha: string) {
  if (!/^[\w.\/-]{4,100}$/.test(sha)) throw new Error("Invalid commit ref");
  const gh = c.provider === "github", ref = repoRef(c, repo), id = encodeURIComponent(sha);
  const r = must(await call(c, `${ref}/${gh ? "commits" : "repository/commits"}/${id}`), `commit ${sha}`);
  const files: any[] = gh ? r.files ?? [] : (await call(c, `${ref}/repository/commits/${id}/diff`)) ?? [];
  return {
    sha: r.sha ?? r.id, message: String(gh ? r.commit.message : r.message).slice(0, 2000), author: gh ? r.commit.author?.name ?? null : r.author_name ?? null,
    date: gh ? r.commit.author?.date ?? null : r.created_at ?? null, url: r.html_url ?? r.web_url,
    files: files.slice(0, 50).map((f) => gh ? { path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions } : { path: f.new_path, status: f.new_file ? "added" : f.deleted_file ? "removed" : f.renamed_file ? "renamed" : "modified" }),
    filesTruncated: files.length > 50,
  };
}
export async function compareRefs(c: GitConn, repo: string, from: string, to: string) {
  const gh = c.provider === "github", ref = repoRef(c, repo), [a, b] = [from, to].map(encodeURIComponent);
  const r = must(await call(c, gh ? `${ref}/compare/${a}...${b}` : `${ref}/repository/compare?from=${a}&to=${b}`), `${from}...${to}`);
  const commits: any[] = r.commits ?? [], files: any[] = gh ? r.files ?? [] : (r.diffs ?? []);
  return {
    ahead: gh ? r.ahead_by : commits.length, behind: gh ? r.behind_by : null,
    commits: commits.slice(0, 30).map((m) => ({ sha: (m.sha ?? m.id).slice(0, 10), message: String(gh ? m.commit.message : m.title).split("\n")[0] })),
    files: files.slice(0, 50).map((f) => gh ? { path: f.filename, status: f.status } : { path: f.new_path, status: f.new_file ? "added" : f.deleted_file ? "removed" : "modified" }),
  };
}
export async function getIssue(c: GitConn, repo: string, number: number) {
  const gh = c.provider === "github", path = itemPath(c, repo, number, "issue");
  const r = must(await call(c, path), `#${number} in ${repo}`);
  return {
    number, title: r.title, state: normState(r.state), author: (gh ? r.user : r.author)?.[gh ? "login" : "username"] ?? null,
    description: String(r.body ?? r.description ?? "").slice(0, 4000), labels: names(r.labels), assignees: (r.assignees ?? []).map((u: any) => u.login ?? u.username), url: r.html_url ?? r.web_url,
  };
}
export async function itemComments(c: GitConn, repo: string, number: number, kind: ItemKind, page: number) {
  const gh = c.provider === "github";
  const rows: any[] = (await call(c, `${itemPath(c, repo, number, kind)}/${gh ? "comments" : "notes"}?${paged(page)}${gh ? "" : "&sort=asc"}`)) ?? [];
  return pageOf(rows, rows.filter((n) => gh || !n.system).map((n) => ({ id: n.id, author: (gh ? n.user : n.author)?.[gh ? "login" : "username"] ?? null, body: String(n.body).slice(0, 2000), createdAt: n.created_at })));
}
export async function searchCode(c: GitConn, repo: string, query: string, page: number) {
  const gh = c.provider === "github", ref = repoRef(c, repo);
  if (gh) {
    const res = await call(c, `/search/code?${paged(page)}&q=${encodeURIComponent(`${query} repo:${repo}`)}`);
    return pageOf(res?.items ?? [], (res?.items ?? []).map((i: any) => ({ path: i.path, url: i.html_url })));
  }
  const rows: any[] = (await call(c, `${ref}/search?scope=blobs&${paged(page)}&search=${encodeURIComponent(query)}`)) ?? [];
  return pageOf(rows, rows.map((i) => ({ path: i.path, line: i.startline, snippet: clipText(i.data) })));
}
const clipText = (t: string) => String(t ?? "").slice(0, 300);
/** Open issues whose title or description match `query`. */
export async function searchIssues(c: GitConn, repo: string, query: string, page: number) {
  const gh = c.provider === "github";
  const rows: any[] = gh
    ? (await call(c, `/search/issues?${paged(page)}&q=${encodeURIComponent(`${query} repo:${repo} is:issue is:open`)}`))?.items ?? []
    : (await call(c, `${repoRef(c, repo)}/issues?state=opened&${paged(page)}&search=${encodeURIComponent(query)}`)) ?? [];
  return pageOf(rows, rows.map((r) => ({ number: r.number ?? r.iid, title: r.title, state: normState(r.state), url: r.html_url ?? r.web_url })));
}
/** One issue, pull/merge request or commit that may answer "is it done?". A pull request's state is merged, open or closed; a commit's is committed. */
export interface WorkHit { repo: string; kind: "issue" | "pull_request" | "commit"; number?: number; sha?: string; title: string; state: string; date: string | null; url: string }
const RECENT_COMMITS = 100;
/**
 * Issues and pull/merge requests of every state that the provider's search matches to one of `queries`, plus those of the
 * latest 100 commits on the default branch whose message holds every term of one of them (`holdsQuery`). Newest first.
 */
export async function searchWork(c: GitConn, repo: string, queries: string[]): Promise<WorkHit[]> {
  const gh = c.provider === "github", ref = repoRef(c, repo), hits = new Map<string, WorkHit>();
  const add = (h: WorkHit) => { if (!hits.has(h.url)) hits.set(h.url, h); };
  for (const q of queries) {
    if (gh) {
      const rows: any[] = (await call(c, `/search/issues?per_page=20&q=${encodeURIComponent(`${q} repo:${repo}`)}`))?.items ?? [];
      for (const r of rows) {
        const mergedAt = r.pull_request?.merged_at ?? null;
        add({ repo, kind: r.pull_request ? "pull_request" : "issue", number: r.number, title: r.title, state: mergedAt ? "merged" : r.state, date: mergedAt ?? r.closed_at ?? r.updated_at ?? null, url: r.html_url });
      }
    } else {
      const search = `state=all&per_page=20&search=${encodeURIComponent(q)}`;
      for (const r of ((await call(c, `${ref}/merge_requests?${search}`)) ?? []) as any[])
        add({ repo, kind: "pull_request", number: r.iid, title: r.title, state: normState(r.state), date: r.merged_at ?? r.closed_at ?? r.updated_at ?? null, url: r.web_url });
      for (const r of ((await call(c, `${ref}/issues?${search}`)) ?? []) as any[])
        add({ repo, kind: "issue", number: r.iid, title: r.title, state: normState(r.state), date: r.closed_at ?? r.updated_at ?? null, url: r.web_url });
    }
  }
  const wanted = queriesTerms(queries);
  const commits: any[] = (await call(c, `${ref}/${gh ? "commits" : "repository/commits"}?per_page=${RECENT_COMMITS}`)) ?? [];
  for (const r of commits) {
    const message = String((gh ? r.commit?.message : r.message ?? r.title) ?? "");
    if (!holdsQuery(wanted, message)) continue;
    add({ repo, kind: "commit", sha: String(r.sha ?? r.id).slice(0, 10), title: message.split("\n")[0]!, state: "committed", date: (gh ? r.commit?.author?.date : r.created_at) ?? null, url: r.html_url ?? r.web_url });
  }
  return [...hits.values()].sort((a, b) => (Date.parse(b.date ?? "") || 0) - (Date.parse(a.date ?? "") || 0));
}
/** A link to `path` as it was at commit `sha`, so it keeps showing what was read. */
export function blobUrl(c: GitConn, repo: string, sha: string, path: string) {
  const host = c.baseUrl?.replace(/\/+$/, "") ?? (c.provider === "github" ? "https://github.com" : "https://gitlab.com");
  return `${host}/${repo}/${c.provider === "github" ? "blob" : "-/blob"}/${sha}/${cleanPath(path).split("/").map(encodeURIComponent).join("/")}`;
}

/** A file of a repository's tree: its path, its blob sha, and its size in bytes when the provider gives it (GitHub does, GitLab does not). */
export type TreeFile = { path: string; sha: string; size?: number };
/** GitLab lists a tree 100 entries a page; a tree longer than this many pages is cut. */
export const MAX_TREE_PAGES = 30;
/** The default branch of `repo` and the commit at its head. */
export async function headCommit(c: GitConn, repo: string): Promise<{ branch: string; commit: string }> {
  const gh = c.provider === "github", branch = await defaultBranch(c, repo);
  const r = must(await call(c, `${repoRef(c, repo)}/${gh ? "branches" : "repository/branches"}/${encodeURIComponent(branch)}`), `branch ${branch}`);
  return { branch, commit: gh ? r.commit.sha : r.commit.id };
}
/** Every file of the tree at `ref` (a commit sha or branch), folders and submodules left out; `truncated` when the listing was cut (by GitHub, or at MAX_TREE_PAGES on GitLab). */
export async function repoTree(c: GitConn, repo: string, ref: string): Promise<{ files: TreeFile[]; truncated: boolean }> {
  const path = repoRef(c, repo);
  if (c.provider === "github") {
    const r = must(await call(c, `${path}/git/trees/${encodeURIComponent(ref)}?recursive=1`), `tree ${ref}`);
    return { files: (r.tree as any[]).filter((e) => e.type === "blob").map((e) => ({ path: e.path, sha: e.sha, size: e.size })), truncated: !!r.truncated };
  }
  const files: TreeFile[] = [];
  for (let page = 1; page <= MAX_TREE_PAGES; page++) {
    const rows: any[] = (await call(c, `${path}/repository/tree?ref=${encodeURIComponent(ref)}&recursive=true&per_page=100&page=${page}`)) ?? [];
    files.push(...rows.filter((e) => e.type === "blob").map((e) => ({ path: e.path, sha: e.id })));
    if (rows.length < 100) return { files, truncated: false };
  }
  return { files, truncated: true };
}
/** The bytes of the blob `sha` of `repo`. */
export async function readBlob(c: GitConn, repo: string, sha: string): Promise<Uint8Array> {
  if (!/^[0-9a-f]{1,64}$/i.test(sha)) throw new Error("Invalid blob sha");
  const r = must(await call(c, `${repoRef(c, repo)}/${c.provider === "github" ? "git/blobs" : "repository/blobs"}/${sha}`), `blob ${sha}`);
  return new Uint8Array(Buffer.from(String(r.content ?? ""), r.encoding === "base64" ? "base64" : "utf8"));
}
