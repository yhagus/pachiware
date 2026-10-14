import type { SkillModule, SkillContext, DiscordClientAdapter, FoundChannel } from "../types.js";
import { safeId, visibleRoots } from "../workspace/paths.js";
import { workspaceStore, WorkspaceConflict, type WorkspaceStore } from "../workspace/store.js";
import { labelFolder } from "./workspace.js";
import { ambiguousAssignee, assigneeFilter, assigneeLabel, linkAssignee, nameOnlyNote, parseAssignee, renderAssignee, resolveAssignee, isAssignee, type Assignee } from "./assignee.js";
import { checklistSuffix, checklistOf, checklistLine, tickItem } from "./checklist.js";
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
    tickChecklistItem: { effect: "write", requiresConfirmation: false },
    moveTask: { effect: "write", requiresConfirmation: false },
  },
  tools: [
    {
      name: "createTask",
      description: "Creates a new task, filed in the current channel's project. In a DM it is the person's Personal task, unless they name a project channel to file it in.",
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
          assignedTo: { type: "string", description: "Optional assignee: a mention, \"me\" for the asker, or a name (matched to a server member, else recorded by name only). A Personal task takes only the asker or a name" },
          channel: { type: "string", description: "Only in a DM, when the person names a project channel to file the task in (\"catat di #laporan-q4\"): the channel as they wrote it, #name or <#id>. Leave it out for a Personal task" },
          dueAt: { type: "string", description: DUE_AT_HINT },
          discordChannelId: { type: "string", description: "Legacy channel ID; the current turn's channel determines the Workspace folder" },
        },
        required: ["title"],
      },
    },
    {
      name: "listTasks",
      description: "Lists tasks filtered by status, assignee, or channel. Each task comes with `line`, its task line to print as it is; a title ending in (2/5) means two of five checklist items are done. Scope mine or delegated returns `groups`, one per channel, soonest due first, at most twenty tasks in all; `total` counts every match and `more` how many were left out.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["here", "mine", "delegated"],
            description: "here (default): this channel's tasks. mine: tasks assigned to the asker in every channel of this server they can view. delegated: tasks the asker created that are assigned to someone else, in those same channels",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "cancelled", "all"],
            description: "Filter by status (default: every status except cancelled; all includes cancelled tasks)",
          },
          assignedTo: { type: "string", description: "Filter by assignee: a mention, \"me\", a member's ID, or a display name or username in any letter case" },
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
          assignedTo: { type: "string", description: "The assignee: a mention, \"me\" for the asker, or a name (matched to a server member, else recorded by name only)" },
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
      description: "Shows one task in full: its task line, its description, every checklist item with its state and position, its three latest Progress notes, and how many older notes it has.",
      parameters: {
        type: "object",
        properties: { taskId: { type: "string", description: "The UUID of the task" } },
        required: ["taskId"],
      },
    },
    {
      name: "tickChecklistItem",
      description: "Ticks or unticks one item of the Markdown checklist (- [ ] / - [x] lines) in a task's description.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The UUID of the task" },
          item: { type: "string", description: "The item's text, or a part of it only that item contains, or its position counting from 1" },
          done: { type: "boolean", description: "true ticks the item (default), false unticks it" },
        },
        required: ["taskId", "item"],
      },
    },
    {
      name: "moveTask",
      description: "Moves a task to another project channel, keeping its id and fields and adding a Progress note saying where it came from. From a DM it moves one of the person's Personal tasks into a project. A task only ever moves into a project channel, never into a DM.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string", description: "The UUID of the task" },
          channel: { type: "string", description: "The project channel to move it to, as the person wrote it: #name or <#id>" },
        },
        required: ["taskId", "channel"],
      },
    },
  ],
  handlers: {
    createTask: async (args: { title: string; description?: string; priority?: Priority; assignedTo?: string; channel?: string; dueAt?: string | null; discordChannelId?: string }, asker: SkillContext) => {
      checkTitle(args.title);
      if (args.priority !== undefined && !PRIORITIES.includes(args.priority)) throw new Error("Invalid task priority");
      const dueAt = dueAtArg(args.dueAt, zoneOf(asker));
      const ctx = typeof args.channel === "string" && args.channel.trim() ? await filingPlace(asker, args.channel) : asker;
      const who = typeof args.assignedTo === "string" && args.assignedTo.trim() ? await resolveAssignee(args.assignedTo, ctx) : null;
      if (who && "candidates" in who) return ambiguousAssignee(args.assignedTo!, who.candidates);
      const roots = visibleRoots(ctx), home = roots.channel ?? roots.dm ?? roots.tenant!;
      if (who && !who.nameOnly) await mustHold(ctx, `${home}/tasks/`, who.assignee);
      const at = today().toISOString(), id = crypto.randomUUID();
      const task: Task = { id, title: args.title.trim(), description: args.description?.trim() || null, status: "pending", priority: args.priority ?? "medium", assignedTo: who?.assignee ?? null, dueAt, createdBy: ctx.userId ?? null, createdByName: ctx.userName ?? null, createdAt: at, updatedAt: at };
      await workspaceStore().write(ctx.tenantId, `${home}/tasks/${slug(task.title)}-${id.slice(0, 8)}.md`, render(task));
      await labelFolder(ctx, roots.channel ? "channel" : roots.guild ? "guild" : roots.dm ? "dm" : "");
      if (roots.channel) await labelFolder(ctx, "guild");
      try { if (!(await workspaceStore().read(ctx.tenantId, `${home}/tasks/.name`))) await workspaceStore().write(ctx.tenantId, `${home}/tasks/.name`, "Tasks"); } catch {}
      return { success: true, message: `Task "${task.title}" created successfully with ID ${id}.${who?.nameOnly ? nameOnlyNote(who.assignee) : ""}`, task };
    },

    listTasks: async (args: { scope?: Scope; status?: Status | "all"; assignedTo?: string; query?: string; dueAfter?: string; dueBefore?: string; late?: boolean | string; limit?: number }, ctx: SkillContext) => {
      if (args.scope !== undefined && args.scope !== null && !SCOPES.includes(args.scope)) throw new Error(`Invalid scope "${String(args.scope).slice(0, 40)}": use here, mine, or delegated`);
      const scope: Scope = args.scope ?? "here";
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 20)), zone = zoneOf(ctx), at = now();
      const after = dueBound(args.dueAfter, zone, "start"), before = dueBound(args.dueBefore, zone, "end");
      const late = args.late === undefined || args.late === null ? undefined : args.late === true || args.late === "true";
      const byDue = after !== undefined || before !== undefined || late !== undefined;
      const assigned = args.assignedTo ? await assigneeFilter(args.assignedTo, ctx) : () => true;
      const store = workspaceStore(), sources = scope === "here" ? null : await scopeSources(store, ctx);
      const tasks = sources ? await tasksIn(store, ctx.tenantId, sources) : await loadTasks(store, ctx), whose = inScope(scope, ctx);
      const found = (args.query ? await matching(store, ctx.tenantId, tasks, args.query) : tasks)
        .map((f) => ({ f, t: f.task, due: dueMoment(f.task.dueAt, zone), late: isLate(f.task, zone, at) }))
        .filter(({ f, t }) => (args.status === "all" || (args.status ? t.status === args.status : t.status !== "cancelled")) && assigned(t.assignedTo) && whose(f))
        .filter((x) => (after === undefined || (x.due !== null && x.due >= after)) && (before === undefined || (x.due !== null && x.due <= before)) && (late === undefined || x.late === late))
        .sort((a, b) => (byDue ? (a.due ?? Infinity) - (b.due ?? Infinity) || a.t.createdAt.localeCompare(b.t.createdAt) : b.t.createdAt.localeCompare(a.t.createdAt)));
      if (sources) {
        const groups = groupTasks(found.map((x) => x.f), sources, zone), cap = Math.min(MAX_SCOPED, limit);
        let room = cap;
        const kept = groups.map((g) => { const tasks = g.tasks.slice(0, room); room -= tasks.length; return { source: g.source, tasks }; }).filter((g) => g.tasks.length);
        const full = await readInFull(store, ctx.tenantId, kept.flatMap((g) => g.tasks)), shown = full.length, more = found.length - shown;
        let i = 0;
        return {
          scope, total: found.length, shown,
          ...(more > 0 && { more, note: `${more} more not shown. Say how many more there are; a status, query, or due date filter narrows the list to show them.` }),
          groups: kept.map((g) => ({ group: g.source.label, ...(g.source.channelId && { channelId: g.source.channelId }), tasks: g.tasks.map(() => { const t = full[i++]!; return { ...t, late: isLate(t, zone, at), line: taskLine(t, zone, at) }; }) })),
        };
      }
      // Only the tasks returned are read in full, for the checklist progress on their line; query hits already are.
      const shown = found.slice(0, limit), full = args.query ? shown.map((x) => x.t) : await readInFull(store, ctx.tenantId, shown.map((x) => x.f));
      return { total: shown.length, tasks: shown.map((x, i) => ({ ...x.t, late: x.late, line: taskLine(full[i]!, zone, at) })) };
    },

    updateTaskStatus: async (args: { taskId: string; status: Status; reason?: string | null }, ctx: SkillContext) => {
      if (!STATUSES.includes(args.status)) throw new Error("Invalid task status");
      const reason = args.status === "cancelled" && typeof args.reason === "string" && args.reason.trim() ? progressNote(ctx, `Cancelled: ${args.reason}`) : null;
      const updated = await change(ctx, args.taskId, (t) => ({ ...t, status: args.status, ...(reason && { notes: [...(t.notes ?? []), reason] }) }));
      return { success: true, message: `Task "${updated.title}" status changed to ${updated.status}.`, task: updated, ...(reason && { note: noteLine(reason) }) };
    },

    assignTask: async (args: { taskId: string; assignedTo: string }, ctx: SkillContext) => {
      if (typeof args.assignedTo !== "string" || !args.assignedTo.trim()) throw new Error("assignedTo is required");
      const who = await resolveAssignee(args.assignedTo, ctx);
      if ("candidates" in who) return ambiguousAssignee(args.assignedTo, who.candidates);
      const updated = await change(ctx, args.taskId, async (t, path) => {
        if (!who.nameOnly) await mustHold(ctx, path, who.assignee);
        return { ...t, assignedTo: who.assignee };
      });
      return { success: true, message: `Task "${updated.title}" assigned to @${assigneeLabel(updated.assignedTo)}.${who.nameOnly ? nameOnlyNote(who.assignee) : ""}`, task: updated };
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
      return { task: taskLine(task, zoneOf(ctx)), description: task.description, checklist: checklistOf(task.description).map((item, i) => checklistLine(item, i + 1)), notes: notes.slice(-LATEST_NOTES).map(noteLine), olderNotes: Math.max(0, notes.length - LATEST_NOTES) };
    },

    tickChecklistItem: async (args: { taskId: string; item: string | number; done?: boolean | string }, ctx: SkillContext) => {
      const done = args.done !== false && args.done !== "false";
      let ticked!: ReturnType<typeof tickItem>;
      const updated = await change(ctx, args.taskId, (t) => { ticked = tickItem(t.description, args.item, done); return { ...t, description: ticked.description }; });
      return { success: true, message: `${done ? "Ticked" : "Unticked"} "${ticked.item.text}" on "${updated.title}" (${ticked.done}/${ticked.total}).` };
    },

    moveTask: async (args: { taskId: string; channel: string }, ctx: SkillContext) => {
      const moved = await move(ctx, args.taskId, args.channel);
      return { success: true, message: `Task "${moved.task.title}" moved from ${moved.from} to #${moved.to}.`, note: noteLine(moved.task.notes!.at(-1)!) };
    },
  },
};

/** The turn as if it were in a project channel `findProject` found: still the asker's turn, in that channel's guild. */
function projectPlace(ctx: SkillContext, channel: FoundChannel): SkillContext {
  const { id, name, guildId, guildName } = channel;
  return { ...ctx, guildId, guildName, channelId: id, channelName: name, parentChannelId: undefined, discord: ctx.discord?.forGuild(guildId) };
}

/** The turn as if it were in the project channel a person named from a DM: still their turn, in that channel's guild. Throws, creating nothing, when they cannot file there. */
async function filingPlace(ctx: SkillContext, channel: string): Promise<SkillContext> {
  if (ctx.guildId) throw new Error("Naming a channel to file a task in works from a DM. Here, the task belongs to this channel; ask in the other channel instead. Nothing was created.");
  const found = await findProject(ctx, channel);
  if (!found.ok) throw new Error(`${found.why} Nothing was created.`);
  return projectPlace(ctx, found.channel);
}

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
/** The one-line task format every task list shares: status, due, assignee, id prefix, title, and the checklist progress such as ` (2/5)` when the description has one (a task from `loadTasks` needs `readInFull` first). */
export const taskLine = (t: Task, timeZone: string, at = now()) => `${t.status} | ${t.dueAt ? `due ${t.dueAt}${isLate(t, timeZone, at) ? ", late" : ""}` : "no due date"} | ${assigneeLabel(t.assignedTo)} | ${t.id.slice(0, 8)} | ${t.title}${checklistSuffix(t.description)}`;

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

export interface Found { path: string; version: string; task: Task }
const MAX_FILES = 500, MAX_DEPTH = 8;
/** Every valid task under the folders this turn can see: in a DM only the person's Personal tasks. ponytail: reads files per call; add an index when a Workspace outgrows MAX_FILES task files. */
export async function loadTasks(store: WorkspaceStore, ctx: Pick<SkillContext, "tenantId" | "guildId" | "channelId" | "parentChannelId" | "userId">, shortId?: string): Promise<Found[]> {
  const roots = visibleRoots(ctx);
  return walkTasks(store, ctx.tenantId, roots.dm ? [roots.dm] : Object.values(roots), shortId);
}

/** Every valid task under `roots`, frontmatter only, at most MAX_FILES Markdown files in all. */
async function walkTasks(store: WorkspaceStore, tenantId: string, roots: readonly string[], shortId?: string): Promise<Found[]> {
  const out: Found[] = [];
  let seen = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const e of await store.list(tenantId, dir)) {
      if (seen >= MAX_FILES) return;
      const name = e.path.split("/").pop()!;
      if (e.type === "dir") { if (depth < MAX_DEPTH && !name.startsWith(".")) await walk(e.path, depth + 1); continue; }
      if (!name.endsWith(".md")) continue;
      seen++;
      const file = await store.readFrontmatter(tenantId, e.path).catch(() => null);
      const task = file && parseTask(file.content);
      if (task && (!shortId || task.id.replace(/-/g, "").startsWith(shortId))) out.push({ path: e.path, version: file.version, task });
    }
  };
  for (const root of roots) await walk(root, 0);
  return out;
}

/** Which tasks a list covers: `here` is the place's own folders, as the turn sees them; `mine` and `delegated` are views across projects. */
export const SCOPES = ["here", "mine", "delegated"] as const;
export type Scope = (typeof SCOPES)[number];
/** At most this many tasks in a view across projects, so the answer fits in one Discord message. */
export const MAX_SCOPED = 20;

/** A folder whose tasks a view across projects prints as one group under `label`: a project channel (`#name`, with its ids), or any other folder such as a person's Personal tasks. */
export interface TaskSource { label: string; folder: string; guildId?: string; channelId?: string }
export interface TaskGroup { source: TaskSource; tasks: Found[] }

/** The project channels of a guild a person can view: each channel folder of the guild in the Workspace that `channelView` says they see. A channel Discord cannot resolve, or one of another guild, is left out, as is every channel without `discord`. */
export async function viewableProjects(store: WorkspaceStore, tenantId: string, discord: DiscordClientAdapter | undefined, guildId: string, userId: string): Promise<TaskSource[]> {
  if (!discord || !safeId(guildId) || !safeId(userId)) return [];
  const folder = `guilds/${guildId}/channels`, ids = (await store.list(tenantId, folder).catch(() => []))
    .filter((e) => e.type === "dir").map((e) => e.path.split("/").pop()!).filter((id) => !!safeId(id));
  const views = await Promise.all(ids.map((id) => discord.channelView(id, userId).catch(() => null)));
  return ids.flatMap((id, i) => {
    const v = views[i];
    return v?.canView && v.channel?.guildId === guildId ? [{ label: `#${v.channel.name}`, folder: `${folder}/${id}`, guildId, channelId: id }] : [];
  });
}

export const PERSONAL_TASKS = "Personal tasks";
/** The folders a `mine` or `delegated` view of this turn draws from: every project channel of the current guild the asker can view, then the asker's Personal tasks. */
export async function scopeSources(store: WorkspaceStore, ctx: Pick<SkillContext, "tenantId" | "guildId" | "userId" | "discord">): Promise<TaskSource[]> {
  const user = safeId(ctx.userId);
  if (!user) return [];
  const projects = ctx.guildId ? await viewableProjects(store, ctx.tenantId, ctx.discord, ctx.guildId, user) : [];
  return [...projects, { label: PERSONAL_TASKS, folder: `dms/${user}` }];
}

/** Every valid task in the given sources, frontmatter only (`readInFull` the ones printed). */
export const tasksIn = (store: WorkspaceStore, tenantId: string, sources: readonly TaskSource[]) => walkTasks(store, tenantId, sources.map((s) => s.folder));

/** Whether a task belongs to a scope for the asker: `mine` when they are its Assignee or it is one of their Personal tasks, `delegated` when they created it for someone else; `here` keeps every task. */
export function inScope(scope: Scope, asker: Pick<SkillContext, "userId" | "userName">): (f: Pick<Found, "path" | "task">) => boolean {
  const person = { id: asker.userId, names: [asker.userName] };
  if (scope === "mine") return ({ path, task: t }) => isAssignee(t.assignedTo, person) || (!!asker.userId && personalOwnerOf(path) === asker.userId);
  if (scope === "delegated") return ({ task: t }) => !!asker.userId && t.createdBy === asker.userId && !!t.assignedTo && !isAssignee(t.assignedTo, person);
  return () => true;
}

/** Tasks grouped by the source folder they are in, soonest due first within a group (no due date last), and groups ordered by their soonest task, then label. Sources without tasks are left out. */
export function groupTasks(found: readonly Found[], sources: readonly TaskSource[], timeZone: string): TaskGroup[] {
  const due = (f: Found) => dueMoment(f.task.dueAt, timeZone) ?? Infinity;
  const groups = sources.map((source) => ({
    source,
    tasks: found.filter((f) => f.path.startsWith(`${source.folder}/`)).sort((a, b) => due(a) - due(b) || a.task.createdAt.localeCompare(b.task.createdAt)),
  })).filter((g) => g.tasks.length);
  return groups.sort((a, b) => due(a.tasks[0]!) - due(b.tasks[0]!) || a.source.label.localeCompare(b.source.label));
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
async function matching(store: WorkspaceStore, tenantId: string, found: Found[], query: string): Promise<Found[]> {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean), out: Found[] = [];
  for (const f of found) {
    const file = await store.read(tenantId, f.path).catch(() => null), task = file && parseTask(file.content);
    const text = task ? `${task.title}\n${task.description ?? ""}`.toLowerCase() : "";
    if (task && words.every((w) => text.includes(w))) out.push({ ...f, task });
  }
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

const LATEST_NOTES = 3;
/** One task by id or id prefix among the folders this turn can see, read in full (description and notes). */
async function readTask(ctx: SkillContext, taskId: string): Promise<Task> {
  if (typeof taskId !== "string" || !/^[0-9a-f-]{8,36}$/.test(taskId)) throw new Error(`Task with ID ${taskId} not found.`);
  const store = workspaceStore(), [hit] = (await loadTasks(store, ctx, taskId.slice(0, 8))).filter((f) => f.task.id.startsWith(taskId));
  const file = hit && (await store.read(ctx.tenantId, hit.path).catch(() => null)), task = file && parseTask(file.content);
  if (!task) throw new Error(`Task with ID ${taskId} not found.`);
  return task;
}

/** The project channel a task file belongs to, from its path: `guilds/<guild>/channels/<channel>/…`; null for shared and DM folders. */
export function taskChannelOf(path: string): { guildId: string; channelId: string } | null {
  const m = /^guilds\/([\w-]+)\/channels\/([\w-]+)\//.exec(path);
  return m ? { guildId: m[1]!, channelId: m[2]! } : null;
}

/**
 * The project channel a person names (`#laporan-q4`, `laporan-q4`, or `<#id>`), searched across every server the bot shares with them.
 * Fails, saying why, when no such channel is found, when they cannot view it, or when the name fits channels in several servers.
 * The reason ends without saying what was left undone, so each caller adds that ("Nothing was created.").
 */
export async function findProject(ctx: Pick<SkillContext, "userId" | "discord">, text: unknown): Promise<{ ok: true; channel: FoundChannel } | { ok: false; why: string }> {
  const asked = typeof text === "string" ? text.trim().slice(0, 100) : "";
  if (!asked) return { ok: false, why: "Name the project channel." };
  const shown = /^<#[\w-]+>$/.test(asked) ? asked : `#${asked.replace(/^#/, "")}`;
  if (!ctx.discord || !ctx.userId) return { ok: false, why: `Channel ${shown} cannot be looked up here.` };
  const found = await ctx.discord.findChannels(asked, ctx.userId).catch(() => []), viewable = found.filter((c) => c.canView);
  if (viewable.length === 1) return { ok: true, channel: viewable[0]! };
  if (viewable.length > 1) return { ok: false, why: `${shown} names channels in several servers: ${viewable.map((c) => `<#${c.id}> in ${c.guildName}`).join(", ")}. Ask which one is meant, then name it by that mention.` };
  if (found.length) return { ok: false, why: `You cannot view #${found[0]!.name}, so it cannot be used for this task.` };
  return { ok: false, why: `No channel ${shown} was found in the servers you share with the bot.` };
}

/** Whose Personal tasks a task file is, from its path: `dms/<user>/…`; null for project and shared folders. */
export const personalOwnerOf = (path: string): string | null => /^dms\/([\w-]+)\//.exec(path)?.[1] ?? null;

/**
 * Whether an Assignee may hold the task at `path`, and if not, why not, naming the ways out.
 * A Personal task is only ever its own person's or a name-only Assignee's; a project task's member must be able to view its channel.
 * Name-only Assignees, shared folders, and turns without Discord always may.
 */
async function canHold(ctx: SkillContext, path: string, assignee: Assignee): Promise<{ ok: true } | { ok: false; why: string }> {
  const owner = personalOwnerOf(path);
  if (owner) return !assignee.id || assignee.id === owner ? { ok: true } : { ok: false, why: `${assignee.name} cannot be the assignee of a Personal task: only you, or someone known by name only, can. Handing work to another member belongs in a project. Nothing was changed. Name the project channel to file the task there, or keep it for yourself.` };
  const home = taskChannelOf(path);
  if (!home || !assignee.id || !ctx.discord) return { ok: true };
  const view = await ctx.discord.channelView(home.channelId, assignee.id).catch(() => ({ channel: null, canView: false }));
  if (view.canView) return { ok: true };
  const channel = `#${view.channel?.name ?? home.channelId}`;
  return { ok: false, why: `${assignee.name} cannot view ${channel}, so they cannot be this task's assignee. Nothing was changed. Add them to ${channel}, or assign someone else.` };
}

/** Throws `canHold`'s reason when the Assignee may not hold the task at `path`. */
async function mustHold(ctx: SkillContext, path: string, assignee: Assignee) {
  const held = await canHold(ctx, path, assignee);
  if (!held.ok) throw new Error(held.why);
}

async function change(ctx: SkillContext, taskId: string, edit: (t: Task, path: string) => Task | Promise<Task>): Promise<Task> {
  if (typeof taskId !== "string" || !/^[0-9a-f-]{8,36}$/.test(taskId)) throw new Error(`Task with ID ${taskId} not found.`);
  const store = workspaceStore(), [hit] = (await loadTasks(store, ctx, taskId.slice(0, 8))).filter((f) => f.task.id.startsWith(taskId));
  if (!hit) throw new Error(`Task with ID ${taskId} not found.`);
  const current = await store.read(ctx.tenantId, hit.path).catch(() => null), parsed = current && parseTask(current.content);
  if (!current || !parsed) throw new Error(`Task with ID ${taskId} not found.`);
  const edited = await edit(parsed, hit.path);
  // A name-only Assignee the edit kept is linked when its name now matches exactly one member who can view the task's channel.
  const linked = edited.assignedTo === parsed.assignedTo ? await linkAssignee(edited.assignedTo, ctx) : edited.assignedTo;
  const assignedTo = linked !== edited.assignedTo && linked && !(await canHold(ctx, hit.path, linked)).ok ? edited.assignedTo : linked;
  const next = { ...edited, assignedTo, updatedAt: today().toISOString() };
  try { await store.write(ctx.tenantId, hit.path, render(next), hit.version); }
  catch (e) { if (e instanceof WorkspaceConflict) throw new Error("The task was changed by someone else just now. Try again."); throw e; }
  return next;
}

/**
 * Moves a task this turn can see into the project channel `channel` names, adding a Progress note that says where it came from.
 * Refused, with nothing changed, when the asker cannot view the source or the destination, or a member Assignee cannot view the destination.
 * The task is written to its new folder before the old file goes; a source changed meanwhile removes the new file again.
 */
async function move(ctx: SkillContext, taskId: string, channel: string): Promise<{ task: Task; from: string; to: string }> {
  if (typeof taskId !== "string" || !/^[0-9a-f-]{8,36}$/.test(taskId)) throw new Error(`Task with ID ${taskId} not found.`);
  const store = workspaceStore(), [hit] = (await loadTasks(store, ctx, taskId.slice(0, 8))).filter((f) => f.task.id.startsWith(taskId));
  const current = hit && (await store.read(ctx.tenantId, hit.path).catch(() => null)), parsed = current && parseTask(current.content);
  if (!hit || !current || !parsed) throw new Error(`Task with ID ${taskId} not found.`);
  const from = await sourceOf(ctx, hit.path), found = await findProject(ctx, channel);
  if (!found.ok) throw new Error(`${found.why} Nothing was changed.`);
  const place = projectPlace(ctx, found.channel), folder = `guilds/${found.channel.guildId}/channels/${found.channel.id}/tasks`;
  if (hit.path.startsWith(`${folder}/`)) throw new Error(`Task "${parsed.title}" is already in #${found.channel.name}. Nothing was changed.`);
  const to = `${folder}/${hit.path.split("/").pop()}`;
  if (parsed.assignedTo) await mustHold(ctx, to, parsed.assignedTo);
  // A name-only Assignee is linked against the destination's guild, as `change()` does for its own.
  const linked = await linkAssignee(parsed.assignedTo, place), assignedTo = linked && linked !== parsed.assignedTo && !(await canHold(ctx, to, linked)).ok ? parsed.assignedTo : linked;
  const task: Task = { ...parsed, assignedTo, notes: [...(parsed.notes ?? []), progressNote(ctx, `Moved from ${from}`)], updatedAt: today().toISOString() };
  try { await store.write(ctx.tenantId, to, render(task)); }
  catch (e) { if (e instanceof WorkspaceConflict) throw new Error(`#${found.channel.name} already has a task file named like this one. Nothing was changed.`); throw e; }
  if ((await store.read(ctx.tenantId, hit.path).catch(() => null))?.version !== hit.version) {
    await store.remove(ctx.tenantId, to).catch(() => {});
    throw new Error("The task was changed by someone else just now. Nothing was changed. Try again.");
  }
  await store.remove(ctx.tenantId, hit.path);
  await labelFolder(place, "channel");
  await labelFolder(place, "guild");
  try { if (!(await store.read(ctx.tenantId, `${folder}/.name`))) await store.write(ctx.tenantId, `${folder}/.name`, "Tasks"); } catch {}
  return { task, from, to: found.channel.name };
}

/** Where a task about to move lives, as its move note names it. Throws when the asker cannot view the project channel it is in. */
async function sourceOf(ctx: SkillContext, path: string): Promise<string> {
  if (personalOwnerOf(path)) return PERSONAL_TASKS;
  const home = taskChannelOf(path);
  if (!home) return "the shared tasks";
  const view = ctx.discord && ctx.userId ? await ctx.discord.channelView(home.channelId, ctx.userId).catch(() => null) : null;
  if (!view?.canView) throw new Error(`You cannot view #${view?.channel?.name ?? home.channelId}, where this task is, so you cannot move it. Nothing was changed.`);
  return `#${view.channel?.name ?? home.channelId}`;
}
