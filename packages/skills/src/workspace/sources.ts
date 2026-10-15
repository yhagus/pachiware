import type { DiscordClientAdapter, SkillContext } from "../types.js";
import { channelsWithSkill } from "../availability.js";
import { textIn } from "../language.js";
import { checkSegments, KEPT_FOLDERS, safeId, visibleRoots } from "./paths.js";
import type { WorkspaceStore } from "./store.js";

/** A channel of a guild one person can view, with its Workspace folder and whether it is a Public channel. */
export interface ViewableChannel { id: string; name: string; guildId: string; folder: string; public: boolean }

/**
 * The channels of a guild a person can view: each channel folder of the guild in the Workspace that `channelView` says they see.
 * A channel Discord cannot resolve, or one of another guild, is left out, as is every channel without `discord`. Task scopes use the same check.
 */
export async function viewableChannels(store: WorkspaceStore, tenantId: string, discord: DiscordClientAdapter | undefined, guildId: string, userId: string): Promise<ViewableChannel[]> {
  if (!discord || !safeId(guildId) || !safeId(userId)) return [];
  const folder = `guilds/${guildId}/channels`, ids = (await store.list(tenantId, folder).catch(() => []))
    .filter((e) => e.type === "dir").map((e) => e.path.split("/").pop()!).filter((id) => !!safeId(id));
  const views = await Promise.all(ids.map((id) => discord.channelView(id, userId).catch(() => null)));
  return ids.flatMap((id, i) => {
    const v = views[i];
    return v?.canView && v.channel?.guildId === guildId ? [{ id, name: v.channel.name, guildId, folder: `${folder}/${id}`, public: v.channel.public }] : [];
  });
}

/**
 * A place whose Minutes, Decisions, Notes and Documents the asker may read from where they ask.
 * `root` is the name a path starts with: "channel", "thread" or "dm" for the place asked from (`here`), else "#name" (with " [id]" when two
 * channels share a name). `label` is how results name it. `folder` is its tenant-relative folder, `folders` the kept folders under it that
 * are read. `quotable`: what it holds may be shown here; a source that is not is never read in this ticket's tools.
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
const WORKSPACE_SKILL = "workspace";

/**
 * Which places the asker may read kept material from here, the place asked from first. From a guild channel or thread: that place,
 * then every other channel folder of the guild the asker can view, leaving out a channel where an Availability rule turns the Workspace off.
 * Another channel is quotable only when it is a Public channel. From a DM or web chat: only the place itself.
 */
export async function readableSources(store: WorkspaceStore, ctx: Asker): Promise<Source[]> {
  const roots = visibleRoots(ctx);
  if (!ctx.guildId || !roots.channel) return roots.dm ? [{ root: "dm", label: "DM", folder: roots.dm, folders: keptIn(roots.dm), here: true, quotable: true }] : [];
  const guildId = ctx.guildId, channelId = (ctx.parentChannelId ?? ctx.channelId)!;
  const channels = ctx.userId ? await viewableChannels(store, ctx.tenantId, ctx.discord, guildId, ctx.userId) : [];
  const here: Source[] = [];
  const threadName = roots.thread && ctx.userId ? (await ctx.discord?.channelView(ctx.channelId!, ctx.userId).catch(() => null))?.channel?.name : undefined;
  if (roots.thread) here.push({ root: "thread", label: `#${threadName ?? ctx.channelId}`, folder: roots.thread, folders: keptIn(roots.thread), guildId, channelId, threadId: ctx.channelId, here: true, quotable: true });
  const own = channels.find((c) => c.id === channelId);
  here.push({ root: "channel", label: `#${own?.name ?? (ctx.parentChannelId ? undefined : ctx.channelName) ?? channelId}`, folder: roots.channel, folders: keptIn(roots.channel), guildId, channelId, here: true, quotable: true });

  const others = channels.filter((c) => c.id !== channelId);
  const on = await channelsWithSkill({ tenantId: ctx.tenantId, botId: ctx.botId, guildId }, WORKSPACE_SKILL, others.map((c) => c.id));
  const elsewhere = others.filter((c) => on.has(c.id)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((c): Source => ({ root: `#${c.name}`, label: `#${c.name}`, folder: c.folder, folders: keptIn(c.folder), guildId, channelId: c.id, here: false, quotable: c.public }));
  const taken = (root: string) => elsewhere.filter((s) => s.root === root).length > 1 || here.some((s) => s.label === root);
  return [...here, ...elsewhere.map((s) => (taken(s.root) ? { ...s, root: `${s.root} [${s.channelId}]` } : s))];
}

/** Whether an agent path starts with a channel's name ("#marketing/...") or mention ("<#123>/..."), not one of the place's own roots. */
export const namesChannel = (path: unknown): path is string => typeof path === "string" && /^<?#/.test(path);

/** The source a path's first segment names: its root or label in any case, or a "<#id>" mention of its channel. */
function sourceNamed(sources: Source[], name: string) {
  const mention = /^<#([\w-]+)>$/.exec(name)?.[1], wanted = name.toLowerCase();
  return mention ? sources.find((s) => s.channelId === mention && !s.threadId) : sources.find((s) => s.root.toLowerCase() === wanted) ?? sources.find((s) => s.label.toLowerCase() === wanted);
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
  return { source, path: [source.folder, ...rest].join("/"), shown: (path) => source.root + path.slice(source.folder.length) };
}
