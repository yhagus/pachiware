import type { SkillContext } from "../types.js";
import { safeId } from "../workspace/paths.js";
import type { WorkspaceStore } from "../workspace/store.js";
import { isAssignee } from "./assignee.js";
import { dueMoment, readInFull, walkTasks, type Found, type Task } from "./taskFile.js";
import { personalTasksOf, viewableProjects } from "./taskAccess.js";

/** Which tasks a list covers: `here` is the place's own folders, as the turn sees them; `mine` and `delegated` are views across projects. */
export const SCOPES = ["here", "mine", "delegated"] as const;
export type Scope = (typeof SCOPES)[number];
/** At most this many tasks in a view across projects, so the answer fits in one Discord message. */
export const MAX_SCOPED = 20;

/**
 * Folders whose tasks a view across projects prints as one group under `label`: a project channel (`#name`, with its ids),
 * a person's Personal tasks, or the shared task folders of the tenant and its guilds. `folders` are tenant-relative and walked recursively.
 */
export interface TaskSource { kind: "project" | "personal" | "shared"; label: string; folders: string[]; guildId?: string; channelId?: string }
export interface TaskGroup { source: TaskSource; tasks: Found[] }

export const PERSONAL_TASKS = "Personal tasks", SHARED_TASKS = "Shared tasks";
/**
 * The folders a `mine` or `delegated` view of this turn draws from: in a guild, every project channel of it the asker can view;
 * in a DM, those of every guild the bot shares with the asker, each label naming its guild, as "#ops (Beta)".
 * Then the shared tasks the asker saw before projects (the tenant's, and those of the same guilds), and the asker's Personal tasks.
 */
export async function scopeSources(store: WorkspaceStore, ctx: Pick<SkillContext, "tenantId" | "guildId" | "userId" | "discord">): Promise<TaskSource[]> {
  const user = safeId(ctx.userId);
  if (!user) return [];
  const personal: TaskSource = { kind: "personal", label: PERSONAL_TASKS, folders: [`dms/${user}`] };
  const shared = (guildIds: (string | undefined)[]): TaskSource => ({ kind: "shared", label: SHARED_TASKS, folders: ["shared/tasks", ...guildIds.flatMap((g) => (safeId(g) ? [`guilds/${g}/shared/tasks`] : []))] });
  if (ctx.guildId) return [...await viewableProjects(store, ctx.tenantId, ctx.discord, ctx.guildId, user), shared([ctx.guildId]), personal];
  const guilds = (await ctx.discord?.sharedGuilds(user).catch(() => [])) ?? [];
  const projects = await Promise.all(guilds.map(async (g) => (await viewableProjects(store, ctx.tenantId, ctx.discord, g.id, user)).map((p) => ({ ...p, label: `${p.label} (${g.name})` }))));
  return [...projects.flat(), shared(guilds.map((g) => g.id)), personal];
}

/** Every valid task in the given sources, frontmatter only (`readGroups` reads the ones printed). */
export const tasksIn = (store: WorkspaceStore, tenantId: string, sources: readonly TaskSource[]) => walkTasks(store, tenantId, sources.flatMap((s) => s.folders));

/** Whether a task belongs to a scope for the asker: `mine` when they are its Assignee or it is one of their Personal tasks, `delegated` when they created it for someone else outside their Personal tasks; `here` keeps every task. */
export function inScope(scope: Scope, asker: Pick<SkillContext, "userId" | "userName">): (f: Pick<Found, "path" | "task">) => boolean {
  const person = { id: asker.userId, names: [asker.userName] };
  if (scope === "mine") return ({ path, task: t }) => isAssignee(t.assignedTo, person) || (!!asker.userId && personalTasksOf(path) === asker.userId);
  if (scope === "delegated") return ({ path, task: t }) => !!asker.userId && t.createdBy === asker.userId && !!t.assignedTo && !isAssignee(t.assignedTo, person) && !personalTasksOf(path);
  return () => true;
}

/** Tasks grouped by the source they are in, soonest due first within a group (no due date last), and groups ordered by their soonest task, then label. Sources without tasks are left out. */
export function groupTasks(found: readonly Found[], sources: readonly TaskSource[], timeZone: string): TaskGroup[] {
  const due = (f: Found) => dueMoment(f.task.dueAt, timeZone) ?? Infinity;
  const groups = sources.map((source) => ({
    source,
    tasks: found.filter((f) => source.folders.some((folder) => f.path.startsWith(`${folder}/`))).sort((a, b) => due(a) - due(b) || a.task.createdAt.localeCompare(b.task.createdAt)),
  })).filter((g) => g.tasks.length);
  return groups.sort((a, b) => due(a.tasks[0]!) - due(b.tasks[0]!) || a.source.label.localeCompare(b.source.label));
}

/** The first `cap` tasks of the groups, in group order, read in full for their task lines; groups left without a task are dropped. */
export async function readGroups(store: WorkspaceStore, tenantId: string, groups: readonly TaskGroup[], cap = Infinity): Promise<{ source: TaskSource; tasks: Task[] }[]> {
  let room = cap;
  const kept = groups.map((g) => { const tasks = g.tasks.slice(0, Math.max(0, room)); room -= tasks.length; return { source: g.source, tasks }; }).filter((g) => g.tasks.length);
  const full = await readInFull(store, tenantId, kept.flatMap((g) => g.tasks));
  let i = 0;
  return kept.map((g) => ({ source: g.source, tasks: g.tasks.map(() => full[i++]!) }));
}
