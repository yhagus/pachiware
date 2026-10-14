import { createHash } from "node:crypto";
import type { SkillContext, ToolDefinition, ToolResult } from "../types.js";
import { createIssue, linkBlockedBy, linkIssues, subIssue, setLabels, assignItem, closeItem, reopenItem, type GitConn } from "../git.js";
import { queueAction } from "../gitConfirm.js";
import { workspaceStore } from "../workspace/store.js";
import { safeId } from "../workspace/paths.js";
import { parseFrontmatter, renderFrontmatter } from "../playbooks.js";
import { acct, repoP, CONFIRM, useRepo, str, num, labelsP, labelsOf, clip } from "./gitShared.js";

/** Up to 25 issue changes behind one Confirm only the asker can press; saved progress lets a rerun of the same batch do only what is missing. */
export const CREATE_ISSUES = "repoCreateIssues", UPDATE_ISSUES = "repoUpdateIssues";
export const MAX_BATCH = 25;

interface NewIssue { ref: string; title: string; body?: string; labels: string[]; parent?: string | number; blockedBy: (string | number)[] }
/** `linked` names the blockers whose link was recorded; a refused one stays out so the next run retries it. */
interface Made { number: number; url: string; id?: number; parented?: true; linked?: string[] }

const isRef = (v: unknown): v is string => typeof v === "string" && !!v.trim();
/** A ref of this batch, or "#12" (or 12) for an existing issue. */
const target = (v: unknown, what: string): string | number => {
  const existing = typeof v === "string" ? /^#(\d+)$/.exec(v.trim())?.[1] : undefined;
  if (existing && Number(existing) > 0) return Number(existing);
  if (isRef(v)) return v.trim();
  if (Number.isInteger(v) && (v as number) > 0) return v as number;
  throw new Error(`${what} must be the ref of an issue in this batch, or "#12" for an existing issue`);
};

function blockers(v: unknown, what: string): (string | number)[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`${what} must be a list`);
  return [...new Set(v.map((b) => target(b, what)))];
}

function batchItems<T>(v: unknown, name: string, parse: (x: any, i: number) => T): T[] {
  if (!Array.isArray(v) || !v.length) throw new Error(`${name} must be a list of 1 to ${MAX_BATCH} items`);
  if (v.length > MAX_BATCH) throw new Error(`A batch holds at most ${MAX_BATCH} items; this one has ${v.length}. Split it into smaller batches.`);
  return v.map((x, i) => { if (!x || typeof x !== "object") throw new Error(`${name}[${i}] must be an object`); return parse(x, i); });
}

function newIssues(v: unknown): NewIssue[] {
  const items = batchItems(v, "issues", (x, i) => ({
    ref: str(x.ref, `issues[${i}].ref`), title: str(x.title, `issues[${i}].title`),
    ...(typeof x.body === "string" && x.body.trim() ? { body: x.body } : {}),
    labels: labelsOf(x.labels),
    ...(x.parent === undefined ? {} : { parent: target(x.parent, `issues[${i}].parent`) }),
    blockedBy: blockers(x.blockedBy, `issues[${i}].blockedBy`),
  }));
  const refs = new Set<string>();
  for (const it of items) {
    if (/^#\d+$/.test(it.ref)) throw new Error(`"${it.ref}" names an existing issue; pick a ref that is not "#" and a number.`);
    if (refs.has(it.ref)) throw new Error(`Two issues share the ref "${it.ref}"; every ref must be unique.`);
    refs.add(it.ref);
  }
  for (const it of items) for (const t of [...(it.parent === undefined ? [] : [it.parent]), ...it.blockedBy]) {
    if (t === it.ref) throw new Error(`${it.ref} cannot be its own parent or blocker`);
    if (typeof t === "string" && !refs.has(t)) throw new Error(`${it.ref} names "${t}", which is no ref in this batch`);
  }
  return items;
}

/** Parents and blockers before the issues that name them; otherwise in the given order. */
function creationOrder(items: NewIssue[]): NewIssue[] {
  const byRef = new Map(items.map((it) => [it.ref, it])), out: NewIssue[] = [], state = new Map<string, "visiting" | "done">();
  const visit = (it: NewIssue, path: string[]) => {
    if (state.get(it.ref) === "done") return;
    if (state.get(it.ref) === "visiting") throw new Error(`Parents and blockers form a cycle: ${[...path, it.ref].join(" → ")}`);
    state.set(it.ref, "visiting");
    for (const t of [...(it.parent === undefined ? [] : [it.parent]), ...it.blockedBy]) if (typeof t === "string") visit(byRef.get(t)!, [...path, it.ref]);
    state.set(it.ref, "done");
    out.push(it);
  };
  items.forEach((it) => visit(it, []));
  return out;
}

/** Where one batch's progress lives: the channel's Workspace folder (a thread uses its parent's), named by what identifies the batch. */
function progressPath(ctx: SkillContext, tool: string, identity: unknown) {
  const guild = safeId(ctx.guildId), channel = safeId(ctx.parentChannelId ?? ctx.channelId);
  if (!guild || !channel) throw new Error(NO_CONTEXT);
  const key = createHash("sha256").update(JSON.stringify([tool, identity])).digest("hex").slice(0, 16);
  return `guilds/${guild}/channels/${channel}/batches/${tool}-${key}.md`;
}

/** The saved progress of a batch, and a save that keeps the file's version in step. */
async function progressOf<T>(tenantId: string, path: string, header: Record<string, unknown>) {
  const store = workspaceStore(), file = await store.read(tenantId, path);
  let version = file?.version;
  const done: Record<string, T> = (file && (parseFrontmatter(file.content)?.fields.done as Record<string, T>)) || {};
  const save = async () => { version = (await store.write(tenantId, path, renderFrontmatter({ ...header, done }, "Progress of a batch of git issue changes. Running the same batch again skips what is recorded here.\n"), version)).version; };
  return { done, save };
}

const locks = new Map<string, Promise<unknown>>();
/** One run per batch at a time, so two confirmations pressed together cannot create the same issue twice. */
function exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  locks.set(key, run);
  void run.finally(() => { if (locks.get(key) === run) locks.delete(key); }).catch(() => {});
  return run;
}

const named = (t: string | number) => (typeof t === "number" ? `#${t}` : t);

const NO_CONTEXT = "A batch needs the person who asked to confirm it, which only works in a Discord channel.";
/** Queues the batch behind its own Confirm: only the asker can press it, and no thread grant covers it. */
function queueBatch(tool: string, a: Record<string, unknown>, ctx: SkillContext, summary: string) {
  if (!ctx.botId || !ctx.userId || !ctx.guildId || !ctx.channelId) throw new Error(NO_CONTEXT);
  const q = queueAction({ tenantId: ctx.tenantId, botId: ctx.botId, userId: ctx.userId, guildId: ctx.guildId, channelId: ctx.channelId, parentChannelId: ctx.parentChannelId, tool, args: a, summary, auth: ctx.auth, ownConfirmation: true });
  return { pending: true, ownConfirmation: true, confirmationId: q.id, summary, note: "Nothing has changed yet. Tell the person who asked to press Confirm or Cancel on the message that appears; a thread grant does not cover a batch. Do not call this tool again." };
}
const issues = (n: number) => `${n} issue${n === 1 ? "" : "s"}`;

/** Where a confirmed batch runs: its repository, and its progress file. */
interface BatchRun { conn: GitConn; repo: string; account: string; path: string }
/** A confirmed batch runs, one run per batch at a time; otherwise it waits for Confirm, summed up by `preview` from the saved progress. */
async function runOrQueue<T>(tool: string, a: Record<string, unknown>, ctx: SkillContext, key: unknown, run: (b: BatchRun) => Promise<unknown>, preview: (done: Record<string, T>, repo: string) => string) {
  const { access, repo, conn } = await useRepo(a, ctx);
  const account = access.account.name, path = progressPath(ctx, tool, [account, repo, key]);
  if (ctx.confirmed) return exclusive(`${ctx.tenantId}|${path}`, () => run({ conn, repo, account, path }));
  const { done } = await progressOf<T>(ctx.tenantId, path, {});
  return queueBatch(tool, a, ctx, preview(done, repo));
}

export interface CreateBatchResult {
  batch: "create";
  repo: string;
  /** Every issue of the batch that exists, this run's and earlier ones'. */
  created: { ref: string; title: string; number: number; url: string }[];
  failed?: { ref: string; title: string; error: string };
  notCreated: { ref: string; title: string }[];
  /** Blocked-by links the platform refused (GitLab's need Premium); the issues exist without them, and the next run retries them. */
  unlinked?: { ref: string; blockedBy: string }[];
  done: boolean;
}

async function createIssues(a: Record<string, unknown>, ctx: SkillContext) {
  const items = newIssues(a.issues), order = creationOrder(items);
  return runOrQueue<Made>(CREATE_ISSUES, a, ctx, items.map((it) => [it.ref, it.title]), (b) => runCreate(ctx, b, order), (done, repo) => {
    const left = order.filter((it) => !finished(it, done[it.ref]));
    if (!left.length) throw new Error(`Every issue of this batch already exists: ${order.map((it) => `${it.ref} #${done[it.ref]!.number}`).join(", ")}. Nothing was changed.`);
    const fresh = left.filter((it) => !done[it.ref]).length;
    const lines = left.map((it, i) => {
      const made = done[it.ref];
      return `${i + 1}. ${it.ref}: ${clip(it.title, 100)}${it.labels.length ? ` · labels: ${it.labels.join(", ")}` : ""}${it.parent !== undefined ? ` · under ${named(it.parent)}` : ""}${it.blockedBy.length ? ` · blocked by ${it.blockedBy.map(named).join(", ")}` : ""}${made ? ` · exists as #${made.number}` : ""}`;
    });
    return [fresh ? `Create ${issues(fresh)} in ${repo}:` : `Finish linking issues in ${repo}:`, ...lines].join("\n");
  });
}

const unlinkedOf = (it: NewIssue, made: Made) => it.blockedBy.filter((b) => !made.linked?.includes(named(b)));
const finished = (it: NewIssue, made?: Made) => !!made && (it.parent === undefined || !!made.parented) && !unlinkedOf(it, made).length;

async function runCreate(ctx: SkillContext, { conn, repo, account, path }: BatchRun, order: NewIssue[]): Promise<CreateBatchResult> {
  const { done, save } = await progressOf<Made>(ctx.tenantId, path, { tool: CREATE_ISSUES, account, repo });
  const numberOf = (t: string | number) => (typeof t === "number" ? t : done[t]!.number);
  const unlinked: { ref: string; blockedBy: string }[] = [];
  let failed: CreateBatchResult["failed"];
  for (const it of order) {
    try {
      if (!done[it.ref]) {
        const made = await createIssue(conn, repo, it.title, it.body, it.labels);
        done[it.ref] = { number: made.number, url: made.url, ...(made.id ? { id: made.id } : {}) };
        await save();
      }
      const made = done[it.ref]!;
      if (it.parent !== undefined && !made.parented) {
        await subIssue(conn, repo, numberOf(it.parent), made.number, "attach");
        made.parented = true;
        await save();
      }
      const missing = unlinkedOf(it, made);
      if (missing.length) {
        // A native link is a convenience: where the platform refuses it, the issue still stands.
        for (const b of missing) {
          const blocker = typeof b === "string" ? done[b]! : null;
          await (blocker ? linkBlockedBy(conn, repo, blocker, made.number) : linkIssues(conn, repo, made.number, b as number))
            .then(() => { made.linked = [...(made.linked ?? []), named(b)]; }, () => unlinked.push({ ref: it.ref, blockedBy: named(b) }));
        }
        await save();
      }
    } catch (e: any) {
      failed = { ref: it.ref, title: it.title, error: String(e?.message ?? e).slice(0, 300) };
      break;
    }
  }
  return {
    batch: "create", repo,
    created: order.filter((it) => done[it.ref]).map((it) => ({ ref: it.ref, title: it.title, number: done[it.ref]!.number, url: done[it.ref]!.url })),
    ...(failed ? { failed } : {}),
    notCreated: order.filter((it) => !done[it.ref]).map((it) => ({ ref: it.ref, title: it.title })),
    ...(unlinked.length ? { unlinked } : {}),
    done: !failed,
  };
}

interface IssueUpdate { number: number; labels?: string[]; state?: "open" | "closed"; assignees?: string[] }

function issueUpdates(v: unknown): IssueUpdate[] {
  const items = batchItems(v, "updates", (x, i): IssueUpdate => {
    if (x.state !== undefined && x.state !== "open" && x.state !== "closed") throw new Error(`updates[${i}].state must be open or closed`);
    if (x.assignees !== undefined && !Array.isArray(x.assignees)) throw new Error(`updates[${i}].assignees must be a list of usernames`);
    const u = {
      number: num(x.number),
      ...(x.labels === undefined ? {} : { labels: labelsOf(x.labels) }),
      ...(x.state === undefined ? {} : { state: x.state }),
      ...(x.assignees === undefined ? {} : { assignees: x.assignees.map((n: unknown) => str(n, "assignee")) }),
    };
    if (Object.keys(u).length === 1) throw new Error(`updates[${i}] changes nothing: give labels, state or assignees`);
    return u;
  });
  const seen = new Set<number>();
  for (const u of items) { if (seen.has(u.number)) throw new Error(`#${u.number} appears twice; put all its changes in one item.`); seen.add(u.number); }
  return items;
}

const changeLine = (u: IssueUpdate) => [`#${u.number}`,
  ...(u.labels ? [u.labels.length ? `labels: ${u.labels.join(", ")}` : "remove all labels"] : []),
  ...(u.assignees ? [u.assignees.length ? `assignees: ${u.assignees.join(", ")}` : "unassign everyone"] : []),
  ...(u.state ? [u.state === "closed" ? "close" : "reopen"] : []),
].join(" · ");

export interface UpdateBatchResult {
  batch: "update";
  repo: string;
  /** Every issue of the batch already changed, this run's and earlier ones'. */
  updated: number[];
  failed?: { number: number; error: string };
  notUpdated: number[];
  done: boolean;
}

async function updateIssues(a: Record<string, unknown>, ctx: SkillContext) {
  const updates = issueUpdates(a.updates);
  return runOrQueue<true>(UPDATE_ISSUES, a, ctx, updates, (b) => runUpdate(ctx, b, updates), (done, repo) => {
    const left = updates.filter((u) => !done[u.number]);
    if (!left.length) throw new Error(`Every change of this batch was already made (${updates.map((u) => `#${u.number}`).join(", ")}). Nothing was changed.`);
    return [`Update ${issues(left.length)} in ${repo}:`, ...left.map(changeLine)].join("\n");
  });
}

async function runUpdate(ctx: SkillContext, { conn, repo, account, path }: BatchRun, updates: IssueUpdate[]): Promise<UpdateBatchResult> {
  const { done, save } = await progressOf<true>(ctx.tenantId, path, { tool: UPDATE_ISSUES, account, repo });
  let failed: UpdateBatchResult["failed"];
  for (const u of updates) {
    if (done[u.number]) continue;
    try {
      // Each change sets a value, so repeating one after a failure part-way through an issue is harmless.
      if (u.labels) await setLabels(conn, repo, u.number, "issue", u.labels);
      if (u.assignees) await assignItem(conn, repo, u.number, "issue", u.assignees);
      if (u.state) await (u.state === "closed" ? closeItem : reopenItem)(conn, repo, u.number, "issue");
      done[u.number] = true;
      await save();
    } catch (e: any) {
      failed = { number: u.number, error: String(e?.message ?? e).slice(0, 300) };
      break;
    }
  }
  return {
    batch: "update", repo,
    updated: updates.filter((u) => done[u.number]).map((u) => u.number),
    ...(failed ? { failed } : {}),
    notUpdated: updates.filter((u) => !done[u.number]).map((u) => u.number),
    done: !failed,
  };
}

const LIMIT = 1900;
/** Lines up to Discord's message limit, then a count of what did not fit. */
function fitted(head: string[], lines: string[], tail: string[]) {
  const out = [...head];
  let used = [...head, ...tail].join("\n").length;
  for (const [i, line] of lines.entries()) {
    if (used + line.length + 40 > LIMIT) { out.push(`…and ${lines.length - i} more`); break; }
    out.push(line);
    used += line.length + 1;
  }
  return [...out, ...tail].join("\n");
}

/** What the confirmation message says after a batch ran; undefined for any other tool result. */
export function issueBatchReport(tool: string, result: ToolResult): string | undefined {
  const data = result.success ? (result.data as CreateBatchResult | UpdateBatchResult) : null;
  if (tool === UPDATE_ISSUES && data?.batch === "update") return updateReport(data);
  if (tool !== CREATE_ISSUES || data?.batch !== "create") return;
  const r = data;
  const links = r.created.map((c) => `${c.ref}: <${c.url}>`);
  const unlinked = r.unlinked?.length ? [`Could not record these blocked-by links: ${r.unlinked.map((u) => `${u.ref} by ${u.blockedBy}`).join(", ")}.`] : [];
  if (!r.failed) return fitted([`Created ${issues(r.created.length)} in ${r.repo}:`], links, unlinked.length ? [...unlinked, "Run the same batch again to retry them."] : []);
  return fitted([`Stopped at ${r.failed.ref} (${clip(r.failed.title, 80)}): ${r.failed.error}`, ...(links.length ? ["Created:"] : ["Nothing was created."])], links, [
    ...(r.notCreated.length ? [`Not created: ${r.notCreated.map((d) => d.ref).join(", ")}`] : []),
    ...unlinked,
    "Run the same batch again to do only what is missing.",
  ]);
}

function updateReport(r: UpdateBatchResult) {
  const list = (ns: number[]) => ns.map((n) => `#${n}`).join(", ");
  if (!r.failed) return `Updated ${issues(r.updated.length)} in ${r.repo}: ${list(r.updated)}`;
  return [`Stopped at #${r.failed.number}: ${r.failed.error}`, r.updated.length ? `Updated: ${list(r.updated)}` : "Nothing was updated.", `Not updated: ${list(r.notUpdated)}`, "Run the same batch again to do only what is missing."].join("\n");
}

const refP = { type: "string", description: "The ref of an issue in this batch, or \"#12\" for an existing issue" };
export const issueBatchTools: ToolDefinition[] = [{
  name: CREATE_ISSUES,
  description: `Creates up to ${MAX_BATCH} issues in one repository behind one confirmation that only the person who asked can press (a thread grant does not cover it). Each issue has a ref, unique in the batch, that other issues use for \`parent\` (sub-issue) and \`blockedBy\`; \"#12\" there means an existing issue. Parents and blockers are created first. A batch stops at the first failure; calling it again with the same refs and titles creates only what is missing.` + CONFIRM,
  parameters: { type: "object", properties: {
    account: acct, repo: repoP,
    issues: { type: "array", items: { type: "object", properties: {
      ref: { type: "string", description: "Short local name, e.g. \"schema\"" },
      title: { type: "string" }, body: { type: "string", description: "Description (markdown)" }, labels: labelsP,
      parent: refP,
      blockedBy: { type: "array", items: refP },
    }, required: ["ref", "title"] } },
  }, required: ["repo", "issues"] },
}, {
  name: UPDATE_ISSUES,
  description: `Changes labels (replacing them), state, or assignees (replacing them) on up to ${MAX_BATCH} issues of one repository behind one confirmation that only the person who asked can press (a thread grant does not cover it). A batch stops at the first failure; calling it again with the same changes does only what is left.` + CONFIRM,
  parameters: { type: "object", properties: {
    account: acct, repo: repoP,
    updates: { type: "array", items: { type: "object", properties: {
      number: { type: "number", description: "Issue number" },
      labels: { ...labelsP, description: "The issue's full new label list" },
      state: { type: "string", enum: ["open", "closed"] },
      assignees: { type: "array", items: { type: "string" }, description: "The full new list of assignee usernames" },
    }, required: ["number"] } },
  }, required: ["repo", "updates"] },
}];
export const issueBatchHandlers = { [CREATE_ISSUES]: createIssues, [UPDATE_ISSUES]: updateIssues };
