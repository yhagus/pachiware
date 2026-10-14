import type { SkillModule, SkillContext } from "../types.js";
import { visibleRoots } from "../workspace/paths.js";
import { workspaceStore, WorkspaceConflict, type WorkspaceStore } from "../workspace/store.js";
import { labelFolder } from "./workspace.js";
import { assigneeLabel, assigneeMatches, parseAssignee, renderAssignee, type Assignee } from "./assignee.js";
import { DEFAULT_TIMEZONE, now, offsetText, today, wallClock, zoneOffset, zonedTime } from "../clock.js";

const DUE_AT_HINT = "Due date: YYYY-MM-DD (the whole day), or a date-time such as 2026-03-06T15:00 in the place's time zone or with an offset (2026-03-06T15:00+07:00)";

export const taskManagementSkill: SkillModule = {
  id: "task_management",
  name: "Task Management",
  description: "Create, view, update status, assign, and set due dates of tasks kept as Markdown files in the Workspace.",
  capabilities: ["tasks"],
  allowedScopes: ["tenant"],
  toolPolicy: {
    createTask: { effect: "write", requiresConfirmation: false },
    listTasks: { effect: "read" },
    updateTaskStatus: { effect: "write", requiresConfirmation: false },
    assignTask: { effect: "write", requiresConfirmation: false },
    setTaskDueDate: { effect: "write", requiresConfirmation: false },
    editTask: { effect: "write", requiresConfirmation: false },
    addProgressNote: { effect: "write", requiresConfirmation: false },
    showTask: { effect: "read" },
  },
  tools: [
    {
      name: "createTask",
      description: "Creates a new task, filed in the current channel's folder.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short, descriptive title of the task" },
          description: { type: "string", description: "Detailed description of the task requirements" },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "urgent"],
            description: "Task priority level (default: medium)",
          },
          assignedTo: { type: "string", description: "Optional name or ID of the assignee" },
          dueAt: { type: "string", description: DUE_AT_HINT },
          discordChannelId: { type: "string", description: "Legacy channel ID; the current turn's channel determines the Workspace folder" },
        },
        required: ["title"],
      },
    },
    {
      name: "listTasks",
      description: "Lists tasks filtered by status, assignee, or channel.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "cancelled", "all"],
            description: "Filter by status (default: every status except cancelled; all includes cancelled tasks)",
          },
          assignedTo: { type: "string", description: "Filter by assignee: a name in any letter case, or a member's ID or mention" },
          query: { type: "string", description: "Words to find in the title or description, any letter case; a task must contain every word. Use it to find a task the person names that is not among the active tasks shown" },
          dueAfter: { type: "string", description: "Only tasks due at or after this date (YYYY-MM-DD, from the start of that day) or date-time; tasks without a due date are left out" },
          dueBefore: { type: "string", description: "Only tasks due at or before this date (YYYY-MM-DD, to the end of that day) or date-time; tasks without a due date are left out" },
          late: { type: "boolean", description: "true: only tasks past their due date and not completed or cancelled; false: only tasks that are not late" },
          limit: { type: "number", description: "Max number of tasks to return (default: 20)" },
        },
      },
    },
    {
      name: "updateTaskStatus",
      description: "Updates the status of a specific task by ID. Cancelling keeps the task on record; it is no longer active or late.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The UUID of the task to update" },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "cancelled"],
            description: "The new task status",
          },
          reason: { type: "string", description: "Only when cancelling: the reason the person gave, kept as a Progress note. Leave it out when they gave none; never ask for one" },
        },
        required: ["taskId", "status"],
      },
    },
    {
      name: "assignTask",
      description: "Assigns or reassigns a task to an individual.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The UUID of the task" },
          assignedTo: { type: "string", description: "Username or identifier of the assignee" },
        },
        required: ["taskId", "assignedTo"],
      },
    },
    {
      name: "setTaskDueDate",
      description: "Sets or clears the due date of a task.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The UUID of the task" },
          dueAt: { type: "string", description: `${DUE_AT_HINT}; null or empty clears it` },
        },
        required: ["taskId"],
      },
    },
    {
      name: "editTask",
      description: "Changes a task's title, description, or priority. Fields left out stay as they are.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The UUID of the task" },
          title: { type: "string", description: "The new title" },
          description: { type: "string", description: "The new description, replacing the old one; empty clears it" },
          priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "The new priority" },
        },
        required: ["taskId"],
      },
    },
    {
      name: "addProgressNote",
      description: "Adds a Progress note to a task: a dated line with the reporter's name saying how the work is going. Notes accumulate below the description and never replace it.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The UUID of the task" },
          text: { type: "string", description: "What was reported, in one line" },
        },
        required: ["taskId", "text"],
      },
    },
    {
      name: "showTask",
      description: "Shows one task in full: its task line, its description, its three latest Progress notes, and how many older notes it has.",
      parameters: {
        type: "object",
        properties: { taskId: { type: "string", description: "The UUID of the task" } },
        required: ["taskId"],
      },
    },
  ],
  handlers: {
    createTask: async (args: { title: string; description?: string; priority?: Priority; assignedTo?: string; dueAt?: string | null; discordChannelId?: string }, ctx: SkillContext) => {
      checkTitle(args.title);
      if (args.priority !== undefined && !PRIORITIES.includes(args.priority)) throw new Error("Invalid task priority");
      const dueAt = dueAtArg(args.dueAt, zoneOf(ctx));
      const roots = visibleRoots(ctx), home = roots.channel ?? roots.dm ?? roots.tenant!;
      const at = today().toISOString(), id = crypto.randomUUID();
      const task: Task = { id, title: args.title.trim(), description: args.description?.trim() || null, status: "pending", priority: args.priority ?? "medium", assignedTo: parseAssignee(args.assignedTo), dueAt, createdBy: ctx.userId ?? null, createdByName: ctx.userName ?? null, createdAt: at, updatedAt: at };
      await workspaceStore().write(ctx.tenantId, `${home}/tasks/${slug(task.title)}-${id.slice(0, 8)}.md`, render(task));
      await labelFolder(ctx, roots.channel ? "channel" : roots.guild ? "guild" : roots.dm ? "dm" : "");
      if (roots.channel) await labelFolder(ctx, "guild");
      try { if (!(await workspaceStore().read(ctx.tenantId, `${home}/tasks/.name`))) await workspaceStore().write(ctx.tenantId, `${home}/tasks/.name`, "Tasks"); } catch {}
      return { success: true, message: `Task "${task.title}" created successfully with ID ${id}.`, task };
    },

    listTasks: async (args: { status?: Status | "all"; assignedTo?: string; query?: string; dueAfter?: string; dueBefore?: string; late?: boolean | string; limit?: number }, ctx: SkillContext) => {
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 20)), zone = zoneOf(ctx), at = now();
      const after = dueBound(args.dueAfter, zone, "start"), before = dueBound(args.dueBefore, zone, "end");
      const late = args.late === undefined || args.late === null ? undefined : args.late === true || args.late === "true";
      const byDue = after !== undefined || before !== undefined || late !== undefined;
      const store = workspaceStore(), tasks = await loadTasks(store, ctx);
      const found = (args.query ? await matching(store, ctx.tenantId, tasks, args.query) : tasks.map((f) => f.task))
        .map((t) => ({ ...t, due: dueMoment(t.dueAt, zone), late: isLate(t, zone, at) }))
        .filter((t) => (args.status === "all" || (args.status ? t.status === args.status : t.status !== "cancelled")) && (!args.assignedTo || assigneeMatches(t.assignedTo, args.assignedTo)))
        .filter((t) => (after === undefined || (t.due !== null && t.due >= after)) && (before === undefined || (t.due !== null && t.due <= before)) && (late === undefined || t.late === late))
        .sort((a, b) => (byDue ? (a.due ?? Infinity) - (b.due ?? Infinity) || a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)))
        .map(({ due: _, ...t }) => t);
      return { total: Math.min(found.length, limit), tasks: found.slice(0, limit) };
    },

    updateTaskStatus: async (args: { taskId: string; status: Status; reason?: string | null }, ctx: SkillContext) => {
      if (!STATUSES.includes(args.status)) throw new Error("Invalid task status");
      const reason = args.status === "cancelled" && typeof args.reason === "string" && args.reason.trim() ? progressNote(ctx, `Cancelled: ${args.reason}`) : null;
      const updated = await change(ctx, args.taskId, (t) => ({ ...t, status: args.status, ...(reason && { notes: [...(t.notes ?? []), reason] }) }));
      return { success: true, message: `Task "${updated.title}" status changed to ${updated.status}.`, task: updated, ...(reason && { note: noteLine(reason) }) };
    },

    assignTask: async (args: { taskId: string; assignedTo: string }, ctx: SkillContext) => {
      if (typeof args.assignedTo !== "string" || !args.assignedTo.trim()) throw new Error("assignedTo is required");
      const assignedTo = parseAssignee(args.assignedTo);
      const updated = await change(ctx, args.taskId, (t) => ({ ...t, assignedTo }));
      return { success: true, message: `Task "${updated.title}" assigned to @${assigneeLabel(updated.assignedTo)}.`, task: updated };
    },

    setTaskDueDate: async (args: { taskId: string; dueAt?: string | null }, ctx: SkillContext) => {
      const dueAt = dueAtArg(args.dueAt, zoneOf(ctx));
      const updated = await change(ctx, args.taskId, (t) => ({ ...t, dueAt }));
      return { success: true, message: dueAt ? `Task "${updated.title}" is due ${dueAt}.` : `Task "${updated.title}" has no due date now.`, task: updated };
    },

    editTask: async (args: { taskId: string; title?: string; description?: string | null; priority?: Priority }, ctx: SkillContext) => {
      if (args.title === undefined && args.description === undefined && args.priority === undefined) throw new Error("Give a new title, description, or priority");
      if (args.title !== undefined) checkTitle(args.title);
      if (args.priority !== undefined && !PRIORITIES.includes(args.priority)) throw new Error("Invalid task priority");
      const updated = await change(ctx, args.taskId, (t) => ({
        ...t,
        ...(args.title !== undefined && { title: args.title.trim() }),
        ...(args.description !== undefined && { description: typeof args.description === "string" ? args.description.trim() || null : null }),
        ...(args.priority !== undefined && { priority: args.priority }),
      }));
      return { success: true, message: `Task "${updated.title}" updated.`, task: updated };
    },

    addProgressNote: async (args: { taskId: string; text: string }, ctx: SkillContext) => {
      const note = progressNote(ctx, args.text);
      const updated = await change(ctx, args.taskId, (t) => ({ ...t, notes: [...(t.notes ?? []), note] }));
      return { success: true, message: `Progress note added to "${updated.title}".`, note: noteLine(note) };
    },

    showTask: async (args: { taskId: string }, ctx: SkillContext) => {
      const task = await readTask(ctx, args.taskId), notes = task.notes ?? [];
      return { task: taskLine(task, zoneOf(ctx)), description: task.description, notes: notes.slice(-LATEST_NOTES).map(noteLine), olderNotes: Math.max(0, notes.length - LATEST_NOTES) };
    },
  },
};

function checkTitle(title: unknown): asserts title is string {
  if (typeof title !== "string" || !title.trim()) throw new Error("Task title is required");
  if (title.length > 200) throw new Error("Task title is too long (max 200 characters)");
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/, DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const zoneOf = (ctx: Pick<SkillContext, "timezone">) => ctx.timezone ?? DEFAULT_TIMEZONE;

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
function dueAtArg(value: unknown, timeZone: string): string | null {
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
function dueBound(value: unknown, timeZone: string, edge: "start" | "end"): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const dueAt = normalizeDueAt(value, timeZone);
  if (dueAt === null) throw new Error(`Invalid ${edge === "start" ? "dueAfter" : "dueBefore"} "${String(value).slice(0, 40)}": use YYYY-MM-DD or a date-time`);
  return (edge === "start" && DATE_ONLY.test(dueAt) ? zonedTime(timeZone, `${dueAt}T00:00`) : dueMoment(dueAt, timeZone))!;
}
/** Open: still to be done, so neither completed nor cancelled. Only open tasks are active, late, in the turn context, or in the Digest. */
export const isOpen = (task: Pick<Task, "status">): boolean => task.status !== "completed" && task.status !== "cancelled";
/** Late: open and past its due moment. */
export const isLate = (task: Pick<Task, "dueAt" | "status">, timeZone: string, at = now()): boolean => { const due = dueMoment(task.dueAt, timeZone); return isOpen(task) && due !== null && at > due; };
/** The one-line task format every task list shares: status, due, assignee, id prefix, title. */
export const taskLine = (t: Task, timeZone: string, at = now()) => `${t.status} | ${t.dueAt ? `due ${t.dueAt}${isLate(t, timeZone, at) ? ", late" : ""}` : "no due date"} | ${assigneeLabel(t.assignedTo)} | ${t.id.slice(0, 8)} | ${t.title}`;

export const STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
type Status = (typeof STATUSES)[number];
type Priority = (typeof PRIORITIES)[number];
export interface Task { id: string; title: string; description: string | null; status: Status; priority: Priority; assignedTo: Assignee | null; dueAt: string | null; createdBy: string | null; createdByName: string | null; createdAt: string; updatedAt: string; notes?: ProgressNote[] }

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

/** A Progress note: who reported what about a task, and on which date (YYYY-MM-DD in the place's time zone). */
export interface ProgressNote { on: string; by: string; text: string }
export const NOTES_HEADING = "## Progress notes";
const NOTE_LINE = /^- (\d{4}-\d{2}-\d{2}) (.+?): (.*)$/;
/** One note as the task file and the detail view print it: `- 2026-03-10 Alice: called the venue`. */
export const noteLine = (n: ProgressNote) => `- ${n.on} ${n.by}: ${n.text}`;
/** A note by the person speaking this turn, dated today in the place's time zone. Text and name are kept to one line so the file reads back the same. */
export function progressNote(ctx: Pick<SkillContext, "userName" | "userId" | "timezone">, text: unknown): ProgressNote {
  const line = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!line) throw new Error("Progress note text is required");
  if (line.length > 1000) throw new Error("Progress note is too long (max 1000 characters)");
  const w = wallClock(zoneOf(ctx)), pad = (n: number) => String(n).padStart(2, "0");
  const by = (ctx.userName || ctx.userId || "someone").replace(/:\s+/g, " ").replace(/\s+/g, " ").trim();
  return { on: `${w.year}-${pad(w.month)}-${pad(w.day)}`, by, text: line };
}
/**
 * A task body split into its description and its Progress notes. The notes section is the last `## Progress notes` heading
 * when every line after it is a note (a line that is not continues the note above); otherwise the whole body is the description.
 */
export function parseBody(body: string): { description: string | null; notes: ProgressNote[] } {
  const lines = body.split(/\r?\n/), at = lines.findLastIndex((l) => l.trim() === NOTES_HEADING);
  const notes: ProgressNote[] = [];
  for (const line of at < 0 ? [] : lines.slice(at + 1).map((l) => l.trim()).filter(Boolean)) {
    const m = NOTE_LINE.exec(line);
    if (m) notes.push({ on: m[1]!, by: m[2]!, text: m[3]! });
    else if (notes.length) notes.at(-1)!.text += ` ${line}`;
    else return { description: body.trim() || null, notes: [] };
  }
  return { description: (at < 0 ? body : lines.slice(0, at).join("\n")).trim() || null, notes };
}
/** The body a task file stores: the description, then the notes section when there are notes. */
export function renderBody(description: string | null, notes: readonly ProgressNote[] = []): string {
  const section = notes.length ? `${NOTES_HEADING}\n${notes.map(noteLine).join("\n")}\n` : "";
  return description ? `${description}\n${section && `\n${section}`}` : section || "\n";
}

interface Found { path: string; version: string; task: Task }
const MAX_FILES = 500, MAX_DEPTH = 8;
/** Every valid task under the folders this turn can see. ponytail: reads files per call; add an index when a Workspace outgrows MAX_FILES task files. */
export async function loadTasks(store: WorkspaceStore, ctx: Pick<SkillContext, "tenantId" | "guildId" | "channelId" | "parentChannelId" | "userId">, shortId?: string): Promise<Found[]> {
  const out: Found[] = [];
  let seen = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const e of await store.list(ctx.tenantId, dir)) {
      if (seen >= MAX_FILES) return;
      const name = e.path.split("/").pop()!;
      if (e.type === "dir") { if (depth < MAX_DEPTH && !name.startsWith(".")) await walk(e.path, depth + 1); continue; }
      if (!name.endsWith(".md")) continue;
      seen++;
      const file = await store.readFrontmatter(ctx.tenantId, e.path).catch(() => null);
      const task = file && parseTask(file.content);
      if (task && (!shortId || task.id.replace(/-/g, "").startsWith(shortId))) out.push({ path: e.path, version: file.version, task });
    }
  };
  for (const root of Object.values(visibleRoots(ctx))) await walk(root, 0);
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

/** The tasks whose title or description contains every word of `query`, ignoring case. Read in full: `loadTasks` reads frontmatter only. */
async function matching(store: WorkspaceStore, tenantId: string, found: Found[], query: string): Promise<Task[]> {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean), out: Task[] = [];
  for (const f of found) {
    const file = await store.read(tenantId, f.path).catch(() => null), task = file && parseTask(file.content);
    const text = task ? `${task.title}\n${task.description ?? ""}`.toLowerCase() : "";
    if (task && words.every((w) => text.includes(w))) out.push(task);
  }
  return out;
}

const LATEST_NOTES = 3;
/** One task by id or id prefix among the folders this turn can see, read in full (description and notes). */
async function readTask(ctx: SkillContext, taskId: string): Promise<Task> {
  if (typeof taskId !== "string" || !/^[0-9a-f-]{8,36}$/.test(taskId)) throw new Error(`Task with ID ${taskId} not found.`);
  const store = workspaceStore(), [hit] = (await loadTasks(store, ctx, taskId.slice(0, 8))).filter((f) => f.task.id.startsWith(taskId));
  const file = hit && (await store.read(ctx.tenantId, hit.path).catch(() => null)), task = file && parseTask(file.content);
  if (!task) throw new Error(`Task with ID ${taskId} not found.`);
  return task;
}

async function change(ctx: SkillContext, taskId: string, edit: (t: Task) => Task): Promise<Task> {
  if (typeof taskId !== "string" || !/^[0-9a-f-]{8,36}$/.test(taskId)) throw new Error(`Task with ID ${taskId} not found.`);
  const store = workspaceStore(), [hit] = (await loadTasks(store, ctx, taskId.slice(0, 8))).filter((f) => f.task.id.startsWith(taskId));
  if (!hit) throw new Error(`Task with ID ${taskId} not found.`);
  const current = await store.read(ctx.tenantId, hit.path).catch(() => null), parsed = current && parseTask(current.content);
  if (!current || !parsed) throw new Error(`Task with ID ${taskId} not found.`);
  const next = { ...edit(parsed), updatedAt: today().toISOString() };
  try { await store.write(ctx.tenantId, hit.path, render(next), hit.version); }
  catch (e) { if (e instanceof WorkspaceConflict) throw new Error("The task was changed by someone else just now. Try again."); throw e; }
  return next;
}
