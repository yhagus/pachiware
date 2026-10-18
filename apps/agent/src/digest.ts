import { repositories, type DigestChannel, type DailyLogChannel, type Schedule } from "@pachiware/db";
import { now, nextOccurrence, wallClock, hhmm, loadTasks, readInFull, workspaceStore, dueMoment, taskLine, isOpen, type Strings } from "@pachiware/skills";

const hourText = (hour: number) => hhmm(hour, 0);
const DAY_MS = 24 * 60 * 60_000;

/** When a channel's Daily log of the day before is written, in the place's zone. */
export const DAILY_LOG_TIME = "00:30";

type Place = { tenantId: string; botId: string; guildId: string; timezone: string };

/** After the tenant's zone changed: the guilds without a zone of their own follow it, so their Digest and Daily log rows move with it. */
export async function syncTenantSchedules(tenantId: string, timezone: string) {
  const guilds = (await repositories().bots.listGuildConfigs(tenantId)).filter((guild) => guild.timezone === null);
  for (const guild of guilds) {
    const where = { tenantId, botId: guild.botId, guildId: guild.guildId, timezone };
    if (guild.digestChannels.length) await syncDigestSchedules(where, guild.digestChannels);
    if (guild.dailyLogChannels.length) await syncDailyLogSchedules(where, guild.dailyLogChannels);
  }
}

/** One active `digest` row per opted-in channel of the guild, daily at its hour in `timezone`; rows of channels no longer listed are cancelled. */
export const syncDigestSchedules = (where: Place, entries: DigestChannel[]) => syncDailyRows("digest", where, new Map(entries.map((e) => [e.channelId, hourText(e.hour)])));

/**
 * One active `daily-log` row per channel with Daily logs, daily at 00:30 in `timezone`, with no owner and no text: the row says only which bot
 * writes which channel's Daily log and when; whether to backfill stays on the guild settings. Rows of channels turned off are cancelled.
 */
export const syncDailyLogSchedules = (where: Place, entries: DailyLogChannel[]) => syncDailyRows("daily-log", where, new Map(entries.map((e) => [e.channelId, DAILY_LOG_TIME])));

/** A row whose time and zone already match is left alone, so an unrelated settings save never moves it. */
async function syncDailyRows(kind: "digest" | "daily-log", where: Place, wanted: Map<string, string>) {
  const { schedules } = repositories();
  const active = await schedules.list({ botId: where.botId, guildId: where.guildId, kind, status: "active" });
  const at = now();
  const nextAt = (timeOfDay: string) => new Date(nextOccurrence({ recurrence: "daily", weekdays: [], dayOfMonth: null, timeOfDay, timezone: where.timezone, until: null }, at)!);
  for (const row of active) {
    const timeOfDay = wanted.get(row.channelId);
    if (!timeOfDay) { await schedules.update(row.id, { status: "cancelled" }); continue; }
    wanted.delete(row.channelId);
    if (row.timeOfDay === timeOfDay && row.timezone === where.timezone) continue;
    await schedules.update(row.id, { timeOfDay, timezone: where.timezone, nextAt: nextAt(timeOfDay), attempts: 0, error: null });
  }
  for (const [channelId, timeOfDay] of wanted) {
    await schedules.create({ tenantId: where.tenantId, botId: where.botId, kind, guildId: where.guildId, channelId, recurrence: "daily", timeOfDay, timezone: where.timezone, nextAt: nextAt(timeOfDay) });
  }
}

/**
 * The Digest's lines for one channel at `at`: the tasks due today and the ones due before today with how many days late, from that channel's task folder only.
 * Empty when there is nothing to report, which means no post. Nothing here pings.
 */
export async function digestLines(row: Schedule, strings: Strings, at: number): Promise<string[]> {
  if (!row.guildId) return [];
  const folder = `guilds/${row.guildId}/channels/${row.channelId}/tasks/`;
  const zone = row.timezone, today = dayNumber(zone, at);
  const store = workspaceStore();
  const open = (await loadTasks(store, { tenantId: row.tenantId, guildId: row.guildId, channelId: row.channelId })).filter((f) => f.path.startsWith(folder) && isOpen(f.task));
  const dueBy = open.map((f) => ({ f, due: dueMoment(f.task.dueAt, zone) })).filter((x): x is { f: typeof x.f; due: number } => x.due !== null && dayNumber(zone, x.due) <= today);
  const full = await readInFull(store, row.tenantId, dueBy.map((x) => x.f)); // only the tasks posted, for their checklist progress
  const dated = dueBy.map((x, i) => ({ t: full[i]!, due: x.due })).sort((a, b) => a.due - b.due || a.t.createdAt.localeCompare(b.t.createdAt));
  const dueToday = dated.filter((x) => dayNumber(zone, x.due) === today).map((x) => taskLine(x.t, zone, at));
  const late = dated.filter((x) => dayNumber(zone, x.due) < today).map((x) => `${taskLine(x.t, zone, at)} · ${strings.daysLate(today - dayNumber(zone, x.due))}`);
  return [...(dueToday.length ? [strings.digestDueToday, ...dueToday] : []), ...(late.length ? [strings.digestLate, ...late] : [])];
}

/** The calendar day in `zone` as a count of days, so two instants compare by date and not by hours between them. */
function dayNumber(zone: string, at: number): number {
  const w = wallClock(zone, at);
  return Math.floor(Date.UTC(w.year, w.month - 1, w.day) / DAY_MS);
}
