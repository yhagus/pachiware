import type { SkillContext, DiscordClientAdapter, FoundChannel } from "../types.js";
import type { WorkspaceStore } from "../workspace/store.js";
import { viewableChannels } from "../workspace/sources.js";
import { linkAssignee, type Assignee } from "./assignee.js";
import type { TaskSource } from "./taskScopes.js";

/** The project channel a task file belongs to, from its path: `guilds/<guild>/channels/<channel>/…`; null for shared and DM folders. */
export function taskChannelOf(path: string): { guildId: string; channelId: string } | null {
  const m = /^guilds\/([\w-]+)\/channels\/([\w-]+)\//.exec(path);
  return m ? { guildId: m[1]!, channelId: m[2]! } : null;
}

/** Whose Personal tasks a task file is, from its path: `dms/<user>/…`; null for project and shared folders. */
export const personalTasksOf = (path: string): string | null => /^dms\/([\w-]+)\//.exec(path)?.[1] ?? null;

/** The project channels of a guild a person can view, by the same check as the sources kept material is read from. */
export async function viewableProjects(store: WorkspaceStore, tenantId: string, discord: DiscordClientAdapter | undefined, guildId: string, userId: string): Promise<TaskSource[]> {
  return (await viewableChannels(store, tenantId, discord, guildId, userId)).map((c) => ({ kind: "project" as const, label: `#${c.name}`, folders: [`${c.folder}/tasks`], guildId, channelId: c.id }));
}

/**
 * The project channel a person names (`#laporan-q4`, `laporan-q4`, or `<#id>`), searched across every guild the bot shares with them.
 * Fails, saying why, when no such channel is found, when they cannot view it, or when the name fits channels in several guilds.
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

/**
 * Whether an Assignee may hold the task at `path`, and if not, why not, naming the ways out.
 * A Personal task is only ever its own person's or a name-only Assignee's; a project task's member must be able to view its channel.
 * Name-only Assignees, shared folders, and turns without Discord always may.
 */
async function canHold(ctx: SkillContext, path: string, assignee: Assignee): Promise<{ ok: true } | { ok: false; why: string }> {
  const person = personalTasksOf(path);
  if (person) return !assignee.id || assignee.id === person ? { ok: true } : { ok: false, why: `${assignee.name} cannot be the assignee of a Personal task: only you, or someone known by name only, can. Handing work to another member belongs in a project. Nothing was changed. Name the project channel to file the task there, or keep it for yourself.` };
  const home = taskChannelOf(path);
  if (!home || !assignee.id || !ctx.discord) return { ok: true };
  const view = await ctx.discord.channelView(home.channelId, assignee.id).catch(() => ({ channel: null, canView: false }));
  if (view.canView) return { ok: true };
  const channel = `#${view.channel?.name ?? home.channelId}`;
  return { ok: false, why: `${assignee.name} cannot view ${channel}, so they cannot be this task's assignee. Nothing was changed. Add them to ${channel}, or assign someone else.` };
}

/** Throws `canHold`'s reason when the Assignee may not hold the task at `path`. */
export async function mustHold(ctx: SkillContext, path: string, assignee: Assignee) {
  const held = await canHold(ctx, path, assignee);
  if (!held.ok) throw new Error(held.why);
}

/**
 * A name-only Assignee linked to the one member its name matches among `place`'s guild members, when that member may hold the task at `path`;
 * otherwise, and for anyone else, the Assignee unchanged.
 */
export async function linkHeld(ctx: SkillContext, path: string, assignee: Assignee | null, place: SkillContext = ctx): Promise<Assignee | null> {
  const linked = await linkAssignee(assignee, place);
  return linked && linked !== assignee && !(await canHold(ctx, path, linked)).ok ? assignee : linked;
}
