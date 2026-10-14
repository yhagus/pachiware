import { db, schedules, guildConfigs, eq, and, type DigestChannel, type Schedule } from "@pachiware/db";
import { isNull } from "drizzle-orm";
import { now, nextOccurrence, wallClock, hhmm, loadTasks, workspaceStore, dueMoment, taskLine, type Strings } from "@pachiware/skills";

const hourText = (hour: number) => hhmm(hour, 0);
const DAY_MS = 24 * 60 * 60_000;

/** After the tenant's zone changed: the guilds without a zone of their own follow it, so their Digest rows move with it. */
export async function syncTenantDigestSchedules(tenantId: string, timezone: string) {
  const guilds = await db.select({ botId: guildConfigs.botId, guildId: guildConfigs.guildId, digestChannels: guildConfigs.digestChannels }).from(guildConfigs).where(and(eq(guildConfigs.tenantId, tenantId), isNull(guildConfigs.timezone)));
  for (const guild of guilds) if (guild.digestChannels.length) await syncDigestSchedules({ tenantId, botId: guild.botId, guildId: guild.guildId, timezone }, guild.digestChannels);
}

/**
 * One active `digest` row per opted-in channel of the guild, daily at its hour in `timezone`; rows of channels no longer listed are cancelled.
 * A row whose hour and zone already match is left alone, so an unrelated settings save never moves a Digest.
 */
export async function syncDigestSchedules(where: { tenantId: string; botId: string; guildId: string; timezone: string }, entries: DigestChannel[]) {
  const active = await db.select().from(schedules).where(and(eq(schedules.botId, where.botId), eq(schedules.guildId, where.guildId), eq(schedules.kind, "digest"), eq(schedules.status, "active")));
  const wanted = new Map(entries.map((e) => [e.channelId, e]));
  const at = now();
  for (const row of active) {
    const entry = wanted.get(row.channelId);
    if (!entry) { await db.update(schedules).set({ status: "cancelled" }).where(eq(schedules.id, row.id)); continue; }
    wanted.delete(row.channelId);
    const timeOfDay = hourText(entry.hour);
    if (row.timeOfDay === timeOfDay && row.timezone === where.timezone) continue;
    const next = nextOccurrence({ recurrence: "daily", weekdays: [], dayOfMonth: null, timeOfDay, timezone: where.timezone, until: null }, at)!;
    await db.update(schedules).set({ timeOfDay, timezone: where.timezone, nextAt: new Date(next), attempts: 0, error: null }).where(eq(schedules.id, row.id));
  }
  for (const entry of wanted.values()) {
    const timeOfDay = hourText(entry.hour);
    const next = nextOccurrence({ recurrence: "daily", weekdays: [], dayOfMonth: null, timeOfDay, timezone: where.timezone, until: null }, at)!;
    await db.insert(schedules).values({ tenantId: where.tenantId, botId: where.botId, kind: "digest", guildId: where.guildId, channelId: entry.channelId, recurrence: "daily", timeOfDay, timezone: where.timezone, nextAt: new Date(next) });
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
  const open = (await loadTasks(workspaceStore(), { tenantId: row.tenantId, guildId: row.guildId, channelId: row.channelId })).filter((f) => f.path.startsWith(folder)).map((f) => f.task).filter((t) => t.status !== "completed");
  const dated = open.map((t) => ({ t, due: dueMoment(t.dueAt, zone) })).filter((x): x is { t: typeof x.t; due: number } => x.due !== null).sort((a, b) => a.due - b.due || a.t.createdAt.localeCompare(b.t.createdAt));
  const dueToday = dated.filter((x) => dayNumber(zone, x.due) === today).map((x) => taskLine(x.t, zone, at));
  const late = dated.filter((x) => dayNumber(zone, x.due) < today).map((x) => `${taskLine(x.t, zone, at)} · ${strings.daysLate(today - dayNumber(zone, x.due))}`);
  return [...(dueToday.length ? [strings.digestDueToday, ...dueToday] : []), ...(late.length ? [strings.digestLate, ...late] : [])];
}

/** The calendar day in `zone` as a count of days, so two instants compare by date and not by hours between them. */
function dayNumber(zone: string, at: number): number {
  const w = wallClock(zone, at);
  return Math.floor(Date.UTC(w.year, w.month - 1, w.day) / DAY_MS);
}
