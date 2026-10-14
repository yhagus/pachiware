/** A playbook thread's repository: what git scope allows here, and the one the thread keeps in its binding. */
import type { SkillContext, ToolDefinition } from "../types.js";
import { readBinding, rewriteBinding, type PlaybookBinding } from "../playbooks.js";
import { placeOf } from "../brief.js";
import { loadGitAccess, connectionOf, repoAllowed } from "../gitScope.js";
import { listRepos } from "../git.js";

export type ThreadRepository = { repo: string; account: string };

/** Every repository git scope allows here, with the first git account that reaches it, sorted by name. A thread follows its parent channel. */
export async function allowedRepositories(ctx: SkillContext): Promise<ThreadRepository[]> {
  const open = new Map<string, string>();
  for (const access of await loadGitAccess(ctx)) {
    // Patterns without a wildcard name the repositories outright; otherwise the account's list is filtered by them.
    const literal = access.sets[0]!.every((p) => !p.includes("*"));
    const repos = literal ? access.sets[0]! : (await listRepos(await connectionOf(access))).map((r) => r.repo);
    for (const repo of repos) if (repoAllowed(access, repo) && !open.has(repo)) open.set(repo, access.account.name);
  }
  return [...open].map(([repo, account]) => ({ repo, account })).sort((a, b) => a.repo.localeCompare(b.repo));
}

/** Whether `playbookRepositories` would list any repository here; when the provider cannot be asked, whether some git scope rule names a pattern. */
export async function anyRepositoryAllowed(ctx: Pick<SkillContext, "tenantId" | "botId" | "guildId" | "channelId" | "parentChannelId">): Promise<boolean> {
  try { return (await allowedRepositories(ctx as SkillContext)).length > 0; }
  catch {
    const access = await loadGitAccess(ctx as SkillContext).catch(() => []);
    return access.some((a) => a.sets.every((set) => set.length > 0));
  }
}

export type PullRequestRef = { number: number; url: string };
/** What the binding keeps once the thread's pull request is open. */
export type ThreadDocuments = { repo: string; branch: string; pullRequest: PullRequestRef };

const isText = (v: unknown): v is string => typeof v === "string";
export const threadRepositoryOf = (b: PlaybookBinding): ThreadRepository | undefined => {
  const r = b.repository as any;
  return isText(r?.repo) && isText(r?.account) ? { repo: r.repo, account: r.account } : undefined;
};
export const threadDocumentsOf = (b: PlaybookBinding): ThreadDocuments | undefined => {
  const d = b.documents as any;
  return isText(d?.repo) && isText(d?.branch) && Number.isInteger(d?.pullRequest?.number) ? { repo: d.repo, branch: d.branch, pullRequest: { number: d.pullRequest.number, url: String(d.pullRequest.url ?? "") } } : undefined;
};

/** This thread's place and active playbook binding; `refusal` is thrown when the thread follows no playbook. */
export async function activeBindingOf(ctx: SkillContext, refusal: string) {
  const place = placeOf(ctx);
  const found = place && await readBinding(ctx.tenantId, place);
  if (!place || !found || found.binding.status !== "active") throw new Error(refusal);
  return { place, binding: found.binding };
}

export async function playbookRepositories(a: Record<string, unknown>, ctx: SkillContext) {
  const { place, binding } = await activeBindingOf(ctx, "This thread does not follow a playbook, so it has no repository.");
  const repositories = await allowedRepositories(ctx);
  const wanted = typeof a.repo === "string" && a.repo.trim() ? a.repo.trim().toLowerCase() : undefined;
  if (wanted && ctx.userId !== binding.authorId) throw new Error("Only the person who started this playbook chooses its repository. Answer this person without choosing.");
  const pick = wanted ? repositories.find((r) => r.repo.toLowerCase() === wanted) : repositories.length === 1 ? repositories[0] : undefined;
  if (wanted && !pick) throw new Error(repositories.length ? `${a.repo} is not allowed here; choose one of ${repositories.map((r) => r.repo).join(", ")}.` : "Git scope allows no repository here.");
  const kept = threadRepositoryOf(binding);
  const chosen = pick && (kept?.repo === pick.repo ? kept : await rewriteBinding(ctx.tenantId, place, ({ binding }) => ({ binding: { ...binding, repository: pick }, value: pick })));
  const now = chosen ?? (kept && repositories.some((r) => r.repo === kept.repo) ? kept : undefined);
  const note = now ? `This thread uses ${now.repo}${wanted ? "" : ": do not ask which repository"}. Pass it as repo (and account ${now.account}) to git tools.`
    : !repositories.length ? "Git scope allows no repository here. Work without one, or tell the person an admin can open one in the console under the server's git access."
    : "Ask the person which of these repositories this thread is for, then call playbookRepositories again with their choice as repo.";
  return { repositories, ...(now ? { chosen: now } : {}), note };
}

export const playbookRepositoryTools: ToolDefinition[] = [
  { name: "playbookRepositories", description: "In a playbook thread: lists the repositories git scope allows here and the one the thread uses. With one allowed it becomes the thread's repository. With several, ask the person which, then call again with repo to keep their choice for the rest of the thread.",
    parameters: { type: "object", properties: { repo: { type: "string", description: "owner/name, one of the listed repositories: the person's choice" } } } },
];
export const playbookRepositoryHandlers = { playbookRepositories };
