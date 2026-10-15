import { safeId, threadFolder, visibleRoots } from "./paths.js";
import { textIn } from "../language.js";
import type { DiscordClientAdapter, SkillContext } from "../types.js";

/** A private thread whose own folder (ADR 0009) holds a path. */
export type ThreadPlace = { guildId: string; channelId: string; threadId: string };
/**
 * Where a tenant-relative path lies under a channel's `threads/`: that folder itself ("threads"), a private thread's own folder or
 * anything in it ("thread"), a loose file there such as a playbook binding ("loose"), or null for a path outside every `threads/`.
 */
export type ThreadsPath = null | { kind: "threads" } | { kind: "loose" } | ({ kind: "thread" } & ThreadPlace);

const UNDER_THREADS = /^guilds\/([^/]+)\/channels\/([^/]+)\/threads(?:\/([^/]+))?(?:\/|$)/;

export function threadsPath(path: string): ThreadsPath {
  const m = UNDER_THREADS.exec(path);
  if (!m) return null;
  const [, guildId, channelId, name] = m;
  if (name === undefined) return { kind: "threads" };
  // A thread's folder is named by its id; a binding is `<id>.md`, which no id looks like.
  return safeId(name) === name ? { kind: "thread", guildId: guildId!, channelId: channelId!, threadId: name } : { kind: "loose" };
}

/** The channel or thread `id` as Discord shows it to a person, when they can view it and it is in `guildId`; else null. */
export async function viewedIn(discord: DiscordClientAdapter, id: string, userId: string, guildId: string) {
  const view = await discord.channelView(id, userId).catch(() => null);
  return view?.canView && view.channel?.guildId === guildId ? view.channel : null;
}

type Asker = Pick<SkillContext, "guildId" | "channelId" | "parentChannelId" | "privateThread" | "userId" | "discord" | "language">;
/** How a path may be read here: shown, only counted (the asker may read it, but not here), or not at all. */
type Reading = "shown" | "counted" | "refused";

/**
 * Who may have private thread folders read, for one asker, with each thread looked up once: the private thread they ask from,
 * or one the Discord adapter says they can view, which for a private thread means they were added to it. Inside a private thread
 * only that thread and its parent are shown; a sibling private thread the asker was added to is only counted. A thread that
 * cannot be looked up (deleted, or in a guild the bot left) is read by nobody. Loose files under `threads/` are never kept material.
 */
export function threadAccess(ctx: Asker) {
  const known = new Map<string, Promise<boolean>>();
  const own = ctx.privateThread ? visibleRoots(ctx).thread : undefined;
  const added = ({ guildId, threadId }: ThreadPlace) => {
    const key = `${guildId}/${threadId}`;
    if (!known.has(key)) known.set(key, ctx.discord && ctx.userId ? viewedIn(ctx.discord, threadId, ctx.userId, guildId).then(Boolean) : Promise.resolve(false));
    return known.get(key)!;
  };
  const reading = async (path: string): Promise<Reading> => {
    const at = threadsPath(path);
    if (!at || at.kind === "threads") return "shown";
    if (at.kind === "loose") return "refused";
    if (own === threadFolder(at.guildId, at.channelId, at.threadId)) return "shown";
    if (!(await added(at))) return "refused";
    return own ? "counted" : "shown";
  };
  return {
    /** Throws the place's refusal unless `path` may be read and shown here. */
    async check(path: string) {
      const read = await reading(path);
      if (read === "refused") throw new Error(textIn(ctx.language).threadFolderRefused);
      if (read === "counted") throw new Error(textIn(ctx.language).notQuotableHere);
    },
    /** The entries that may be shown here, and how many more the asker may read but not here. */
    async sort<T extends { path: string }>(entries: T[]): Promise<{ shown: T[]; counted: number }> {
      const read = await Promise.all(entries.map((e) => reading(e.path)));
      return { shown: entries.filter((_, i) => read[i] === "shown"), counted: read.filter((r) => r === "counted").length };
    },
  };
}

/** Refuses a change under any `threads/` outside this private thread's own folder: a thread's kept material changes only from inside it. */
export function checkThreadWrite(ctx: Pick<SkillContext, "guildId" | "channelId" | "parentChannelId" | "privateThread" | "userId" | "language">, path: string) {
  if (!threadsPath(path)) return;
  const own = ctx.privateThread ? visibleRoots(ctx).thread : undefined;
  if (!own || (path !== own && !path.startsWith(`${own}/`))) throw new Error(textIn(ctx.language).threadFolderReadOnly);
}
