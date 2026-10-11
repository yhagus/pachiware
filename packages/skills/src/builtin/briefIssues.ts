import type { SkillContext, ToolDefinition, ToolResult } from "../types.js";
import { readBinding, writeBinding, type BindingPlace, type PlaybookBinding } from "../playbooks.js";
import { briefState, placeOf, updateBrief, type BriefDraft, type BriefState } from "../brief.js";
import { draftBody } from "../issueDrafts.js";
import { groundingOf, proposedLabels } from "../grounding.js";
import { createIssue, linkBlockedBy, type GitConn } from "../git.js";
import { queueAction } from "../gitConfirm.js";
import { WorkspaceConflict } from "../workspace/store.js";
import { useRepo } from "./gitShared.js";

/**
 * Creating a brief's issues from its drafts (#43): one Git write confirmation for every draft left, pressed by the
 * brief's author. A thread grant never covers it. Drafts are read from the brief's file by number, so no body
 * passes through tool arguments.
 */
export const CREATE_BRIEF_ISSUES = "createBriefIssues";

async function authorsBrief(ctx: SkillContext) {
  const place = placeOf(ctx);
  const found = place && await readBinding(ctx.tenantId, place);
  if (!place || !found || found.binding.status !== "active") throw new Error("This thread does not follow a playbook, so there is no brief to create issues from.");
  if (ctx.userId !== found.binding.authorId) throw new Error("Only the brief's author can create its issues. Tell this person the author decides.");
  return { place, found };
}

const numbers = (v: unknown, count: number, name: string) => {
  if (v === undefined) return [];
  const list = Array.isArray(v) ? [...new Set(v)] : [null];
  if (list.some((n) => !Number.isInteger(n) || (n as number) < 1 || (n as number) > count)) throw new Error(`${name} must name drafts by number, from 1 to ${count}.`);
  return list as number[];
};

/** Blockers before the drafts that wait on them; otherwise in draft order. */
export function creationOrder(drafts: BriefDraft[], picked: number[]): number[] {
  const out: number[] = [], seen = new Set<number>();
  const visit = (n: number) => {
    if (seen.has(n)) return;
    seen.add(n);
    for (const b of drafts[n - 1]!.blockedBy) if (picked.includes(b)) visit(b);
    out.push(n);
  };
  [...picked].sort((a, b) => a - b).forEach(visit);
  return out;
}

/** How a draft names a blocker: its issue number in the same repository, its full URL across repositories. */
const blockerRef = (d: BriefDraft) => (b: BriefDraft) =>
  b.issue ? (b.repo === d.repo ? `#${b.issue.number}` : b.issue.url) : `${b.title} (not created)`;
const stripAdded = (body: string) => body.replace(/ ?\*\(added\)\*/g, "");

function summaryOf(state: BriefState, binding: PlaybookBinding, order: number[], skip: number[]) {
  const g = groundingOf(binding);
  const lines = order.map((n) => {
    const d = state.drafts[n - 1]!, labels = proposedLabels(g, d);
    const waits = d.blockedBy.map((b) => { const x = state.drafts[b - 1]!; return x.issue ? blockerRef(d)(x) : `draft ${b}`; });
    return `${n}. ${d.title} · ${d.repo}${labels.length ? ` · labels: ${labels.join(", ")}` : ""}${waits.length ? ` · blocked by ${waits.join(", ")}` : ""}`;
  });
  const skipped = skip.map((n) => `${n}. ${state.drafts[n - 1]!.title}`);
  return [`Create ${order.length} issue${order.length === 1 ? "" : "s"} from this brief:`, ...lines, ...(skipped.length ? [`Skipped: ${skipped.join("; ")}`] : [])].join("\n");
}

const locks = new Map<string, Promise<unknown>>();
/** One batch per brief at a time, so two confirmations pressed together cannot create the same draft twice. */
function exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  locks.set(key, run);
  void run.finally(() => { if (locks.get(key) === run) locks.delete(key); }).catch(() => {});
  return run;
}

export interface CreatedIssue { n: number; title: string; repo: string; number: number; url: string }
export interface BriefIssuesResult {
  brief: true;
  /** Every draft of the brief that has an issue, this batch's and earlier ones'. */
  created: CreatedIssue[];
  failed?: { n: number; title: string; error: string };
  notCreated: { n: number; title: string }[];
  skipped: { n: number; title: string }[];
  done: boolean;
}

export async function createBriefIssues(a: Record<string, unknown>, ctx: SkillContext) {
  const { place, found } = await authorsBrief(ctx);
  const state = briefState(found.binding), count = state.drafts.length;
  const skip = numbers(a.skip, count, "skip");
  const picked = a.drafts === undefined ? state.drafts.filter((d) => !d.issue && !d.skipped && !skip.includes(d.n)).map((d) => d.n) : numbers(a.drafts, count, "drafts");
  if (!picked.length) throw new Error("Every draft of this brief already has an issue or was skipped.");
  const problems = [
    ...picked.filter((n) => !state.drafts[n - 1]!.writtenAt).map((n) => `Draft ${n} is not written yet: write it with writeIssueDraft, or skip it.`),
    ...picked.filter((n) => state.drafts[n - 1]!.writtenAt && !state.drafts[n - 1]!.repo).map((n) => `Draft ${n} has no repository: give it one with writeIssueDraft, or skip it and paste it by hand from drafts.md.`),
  ];
  if (problems.length) throw new Error(problems.join("\n"));
  const order = creationOrder(state.drafts, picked);

  if (!ctx.confirmed) {
    if (!ctx.botId || !ctx.userId || !ctx.guildId || !ctx.channelId) throw new Error("Creating issues needs the author to confirm it, which only works in a Discord thread.");
    const summary = summaryOf(state, found.binding, order, skip);
    const q = queueAction({ tenantId: ctx.tenantId, botId: ctx.botId, userId: ctx.userId, guildId: ctx.guildId, channelId: ctx.channelId, parentChannelId: ctx.parentChannelId, tool: CREATE_BRIEF_ISSUES, args: { drafts: order, ...(skip.length ? { skip } : {}) }, summary, auth: ctx.auth, ownConfirmation: true });
    return { pending: true, ownConfirmation: true, confirmationId: q.id, summary, note: "Nothing has changed yet. Tell the author to press Confirm or Cancel on the message that appears in the thread; a thread grant does not cover this. Do not call this tool again." };
  }
  return exclusive(`${ctx.tenantId}|${place.threadId}`, () => runBatch(ctx, place, order, skip));
}

async function runBatch(ctx: SkillContext, place: BindingPlace, order: number[], skip: number[]): Promise<BriefIssuesResult> {
  if (skip.length) await updateBrief(ctx.tenantId, place, (s) => ({ state: { ...s, drafts: s.drafts.map((d) => (skip.includes(d.n) && !d.issue ? { ...d, skipped: true } : d)) }, value: true }));
  const conns = new Map<string, GitConn>();
  let failed: BriefIssuesResult["failed"];
  for (const n of order) {
    const found = await readBinding(ctx.tenantId, place);
    if (!found) break;
    const state = briefState(found.binding), d = state.drafts[n - 1];
    if (!d || d.issue || d.skipped) continue;
    try {
      const g = groundingOf(found.binding), repo = d.repo!;
      if (!conns.has(repo)) conns.set(repo, (await useRepo({ repo, account: g.repos[repo]?.account }, ctx)).conn);
      const conn = conns.get(repo)!;
      const made = await createIssue(conn, repo, d.title, stripAdded(draftBody(state, found.binding, n, blockerRef(d))), proposedLabels(g, d));
      const issue = { number: made.number, url: made.url, ...(made.id ? { id: made.id } : {}) };
      const saved = await updateBrief(ctx.tenantId, place, (s) => ({ state: { ...s, drafts: s.drafts.map((x) => (x.n === n ? { ...x, issue } : x)) }, value: true }));
      if (!saved) throw new Error(`${made.url} was created but could not be saved to the brief's file`);
      // A native link is a convenience: where the platform has none, the Blocked by text stands alone.
      for (const b of d.blockedBy) {
        const blocker = state.drafts[b - 1];
        if (blocker?.issue && blocker.repo === repo) await linkBlockedBy(conn, repo, blocker.issue, issue.number).catch(() => {});
      }
    } catch (e: any) {
      failed = { n, title: d.title, error: String(e?.message ?? e).slice(0, 300) };
      break;
    }
  }
  return finish(ctx.tenantId, place, failed);
}

async function finish(tenantId: string, place: BindingPlace, failed: BriefIssuesResult["failed"]): Promise<BriefIssuesResult> {
  for (let attempt = 0; ; attempt++) {
    const found = await readBinding(tenantId, place);
    const drafts = found ? briefState(found.binding).drafts : [];
    const result: BriefIssuesResult = {
      brief: true,
      created: drafts.filter((d) => d.issue).map((d) => ({ n: d.n, title: d.title, repo: d.repo!, number: d.issue!.number, url: d.issue!.url })),
      ...(failed ? { failed } : {}),
      notCreated: drafts.filter((d) => !d.issue && !d.skipped).map((d) => ({ n: d.n, title: d.title })),
      skipped: drafts.filter((d) => d.skipped).map((d) => ({ n: d.n, title: d.title })),
      done: false,
    };
    result.done = !!found && !result.notCreated.length;
    if (!found || !result.done) return result;
    try { await writeBinding(tenantId, { ...found.binding, status: "done" }, found.body, found.version); return result; }
    catch (e) { if (!(e instanceof WorkspaceConflict) || attempt) throw e; }
  }
}

/** The result of a confirmed batch, or null for any other tool result. */
export const briefIssuesOf = (tool: string, result: ToolResult): BriefIssuesResult | null =>
  tool === CREATE_BRIEF_ISSUES && result.success && (result.data as any)?.brief === true ? result.data as BriefIssuesResult : null;

/** A created draft's embed, edited in place. */
export const createdEmbed = (c: CreatedIssue) => ({ title: `${c.n}. ${c.title}`, url: c.url, description: `Created: ${c.url}` });

/** The thread message after a batch: every link, and on a failure what was not created and how to go on. */
export function issuesReport(r: BriefIssuesResult): string {
  const links = r.created.map((c) => `${c.n}. ${c.title}: <${c.url}>`);
  const skipped = r.skipped.length ? [`Skipped: ${r.skipped.map((d) => `${d.n}. ${d.title}`).join("; ")}`] : [];
  if (!r.failed) return [`Created ${r.created.length} issue${r.created.length === 1 ? "" : "s"} from this brief:`, ...links, ...skipped, ...(r.done ? ["-# This brief is done. Messages here are ordinary chat from now on."] : [])].join("\n");
  return [
    `Stopped at draft ${r.failed.n}, ${r.failed.title}: ${r.failed.error}`,
    ...(links.length ? ["**Created**", ...links] : ["Nothing was created."]),
    "**Not created**", ...r.notCreated.map((d) => `${d.n}. ${d.title}`),
    ...skipped,
    `Say "continue the rest" to create the drafts not created yet, under a new confirmation. drafts.md has them to paste by hand.`,
  ].join("\n");
}

export const briefIssuesTools: ToolDefinition[] = [{
  name: CREATE_BRIEF_ISSUES,
  description: "In a thread that follows the issue-draft playbook: creates the brief's written drafts as issues, after one confirmation that only the brief's author can press. Blockers are created first, each with its proposed labels. Call it with no arguments to create every draft left; drafts already created are never created again, so the same call continues a stopped batch.",
  parameters: { type: "object", properties: {
    skip: { type: "array", items: { type: "integer" }, description: "Draft numbers the author dropped, e.g. \"skip draft 3\"; they are never created" },
  } },
}];
export const briefIssuesHandlers = { [CREATE_BRIEF_ISSUES]: createBriefIssues };
