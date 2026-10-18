import type { SkillContext } from "../types.js";
import { visibleRoots } from "../workspace/paths.js";
import type { WorkspaceStore } from "../workspace/store.js";
import { assigneeLabel, parseAssignee, renderAssignee, type Assignee } from "./assignee.js";
import { checklistSuffix } from "./checklist.js";
import { parseBody, renderBody, type ProgressNote } from "./progressNotes.js";
import { now, offsetText, zoneOffset, zonedTime } from "../clock.js";

export const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskStatus = (typeof STATUSES)[number];
export type TaskPriority = (typeof PRIORITIES)[number];
export interface Task { id: string; title: string; description: string | null; status: TaskStatus; priority: TaskPriority; assignedTo: Assignee | null; dueAt: string | null; createdBy: string | null; createdByName: string | null; createdAt: string; updatedAt: string; notes?: ProgressNote[] }

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/, DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/** A due date as the file stores it: a date, or a date-time with its offset. A date-time without an offset is read in `timeZone`. Null when `value` is not a real date or time. */
export function normalizeDueAt(value: unknown, timeZone: string): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (DATE_ONLY.test(v)) return zonedTime("UTC", `${v}T00:00`) === null ? null : v;
  const m = DATE_TIME.exec(v);
  if (!m) return null;
  const wall = `${m[1]}T${m[2]}:${m[3] ?? "00"}`;
  if (m[4]) return zonedTime("UTC", wall) === null ? null : `${wall}${m[4]}`;
  const at = zonedTime(timeZone, wall);
  return at === null ? null : `${wall}${offsetText(zoneOffset(timeZone, at))}`;
}
/** A due date tool argument as the file stores it; empty clears it. Throws on anything that is not a date or date-time. */
export function dueAtArg(value: unknown, timeZone: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const dueAt = normalizeDueAt(value, timeZone);
  if (dueAt === null) throw new Error(`Invalid due date "${String(value).slice(0, 40)}": use YYYY-MM-DD, or a date-time such as 2026-03-06T15:00`);
  return dueAt;
}
/** The last instant a task is on time: the end of the day in `timeZone` for a date, the exact time otherwise. Null without a due date. */
export function dueMoment(dueAt: string | null | undefined, timeZone: string): number | null {
  if (!dueAt) return null;
  if (DATE_ONLY.test(dueAt)) { const end = zonedTime(timeZone, `${dueAt}T23:59:59`); return end === null ? null : end + 999; }
  const m = DATE_TIME.exec(dueAt);
  if (!m) return null;
  if (m[4]) { const t = Date.parse(`${m[1]}T${m[2]}:${m[3] ?? "00"}${m[4]}`); return Number.isNaN(t) ? null : t; }
  return zonedTime(timeZone, `${m[1]}T${m[2]}:${m[3] ?? "00"}`);
}
/** A listTasks due filter bound as an instant: a date starts or ends its whole day. Undefined when no bound was given; throws on anything else that is not a date. */
export function dueBound(value: unknown, timeZone: string, edge: "start" | "end"): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const dueAt = normalizeDueAt(value, timeZone);
  if (dueAt === null) throw new Error(`Invalid ${edge === "start" ? "dueAfter" : "dueBefore"} "${String(value).slice(0, 40)}": use YYYY-MM-DD or a date-time`);
  return (edge === "start" && DATE_ONLY.test(dueAt) ? zonedTime(timeZone, `${dueAt}T00:00`) : dueMoment(dueAt, timeZone))!;
}
/** Open: still to be done, so neither completed nor cancelled. Only open tasks are active, late, in the turn context, or in the Digest. */
export const isOpen = (task: Pick<Task, "status">): boolean => task.status !== "completed" && task.status !== "cancelled";
/** Late: open and past its due moment. */
export const isLate = (task: Pick<Task, "dueAt" | "status">, timeZone: string, at = now()): boolean => { const due = dueMoment(task.dueAt, timeZone); return isOpen(task) && due !== null && at > due; };
/** The one-line task format every task list shares: status, due, assignee, id prefix, title, and the checklist progress such as ` (2/5)` when the description has one (a task from `loadTasks` needs `readInFull` first). */
export const taskLine = (t: Task, timeZone: string, at = now()) => `${t.status} | ${t.dueAt ? `due ${t.dueAt}${isLate(t, timeZone, at) ? ", late" : ""}` : "no due date"} | ${assigneeLabel(t.assignedTo)} | ${t.id.slice(0, 8)} | ${t.title}${checklistSuffix(t.description)}`;

export const slug = (title: string) => title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "task";

/** Frontmatter is one `key: JSON value` per line, which is also valid YAML; hand-edited bare values (status: pending) are accepted too. */
export function render(t: Task) {
  const q = JSON.stringify;
  return `---\nid: ${q(t.id)}\ntitle: ${q(t.title)}\nstatus: ${q(t.status)}\npriority: ${q(t.priority)}\nassignedTo: ${renderAssignee(t.assignedTo)}\ndueAt: ${q(t.dueAt)}\ncreatedBy: ${q(t.createdBy)}\ncreatedByName: ${q(t.createdByName)}\ncreatedAt: ${q(t.createdAt)}\nupdatedAt: ${q(t.updatedAt)}\n---\n${renderBody(t.description, t.notes)}`;
}
/** A task file, or null when it is not a valid one: a broken file is skipped, never trusted. */
export function parseTask(text: string): Task | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const f: Record<string, any> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const raw = line.slice(i + 1).trim();
    try { f[line.slice(0, i).trim()] = JSON.parse(raw); } catch { f[line.slice(0, i).trim()] = raw; }
  }
  const { id, title, status, priority } = f;
  const validDate = (v: unknown) => typeof v === "string" && !!v && !Number.isNaN(Date.parse(v));
  if (typeof id !== "string" || !/^[0-9a-f-]{8,36}$/i.test(id) || typeof title !== "string" || !title.trim() || !STATUSES.includes(status) || !PRIORITIES.includes(priority) || !validDate(f.createdAt) || !validDate(f.updatedAt)) return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const dueAt = str(f.dueAt), { description, notes } = parseBody(m[2]!);
  return { id, title, description, status, priority, assignedTo: parseAssignee(f.assignedTo), dueAt: dueAt && (DATE_ONLY.test(dueAt) || DATE_TIME.test(dueAt)) ? dueAt : null, createdBy: str(f.createdBy), createdByName: str(f.createdByName), createdAt: str(f.createdAt) ?? "", updatedAt: str(f.updatedAt) ?? "", notes };
}

export interface Found { path: string; version: string; task: Task }
const MAX_DEPTH = 8;
/** Every valid task in the tasks/ folders this turn can see: in a DM only the person's Personal tasks. ponytail: reads every task file per call; add an index when that gets slow. */
export async function loadTasks(store: WorkspaceStore, ctx: Pick<SkillContext, "tenantId" | "guildId" | "channelId" | "parentChannelId" | "userId">, shortId?: string): Promise<Found[]> {
  // A private thread's own folder sits inside its parent's and holds no tasks: a thread's tasks are its parent's.
  const { thread: _, ...roots } = visibleRoots(ctx);
  return walkTasks(store, ctx.tenantId, (roots.dm ? [roots.dm] : Object.values(roots)).map((root) => `${root}/tasks`), shortId);
}

/** Every valid task in `folders` (tasks/ folders, at any depth), frontmatter only. Kept material never sits there, so it can never crowd tasks out. */
export async function walkTasks(store: WorkspaceStore, tenantId: string, folders: readonly string[], shortId?: string): Promise<Found[]> {
  const out: Found[] = [];
  for (const folder of folders) for (const { path } of await store.files(tenantId, folder)) {
    if (!path.endsWith(".md")) continue;
    const file = await store.readFrontmatter(tenantId, path).catch(() => null);
    const task = file && parseTask(file.content);
    if (task && (!shortId || task.id.replace(/-/g, "").startsWith(shortId))) out.push({ path, version: file.version, task });
  }
  return out;
}

/** All valid task files in a tenant, used by the tenant-wide REST API and migration tooling. */
export async function loadAllTasks(store: WorkspaceStore, tenantId: string): Promise<Found[]> {
  const out: Found[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const e of await store.list(tenantId, dir)) {
      const name = e.path.split("/").pop()!;
      if (name.startsWith(".")) continue;
      if (e.type === "dir") { if (depth < MAX_DEPTH + 4) await walk(e.path, depth + 1); continue; }
      if (!name.endsWith(".md")) continue;
      const file = await store.readFrontmatter(tenantId, e.path).catch(() => null);
      const task = file && parseTask(file.content);
      if (task) out.push({ path: e.path, version: file.version, task });
    }
  };
  await walk("", 0);
  return out;
}

/**
 * The tasks `loadTasks` found, read in full (description and notes) so their task lines carry checklist progress.
 * Read only the tasks about to be printed: `loadTasks` reads frontmatter alone to keep lists cheap. A file that no longer reads keeps its frontmatter task.
 */
export async function readInFull(store: WorkspaceStore, tenantId: string, found: readonly Pick<Found, "path" | "task">[]): Promise<Task[]> {
  return Promise.all(found.map(async (f) => {
    const file = await store.read(tenantId, f.path).catch(() => null);
    return (file && parseTask(file.content)) || f.task;
  }));
}
