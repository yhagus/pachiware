import { safeId, visibleRoots } from "./paths.js";
import { textIn } from "../language.js";
import type { SkillContext } from "../types.js";

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

type Asker = Pick<SkillContext, "guildId" | "channelId" | "parentChannelId" | "privateThread" | "userId" | "discord" | "language">;

/**
 * Who may have private thread folders read, for one asker, with each thread looked up once: the private thread they ask from,
 * or one the Discord adapter says they can view, which for a private thread means they were added to it. A thread that cannot
 * be looked up (deleted, or in a guild the bot left) is read by nobody. Loose files under `threads/` are never kept material.
 */
export function threadAccess(ctx: Asker) {
  const known = new Map<string, Promise<boolean>>();
  const own = ctx.privateThread ? visibleRoots(ctx).thread : undefined;
  const view = async ({ guildId, threadId }: ThreadPlace) => {
    if (!ctx.discord || !ctx.userId) return false;
    const seen = await ctx.discord.channelView(threadId, ctx.userId).catch(() => null);
    return !!seen?.canView && seen.channel?.guildId === guildId;
  };
  const threadReadable = (at: ThreadPlace) => {
    if (own === `guilds/${at.guildId}/channels/${at.channelId}/threads/${at.threadId}`) return Promise.resolve(true);
    const key = `${at.guildId}/${at.threadId}`;
    if (!known.has(key)) known.set(key, view(at));
    return known.get(key)!;
  };
  const readable = async (path: string) => {
    const at = threadsPath(path);
    return !at || at.kind === "threads" || (at.kind === "thread" && await threadReadable(at));
  };
  return {
    threadReadable,
    readable,
    /** Throws the place's refusal unless `path` may be read here. */
    async check(path: string) {
      if (!(await readable(path))) throw new Error(textIn(ctx.language).threadFolderRefused);
    },
    /** A folder listing without what may not be read here. */
    async filter<T extends { path: string }>(entries: T[]): Promise<T[]> {
      const keep = await Promise.all(entries.map((e) => readable(e.path)));
      return entries.filter((_, i) => keep[i]);
    },
  };
}

/** Refuses a change under any `threads/` outside this private thread's own folder: a thread's kept material changes only from inside it. */
export function checkThreadWrite(ctx: Pick<SkillContext, "guildId" | "channelId" | "parentChannelId" | "privateThread" | "userId" | "language">, path: string) {
  if (!threadsPath(path)) return;
  const own = ctx.privateThread ? visibleRoots(ctx).thread : undefined;
  if (!own || (path !== own && !path.startsWith(`${own}/`))) throw new Error(textIn(ctx.language).threadFolderReadOnly);
}
