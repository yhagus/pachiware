import { repositories } from "@pachiware/db";
import { now } from "@pachiware/skills";
import { writeDailyLog, dayBefore } from "./dailyLog.js";
import type { DiscordBotManager } from "./client.js";

/** Turning Daily logs on with the backfill tick writes this many days before today. */
export const BACKFILL_DAYS = 30;
/** Nights missed while the bot was down are written on start, this many days back at most. */
export const CATCH_UP_DAYS = 7;

type Manager = Pick<DiscordBotManager, "clientOf" | "adapterOf">;
export type DailyLogPlace = { tenantId: string; botId: string; guildId: string; channelId: string; timezone: string };

const DAY_MS = 24 * 3600_000;
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The `count` days before the day `at` falls on in `zone`, oldest first. */
export function daysBefore(zone: string, at: number, count: number): string[] {
  const yesterday = dayBefore(zone, at);
  return Array.from({ length: count }, (_, i) => shift(yesterday, i - count + 1));
}

/** The days from `first` to `last`, both included, oldest first; none when `first` comes after `last`. */
export function daysFrom(first: string, last: string): string[] {
  const days: string[] = [];
  for (let day = first; day <= last; day = shift(day, 1)) days.push(day);
  return days;
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Writes the channel's Daily log of each day that has none yet, oldest first; a day already logged is never rewritten.
 * One channel's days are written one run at a time, so a backfill, a catch-up and the nightly row never write the same day twice.
 * A day that fails is logged and left missing for a later catch-up.
 */
export function writeMissingDays(manager: Manager, place: DailyLogPlace, days: string[]): Promise<void> {
  const key = `${place.tenantId}:${place.guildId}:${place.channelId}`;
  const pending = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => writeDays(manager, place, days));
  queues.set(key, pending);
  void pending.finally(() => { if (queues.get(key) === pending) queues.delete(key); }).catch(() => {});
  return pending;
}

async function writeDays(manager: Manager, place: DailyLogPlace, days: string[]) {
  const adapter = manager.adapterOf(place.botId, place.guildId);
  const channel: any = await manager.clientOf(place.botId)?.channels.fetch(place.channelId).catch(() => null);
  if (!adapter || !channel) return;
  for (const day of days) {
    const run = { ...place, channelName: channel.name ?? place.channelId, day, adapter };
    const result = await writeDailyLog(run).catch((error) => { console.error(`[daily-log] ${place.channelId} ${day}:`, error?.message ?? error); return "failed" as const; });
    if (result === "failed") console.error(`[daily-log] could not write ${place.channelId} ${day}`);
  }
}

/** On start: every channel this bot keeps Daily logs of gets the missing days of the last week written. */
export async function catchUpDailyLogs(manager: Manager, botId: string) {
  const rows = await repositories().schedules.list({ botId, kind: "daily-log", status: "active" });
  for (const row of rows) {
    if (!row.guildId) continue;
    const place = { tenantId: row.tenantId, botId, guildId: row.guildId, channelId: row.channelId, timezone: row.timezone };
    await writeMissingDays(manager, place, daysBefore(row.timezone, now(), CATCH_UP_DAYS));
  }
}
