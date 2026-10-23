import { DEFAULT_PLAYBOOK_WORKERS, MAX_PLAYBOOK_WORKERS, MIN_PLAYBOOK_WORKERS, repositories } from "@pachiware/db";
import { readPlaybookFile } from "../playbooks.js";
import { asUntrusted } from "../guardrails.js";
import { draftName, settleCandidate, takeCandidates, type RepositoryTool, type TraceResult } from "./changelog.js";
import type { SkillContext, WorkerOutcome } from "../types.js";

/**
 * Tracing an API changelog's candidate endpoints in workers (ADR 0024, amended by ADR 0025): one worker per endpoint, at most the tenant's
 * `playbookWorkers` at once, each recording its own endpoint in the draft, so the main loop's context never holds the files they read.
 */

/** A worker's steps and time (ADR 0024), and the least a turn must have left to start one; tests shorten them. */
export const workerBudget = { steps: 20, ms: 5 * 60_000, leastMs: 60_000 };
/** The repository reads a worker is offered: reading, diffing and searching files, not comparing or listing commits. */
const WORKER_READS: RepositoryTool[] = ["repoReadFile", "repoFileDiff", "repoSearchCode", "repoTree"];
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
    "conventions" in kept ? asUntrusted("conventions summary", kept.conventions!) : "None were written down: find what the endpoint needs from the code.",
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
  if (outcome.ranOut === "time" && ms < workerBudget.ms) return null;
  if (outcome.ranOut === "steps") return { reason: `its worker used all ${workerBudget.steps} steps before recording it` };
  if (outcome.ranOut === "time") return { reason: `its worker ran out of its ${Math.round(workerBudget.ms / 60_000)} minutes before recording it` };
  return { reason: answer.slice(0, REASON_CHARS) || "its worker ended without recording it" };
}

/**
 * traceEndpoints: keeps the candidates given, then hands each waiting one to a worker while the turn has time, at most the tenant's
 * `playbookWorkers` at once. A worker that could not reach the model, or that a service failed for good, leaves its endpoint waiting and no
 * more start; the turn then ends as the host's rules for those say (#358, #359). Returns what each worker recorded, never what it read.
 */
export async function traceEndpoints(ctx: SkillContext, args: { draft?: unknown; candidates?: unknown }, playbook: string) {
  const workers = ctx.workers;
  if (!workers) throw new Error("Endpoints can only be traced in a chat turn. Nothing was traced.");
  const kept = await takeCandidates(ctx, args.draft, args.candidates), draft = String(args.draft).trim();
  const [rules, extensions, config] = await Promise.all([
    readPlaybookFile(ctx.tenantId, playbook, "tracing.md", ctx.guildId), readPlaybookFile(ctx.tenantId, playbook, "extensions.md", ctx.guildId), repositories().agentConfig.get(ctx.tenantId),
  ]);
  if (!rules) throw new Error(`The ${playbook} playbook has no tracing.md, so no worker can trace. Nothing was traced.`);
  const limit = Math.max(MIN_PLAYBOOK_WORKERS, Math.min(MAX_PLAYBOOK_WORKERS, Number(config?.settings?.playbookWorkers) || DEFAULT_PLAYBOOK_WORKERS));
  const queue = [...kept.waiting], traced: TraceResult[] = [], failed: TraceResult[] = [];
  let halted: "model" | "service" | "stopped" | "time" | null = null;

  const work = async () => {
    while (queue.length && !halted) {
      const left = workers.timeLeft();
      if (left < workerBudget.leastMs) { halted = "time"; break; }
      const c = queue.shift()!, ms = Math.min(workerBudget.ms, left);
      const outcome = await workers.run({ playbook, rules, brief: briefOf(kept, draft, extensions ?? "", c), tools: WORKER_TOOLS, steps: workerBudget.steps, ms, cacheKey: `changelog-worker:${draft}` });
      const settle = settled(outcome, ms);
      console.info(`[changelog] Worker on ${c.method.toUpperCase()} ${c.path} (${kept.repo}, draft ${draftName(draft)}): ${outcome.calls.length} tool call${outcome.calls.length === 1 ? "" : "s"}, ${!settle ? "left waiting" : "reason" in settle ? `failed: ${settle.reason}` : "traced"}`);
      if (!settle) { halted ??= outcome.halted ?? "time"; queue.unshift(c); continue; }
      const result = await settleCandidate(ctx, draft, c, settle);
      ("failed" in result ? failed : traced).push(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, work));

  const waiting = queue.length;
  const note = halted === "model" ? "The model could not be reached, so the endpoints not traced wait for the next turn. Say nothing more now."
    : halted === "service" ? "A service the work reads failed, so the work paused; the endpoints not traced wait."
    : halted === "stopped" ? "The person pressed Stop: the endpoints not traced wait."
    : waiting ? `This turn's time is nearly out: ${waiting} endpoint${waiting === 1 ? "" : "s"} wait${waiting === 1 ? "s" : ""}, and the next turn goes on with ${waiting === 1 ? "it" : "them"} through traceEndpoints.`
    : `Every candidate is traced.${failed.length ? " Those that failed are listed as unverified in the notes and are not traced again." : ""} Record removed endpoints with putChangelogNotes, then call finishChangelog.`;
  return { traced, failed, waiting, note };
}
