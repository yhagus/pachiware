import { readPlaybookFile } from "../playbooks.js";
import { asUntrusted } from "../guardrails.js";
import { draftName, settleCandidate, takeCandidates, type TraceResult } from "./changelog.js";
import { cutByTurn, fanOut, ranOut, WORKER_READS, workerBudget, workerLimit } from "./workers.js";
import type { SkillContext, WorkerOutcome } from "../types.js";

/**
 * Tracing an API changelog's candidate endpoints in workers (ADR 0024, amended by ADR 0025): one worker per endpoint, at most the tenant's
 * `playbookWorkers` at once, each recording its own endpoint in the draft, so the main loop's context never holds the files they read.
 */

/** The budget every worker of a changelog has (workers.ts), where tests have shortened it. */
export { workerBudget } from "./workers.js";
/** What a worker is offered: its repository reads and the two tools that record into the draft. */
export const WORKER_TOOLS = [...WORKER_READS, "putChangelogOperation", "putChangelogComponents"];
/** A worker that finds its endpoint's contract unchanged ends its answer with this word first, and why. */
const UNCHANGED = /^\s*UNCHANGED\b[\s:.-]*/i;
/** The most of a worker's own answer kept as the reason it failed. */
const REASON_CHARS = 300;

type Endpoint = { method: string; path: string; note?: string };
/** What a worker's brief is made from: the draft's repository, commits and conventions, beside the candidates still waiting. */
type BriefSource = Awaited<ReturnType<typeof takeCandidates>>;

/** What one worker starts from: the draft's repository, commits and conventions and the extension reference first, the same for every worker, and its endpoint last. */
function briefOf(kept: BriefSource, draft: string, extensions: string, c: Endpoint) {
  const commits = kept.base
    ? `Base: ${kept.base.commit} (${kept.base.ref}); head: ${kept.head.commit} (${kept.head.ref}). Read code at them by passing each as the ref.`
    : `Head: ${kept.head.commit} (${kept.head.ref}). Nothing came before this changelog: the endpoint is NEW. Read head only.`;
  return [
    `Trace one endpoint of the API changelog of ${kept.repo}${"account" in kept ? ` (git account ${kept.account})` : ""}, branch ${kept.branch}, and record it in the changelog's draft before you stop.`,
    commits,
    `Draft: ${draft}. Pass it to putChangelogOperation and putChangelogComponents.`,
    "",
    "The repository's conventions, as the changelog's main work wrote them down:",
    asUntrusted("conventions summary", kept.conventions),
    "",
    extensions,
    "",
    `Your endpoint: ${c.method.toUpperCase()} ${c.path}`,
    ...(c.note ? [`Why it is a candidate: ${asUntrusted("candidate note", c.note)}`] : []),
  ].join("\n");
}

/**
 * How a worker's endpoint stands after it ran: waiting when it could not reach the model, a service failed it for good, it was stopped, or
 * the turn's time cut it short;
 * traced when it recorded an operation or answered that the contract is unchanged; failed otherwise, with why.
 */
function settled(outcome: WorkerOutcome, ms: number): { recorded: string[] } | { unchanged: string } | { reason: string } | null {
  if (outcome.halted) return null;
  const recorded = [...new Set(outcome.calls.filter((c) => c.name === "putChangelogOperation" && c.success && typeof c.data?.saved === "string").map((c) => c.data.saved as string))];
  if (recorded.length) return { recorded };
  const answer = outcome.answer.trim();
  if (!outcome.ranOut && UNCHANGED.test(answer)) return { unchanged: answer.replace(UNCHANGED, "").slice(0, REASON_CHARS) || "its contract did not change" };
  if (cutByTurn(outcome, ms)) return null;
  return { reason: ranOut(outcome, "recording it") ?? (answer.slice(0, REASON_CHARS) || "its worker ended without recording it") };
}

/**
 * traceEndpoints: once every changed file is mapped, hands each candidate mapping kept that still waits to a worker while the turn has
 * time, at most the tenant's `playbookWorkers` at once (#369); candidates passed to it are refused. A worker that could not reach the
 * model, or that a service failed for good, leaves its endpoint waiting and no more start; the turn then ends as the host's rules for those
 * say (#358, #359). Returns what each worker recorded, never what it read.
 */
export async function traceEndpoints(ctx: SkillContext, args: { draft?: unknown; candidates?: unknown }, playbook: string) {
  const workers = ctx.workers;
  if (!workers) throw new Error("Endpoints can only be traced in a chat turn. Nothing was traced.");
  const kept = await takeCandidates(ctx, args.draft, args.candidates), draft = String(args.draft).trim();
  const [rules, extensions, limit] = await Promise.all([
    readPlaybookFile(ctx.tenantId, playbook, "tracing.md", ctx.guildId), readPlaybookFile(ctx.tenantId, playbook, "extensions.md", ctx.guildId), workerLimit(ctx.tenantId),
  ]);
  if (!rules) throw new Error(`The ${playbook} playbook has no tracing.md, so no worker can trace. Nothing was traced.`);
  const queue = [...kept.waiting], traced: TraceResult[] = [], failed: TraceResult[] = [];

  const halted = await fanOut(workers, limit, { more: () => queue.length > 0, take: () => queue.shift()! }, async (c, ms) => {
    const outcome = await workers.run({ playbook, rules, brief: briefOf(kept, draft, extensions ?? "", c), tools: WORKER_TOOLS, steps: workerBudget.steps, ms, cacheKey: `changelog-worker:${draft}` });
    const settle = settled(outcome, ms);
    console.info(`[changelog] Worker on ${c.method.toUpperCase()} ${c.path} (${kept.repo}, draft ${draftName(draft)}): ${outcome.calls.length} tool call${outcome.calls.length === 1 ? "" : "s"}, ${!settle ? "left waiting" : "reason" in settle ? `failed: ${settle.reason}` : "traced"}`);
    if (!settle) { queue.unshift(c); return outcome.halted ?? "time"; }
    const result = await settleCandidate(ctx, draft, c, settle);
    ("failed" in result ? failed : traced).push(result);
    return null;
  });

  const waiting = queue.length;
  const note = halted === "model" ? "The model could not be reached, so the endpoints not traced wait for the next turn. Say nothing more now."
    : halted === "service" ? "A service the work reads failed, so the work paused; the endpoints not traced wait."
    : halted === "stopped" ? "The person pressed Stop: the endpoints not traced wait."
    : waiting ? `This turn's time is nearly out: ${waiting} endpoint${waiting === 1 ? "" : "s"} wait${waiting === 1 ? "s" : ""}, and the next turn goes on with ${waiting === 1 ? "it" : "them"} through traceEndpoints.`
    : `Every candidate is traced.${failed.length ? " Those that failed are listed as unverified in the notes and are not traced again." : ""} Record removed endpoints with putChangelogNotes, then call finishChangelog.`;
  return { traced, failed, waiting, note };
}
