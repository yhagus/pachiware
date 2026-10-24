import { readPlaybookFile } from "../playbooks.js";
import { asUntrusted } from "../guardrails.js";
import { draftName, listRouteFiles, mappedKind, mappingWork, settleFiles, type ChangedFile } from "./changelog.js";
import { cutByTurn, fanOut, WORKER_READS, workerBudget, workerLimit } from "./workers.js";
import type { SkillContext, WorkerOutcome } from "../types.js";

/**
 * Mapping an API changelog's changed files in workers (ADR 0026): the files not yet mapped are split into groups by path, and each group
 * goes to a worker of its own, which reads every patch, follows each change outward to the routes it reaches, and records how each file
 * ends in the draft itself, so the main loop's context never holds the patches.
 */

/** The most patch characters and the most files one mapping worker is given (ADR 0026). */
export const GROUP_CHARS = 40_000, GROUP_FILES = 20;
/** What a mapping worker is offered: its repository reads and the one tool that records how a file ends. */
export const MAPPING_TOOLS = [...WORKER_READS, "putChangelogMapping"];
/** The most of a worker's own answer kept as why it could not map a file. */
const REASON_CHARS = 300;

/** A changed file as grouping weighs it: its patch's length when the comparison gave a patch (`patchChars`). */
type Weighed = { path: string; status: string; patchChars?: number };

/**
 * How much of a group a file takes: its patch's length. A file the comparison gave no patch for is too large or binary, so it is over the
 * bound, unless it was only moved, which leaves no patch to read.
 */
const weightOf = (f: Weighed) => f.patchChars ?? (f.status === "renamed" ? 0 : Infinity);

/**
 * Splits changed files into the groups mapping workers are given: sorted by path, each group at most GROUP_CHARS patch characters and
 * GROUP_FILES files, a file never split; a file over the bound is a group of its own.
 */
export function mappingGroups<T extends Weighed>(files: T[]): T[][] {
  const groups: T[][] = [];
  let chars = 0;
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const weight = weightOf(f), last = groups.at(-1);
    if (last && last.length < GROUP_FILES && chars + weight <= GROUP_CHARS) { last.push(f); chars += weight; }
    else { groups.push([f]); chars = weight; }
  }
  return groups;
}

type Work = Awaited<ReturnType<typeof mappingWork>>;

/**
 * What one worker starts from: the draft's repository, commits and conventions, the same for every worker, and its files last. The whole
 * history has no base: its worker reads its route files at head, each route they declare NEW, and is told how they were chosen (#373).
 */
function briefOf(work: Work, draft: string, group: ChangedFile[]) {
  const kind = mappedKind(work.scope), many = group.length === 1 ? kind : `${group.length} ${kind}s`;
  return [
    `Map ${group.length === 1 ? `one ${kind}` : many} of the API changelog of ${work.repo}${"account" in work ? ` (git account ${work.account})` : ""}, branch ${work.branch}, and record how each ends in the changelog's draft before you stop.`,
    work.base ? `Base: ${work.base.commit} (${work.base.ref}); head: ${work.head.commit} (${work.head.ref}). Read code at them by passing each as the ref.`
      : `Head: ${work.head.commit} (${work.head.ref}). Nothing came before this changelog: it covers the whole history, so every route your files declare is NEW. Read them at head by passing it as the ref.`,
    `Draft: ${draft}. Pass it to putChangelogMapping.`,
    "",
    "The repository's conventions, as the changelog's main work wrote them down:",
    asUntrusted("conventions summary", work.conventions),
    "",
    ...(work.base ? [`Your ${many}, with how ${group.length === 1 ? "it" : "each"} changed:`, asUntrusted("changed files", group.map((f) => `- ${f.path} (${f.status}${f.oldPath ? `, was ${f.oldPath}` : ""})`).join("\n"))]
      : [`Your ${many}, which the changelog's main work chose as follows:`, asUntrusted("how the route files were chosen", work.chosenBy ?? ""), ...group.map((f) => `- ${f.path}`)]),
  ].join("\n");
}

/** Why a worker that was not cut short left `path` unmapped: it ran out of steps or time, or its answer's line for the file, or its answer. */
function whyUnmapped(outcome: WorkerOutcome, path: string) {
  if (outcome.ranOut === "steps") return `its worker used all ${workerBudget.steps} steps before mapping it`;
  if (outcome.ranOut === "time") return `its worker ran out of its ${Math.round(workerBudget.ms / 60_000)} minutes before mapping it`;
  const line = outcome.answer.split("\n").map((l) => l.trim().replace(/^[-*]\s*/, "")).find((l) => l.startsWith(`${path}:`));
  return (line ? line.slice(path.length + 1).trim() : outcome.answer.trim()).slice(0, REASON_CHARS) || "its worker ended without mapping it";
}

/**
 * mapChangedFiles: hands the changed files neither mapped nor set aside to mapping workers, a group each, while the turn has time, at most
 * the tenant's `playbookWorkers` at once (ADR 0026). A file a worker left unmapped joins a later group; the second worker to leave it lists
 * it as unverified. A worker that could not reach the model, that a service failed for good, or that the turn's time cut short leaves its
 * files waiting and no more start; the turn then ends as the host's rules for those say (#358, #359). Returns counts, never what was read.
 * For the whole history the files are the route files at head, which `routeFiles` and `chosenBy` list first (#373).
 */
export async function mapChangedFiles(ctx: SkillContext, args: { draft?: unknown; routeFiles?: unknown; chosenBy?: unknown }, playbook: string) {
  const workers = ctx.workers;
  if (!workers) throw new Error("Changed files can only be mapped in a chat turn. Nothing was mapped.");
  const listed = args.routeFiles !== undefined || args.chosenBy !== undefined ? await listRouteFiles(ctx, args.draft, args) : undefined;
  const work = await mappingWork(ctx, args.draft), draft = String(args.draft).trim();
  const files = (n: number) => `${n} ${mappedKind(work.scope)}${n === 1 ? "" : "s"}`;
  const [rules, limit] = await Promise.all([readPlaybookFile(ctx.tenantId, playbook, "mapping.md", ctx.guildId), workerLimit(ctx.tenantId)]);
  if (!rules) throw new Error(`The ${playbook} playbook has no mapping.md, so no worker can map. Nothing was mapped.`);
  // The files still to map; those a worker has are busy, and one it leaves unmapped goes back, to join the next group formed.
  let pool = [...work.files];
  const busy = new Set<string>(), next = () => mappingGroups(pool.filter((f) => !busy.has(f.path)))[0];
  let mapped = 0, unverified = 0, stands = { files: work.counted, candidates: work.candidates, globalChanges: work.globalChanges, removedOperations: work.removedOperations };

  const halted = await fanOut(workers, limit, { more: () => !!next(), take: () => { const group = next()!; group.forEach((f) => busy.add(f.path)); return group; } }, async (group, ms) => {
    const outcome = await workers.run({ playbook, rules, brief: briefOf(work, draft, group), tools: MAPPING_TOOLS, steps: workerBudget.steps, ms, cacheKey: `changelog-mapping:${draft}` });
    const cut = outcome.halted ?? (cutByTurn(outcome, ms) ? "time" : null);
    const settled = await settleFiles(ctx, draft, group.map((f) => f.path), cut ? null : (path) => whyUnmapped(outcome, path));
    group.forEach((f) => busy.delete(f.path));
    pool = pool.filter((f) => !group.includes(f) || settled.left.includes(f.path));
    mapped += group.length - settled.left.length - settled.unverified.length;
    unverified += settled.unverified.length;
    stands = { files: settled.files, candidates: settled.candidates, globalChanges: settled.globalChanges, removedOperations: settled.removedOperations };
    console.info(`[changelog] Mapping worker on ${files(group.length)} (${work.repo}, draft ${draftName(draft)}): ${outcome.calls.length} tool call${outcome.calls.length === 1 ? "" : "s"}, ${group.length - settled.left.length - settled.unverified.length} mapped${settled.unverified.length ? `, ${settled.unverified.length} unverified` : ""}${settled.left.length ? `, ${settled.left.length} ${cut ? "left waiting" : "for a later group"}` : ""}`);
    return cut;
  });

  const waiting = stands.files.left, { candidates, globalChanges, removedOperations } = stands;
  const unmappable = unverified ? `; ${unverified} could not be mapped and ${unverified === 1 ? "is" : "are"} listed as unverified` : "";
  // A change to every endpoint and a route taken away are recorded in the notes, not as candidates: the changelog has them without tracing.
  const noted = [globalChanges && `${globalChanges} global change${globalChanges === 1 ? "" : "s"}`, removedOperations && `${removedOperations} removed endpoint${removedOperations === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
  const kind = mappedKind(work.scope);
  const note = halted === "model" ? `The model could not be reached, so the ${kind}s not mapped wait for the next turn. Say nothing more now.`
    : halted === "service" ? `A service the work reads failed, so the work paused; the ${kind}s not mapped wait.`
    : halted === "stopped" ? `The person pressed Stop: the ${kind}s not mapped wait.`
    : waiting ? `This turn's time is nearly out: ${files(waiting)} wait${waiting === 1 ? "s" : ""} to be mapped, and the next turn goes on with ${waiting === 1 ? "it" : "them"} through mapChangedFiles.`
    : candidates ? `Every ${kind} is mapped or set aside${unmappable}. Trace the ${candidates} candidate endpoint${candidates === 1 ? "" : "s"} with traceEndpoints.`
    : noted ? `Every ${kind} is mapped or set aside${unmappable}, and no candidate endpoint is kept to trace; the notes hold ${noted}: call finishChangelog.`
    : `Every ${kind} is mapped or set aside${unmappable}, and no change reaches an endpoint: call finishChangelog.`;
  return { ...(listed !== undefined ? { routeFiles: listed } : {}), mapped, unverified, files: stands.files, candidates, ...(globalChanges ? { globalChanges } : {}), ...(removedOperations ? { removedOperations } : {}), note };
}
