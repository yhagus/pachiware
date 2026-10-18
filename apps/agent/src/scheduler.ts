import { repositories, type Schedule } from "@pachiware/db";
import { now, nextOccurrence, wallClock, hhmm, LATE_LIMIT_MS, LATE_NOTE_MS, MAX_POST_ATTEMPTS, retryDelay, MESSAGE_LIMIT, configuredLanguage, textIn, readGroups, MAX_SCOPED, workspaceStore, taskLine, isOpen, scopeSources, tasksIn, inScope, groupTasks, type DiscordClientAdapter, type TaskSource, type Strings } from "@pachiware/skills";
import { loadGuildSettings } from "./loop/prompt.js";
import { digestLines, syncDigestSchedules } from "./digest.js";
import { writeOwedDays, syncDailyLogSchedules } from "./discord/dailyLogDays.js";
import type { DiscordBotManager } from "./discord/client.js";

export const SCHEDULER_INTERVAL_MS = 60_000;

/** After the tenant's zone changed: the guilds without a zone of their own follow it, so their Digest and Daily log rows move with it. */
export async function syncTenantSchedules(tenantId: string, timezone: string) {
  const guilds = (await repositories().bots.listGuildConfigs(tenantId)).filter((guild) => guild.timezone === null);
  for (const guild of guilds) {
    const where = { tenantId, botId: guild.botId, guildId: guild.guildId, timezone };
    if (guild.digestChannels.length) await syncDigestSchedules(where, guild.digestChannels);
    if (guild.dailyLogChannels.length) await syncDailyLogSchedules(where, guild.dailyLogChannels);
  }
}
let running: Promise<void> | null = null;

/** One scheduler pass: every active row due at `at` is posted through its bot's client and moved on. A pass still running when the next starts is awaited, never doubled. */
export function schedulerTick(manager: DiscordBotManager, at = now()): Promise<void> {
  if (running) return running;
  running = pass(manager, at).finally(() => { running = null; });
  return running;
}

export function startScheduler(manager: DiscordBotManager, everyMs = SCHEDULER_INTERVAL_MS) {
  const timer = setInterval(() => { schedulerTick(manager).catch(() => {}); }, everyMs);
  timer.unref?.();
  return timer;
}

async function pass(manager: DiscordBotManager, at: number) {
  const due = await repositories().schedules.due(new Date(at));
  for (const row of due) await fire(manager, row, at).catch(() => {});
}

async function fire(manager: DiscordBotManager, row: Schedule, at: number) {
  const client = manager.clientOf(row.botId);
  if (!client) return;
  // A daily-log row moves on even when a day fails, since a failing row would end as done; its `lastFiredAt` keeps that day owed instead.
  if (row.kind === "daily-log") { await moveOn(row, at, row.guildId ? await writeOwedDays(manager, { ...row, guildId: row.guildId }, at) : new Date(at)); return; }
  const late = at - row.nextAt.getTime();
  if (late > LATE_LIMIT_MS) { await moveOn(row, at, null); return; }
  if (late < retryDelay(row.attempts)) return;
  try { await post(client, manager.adapterOf(row.botId, row.guildId ?? undefined), row, at, late > LATE_NOTE_MS); }
  catch (error: any) { await failed(row, at, error?.message || String(error)); return; }
  await moveOn(row, at, new Date(at));
}

/** A Reminder is the one message that pings: the owner and the people named when it was made; a late one says when it was due, in the row's zone. A Digest pings nobody and is skipped on a day with nothing to report. */
async function post(client: any, discord: DiscordClientAdapter | null, row: Schedule, at: number, late: boolean) {
  const channel: any = await client.channels.fetch(row.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error("The channel is gone or cannot be posted in.");
  const agent = await repositories().agentConfig.get(row.tenantId);
  const guild = row.guildId ? await loadGuildSettings(row.tenantId, row.botId, row.guildId) : null;
  const strings = textIn(configuredLanguage(guild, agent));
  if (row.kind === "digest") {
    const [first, ...rest] = await digestLines(row, strings, at);
    if (first) await channel.send({ content: withinLimit(first, rest.map((line) => [line])), allowedMentions: { parse: [] } });
    return;
  }
  const users = [...new Set([row.ownerId, ...row.mentions].filter((id): id is string => !!id))];
  let head = [...users.map((id) => `<@${id}>`), strings.reminder(row.text)].join(" ");
  if (late) { const w = wallClock(row.timezone, row.nextAt.getTime()); head += `\n${strings.reminderLate(w.day, w.month, hhmm(w.hour, w.minute))}`; }
  const tasks = row.withTasks ? await ownerTaskLines(row, discord, strings, at) : { chunks: [], unlisted: 0 };
  await channel.send({ content: withinLimit(head.slice(0, MESSAGE_LIMIT), tasks.chunks, tasks.unlisted, strings.moreTasks), allowedMentions: { users } });
}

/**
 * The owner's open `mine` tasks, as they would list them from where the Reminder posts: assigned to them or kept as their Personal tasks,
 * in every project channel they can view (from a DM, in every guild the bot shares with them) and in the shared tasks, one heading per group, soonest due first.
 * At most MAX_SCOPED, like listTasks; `unlisted` counts the rest. One chunk per task line; the first of each group also holds its heading
 * (and the very first the list header), so a cut list never ends on a heading.
 */
async function ownerTaskLines(row: Schedule, discord: DiscordClientAdapter | null, strings: Strings, at: number): Promise<{ chunks: string[][]; unlisted: number }> {
  if (!row.ownerId) return { chunks: [], unlisted: 0 };
  const store = workspaceStore(), owner = { userId: row.ownerId, userName: row.ownerName ?? undefined };
  const sources = await scopeSources(store, { tenantId: row.tenantId, guildId: row.guildId ?? undefined, userId: row.ownerId, discord: discord ?? undefined });
  const groups = groupTasks((await tasksIn(store, row.tenantId, sources)).filter((f) => isOpen(f.task) && inScope("mine", owner)(f)), sources, row.timezone);
  const heading = (source: TaskSource) => (source.kind === "personal" ? strings.personalTasks : source.kind === "shared" ? strings.sharedTasks : source.label);
  const chunks = (await readGroups(store, row.tenantId, groups, MAX_SCOPED)).flatMap((g) => g.tasks.map((t, n) => [...(n ? [] : [heading(g.source)]), taskLine(t, row.timezone, at)]));
  if (chunks[0]) chunks[0].unshift(strings.openTasks);
  return { chunks, unlisted: groups.reduce((n, g) => n + g.tasks.length, 0) - chunks.length };
}

/**
 * Whole chunks of lines only: a list that would cross Discord's limit stops at the last chunk that fits.
 * With `moreLine`, chunks left out (cut here, or `unlisted` before) are counted on a last line, which is kept room for.
 */
function withinLimit(head: string, chunks: string[][], unlisted = 0, moreLine?: (n: number) => string): string {
  const room = moreLine ? moreLine(chunks.length + unlisted).length + 1 : 0;
  let content = head, fitted = 0;
  for (const chunk of chunks) {
    const more = chunk.map((line) => `\n${line}`).join(""), last = fitted + 1 === chunks.length && !unlisted;
    if (content.length + more.length + (last ? 0 : room) > MESSAGE_LIMIT) break;
    content += more;
    fitted++;
  }
  const left = chunks.length - fitted + unlisted, tail = moreLine && left > 0 ? `\n${moreLine(left)}` : "";
  return content.length + tail.length <= MESSAGE_LIMIT ? content + tail : content;
}

async function moveOn(row: Schedule, at: number, firedAt: Date | null) {
  const next = nextOccurrence(row, at);
  await repositories().schedules.update(row.id, { nextAt: next === null ? row.nextAt : new Date(next), status: next === null ? "done" : "active", lastFiredAt: firedAt ?? row.lastFiredAt, attempts: 0, error: null });
}

/** Counts a failed post; the last allowed one gives up on this time: a repeating row keeps coming at its next time with the error kept, a one-off ends. */
async function failed(row: Schedule, at: number, reason: string) {
  const attempts = row.attempts + 1;
  if (attempts < MAX_POST_ATTEMPTS) { await repositories().schedules.update(row.id, { attempts }); return; }
  const error = `Could not post after ${attempts} attempts: ${reason.slice(0, 200)}`, next = nextOccurrence(row, at);
  await repositories().schedules.update(row.id, next === null ? { attempts, status: "done", error } : { attempts: 0, nextAt: new Date(next), error });
}
