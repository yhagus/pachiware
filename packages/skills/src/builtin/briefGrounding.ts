import type { SkillContext, ToolDefinition } from "../types.js";
import { readBinding, writeBinding, parseFrontmatter, type BindingPlace, type PlaybookBinding } from "../playbooks.js";
import { placeOf, briefState } from "../brief.js";
import { WorkspaceConflict, workspaceStore } from "../workspace/store.js";
import { loadGitAccess, connectionOf, repoAllowed } from "../gitScope.js";
import { defaultBranch, getCommit, readFile, listLabels, listRepos, searchIssues, searchCode, getIssue, blobUrl } from "../git.js";
import { groundingOf, readsLeft, briefReadsLeft, missingStep, READ_BUDGET, MAX_BRIEF_REPOS, type BriefGrounding, type GroundingRead, type ReadStep } from "../grounding.js";
import { acct, useRepo, str, num } from "./gitShared.js";

/** Grounding a brief in its repositories (#42). Every read goes through the git functions, so an offline provider serves them too. */
async function authorsThread(ctx: SkillContext) {
  const place = placeOf(ctx);
  const found = place && await readBinding(ctx.tenantId, place);
  if (!place || !found || found.binding.status !== "active") throw new Error("This thread does not follow a playbook, so there is no brief to read for.");
  if (ctx.userId !== found.binding.authorId) throw new Error("Only the brief's author's turns read repositories for it. Answer this person without reading.");
  return { place, found };
}

/** Read-modify-write of the binding's `grounding`, retried once when another write landed in between. */
async function saveGrounding(tenantId: string, place: BindingPlace, change: (g: BriefGrounding) => BriefGrounding) {
  for (let attempt = 0; ; attempt++) {
    const found = await readBinding(tenantId, place);
    if (!found) return;
    try { await writeBinding(tenantId, { ...found.binding, grounding: change(groundingOf(found.binding)) }, found.body, found.version); return; }
    catch (e) { if (!(e instanceof WorkspaceConflict) || attempt) throw e; }
  }
}

/** Repositories earlier briefs in this channel drafted for, counted once per brief. */
async function earlierBriefRepos(tenantId: string, place: BindingPlace) {
  const dir = `guilds/${place.guildId}/channels/${place.channelId}/threads`, counts = new Map<string, number>();
  const files = (await workspaceStore().list(tenantId, dir).catch(() => [])).filter((e) => e.type === "file" && e.path.endsWith(".md") && !e.path.endsWith(`/${place.threadId}.md`)).slice(-100);
  for (const file of files) {
    const text = (await workspaceStore().read(tenantId, file.path).catch(() => null))?.content;
    const drafts = text && parseFrontmatter(text)?.fields.drafts;
    if (!Array.isArray(drafts)) continue;
    for (const repo of new Set(drafts.map((d: any) => d?.repo).filter((r): r is string => typeof r === "string"))) counts.set(repo, (counts.get(repo) ?? 0) + 1);
  }
  return counts;
}

const mentions = (text: string, repo: string) => {
  const lower = text.toLowerCase(), name = repo.toLowerCase().split("/").pop()!;
  return lower.includes(repo.toLowerCase()) || (name.length >= 3 && new RegExp(`(?<![\\p{L}\\p{N}_-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_-])`, "u").test(lower));
};

export async function briefRepositories(_a: Record<string, unknown>, ctx: SkillContext) {
  const { place, found } = await authorsThread(ctx);
  const open = new Map<string, string>();
  for (const access of await loadGitAccess(ctx)) {
    // Patterns without a wildcard name the repositories outright; otherwise the account's list is filtered by them.
    const literal = access.sets[0]!.every((p) => !p.includes("*"));
    const repos = literal ? access.sets[0]! : (await listRepos(await connectionOf(access))).map((r) => r.repo);
    for (const repo of repos) if (repoAllowed(access, repo) && !open.has(repo)) open.set(repo, access.account.name);
  }
  const earlier = await earlierBriefRepos(ctx.tenantId, place);
  const ranked = [...open].map(([repo, account]) => ({ repo, account, earlierBriefs: earlier.get(repo) ?? 0, mentioned: mentions(found.body, repo) }))
    .sort((a, b) => Number(b.mentioned) - Number(a.mentioned) || b.earlierBriefs - a.earlierBriefs || a.repo.localeCompare(b.repo));
  const single = ranked.length === 1 ? ranked[0]!.repo : undefined;
  await saveGrounding(ctx.tenantId, place, (g) => ({ ...g, candidates: ranked.map(({ repo, account }) => ({ repo, account })), ...(single ? { single } : {}) }));
  const note = !ranked.length ? "No repository is open in this channel. Write the drafts without repository context."
    : single ? `Only ${single} is open here, so every draft targets it. Do not ask which repository.`
    : `Ask in round 1 which repository the brief belongs to, recommending ${ranked[0]!.repo} (ranked by the brief's text, then by earlier briefs in this channel). Points may target different repositories.`;
  return { repositories: ranked, ...(ranked.length ? { recommended: ranked[0]!.repo } : {}), ...(single ? { single } : {}), note };
}

const clipped = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n[cut at ${max} characters]` : text);
const DOCS = [{ path: "README.md", key: "readme", max: 3000 }, { path: "GLOSSARY.md", key: "glossary", max: 3000 }, { path: "CONTRIBUTING.md", key: "contributing", max: 1200 }];
const STEPS = ["repository", "duplicates", "issue", "code", "files"] as const;
const spentNote = (point: number, briefSpent: boolean) => briefSpent
  ? `The brief's reading budget (${READ_BUDGET.brief} reads) is spent. Draft with what you have, and list what you could not check under Open questions.`
  : `Point ${point}'s reading budget (${READ_BUDGET.point} reads) is spent. Draft it with what you have, and list what you could not check under its Open questions.`;

export async function briefRead(a: Record<string, unknown>, ctx: SkillContext) {
  const { place, found } = await authorsThread(ctx);
  const step = a.step as (typeof STEPS)[number], repo = str(a.repo, "repo");
  if (!STEPS.includes(step)) throw new Error(`step is one of ${STEPS.join(", ")}.`);
  const g = groundingOf(found.binding);

  if (step === "repository") {
    const known = g.repos[repo];
    if (known) return { repo, alreadyRead: true, branch: known.branch, commit: known.sha, labels: known.labels, docs: known.docs.map((d) => d.path) };
    if (Object.keys(g.repos).length >= MAX_BRIEF_REPOS) throw new Error(`A brief reads at most ${MAX_BRIEF_REPOS} repositories: ${Object.keys(g.repos).join(", ")}.`);
    const { conn, access } = await useRepo({ repo, account: a.account ?? g.candidates.find((c) => c.repo === repo)?.account }, ctx);
    const branch = await defaultBranch(conn, repo), sha = (await getCommit(conn, repo, branch)).sha as string;
    const text: Record<string, string> = {}, docs: { path: string; url: string }[] = [];
    for (const doc of DOCS) {
      const file: any = await readFile(conn, repo, doc.path, sha).catch(() => null);
      if (file?.type === "file") { text[doc.key] = clipped(file.content, doc.max); docs.push({ path: doc.path, url: blobUrl(conn, repo, sha, doc.path) }); }
    }
    const adr: any = await readFile(conn, repo, "docs/adr", sha).catch(() => null);
    const labels: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await listLabels(conn, repo, page);
      labels.push(...(res.items as { name: string }[]).map((l) => l.name));
      if (!res.hasMore) break;
    }
    await saveGrounding(ctx.tenantId, place, (now) => ({ ...now, repos: { ...now.repos, [repo]: { account: access.account.name, branch, sha, labels, docs } } }));
    return { repo, branch, commit: sha, labels, ...(adr?.type === "dir" ? { adrs: adr.entries.map((e: any) => e.name).slice(0, 40) } : {}), ...text };
  }

  const grounded = g.repos[repo];
  if (!grounded) throw new Error(`Read the repository first: briefRead with step "repository" and repo ${repo}.`);
  const points = briefState(found.binding).points.length || 30, point = a.point as number;
  if (!Number.isInteger(point) || point < 1 || point > points) throw new Error(`point must be a number from 1 to ${points}.`);
  const before = missingStep(g, repo, point, step);
  if (before) throw new Error(`Reads for a point go in order: duplicate search, then code search, then files. Run step "${before}" for point ${point} in ${repo} first.`);
  const left = readsLeft(g, point);
  if (!left) {
    const briefSpent = !briefReadsLeft(g);
    if (briefSpent && !g.spent) await saveGrounding(ctx.tenantId, place, (now) => ({ ...now, spent: true }));
    throw new Error(spentNote(point, briefSpent));
  }

  const { conn } = await useRepo({ repo, account: grounded.account }, ctx);
  const reads: GroundingRead[] = [];
  const record = (r: Omit<GroundingRead, "repo" | "point" | "step">) => reads.push({ repo, point, step: step as ReadStep, ...r });
  let result: Record<string, unknown>;
  if (step === "duplicates" || step === "code") {
    const query = str(a.query, "query");
    const res = step === "duplicates" ? await searchIssues(conn, repo, query, 1) : await searchCode(conn, repo, query, 1);
    record({ target: query });
    result = { [step === "duplicates" ? "issues" : "matches"]: res.items.slice(0, 10) };
  } else if (step === "issue") {
    const n = num(a.number), issue = await getIssue(conn, repo, n);
    record({ target: `#${n}`, title: issue.title, url: issue.url });
    result = { issue: { ...issue, description: clipped(issue.description, 1500) } };
  } else {
    const paths = Array.isArray(a.paths) ? [...new Set(a.paths.filter((p): p is string => typeof p === "string" && !!p.trim()).map((p) => p.trim()))] : [];
    if (!paths.length) throw new Error("paths must list the files to read.");
    const now = paths.slice(0, left), share = Math.floor(8000 / now.length), files: unknown[] = [];
    for (const path of now) {
      const file: any = await readFile(conn, repo, path, grounded.sha).catch((e: Error) => ({ error: e.message }));
      if (file.type === "file") { record({ target: path, url: blobUrl(conn, repo, grounded.sha, path) }); files.push({ path, content: clipped(file.content, share) }); }
      else { record({ target: path }); files.push(file.type === "dir" ? { path, entries: file.entries } : { path, error: file.error }); }
    }
    const briefSpent = now.length < paths.length && now.length === briefReadsLeft(g);
    result = { files, ...(now.length < paths.length ? { notRead: paths.slice(now.length), note: spentNote(point, briefSpent), ...(briefSpent ? { spent: true } : {}) } : {}) };
  }
  await saveGrounding(ctx.tenantId, place, (now) => ({ ...now, reads: [...now.reads, ...reads], ...(result.spent ? { spent: true } : {}) }));
  delete result.spent;
  const after = { ...g, reads: [...g.reads, ...reads] };
  return { repo, point, commit: grounded.sha, ...result, readsLeft: { point: readsLeft(after, point), brief: briefReadsLeft(after) } };
}

export const briefGroundingTools: ToolDefinition[] = [
  { name: "briefRepositories", description: "In a thread that follows the issue-draft playbook: lists the repositories open to this brief, ranked by the brief's text and then by the repositories earlier briefs in this channel went to. Call it before round 1.",
    parameters: { type: "object", properties: {} } },
  { name: "briefRead", description: `In a thread that follows the issue-draft playbook: the only way to read a repository for a brief. First step "repository" once per repository (README, glossary, ADR list, CONTRIBUTING, labels, pinned to the default branch's HEAD commit). Then, per point and in this order: "duplicates" (search open issues), "issue" (open a likely duplicate), "code" (search the code), "files" (read the few most relevant files). A point gets ${READ_BUDGET.point} reads and the brief ${READ_BUDGET.brief}; each file counts as one read.`,
    parameters: { type: "object", properties: {
      step: { type: "string", enum: [...STEPS] },
      repo: { type: "string", description: "owner/name, one of briefRepositories" },
      account: acct,
      point: { type: "integer", description: "The point the read is for (1-based); every step except repository" },
      query: { type: "string", description: "Key terms of the point, for duplicates and code" },
      number: { type: "integer", description: "Issue number, for issue" },
      paths: { type: "array", items: { type: "string" }, description: "Files to read, for files" },
    }, required: ["step", "repo"] } },
];
export const briefGroundingHandlers = { briefRepositories, briefRead };
