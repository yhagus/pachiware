import type { SkillModule, SkillContext, FoundChannel } from "../types.js";
import { visibleRoots } from "../workspace/paths.js";
import { workspaceStore, WorkspaceConflict, type WorkspaceStore } from "../workspace/store.js";
import { labelFolder } from "./workspace.js";
import { ambiguousAssignee, assigneeFilter, assigneeLabel, nameOnlyNote, resolveAssignee } from "./assignee.js";
import { checklistOf, checklistLine, tickItem } from "./checklist.js";
import { historyEntry, historyLine, noteLine, progressNote } from "./progressNotes.js";
import { PRIORITIES, STATUSES, dueAtArg, dueBound, dueMoment, isLate, isOpen, loadTasks, parseTask, readInFull, render, slug, taskLine, walkTasks, type Found, type MadeFrom, type Task, type TaskPriority, type TaskStatus } from "./taskFile.js";
import { findProject, linkHeld, mustHold, personalTasksOf, taskChannelOf } from "./taskAccess.js";
import { MAX_SCOPED, PERSONAL_TASKS, SCOPES, anywhereSources, groupTasks, inScope, readGroups, scopeSources, tasksIn, type Scope } from "./taskScopes.js";
import { textIn } from "../language.js";
import { tasksFromMinutes } from "./minutesTasks.js";
import { fileWords, matchWords, queriesTerms, scoreOf, wordingsOf } from "../workspace/terms.js";
import { isStrong } from "../workspace/search.js";
import { DEFAULT_TIMEZONE, now, today } from "../clock.js";

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
    tasksFromMinutes: { effect: "write", requiresConfirmation: false },
    taskSummary: { effect: "read" },
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
      description: "Lists tasks filtered by status, assignee, or channel. Each task comes with `line`, its task line to print as it is; a title ending in (2/5) means two of five checklist items are done. Scope mine or delegated returns `groups`, one per channel (plus Shared tasks and Personal tasks), soonest due first (with a query, best match first), at most twenty tasks in all; `total` counts every match and `more` how many were left out.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["here", "mine", "delegated", "anywhere"],
            description: "here (default): this channel's tasks. mine: tasks assigned to the asker in every channel of this server they can view (in a DM: of every server they share with the bot) and in the shared tasks, plus their Personal tasks. delegated: tasks the asker created that are assigned to someone else, in those same channels and shared tasks. anywhere: for \"is it done?\", every task whoever holds it, of every status unless status says otherwise, in this channel and every other channel the asker can view; notShownHere counts tasks that cannot be shown in this channel",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "cancelled", "all"],
            description: "Filter by status (default: every status except cancelled, and with scope mine or delegated only open tasks, neither completed nor cancelled; all includes every status)",
          },
          assignedTo: { type: "string", description: "Filter by assignee: a mention, \"me\", a member's ID, or a display name or username in any letter case" },
          query: { type: "string", description: "Words to find in the title or description, any letter case and any form of a word (\"normalisasi\" finds \"normalization\"), filler words ignored; the best match comes first, and a task holding only some of the words is marked partial. Use it to find a task the person names that is not among the active tasks shown" },
          queries: { type: "array", items: { type: "string" }, description: "Several wordings searched together, e.g. [\"normalisasi audio\", \"audio normalization\"]; the best match comes first, and a task holding no wording whole, in any form, is marked partial" },
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
      name: "taskSummary",
      description: "How a project stands, for a manager's \"how is the project going?\": per channel, how many tasks are pending, in progress, late, due in the next 7 days, and completed in the last 7 days, and who holds the open ones. Scope here is this channel's project; anywhere is every project channel the asker can view.",
      parameters: { type: "object", properties: { scope: { type: "string", enum: ["here", "anywhere"], description: "Default here" } } },
    },
    {
      name: "tasksFromMinutes",
      description: "Makes Tasks from the action items of Minutes kept in this channel: all of them, or the item numbers the Minutes show (\"jadikan task poin 2-3\"). Each owner becomes the Assignee when the name fits one member, a due date in words becomes the day it names, and every task remembers the item it came from, so asking again never makes it twice. Use it instead of createTask for Minutes action items.",
      parameters: {
        type: "object",
        properties: {
          minutes: { type: "string", description: "The Minutes file as recall or listFiles name it, e.g. channel/minutes/2026-10-14-launch-sync.md" },
          points: { type: "array", items: { type: "number" }, description: "Item numbers as the posted Minutes show them; leave out for every action item" },
        },
        required: ["minutes"],
      },
    },
    {
      name: "moveTask",
      description: "Moves a task to another project channel, keeping its id and fields and adding a Progress note saying where it came from. From a DM it moves one of the person's Personal tasks into a project. A server's shared task moves only into a channel of that server; the workspace-wide shared tasks do not move. A task only ever moves into a project channel, never into a DM.",
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
    createTask: async (args: { title: string; description?: string; priority?: TaskPriority; assignedTo?: string; channel?: string; dueAt?: string | null; discordChannelId?: string; madeFrom?: MadeFrom }, asker: SkillContext) => {
      checkTitle(args.title);
      if (args.priority !== undefined && !PRIORITIES.includes(args.priority)) throw new Error("Invalid task priority");
      const dueAt = dueAtArg(args.dueAt, zoneOf(asker));
      const ctx = typeof args.channel === "string" && args.channel.trim() ? await filingPlace(asker, args.channel) : asker;
      const who = typeof args.assignedTo === "string" && args.assignedTo.trim() ? await resolveAssignee(args.assignedTo, ctx) : null;
      if (who && "candidates" in who) return ambiguousAssignee(args.assignedTo!, who.candidates);
      const home = taskHome(ctx);
      if (who && !who.nameOnly) await mustHold(ctx, `${home}/`, who.assignee);
      const at = today().toISOString(), id = crypto.randomUUID();
      // madeFrom is not in the schema: the Minutes conversion sets it (#253).
      const madeFrom = args.madeFrom && typeof args.madeFrom === "object" && typeof args.madeFrom.label === "string" ? args.madeFrom : null;
      const task: Task = { id, title: args.title.trim(), description: args.description?.trim() || null, status: "pending", priority: args.priority ?? "medium", assignedTo: who?.assignee ?? null, dueAt, createdBy: ctx.userId ?? null, createdByName: ctx.userName ?? null, createdAt: at, updatedAt: at, ...(madeFrom ? { madeFrom } : {}) };
      await workspaceStore().write(ctx.tenantId, `${home}/${slug(task.title)}-${id.slice(0, 8)}.md`, render(task));
      await labelTaskFolder(ctx);
      return { success: true, message: `Task "${task.title}" created successfully with ID ${id}.${who?.nameOnly ? nameOnlyNote(who.assignee, ctx) : ""}`, task };
    },

    listTasks: async (args: { scope?: Scope; status?: TaskStatus | "all"; assignedTo?: string; query?: string; queries?: unknown; dueAfter?: string; dueBefore?: string; late?: boolean | string; limit?: number }, ctx: SkillContext) => {
      if (args.scope !== undefined && args.scope !== null && !SCOPES.includes(args.scope)) throw new Error(`Invalid scope "${String(args.scope).slice(0, 40)}": use here, mine, delegated, or anywhere`);
      const scope: Scope = args.scope ?? "here";
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 20)), zone = zoneOf(ctx), at = now();
      const after = dueBound(args.dueAfter, zone, "start"), before = dueBound(args.dueBefore, zone, "end");
      const late = args.late === undefined || args.late === null ? undefined : args.late === true || args.late === "true";
      const byDue = after !== undefined || before !== undefined || late !== undefined;
      const assigned = args.assignedTo ? await assigneeFilter(args.assignedTo, ctx) : () => true;
      const store = workspaceStore(), sources = scope === "here" ? null : scope === "anywhere" ? await anywhereSources(store, ctx) : await scopeSources(store, ctx);
      const tasks = sources ? await tasksIn(store, ctx.tenantId, sources) : await loadTasks(store, ctx), whose = inScope(scope, ctx);
      const status = args.status ?? (scope === "anywhere" ? "all" : undefined), queries = queriesTerms(wordingsOf(args.query, args.queries));
      const all = (queries.length ? await matching(store, ctx.tenantId, tasks, queries) : tasks as (Found & Partial<Matched>)[])
        .map((f) => ({ f, t: f.task, due: dueMoment(f.task.dueAt, zone), late: isLate(f.task, zone, at) }))
        .filter(({ f, t }) => (status === "all" || (status ? t.status === status : sources ? isOpen(t) : t.status !== "cancelled")) && assigned(t.assignedTo) && whose(f))
        .filter((x) => (after === undefined || (x.due !== null && x.due >= after)) && (before === undefined || (x.due !== null && x.due <= before)) && (late === undefined || x.late === late))
        .sort((a, b) => (byDue ? (a.due ?? Infinity) - (b.due ?? Infinity) || a.t.createdAt.localeCompare(b.t.createdAt) : (b.f.score ?? 0) - (a.f.score ?? 0) || b.t.createdAt.localeCompare(a.t.createdAt)));
      // A task of a source that may not be shown here is only counted, as files are.
      const hidden = sources?.filter((s) => s.quotable === false).flatMap((s) => s.folders) ?? [];
      const found = all.filter((x) => !hidden.some((folder) => x.f.path.startsWith(`${folder}/`))), notShownHere = all.length - found.length;
      if (sources) {
        // A query shows its best matches, cut before grouping so a better match in a later group is not left out; the best one's group comes first.
        const cap = Math.min(MAX_SCOPED, limit), ranked = queries.length > 0 && !byDue, partial = new Set(found.filter((x) => x.f.partial).map((x) => x.t.id));
        const groups = ranked ? groupTasks(found.slice(0, cap).map((x) => x.f), sources, zone, (f) => f.score ?? 0) : groupTasks(found.map((x) => x.f), sources, zone);
        const kept = await readGroups(store, ctx.tenantId, groups, cap);
        const shown = kept.reduce((n, g) => n + g.tasks.length, 0), more = found.length - shown;
        return {
          scope, total: found.length, shown,
          ...(more > 0 && { more, note: `${more} more not shown. Say how many more there are; a status, query, or due date filter narrows the list to show them.` }),
          groups: kept.map((g) => ({ group: g.source.label, ...(g.source.channelId && { channelId: g.source.channelId }), tasks: g.tasks.map((t) => ({ ...t, late: isLate(t, zone, at), line: taskLine(t, zone, at), ...(partial.has(t.id) && { partial: true }) })) })),
          ...(notShownHere && { notShownHere, suggestion: textIn(ctx.language).tasksNotShownHere(notShownHere) }),
        };
      }
      // Only the tasks returned are read in full, for the checklist progress on their line; query hits already are.
      const shown = found.slice(0, limit), full = queries.length ? shown.map((x) => x.t) : await readInFull(store, ctx.tenantId, shown.map((x) => x.f));
      return { total: shown.length, tasks: shown.map((x, i) => ({ ...x.t, late: x.late, line: taskLine(full[i]!, zone, at), ...(x.f.partial && { partial: true }) })) };
    },

    updateTaskStatus: async (args: { taskId: string; status: TaskStatus; reason?: string | null }, ctx: SkillContext) => {
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
      return { success: true, message: `Task "${updated.title}" assigned to @${assigneeLabel(updated.assignedTo)}.${who.nameOnly ? nameOnlyNote(who.assignee, ctx) : ""}`, task: updated };
    },

    setTaskDueDate: async (args: { taskId: string; dueAt?: string | null }, ctx: SkillContext) => {
      const dueAt = dueAtArg(args.dueAt, zoneOf(ctx));
      const updated = await change(ctx, args.taskId, (t) => ({ ...t, dueAt }));
      return { success: true, message: dueAt ? `Task "${updated.title}" is due ${dueAt}.` : `Task "${updated.title}" has no due date now.`, task: updated };
    },

    editTask: async (args: { taskId: string; title?: string; description?: string | null; priority?: TaskPriority }, ctx: SkillContext) => {
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
      const { task } = await findTask(ctx, args.taskId), notes = task.notes ?? [], history = task.history ?? [];
      return {
        task: taskLine(task, zoneOf(ctx)), description: task.description, checklist: checklistOf(task.description).map((item, i) => checklistLine(item, i + 1)), notes: notes.slice(-LATEST_NOTES).map(noteLine), olderNotes: Math.max(0, notes.length - LATEST_NOTES),
        createdAt: task.createdAt, ...(task.createdByName ? { createdBy: task.createdByName } : {}), ...(task.completedAt ? { completedAt: task.completedAt } : {}),
        ...(task.madeFrom ? { madeFrom: task.madeFrom } : {}), ...(history.length ? { history: history.slice(-LATEST_HISTORY).map(historyLine), olderHistory: Math.max(0, history.length - LATEST_HISTORY) } : {}),
      };
    },

    tickChecklistItem: async (args: { taskId: string; item: string | number; done?: boolean | string }, ctx: SkillContext) => {
      const done = args.done !== false && args.done !== "false";
      let ticked!: ReturnType<typeof tickItem>;
      const updated = await change(ctx, args.taskId, (t) => { ticked = tickItem(t.description, args.item, done); return { ...t, description: ticked.description }; });
      return { success: true, message: `${done ? "Ticked" : "Unticked"} "${ticked.item.text}" on "${updated.title}" (${ticked.done}/${ticked.total}).` };
    },

    taskSummary: async (args: { scope?: "here" | "anywhere" }, ctx: SkillContext) => {
      if (args.scope !== undefined && args.scope !== "here" && args.scope !== "anywhere") throw new Error('Invalid scope: use "here" or "anywhere"');
      return summary(ctx, args.scope ?? "here");
    },

    tasksFromMinutes: async (args: { minutes: string; points?: unknown }, ctx: SkillContext) => {
      if (typeof args.minutes !== "string" || !args.minutes.trim()) throw new Error("minutes is required: the Minutes file, as recall or listFiles name it");
      const points = Array.isArray(args.points) ? args.points.filter((n): n is number => Number.isInteger(n)) : [];
      return minutesToTasks(ctx, args.minutes, points);
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

const zoneOf = (ctx: Pick<SkillContext, "timezone">) => ctx.timezone ?? DEFAULT_TIMEZONE;

/** The tasks folder a task filed in this turn's place goes to: the channel's project, else the DM's Personal tasks, else the tenant's shared tasks. */
function taskHome(ctx: SkillContext): string {
  const roots = visibleRoots(ctx);
  return `${roots.channel ?? roots.dm ?? roots.tenant!}/tasks`;
}

/** Labels the folders a task was just filed in, best effort: the channel and its guild (or the guild, or the DM), and the tasks folder itself. */
async function labelTaskFolder(ctx: SkillContext) {
  const roots = visibleRoots(ctx), name = `${taskHome(ctx)}/.name`;
  await labelFolder(ctx, roots.channel ? "channel" : roots.guild ? "guild" : roots.dm ? "dm" : "");
  if (roots.channel) await labelFolder(ctx, "guild");
  try { if (!(await workspaceStore().read(ctx.tenantId, name))) await workspaceStore().write(ctx.tenantId, name, "Tasks"); } catch {}
}

/** A task a query matched, with its score, and `partial` when it holds no query whole. */
type Matched = Found & { score: number; partial?: true };

/**
 * The tasks whose title or description holds any term of the queries, each scored as a file would be with its title as the name and
 * its description as the body, so a task naming the words in its title comes first. One holding no query whole is `partial`, as a
 * kept file is (#258): a Task named in other words ("Waveform trim and cut" for "trim tool") is still found. Read in full:
 * `loadTasks` reads frontmatter only.
 */
async function matching(store: WorkspaceStore, tenantId: string, found: Found[], queries: string[][]): Promise<Matched[]> {
  const out: Matched[] = [], terms = [...new Set(queries.flat())];
  for (const f of found) {
    const file = await store.read(tenantId, f.path).catch(() => null), task = file && parseTask(file.content);
    if (!task) continue;
    const words = fileWords(task.description ?? ""), hit = matchWords(terms, task.title, words);
    if (!hit) continue;
    out.push({ ...f, task, score: scoreOf(hit, queries, () => 1, words.length), ...(isStrong(hit, queries) ? {} : { partial: true as const }) });
  }
  return out;
}

/**
 * `after` as it is written: each field change kept as a dated History line naming who asked (#250), completedAt stamped when it becomes
 * completed and cleared when it opens again, updatedAt moved. Every write path uses it: chat tools and the web routes.
 */
export function recordChange(before: Task, after: Task, who: Pick<SkillContext, "userName" | "userId" | "timezone">): Task {
  const at = today().toISOString(), changes = changesOf(before, after);
  const completedAt = after.status === "completed" ? (before.status === "completed" ? before.completedAt ?? null : at) : null;
  const history = changes.length ? [...(before.history ?? []), historyEntry(who, changes.join("; "))] : before.history;
  return { ...after, updatedAt: at, completedAt, ...(history?.length ? { history } : {}) };
}

/** What a write changed in the fields people track, one phrase each, for the task's History. */
function changesOf(before: Task, after: Task): string[] {
  const out: string[] = [], none = "none";
  if (before.status !== after.status) out.push(`status ${before.status} → ${after.status}`);
  if (assigneeLabel(before.assignedTo) !== assigneeLabel(after.assignedTo)) out.push(`assignee ${assigneeLabel(before.assignedTo)} → ${assigneeLabel(after.assignedTo)}`);
  if (before.dueAt !== after.dueAt) out.push(`due ${before.dueAt ?? none} → ${after.dueAt ?? none}`);
  if (before.title !== after.title) out.push(`title "${before.title}" → "${after.title}"`);
  if (before.priority !== after.priority) out.push(`priority ${before.priority} → ${after.priority}`);
  return out;
}

const LATEST_NOTES = 3, LATEST_HISTORY = 5;
/**
 * One task by id or id prefix, read in full (description and notes), with the file it was found in: among this place's folders first,
 * then among the tasks of every channel listTasks scope anywhere reads (#260), so a task is changed from wherever its channel's tasks
 * can be viewed. One of a channel whose tasks may not be shown here is refused without naming it.
 */
async function findTask(ctx: SkillContext, taskId: string): Promise<{ hit: Found; task: Task }> {
  if (typeof taskId !== "string" || !/^[0-9a-f-]{8,36}$/.test(taskId)) throw new Error(`Task with ID ${taskId} not found.`);
  const store = workspaceStore(), prefix = taskId.slice(0, 8), byId = (found: Found[]) => found.find((f) => f.task.id.startsWith(taskId));
  let hit = byId(await loadTasks(store, ctx, prefix));
  if (!hit) {
    const sources = await anywhereSources(store, ctx);
    hit = byId(await walkTasks(store, ctx.tenantId, sources.flatMap((s) => s.folders), prefix));
    const hidden = hit && sources.some((s) => s.quotable === false && s.folders.some((folder) => hit!.path.startsWith(`${folder}/`)));
    if (hidden) throw new Error(`Task with ID ${taskId} cannot be shown or changed in this channel. Nothing was changed. Do not say what or where it is; suggest asking in a DM instead.`);
  }
  const file = hit && (await store.read(ctx.tenantId, hit.path).catch(() => null)), task = file && parseTask(file.content);
  if (!hit || !task) throw new Error(`Task with ID ${taskId} not found.`);
  return { hit, task };
}

async function change(ctx: SkillContext, taskId: string, edit: (t: Task, path: string) => Task | Promise<Task>): Promise<Task> {
  const { hit, task: parsed } = await findTask(ctx, taskId), store = workspaceStore();
  const edited = await edit(parsed, hit.path);
  // A name-only Assignee the edit kept is linked when its name now matches exactly one member who may hold the task.
  const assignedTo = edited.assignedTo === parsed.assignedTo ? await linkHeld(ctx, hit.path, edited.assignedTo) : edited.assignedTo;
  const next = recordChange(parsed, { ...edited, assignedTo }, ctx);
  try { await store.write(ctx.tenantId, hit.path, render(next), hit.version); }
  catch (e) { if (e instanceof WorkspaceConflict) throw new Error("The task was changed by someone else just now. Try again."); throw e; }
  return next;
}

/**
 * Moves a task this turn can see into the project channel `channel` names, adding a Progress note that says where it came from.
 * Refused, with nothing changed, when the asker cannot view the source or the destination, a member Assignee cannot view the destination,
 * the task is one of the tenant-wide shared tasks, or a guild's shared task would leave its guild.
 * The task is written to its new folder before the old file goes; a source changed meanwhile removes the new file again.
 */
async function move(ctx: SkillContext, taskId: string, channel: string): Promise<{ task: Task; from: string; to: string }> {
  const { hit, task: parsed } = await findTask(ctx, taskId), store = workspaceStore();
  const from = await sourceOf(ctx, hit.path, parsed.title), found = await findProject(ctx, channel);
  if (!found.ok) throw new Error(`${found.why} Nothing was changed.`);
  const sharedIn = /^guilds\/([\w-]+)\/shared\//.exec(hit.path)?.[1];
  if (sharedIn && sharedIn !== found.channel.guildId) throw new Error(`Task "${parsed.title}" is in a server's shared tasks, so it only moves into one of its own server's channels, and #${found.channel.name} is in another. Nothing was changed.`);
  const place = projectPlace(ctx, found.channel), folder = taskHome(place);
  if (hit.path.startsWith(`${folder}/`)) throw new Error(`Task "${parsed.title}" is already in #${found.channel.name}. Nothing was changed.`);
  const to = `${folder}/${hit.path.split("/").pop()}`;
  if (parsed.assignedTo) await mustHold(ctx, to, parsed.assignedTo);
  // A name-only Assignee is linked against the destination's guild, as `change()` does for its own.
  const assignedTo = await linkHeld(ctx, to, parsed.assignedTo, place);
  const task: Task = { ...parsed, assignedTo, notes: [...(parsed.notes ?? []), progressNote(ctx, `Moved from ${from}`)], updatedAt: today().toISOString() };
  try { await store.write(ctx.tenantId, to, render(task)); }
  catch (e) { if (e instanceof WorkspaceConflict) throw new Error(`#${found.channel.name} already has a task file named like this one. Nothing was changed.`); throw e; }
  if ((await store.read(ctx.tenantId, hit.path).catch(() => null))?.version !== hit.version) {
    await store.remove(ctx.tenantId, to).catch(() => {});
    throw new Error("The task was changed by someone else just now. Nothing was changed. Try again.");
  }
  await store.remove(ctx.tenantId, hit.path);
  await labelTaskFolder(place);
  return { task, from, to: found.channel.name };
}

/**
 * Where a task about to move lives, as its move note names it: a Personal task, a project channel's task, or a guild's shared task.
 * Throws when the asker cannot view the project channel it is in, or when it is one of the tenant-wide shared tasks, which no channel owns.
 */
async function sourceOf(ctx: SkillContext, path: string, title: string): Promise<string> {
  if (personalTasksOf(path)) return PERSONAL_TASKS;
  if (path.startsWith("shared/")) throw new Error(`Task "${title}" is one of the shared tasks of the whole workspace, not of a project or a server, so it cannot be moved into a channel. Nothing was changed.`);
  const home = taskChannelOf(path);
  if (!home) return "the shared tasks";
  const view = ctx.discord && ctx.userId ? await ctx.discord.channelView(home.channelId, ctx.userId).catch(() => null) : null;
  if (!view?.canView) throw new Error(`You cannot view #${view?.channel?.name ?? home.channelId}, where this task is, so you cannot move it. Nothing was changed.`);
  return `#${view.channel?.name ?? home.channelId}`;
}

/** Tasks from a Minutes file's action items (#253), for the tool and for a reply to posted Minutes. */
export const minutesToTasks = (ctx: SkillContext, minutes: string, points: number[]) =>
  tasksFromMinutes(ctx, minutes, points, (args, at) => taskManagementSkill.handlers.createTask!(args as any, at));

const WEEK_MS = 7 * 86_400_000;
/** Counts per project for taskSummary (#250): open by status, late, due within a week, completed within the last week, and open tasks per Assignee. */
async function summary(ctx: SkillContext, scope: "here" | "anywhere") {
  const store = workspaceStore(), zone = zoneOf(ctx), at = now();
  const sources = scope === "anywhere" ? (await anywhereSources(store, ctx)).filter((s) => s.kind === "project") : null;
  const found = sources ? await tasksIn(store, ctx.tenantId, sources) : await loadTasks(store, ctx);
  const groups = sources ? sources.map((s) => ({ label: s.label, quotable: s.quotable !== false, tasks: found.filter((f) => s.folders.some((folder) => f.path.startsWith(`${folder}/`))).map((f) => f.task) }))
    : [{ label: ctx.channelName ? `#${ctx.channelName}` : "here", quotable: true, tasks: found.map((f) => f.task) }];
  const shown = groups.filter((g) => g.quotable && g.tasks.length), notShownHere = groups.filter((g) => !g.quotable && g.tasks.length).length;
  return {
    projects: shown.map((g) => {
      const open = g.tasks.filter(isOpen), holders = new Map<string, number>();
      for (const t of open) holders.set(assigneeLabel(t.assignedTo), (holders.get(assigneeLabel(t.assignedTo)) ?? 0) + 1);
      const due = (t: Task) => dueMoment(t.dueAt, zone);
      return {
        project: g.label, pending: open.filter((t) => t.status === "pending").length, inProgress: open.filter((t) => t.status === "in_progress").length,
        late: open.filter((t) => isLate(t, zone, at)).length, dueThisWeek: open.filter((t) => { const d = due(t); return d !== null && d >= at && d <= at + WEEK_MS; }).length,
        completedLastWeek: g.tasks.filter((t) => t.status === "completed" && t.completedAt && at - Date.parse(t.completedAt) <= WEEK_MS).length,
        openByAssignee: Object.fromEntries([...holders].sort((a, b) => b[1] - a[1])),
      };
    }),
    ...(notShownHere ? { notShownHere, suggestion: textIn(ctx.language).tasksNotShownHere(notShownHere) } : {}),
  };
}
