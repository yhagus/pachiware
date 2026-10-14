/** Playbook documents (ADR 0007): the glossary and decision records go to the thread's repository through one branch and one pull request per thread, or to the channel's Workspace folder when git scope allows no repository. */
import type { SkillContext, ToolDefinition } from "../types.js";
import { readBinding, rewriteBinding, type PlaybookBinding } from "../playbooks.js";
import { placeOf } from "../brief.js";
import { writeFile, openPullRequest } from "../git.js";
import { workspaceStore } from "../workspace/store.js";
import { visibleRoots } from "../workspace/paths.js";
import { freeName } from "../workspace/files.js";
import { today } from "../clock.js";
import { allowedRepositories, threadRepositoryOf } from "./playbookRepository.js";
import { confirmable, str, clip } from "./gitShared.js";

export type PullRequestRef = { number: number; url: string };
/** What the binding keeps once the thread's pull request is open. */
export type ThreadDocuments = { repo: string; branch: string; pullRequest: PullRequestRef };

export const threadDocumentsOf = (b: PlaybookBinding): ThreadDocuments | undefined => {
  const d = b.documents as any;
  return d && typeof d.repo === "string" && typeof d.branch === "string" && Number.isInteger(d.pullRequest?.number) ? { repo: d.repo, branch: d.branch, pullRequest: { number: d.pullRequest.number, url: String(d.pullRequest.url ?? "") } } : undefined;
};

// Named after the thread, so a write whose pull request failed to open lands on the same branch next time.
const branchOf = (b: PlaybookBinding) => `playbook/${b.playbook}-${b.threadId}`;
const KINDS = ["glossary", "decision"] as const;
type Kind = (typeof KINDS)[number];
const slug = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "decision";

/** Without a repository: the glossary is the channel folder's glossary.md, and a decision record is a Decision under decisions/. */
async function toWorkspace(kind: Kind, title: string, content: string, ctx: SkillContext) {
  const root = visibleRoots(ctx).channel;
  if (!root) throw new Error("Documents need a server channel.");
  const store = workspaceStore();
  if (kind === "glossary") {
    const current = await store.read(ctx.tenantId, `${root}/glossary.md`);
    await store.write(ctx.tenantId, `${root}/glossary.md`, content, current?.version);
    return { written: "channel/glossary.md", note: "No repository is allowed here, so the glossary is kept in this channel's Workspace folder." };
  }
  const taken = new Set((await store.list(ctx.tenantId, `${root}/decisions`).catch(() => [])).map((e) => e.path.split("/").pop()!));
  const name = freeName(`${today().toISOString().slice(0, 10)}-${slug(title)}.md`, taken);
  await store.write(ctx.tenantId, `${root}/decisions/${name}`, content);
  return { written: `channel/decisions/${name}`, note: `No repository is allowed here, so this is a Decision in the channel's Workspace folder. Add a remember line pointing at decisions/${name}.` };
}

export async function writePlaybookDocument(a: Record<string, any>, ctx: SkillContext) {
  const kind = a.kind as Kind;
  if (!KINDS.includes(kind)) throw new Error("kind must be glossary or decision");
  if (typeof a.content !== "string" || !a.content.trim()) throw new Error("content is required");
  const title = str(a.title, "title"), content = a.content;
  const place = placeOf(ctx);
  const found = place && await readBinding(ctx.tenantId, place);
  if (!place || !found || found.binding.status !== "active") throw new Error("Documents are written in a playbook thread; this thread does not follow one.");
  const binding = found.binding, repository = threadRepositoryOf(binding);
  if (!repository) {
    if ((await allowedRepositories(ctx)).length) throw new Error("This thread has no repository yet. Call playbookRepositories first; documents go to the repository it keeps.");
    return toWorkspace(kind, title, content, ctx);
  }
  const path = str(a.path, "path"), branch = branchOf(binding);
  const kept = threadDocumentsOf(binding), open = kept?.repo === repository.repo && kept.branch === branch ? kept.pullRequest : undefined;
  return confirmable("writePlaybookDocument", { ...a, repo: repository.repo, account: repository.account }, ctx, (repo) => ({
    summary: `Commit "${clip(title, 80)}" to ${repo} on branch ${branch}: write the ${kind} ${path} (${content.length} characters), ${open ? `part of pull request #${open.number}` : "then open a pull request into the default branch"}`,
    run: async (c) => {
      const written = await writeFile(c, repo, path, content, title, branch);
      if (open) return { ...written, pullRequest: open };
      const pullRequest = await openPullRequest(c, repo, branch, `Documents from the ${binding.playbook} playbook`,
        `The glossary and decision records written in the Discord thread https://discord.com/channels/${place.guildId}/${place.threadId}. Later writes in that thread add commits here.`);
      await rewriteBinding(ctx.tenantId, place, ({ binding: b }) => ({ binding: { ...b, documents: { repo, branch, pullRequest } }, value: null }));
      return { ...written, pullRequest };
    },
  }));
}

export const playbookDocumentTools: ToolDefinition[] = [
  { name: "writePlaybookDocument", description: "In a playbook thread: writes the glossary or one decision record, replacing the whole file. With a thread repository it commits to the thread's own branch (never the default branch) after the person presses Confirm; the first write opens the thread's one pull request, later writes add commits to it. Read the current file from that branch with repoReadFile first. Without a repository allowed here, the glossary is kept in the channel's Workspace folder and a decision becomes a Decision there.",
    parameters: { type: "object", properties: {
      kind: { type: "string", enum: [...KINDS] },
      path: { type: "string", description: "Path in the repository, e.g. GLOSSARY.md or docs/adr/0003-use-postgres.md; ignored without a repository" },
      title: { type: "string", description: "Commit message; for a decision without a repository, also its file name" },
      content: { type: "string", description: "Full new file content (markdown)" },
    }, required: ["kind", "title", "content"] } },
];
export const playbookDocumentHandlers = { writePlaybookDocument };
