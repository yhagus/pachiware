import type { SkillContext } from "../types.js";
import { safeId } from "../workspace/paths.js";
import { readableSources } from "../workspace/sources.js";
import type { WorkspaceStore } from "../workspace/store.js";
import { isAssignee } from "./assignee.js";
import { dueMoment, readInFull, walkTasks, type Found } from "./taskFile.js";
import { personalTasksOf, viewableProjects } from "./taskAccess.js";

/**
 * Which tasks a list covers: `here` is the place's own folders, as the turn sees them; `mine` and `delegated` are views across projects;
 * `anywhere` is every task of the channels the asker may read kept material from here, whoever holds it.
 */
export const SCOPES = ["here", "mine", "delegated", "anywhere"] as const;
export type Scope = (typeof SCOPES)[number];
/** At most this many tasks in a view across projects, so the answer fits in one Discord message. */
export const MAX_SCOPED = 20;

/**
 * Folders whose tasks a view across projects prints as one group under `label`: a project channel (`#name`, with its ids),
 * a person's Personal tasks, or the shared task folders of the tenant and its guilds. `folders` are tenant-relative tasks/ folders, walked recursively.
 */
export interface TaskSource { kind: "project" | "personal" | "shared"; label: string; folders: string[]; guildId?: string; channelId?: string; /** False: its tasks may not be shown here, only counted. */ quotable?: boolean }
/** `F` may carry more than the file, such as a query's `partial`; `readGroups` keeps it. */
export interface TaskGroup<F extends Found = Found> { source: TaskSource; tasks: F[] }

export const PERSONAL_TASKS = "Personal tasks", SHARED_TASKS = "Shared tasks";
/** Whether the file at `path` lies under one of `folders` (tenant-relative, as a TaskSource's). */
export const inFolders = (path: string, folders: readonly string[]) => folders.some((folder) => path.startsWith(`${folder}/`));
/**
 * The folders a `mine` or `delegated` view of this turn draws from: in a guild, every project channel of it the asker can view;
 * in a DM, those of every guild the bot shares with the asker, each label naming its guild, as "#ops (Beta)".
 * Then the shared tasks the asker saw before projects (the tenant's, and those of the same guilds), and the asker's Personal tasks.
 */
export async function scopeSources(store: WorkspaceStore, ctx: Pick<SkillContext, "tenantId" | "guildId" | "userId" | "discord">): Promise<TaskSource[]> {
  const user = safeId(ctx.userId);
  if (!user) return [];
  const personal: TaskSource = { kind: "personal", label: PERSONAL_TASKS, folders: [`dms/${user}/tasks`] };
  const shared = (guildIds: (string | undefined)[]): TaskSource => ({ kind: "shared", label: SHARED_TASKS, folders: ["shared/tasks", ...guildIds.flatMap((g) => (safeId(g) ? [`guilds/${g}/shared/tasks`] : []))] });
  if (ctx.guildId) return [...await viewableProjects(store, ctx.tenantId, ctx.discord, ctx.guildId, user), shared([ctx.guildId]), personal];
  const guilds = (await ctx.discord?.sharedGuilds(user).catch(() => [])) ?? [];
  const projects = await Promise.all(guilds.map(async (g) => (await viewableProjects(store, ctx.tenantId, ctx.discord, g.id, user)).map((p) => ({ ...p, label: `${p.label} (${g.name})` }))));
  return [...projects.flat(), shared(guilds.map((g) => g.id)), personal];
}

/**
 * The folders an `anywhere` view of this turn draws from: the tasks of every Source the asker may read kept material from here
 * (`readableSources`), quotable under the same rules. A private thread's tasks are its parent channel's, so threads add nothing.
 * From a DM, the DM's own Source is the asker's Personal tasks.
 */
export async function anywhereSources(store: WorkspaceStore, ctx: Parameters<typeof readableSources>[1]): Promise<TaskSource[]> {
  return (await readableSources(store, ctx)).filter((s) => !s.threadId).map((s) => ({
    kind: s.channelId ? "project" as const : "personal" as const, label: s.channelId ? s.label : PERSONAL_TASKS, folders: [`${s.folder}/tasks`],
    ...(s.guildId && { guildId: s.guildId }), ...(s.channelId && { channelId: s.channelId }), quotable: s.quotable,
  }));
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

/**
 * Tasks grouped by the source they are in, soonest due first within a group (no due date last), and groups ordered by their soonest
 * task, then label. Given `rank` (a query's match score), the best match comes first, in a group and among groups, before the due
 * date (#258). Sources without tasks are left out.
 */
export function groupTasks<F extends Found>(found: readonly F[], sources: readonly TaskSource[], timeZone: string, rank: (f: F) => number = () => 0): TaskGroup<F>[] {
  const due = (f: F) => dueMoment(f.task.dueAt, timeZone) ?? Infinity;
  const groups = sources.map((source) => ({
    source,
    tasks: found.filter((f) => inFolders(f.path, source.folders)).sort((a, b) => rank(b) - rank(a) || due(a) - due(b) || a.task.createdAt.localeCompare(b.task.createdAt)),
  })).filter((g) => g.tasks.length);
  return groups.sort((a, b) => rank(b.tasks[0]!) - rank(a.tasks[0]!) || due(a.tasks[0]!) - due(b.tasks[0]!) || a.source.label.localeCompare(b.source.label));
}

/**
 * The first `cap` tasks of the groups, in group order, each with its task read in full for its task line and the rest of what it
 * carried kept; groups left without a task are dropped.
 */
export async function readGroups<F extends Found>(store: WorkspaceStore, tenantId: string, groups: readonly TaskGroup<F>[], cap = Infinity): Promise<TaskGroup<F>[]> {
  let room = cap;
  const kept = groups.map((g) => { const tasks = g.tasks.slice(0, Math.max(0, room)); room -= tasks.length; return { source: g.source, tasks }; }).filter((g) => g.tasks.length);
  const full = await readInFull(store, tenantId, kept.flatMap((g) => g.tasks));
  let i = 0;
  return kept.map((g) => ({ source: g.source, tasks: g.tasks.map((f) => ({ ...f, task: full[i++]! })) }));
}
