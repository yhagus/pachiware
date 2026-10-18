import type { DiscordClientAdapter, SkillContext } from "../types.js";
import { channelsWithSkill } from "../availability.js";
import { textIn } from "../language.js";
import { agentPaths, checkSegments, KEPT_FOLDERS, safeId, visibleRoots } from "./paths.js";
import { capMatches, shownMatch, type FileMatch } from "./search.js";
import type { SearchableWorkspaceStore, WorkspaceStore } from "./store.js";
import { viewedIn } from "./threads.js";

/** A channel or thread of a guild one person can view, with its Workspace folder and whether it is a Public channel. */
export interface ViewableChannel { id: string; name: string; guildId: string; folder: string; public: boolean }

/** The id-named folders under `folder` whose channel or thread Discord shows the person in `guildId`. One Discord cannot resolve is left out. */
async function viewableFolders(store: WorkspaceStore, tenantId: string, discord: DiscordClientAdapter, folder: string, guildId: string, userId: string): Promise<ViewableChannel[]> {
  const ids = (await store.list(tenantId, folder).catch(() => []))
    .filter((e) => e.type === "dir").map((e) => e.path.split("/").pop()!).filter((id) => !!safeId(id));
  const views = await Promise.all(ids.map((id) => viewedIn(discord, id, userId, guildId)));
  return ids.flatMap((id, i) => {
    const v = views[i];
    return v ? [{ id, name: v.name, guildId, folder: `${folder}/${id}`, public: v.public }] : [];
  });
}

/**
 * The channels of a guild a person can view: each channel folder of the guild in the Workspace that `channelView` says they see.
 * A channel Discord cannot resolve, or one of another guild, is left out, as is every channel without `discord`. Task scopes use the same check.
 */
export async function viewableChannels(store: WorkspaceStore, tenantId: string, discord: DiscordClientAdapter | undefined, guildId: string, userId: string): Promise<ViewableChannel[]> {
  if (!discord || !safeId(guildId) || !safeId(userId)) return [];
  return viewableFolders(store, tenantId, discord, `guilds/${guildId}/channels`, guildId, userId);
}

/**
 * A place whose kept material (Minutes, Daily logs, Decisions, Notes and Documents) the asker may read from where they ask.
 * `root` is the name a path starts with: "channel", "thread" or "dm" for the place asked from (`here`), "channel/threads/<id>" for one
 * of its private threads, else "#name" (with " [id]" when two channels share a name). `label` is how results name it. `folder` is its
 * tenant-relative folder, `folders` the kept folders under it that are read. `quotable`: what it holds may be shown here; a source
 * that is not is only counted, never named or shown.
 */
export interface Source {
  root: string;
  label: string;
  folder: string;
  folders: string[];
  guildId?: string;
  channelId?: string;
  threadId?: string;
  here: boolean;
  quotable: boolean;
}

type Asker = Pick<SkillContext, "tenantId" | "botId" | "guildId" | "channelId" | "parentChannelId" | "privateThread" | "userId" | "channelName" | "discord">;

const keptIn = (folder: string) => KEPT_FOLDERS.map((f) => `${folder}/${f}`);
/** A source kept in `folder`, reading the kept folders under it; not the place asked from unless `here`. */
const sourceAt = (folder: string, source: Omit<Source, "folder" | "folders" | "here"> & { here?: boolean }): Source =>
  ({ ...source, folder, folders: keptIn(folder), here: source.here ?? false });
const WORKSPACE_SKILL = "workspace";

/** Gives each source a root no other source has: its label, with " [id]" added when two share one. */
function uniqueRoots(sources: Source[], taken: (root: string) => boolean = () => false): Source[] {
  const shared = (root: string) => sources.filter((s) => s.root === root).length > 1 || taken(root);
  return sources.map((s) => (shared(s.root) ? { ...s, root: `${s.root} [${s.threadId ?? s.channelId}]` } : s));
}

/** The private thread folders under a channel's `threads/` whose thread Discord says the person can view, which means they were added to it. */
const addedThreads = (store: WorkspaceStore, ctx: Asker, channel: ViewableChannel, userId: string) =>
  viewableFolders(store, ctx.tenantId, ctx.discord!, `${channel.folder}/threads`, channel.guildId, userId);

/** The viewable channels of a guild where no Availability rule turns the Workspace off, by name. */
async function workspaceOn(ctx: Asker, guildId: string, channels: ViewableChannel[]) {
  const on = await channelsWithSkill({ tenantId: ctx.tenantId, botId: ctx.botId, guildId }, WORKSPACE_SKILL, channels.map((c) => c.id));
  return channels.filter((c) => on.has(c.id)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * From a DM, every guild the asker shares with the bot: each channel folder they can view where the Workspace is on, and the folders of the
 * private threads under those channels they were added to. Everything is quotable in a DM. Labels name the guild, as "#ops (Beta)".
 */
async function sharedGuildSources(store: WorkspaceStore, ctx: Asker, userId: string): Promise<Source[]> {
  const guilds = (await ctx.discord?.sharedGuilds(userId).catch(() => [])) ?? [];
  const perGuild = await Promise.all(guilds.filter((g) => safeId(g.id)).map(async (g) => {
    const channels = await workspaceOn(ctx, g.id, await viewableChannels(store, ctx.tenantId, ctx.discord, g.id, userId));
    const named = (name: string) => ({ root: `#${name} (${g.name})`, label: `#${name} (${g.name})`, guildId: g.id, quotable: true });
    const threads = await Promise.all(channels.map(async (c) => (await addedThreads(store, ctx, c, userId))
      .map((t) => sourceAt(t.folder, { ...named(t.name), channelId: c.id, threadId: t.id }))));
    return [...channels.map((c) => sourceAt(c.folder, { ...named(c.name), channelId: c.id })), ...threads.flat()];
  }));
  return perGuild.flat().sort((a, b) => a.label.localeCompare(b.label) || a.folder.localeCompare(b.folder));
}

/**
 * From a guild channel or thread: that place; then the channel's private threads the asker was added to, shown in the channel and its
 * public threads but only counted inside another private thread of it; then every other channel folder of the guild the asker can view,
 * leaving out a channel where an Availability rule turns the Workspace off, quotable only when it is a Public channel; then the private
 * threads under those channels the asker was added to, never quotable.
 */
async function guildSources(store: WorkspaceStore, ctx: Asker, roots: Record<string, string>, guildId: string): Promise<Source[]> {
  const channelId = (ctx.parentChannelId ?? ctx.channelId)!, userId = ctx.userId;
  const channels = userId ? await viewableChannels(store, ctx.tenantId, ctx.discord, guildId, userId) : [];
  const own = channels.find((c) => c.id === channelId);
  const here: Source[] = [];
  if (roots.thread) {
    const threadName = userId && ctx.discord ? (await viewedIn(ctx.discord, ctx.channelId!, userId, guildId))?.name : undefined;
    here.push(sourceAt(roots.thread, { root: "thread", label: `#${threadName ?? ctx.channelId}`, guildId, channelId, threadId: ctx.channelId, here: true, quotable: true }));
  }
  here.push(sourceAt(roots.channel!, { root: "channel", label: `#${own?.name ?? (ctx.parentChannelId ? undefined : ctx.channelName) ?? channelId}`, guildId, channelId, here: true, quotable: true }));
  if (!userId || !ctx.discord) return here;

  // Read by the path the channel gives them, so `channel/threads/<id>/...` names each.
  const ownThreads = own ? (await addedThreads(store, ctx, own, userId)).filter((t) => t.folder !== roots.thread)
    .map((t) => sourceAt(t.folder, { root: `channel/threads/${t.id}`, label: `#${t.name}`, guildId, channelId, threadId: t.id, quotable: !roots.thread })) : [];
  const others = await workspaceOn(ctx, guildId, channels.filter((c) => c.id !== channelId));
  const elsewhere = others.map((c) => sourceAt(c.folder, { root: `#${c.name}`, label: `#${c.name}`, guildId, channelId: c.id, quotable: c.public }));
  // Another channel's private thread is only counted here: its root holds a "/", so no path names it by name.
  const threads = await Promise.all(others.map(async (c) => (await addedThreads(store, ctx, c, userId))
    .map((t) => sourceAt(t.folder, { root: `#${c.name}/${t.name}`, label: `#${c.name}/${t.name}`, guildId, channelId: c.id, threadId: t.id, quotable: false }))));
  return [...here, ...ownThreads, ...uniqueRoots(elsewhere, (root) => here.some((s) => s.label === root)), ...threads.flat()];
}

/** Every source of one turn, looked up once: the host passes one context object to every tool call of a turn. */
const perTurn = new WeakMap<WorkspaceStore, WeakMap<object, Promise<Source[]>>>();

/**
 * Which places the asker may read kept material from here, the place asked from first. From a guild channel or thread, see
 * `guildSources`. From a DM: the DM, then every guild shared with the bot (`sharedGuildSources`). From web chat, which has no Discord
 * identity: only the place itself. Looked up once per turn context.
 */
export function readableSources(store: WorkspaceStore, ctx: Asker): Promise<Source[]> {
  const turns = perTurn.get(store) ?? perTurn.set(store, new WeakMap()).get(store)!;
  const known = turns.get(ctx);
  if (known) return known;
  const found = lookUpSources(store, ctx);
  turns.set(ctx, found);
  found.catch(() => turns.delete(ctx));
  return found;
}

async function lookUpSources(store: WorkspaceStore, ctx: Asker): Promise<Source[]> {
  const roots = visibleRoots(ctx);
  if (ctx.guildId && roots.channel) return guildSources(store, ctx, roots, ctx.guildId);
  if (!roots.dm) return [];
  const dm = sourceAt(roots.dm, { root: "dm", label: "DM", here: true, quotable: true });
  const user = safeId(ctx.userId);
  return [dm, ...(user && ctx.discord ? uniqueRoots(await sharedGuildSources(store, ctx, user), (root) => root === dm.label) : [])];
}

/** Whether an agent path starts with a channel's name ("#marketing/...") or mention ("<#123>/..."), not one of the place's own roots. */
export const namesChannel = (path: unknown): path is string => typeof path === "string" && /^<?#/.test(path);

/** The source a path's first segment names: its root or label in any case, or a "<#id>" mention of its channel or private thread. */
function sourceNamed(sources: Source[], name: string) {
  const mention = /^<#([\w-]+)>$/.exec(name)?.[1], wanted = name.toLowerCase();
  return mention ? sources.find((s) => (s.threadId ?? s.channelId) === mention) : sources.find((s) => s.root.toLowerCase() === wanted) ?? sources.find((s) => s.label.toLowerCase() === wanted);
}

/**
 * Turns a path naming a source ("#marketing/minutes/2026-10-14-pricing.md") into the source and the tenant-relative path, or throws the
 * place's refusal: a name that is no readable source here (never saying whether the channel exists), or a folder that is not kept material.
 * With `allowRoot`, the source's own folder may be named alone.
 */
export function sourcePath(ctx: Pick<SkillContext, "language">, sources: Source[], input: string, allowRoot = false): { source: Source; path: string; shown: (path: string) => string } {
  const t = textIn(ctx.language);
  if (input.includes("\0") || input.includes("\\")) throw new Error("Invalid path");
  const [name, ...rest] = input.replace(/\/$/, "").split("/");
  const source = sourceNamed(sources, name!);
  if (!source) throw new Error(t.notASource(name!));
  if (!rest.length && !allowRoot) throw new Error("path must name a file");
  checkSegments(rest);
  if (rest.length && !KEPT_FOLDERS.includes(rest[0]!)) throw new Error(t.sourceFolderRefused(KEPT_FOLDERS));
  return { source, path: [source.folder, ...rest].join("/"), shown: agentPaths(source.root, source.folder) };
}

/**
 * Every file in a source's folders (its kept folders unless given) holding any of the words, each with its source and the
 * path the agent reads it by, and how many files were searched.
 */
export async function searchSource(store: SearchableWorkspaceStore, tenantId: string, source: Source, words: string[], folders = source.folders) {
  const shown = agentPaths(source.root, source.folder);
  const found = await Promise.all(folders.map((folder) => store.searchFolder(tenantId, folder, words, (p) => p.slice(source.folder.length + 1))));
  return {
    matches: found.flatMap((f) => f.matches).map((m): FileMatch & { source: Source; shown: string } => ({ ...m, source, shown: shown(m.path) })),
    searched: found.reduce((n, f) => n + f.searched, 0),
  };
}

/**
 * Searches the kept folders of every source for any of the queries. Matches that may be shown here are ranked best first
 * (see `ranked`) and come grouped by source label, groups in the order of their best match, at most MAX_MATCHES in all;
 * `total` and `leftOut` count only those. `notShown` counts the matches of non-quotable sources.
 */
export async function searchSources(store: SearchableWorkspaceStore, tenantId: string, sources: Source[], queries: string[][]) {
  const words = [...new Set(queries.flat())];
  const found = await Promise.all(sources.map((s) => searchSource(store, tenantId, s, words)));
  const all = found.flatMap((f) => f.matches);
  const searched = found.reduce((n, f, i) => n + (sources[i]!.quotable ? f.searched : 0), 0);
  const { matches, total, leftOut } = capMatches(all.filter((m) => m.source.quotable), queries, searched);
  const groups = sources.map((s) => ({ s, matches: matches.filter((m) => m.source === s) })).filter((g) => g.matches.length)
    .sort((a, b) => matches.indexOf(a.matches[0]!) - matches.indexOf(b.matches[0]!));
  return { groups: groups.map((g) => ({ channel: g.s.label, matches: g.matches.map(shownMatch) })), total, leftOut, notShown: all.length - total };
}
