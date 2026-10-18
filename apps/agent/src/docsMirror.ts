import { repositories, type DocSource } from "@pachiware/db";
import { loadGitAccess, repoAllowed, connectionOf, mirrorSource, mirrorFolder, noteNotAllowed, dropMirror, audit, failureOf, type GitAccess } from "@pachiware/skills";
import { botCompletion } from "./llm/completion.js";
import { syncDailyRows, type GuildPlace } from "./digest.js";
import { DAILY_LOG_TIME } from "./discord/dailyLogDays.js";
import type { DiscordBotManager } from "./discord/client.js";

/**
 * When the documentation mirror (#248) runs: once right after an admin saves a new or changed doc source, and every night with the
 * Daily logs. Whether a source may be mirrored is the channel's Git scope's decision, at save time and again at each refresh.
 */

/** One active `docs-mirror` row per channel with doc sources, daily at DAILY_LOG_TIME in `timezone`; rows of channels left without sources are cancelled. */
export const syncDocsMirrorSchedules = (where: GuildPlace, sources: DocSource[]) => syncDailyRows("docs-mirror", where, new Map(sources.map((s) => [s.channelId, DAILY_LOG_TIME])));

/** The git account that reads `source` in its channel: the one it names, else the first the channel's Git scope allows the repository for; null when none. */
export async function sourceAccess(where: Omit<GuildPlace, "timezone">, source: DocSource): Promise<GitAccess | null> {
  const allowed = (await loadGitAccess({ ...where, channelId: source.channelId })).filter((a) => repoAllowed(a, source.repo));
  return (source.account ? allowed.find((a) => a.account.name.toLowerCase() === source.account!.toLowerCase()) : allowed[0]) ?? null;
}

/** Refuses saving a doc source whose repository its channel's Git scope does not allow. */
export class DocSourceRefused extends Error {}

const keyOf = (s: DocSource) => `${s.channelId}\n${s.repo}`;
const sameSource = (a: DocSource, b: DocSource) => (a.account ?? "") === (b.account ?? "") && a.paths.join("\n") === b.paths.join("\n");

/** What a save changed: the sources new or changed (another account or other paths), and those removed. */
export function docSourceChanges(before: DocSource[], after: DocSource[]) {
  const old = new Map(before.map((s) => [keyOf(s), s])), kept = new Set(after.map(keyOf));
  return { changed: after.filter((s) => !old.has(keyOf(s)) || !sameSource(old.get(keyOf(s))!, s)), removed: before.filter((s) => !kept.has(keyOf(s))) };
}

/** Throws `DocSourceRefused` for the first source the Git scope does not allow; a source saved before stays even when the scope has since narrowed. */
export async function assertDocSourcesAllowed(where: Omit<GuildPlace, "timezone">, sources: DocSource[]) {
  for (const source of sources) {
    if (await sourceAccess(where, source)) continue;
    throw new DocSourceRefused(source.account
      ? `The Git scope of channel ${source.channelId} does not allow ${source.repo} for the git account "${source.account}". Open the repository to that channel first.`
      : `The Git scope of channel ${source.channelId} does not allow ${source.repo} for any git account of this bot. Open the repository to that channel first.`);
  }
}

const queues = new Map<string, Promise<unknown>>();
/** One job per mirror folder at a time, so a save's refresh and the night's never write the same files together. */
function serial(key: string, job: () => Promise<void>): Promise<void> {
  const pending = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(job);
  queues.set(key, pending);
  void pending.finally(() => { if (queues.get(key) === pending) queues.delete(key); }).catch(() => {});
  return pending;
}

/**
 * Refreshes one source. A source its channel's Git scope no longer allows is skipped, logged and audited the first time only, and keeps its
 * files. A failure is logged and audited, never thrown, so it cannot stop the run it is part of.
 */
function refreshSource(where: Omit<GuildPlace, "timezone">, source: DocSource): Promise<void> {
  const folder = mirrorFolder(where.guildId, source.channelId, source.repo), meta = { channelId: source.channelId, repo: source.repo };
  return serial(`${where.tenantId}:${folder}`, async () => {
    try {
      const access = await sourceAccess(where, source);
      if (!access) {
        if (!(await noteNotAllowed(where.tenantId, folder, source.repo))) return;
        console.warn(`[docs-mirror] ${source.repo} is no longer allowed in channel ${source.channelId}; skipped until its Git scope allows it again`);
        await audit(where, "docs_mirror_not_allowed", meta);
        return;
      }
      await mirrorSource({ tenantId: where.tenantId, folder, conn: await connectionOf(access), repo: source.repo, paths: source.paths, complete: botCompletion(where.tenantId, where.botId) });
    } catch (error) {
      const failure = failureOf(error);
      console.error(`[docs-mirror] could not refresh ${source.repo} in channel ${source.channelId}: ${failure.error}: ${failure.message}`);
      await audit(where, "docs_mirror_failed", { ...meta, ...failure });
    }
  });
}

/** Refreshes `sources` one after another. */
export async function refreshDocSources(where: Omit<GuildPlace, "timezone">, sources: DocSource[]) {
  for (const source of sources) await refreshSource(where, source);
}

/** The night's run of one `docs-mirror` row: every source of its channel as the guild settings hold them now. */
export async function refreshChannelDocs(row: Omit<GuildPlace, "timezone"> & { channelId: string }) {
  const config = await repositories().bots.getGuildConfig(row.botId, row.guildId);
  await refreshDocSources(row, (config?.docSources ?? []).filter((s) => s.channelId === row.channelId));
}

/** After a save: the mirrors of removed sources are deleted at once; each new or changed source is refreshed in the background (with `manager`). */
export async function docSourcesSaved(where: Omit<GuildPlace, "timezone">, before: DocSource[], after: DocSource[], manager?: Pick<DiscordBotManager, "background">) {
  const { changed, removed } = docSourceChanges(before, after);
  for (const source of removed) {
    const folder = mirrorFolder(where.guildId, source.channelId, source.repo);
    await serial(`${where.tenantId}:${folder}`, () => dropMirror(where.tenantId, folder)).catch(() => {});
  }
  if (manager && changed.length) manager.background(refreshDocSources(where, changed));
}
