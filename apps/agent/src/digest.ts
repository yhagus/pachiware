import { repositories, type DigestChannel, type Schedule, type ScheduleKind } from "@pachiware/db";
import { now, nextOccurrence, wallClock, hhmm, loadTasks, readInFull, workspaceStore, dueMoment, taskLine, isOpen, DAY_MS, type Strings } from "@pachiware/skills";

const hourText = (hour: number) => hhmm(hour, 0);

/** A guild of one bot and the zone its daily rows follow. */
export type GuildPlace = { tenantId: string; botId: string; guildId: string; timezone: string };

/** One active `digest` row per opted-in channel of the guild, daily at its hour in `timezone`; rows of channels no longer listed are cancelled. */
export const syncDigestSchedules = (where: GuildPlace, entries: DigestChannel[]) => syncDailyRows("digest", where, new Map(entries.map((e) => [e.channelId, hourText(e.hour)])));

/** One active `kind` row per channel of `wanted` at its time of day, other rows cancelled; a row whose time and zone already match is left alone, so an unrelated settings save never moves it. */
export async function syncDailyRows(kind: ScheduleKind, where: GuildPlace, wanted: Map<string, string>) {
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
