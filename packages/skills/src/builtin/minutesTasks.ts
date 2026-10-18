import type { SkillContext } from "../types.js";
import { parseFrontmatter } from "../playbooks.js";
import { workspaceStore } from "../workspace/store.js";
import { placeRoot, visibleRoots } from "../workspace/paths.js";
import { loadTasks, taskLine, type MadeFrom, type Task } from "./taskFile.js";
import { dueFromWords } from "../dueWords.js";
import { DEFAULT_TIMEZONE, isoInZone } from "../clock.js";
import { textIn } from "../language.js";

/** What a stored Minutes file holds that tasks are made from; the Discord side writes it (apps/agent/src/discord/minutes.ts). */
interface StoredMinutes {
  title: string; postedIn: string; messageId: string; guildId: string;
  header: { from: number };
  minutes: { title: string; decided: unknown[]; open: unknown[]; actions: { owner: string | null; task: string; due: string | null; link: string }[] };
}
export interface MinutesTasksResult {
  success: boolean; message: string;
  created?: { item: number; id: string; line: string; title: string; dueAt: string | null; assigneeId?: string }[];
  existing?: { item: number; line: string }[];
  notes?: string[];
}
/** Creates one task as createTask does; returns its result, which says when a name matched several members. */
type CreateTask = (args: Record<string, unknown>, ctx: SkillContext) => Promise<any>;

/** The Minutes file a place keeps under `minutes/`, from a path as the agent names it ("channel/minutes/x.md") or its file name alone. */
export function minutesFilePath(ctx: SkillContext, minutes: string): string | null {
  const root = placeRoot(ctx), folder = root === "channel" || root === "thread" ? visibleRoots(ctx)[root] : undefined;
  const parts = minutes.trim().split("/"), name = parts.at(-1) ?? "";
  if (!folder || !/^[\p{L}\p{N}._-]+\.md$/u.test(name)) return null;
  // Only this place's own minutes: tasks belong to the project of the channel the minutes were written in.
  if (parts.length > 1 && !(parts.length === 3 && (parts[0] === "channel" || parts[0] === "thread") && parts[1] === "minutes")) return null;
  return `${folder}/minutes/${name}`;
}

/**
 * Tasks from a Minutes file's action items (#253): all of them when `points` is empty, else those numbers as the posted Minutes
 * show them (counted across Decided, Still open and Action items). The owner becomes the Assignee when the name resolves to one
 * member who can view the channel, a due date in words becomes the day it names counted from the discussion's day, and each task
 * remembers the item it was made from, so asking again never makes it twice.
 */
export async function tasksFromMinutes(ctx: SkillContext, minutes: string, points: number[], create: CreateTask): Promise<MinutesTasksResult> {
  const t = textIn(ctx.language), path = minutesFilePath(ctx, minutes);
  if (!path) return { success: false, message: t.minutesTasksElsewhere };
  const file = await workspaceStore().read(ctx.tenantId, path).catch(() => null);
  const record = file && (parseFrontmatter(file.content)?.fields as unknown as StoredMinutes | undefined);
  if (!record?.minutes?.actions || !record.header) return { success: false, message: t.minutesTasksNoRecord };
  const m = record.minutes, first = m.decided.length + m.open.length + 1;
  const all = m.actions.map((a, i) => ({ ...a, n: first + i }));
  if (!all.length) return { success: false, message: t.minutesTasksNoActions };
  const wrong = points.filter((n) => n < first || n >= first + all.length);
  if (wrong.length) return { success: false, message: t.minutesNotActions(wrong.map(String), t.minutesSpan(all.map((a) => String(a.n)), all.length > 3)) };
  const picked = points.length ? all.filter((a) => points.includes(a.n)) : all;

  const zone = ctx.timezone ?? DEFAULT_TIMEZONE, said = isoInZone(zone, record.header.from).slice(0, 10);
  const made = new Map((await loadTasks(workspaceStore(), ctx)).filter((f) => f.task.madeFrom?.path === path).map((f) => [f.task.madeFrom!.item, f.task]));
  const created: NonNullable<MinutesTasksResult["created"]> = [], existing: { item: number; line: string }[] = [], notes: string[] = [];
  for (const a of picked) {
    const already = made.get(a.n);
    if (already) { existing.push({ item: a.n, line: taskLine(already, zone) }); continue; }
    const dueAt = dueFromWords(a.due, said);
    if (a.due && !dueAt) notes.push(t.minutesTasksDueKept(a.n, a.due));
    const madeFrom: MadeFrom = { label: t.minutesTasksFrom(m.title, a.n), link: a.link, path, item: a.n };
    const args = { title: a.task.slice(0, 200), description: t.minutesTasksDescription(m.title, a.link, a.due && !dueAt ? a.due : null), ...(dueAt ? { dueAt } : {}), madeFrom };
    let result = a.owner ? await create({ ...args, assignedTo: a.owner }, ctx).catch((e: Error) => ({ refused: e.message })) : await create(args, ctx);
    // A name that fits several members, or a member who cannot view the channel, leaves the task unassigned rather than not made.
    if (a.owner && result?.candidates) { notes.push(t.minutesTasksAmbiguous(a.owner)); result = await create(args, ctx); }
    else if (a.owner && result?.refused) { notes.push(t.minutesTasksCannotView(a.owner)); result = await create(args, ctx); }
    const task = result?.task as Task | undefined;
    if (task) created.push({ item: a.n, id: task.id, line: taskLine(task, zone), title: task.title, dueAt: task.dueAt, ...(task.assignedTo?.id ? { assigneeId: task.assignedTo.id } : {}) });
  }
  const head = created.length ? t.minutesTasksCreated(created.length, m.title) : t.minutesTasksNone(m.title);
  const message = [head, ...created.map((c) => `- ${c.line}`), ...existing.map((e) => `- ${t.minutesTasksExisting(e.item, e.line)}`), ...notes.map((n) => `-# ${n}`)].join("\n");
  return { success: true, message, created, ...(existing.length ? { existing } : {}), ...(notes.length ? { notes } : {}) };
}
