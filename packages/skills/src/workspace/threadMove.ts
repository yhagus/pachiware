import { parseFrontmatter } from "../playbooks.js";
import { safeId, threadFolder } from "./paths.js";
import { workspaceStore, type WorkspaceStore } from "./store.js";

/** Whether a thread is "private" (a private thread, or one that cannot be looked up), whose kept material belongs in its own folder, or "public". */
export type ThreadKind = "private" | "public";
export interface ThreadMoveReport { moved: { from: string; to: string }[]; taken: { from: string; to: string }[] }

/** Written once a guild's old files were moved, with what could not be; a later connect leaves the guild alone. */
const doneMarker = (guildId: string) => `guilds/${guildId}/.private-threads-moved.json`;
const LINK = /^https:\/\/discord\.com\/channels\/([^/]+)\/([^/]+)\/[^/]+$/;
const running = new Map<string, Promise<ThreadMoveReport | null>>();

/**
 * One-time move (ADR 0009) of what a guild kept from private threads before they had their own folder: Minutes whose record says
 * they were posted in a thread, and Notes whose source links point into one, go from the parent channel's folder to the thread's
 * when `kindOf` says it is private (an unresolvable thread is). Never overwrites: a taken name is reported and the file stays.
 * Returns null when the guild was already done or keeps nothing yet.
 */
export function moveOldThreadFiles(tenantId: string, guildId: string, kindOf: (threadId: string) => Promise<ThreadKind>): Promise<ThreadMoveReport | null> {
  const key = `${tenantId}/${guildId}`;
  // Two bots of a tenant in one guild connect at about the same time; the second waits for the first's result.
  const pending = running.get(key) ?? run(workspaceStore(), tenantId, guildId, kindOf).finally(() => running.delete(key));
  running.set(key, pending);
  return pending;
}

async function run(store: WorkspaceStore, tenantId: string, guildId: string, kindOf: (threadId: string) => Promise<ThreadKind>) {
  const g = safeId(guildId);
  if (!g || await store.read(tenantId, doneMarker(g))) return null;
  const channels = (await store.list(tenantId, `guilds/${g}/channels`)).filter((e) => e.type === "dir");
  if (!channels.length) return null;
  const kinds = new Map<string, Promise<ThreadKind>>();
  const kind = (threadId: string) => kinds.get(threadId) ?? kinds.set(threadId, kindOf(threadId).catch(() => "private" as const)).get(threadId)!;
  const report: ThreadMoveReport = { moved: [], taken: [] };
  for (const { path: channel } of channels) {
    const c = channel.split("/").pop()!;
    for (const folder of ["minutes", "notes"] as const) {
      for (const from of await files(store, tenantId, `${channel}/${folder}`)) {
        const head = await store.readFrontmatter(tenantId, from).catch(() => null);
        const fields = head && parseFrontmatter(head.content)?.fields;
        const threadId = fields && (folder === "minutes" ? postedThread(fields, c) : sourceThread(fields, g, c));
        const home = threadId && threadFolder(g, c, threadId);
        if (!home || await kind(threadId) !== "private") continue;
        const to = `${home}/${folder}/${from.slice(`${channel}/${folder}/`.length)}`;
        if (await store.read(tenantId, to).catch(() => true) !== null) { report.taken.push({ from, to }); continue; }
        try { await store.move(tenantId, from, to); report.moved.push({ from, to }); }
        catch { report.taken.push({ from, to }); }
      }
    }
  }
  await store.write(tenantId, doneMarker(g), `${JSON.stringify({ at: new Date().toISOString(), moved: report.moved.length, notMoved: report.taken }, null, 2)}\n`);
  return report;
}

/** Every Markdown file under `dir` at any depth, hidden ones skipped. */
async function files(store: WorkspaceStore, tenantId: string, dir: string) {
  return (await store.files(tenantId, dir).catch(() => [])).map((f) => f.path).filter((p) => p.endsWith(".md"));
}

/** The thread a Minutes record was posted in, when it was not the channel itself. */
function postedThread(fields: Record<string, unknown>, channelId: string) {
  const posted = fields.postedIn;
  return typeof fields.messageId === "string" && typeof posted === "string" && posted !== channelId ? posted : undefined;
}

/** The one thread a kept-message Note's source links point into; a link to the channel itself (a thread's starter message) is no thread. */
function sourceThread(fields: Record<string, unknown>, guildId: string, channelId: string) {
  const links = (Array.isArray(fields.source) ? fields.source : [fields.source]).filter((l): l is string => typeof l === "string");
  const threads = new Set(links.flatMap((l) => { const m = LINK.exec(l); return m && m[1] === guildId && m[2] !== channelId ? [m[2]!] : []; }));
  return threads.size === 1 ? [...threads][0] : undefined;
}
