import { repositories, type DailyLogChannel } from "@pachiware/db";
import { now, addDays, textIn, type Language } from "@pachiware/skills";
import { syncDailyRows, type GuildPlace } from "../digest.js";
import { writeDailyLog, dayBefore, type DailyLogResult } from "./dailyLog.js";
import type { DiscordBotManager } from "./client.js";

/** Turning Daily logs on with the backfill tick writes this many days before today. */
export const BACKFILL_DAYS = 30;
/** Nights missed while the bot was down are written on start, this many days back at most. */
export const CATCH_UP_DAYS = 7;
/** When a channel's Daily log of the day before is written, in the place's zone. */
export const DAILY_LOG_TIME = "00:30";

type Manager = Pick<DiscordBotManager, "clientOf" | "adapterOf">;
export type DailyLogPlace = GuildPlace & { channelId: string };

/**
 * One active `daily-log` row per channel with Daily logs, daily at DAILY_LOG_TIME in `timezone`, with no owner and no text: the row says only which bot
 * writes which channel's Daily log and when; whether to backfill stays on the guild settings. Rows of channels turned off are cancelled.
 */
export const syncDailyLogSchedules = (where: GuildPlace, entries: DailyLogChannel[]) => syncDailyRows("daily-log", where, new Map(entries.map((e) => [e.channelId, DAILY_LOG_TIME])));

/** The `count` days before the day `at` falls on in `zone`, oldest first. */
export function daysBefore(zone: string, at: number, count: number): string[] {
  const yesterday = dayBefore(zone, at);
  return Array.from({ length: count }, (_, i) => addDays(yesterday, i - count + 1));
}

/** The days from `first` to `last`, both included, oldest first; none when `first` comes after `last`. */
export function daysFrom(first: string, last: string): string[] {
  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Writes the channel's Daily log of each day that has none yet, oldest first, one run per channel at a time, so no day is written twice.
 * A day that fails is logged and left for a later catch-up. Resolves to each day's result; none when the bot cannot reach the channel.
 */
export function writeMissingDays(manager: Manager, place: DailyLogPlace, days: string[]): Promise<DailyLogResult[]> {
  const key = `${place.tenantId}:${place.guildId}:${place.channelId}`;
  const pending = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => writeDays(manager, place, days));
  queues.set(key, pending);
  void pending.finally(() => { if (queues.get(key) === pending) queues.delete(key); }).catch(() => {});
  return pending;
}

async function writeDays(manager: Manager, place: DailyLogPlace, days: string[]): Promise<DailyLogResult[]> {
  const adapter = manager.adapterOf(place.botId, place.guildId);
  const channel: any = await manager.clientOf(place.botId)?.channels.fetch(place.channelId).catch(() => null);
  if (!adapter || !channel) return [];
  const results: DailyLogResult[] = [];
  for (const day of days) {
    const run = { ...place, channelName: channel.name ?? place.channelId, day, adapter };
    const result = await writeDailyLog(run).catch((error) => { console.error(`[daily-log] ${place.channelId} ${day}:`, error?.message ?? error); return "failed" as const; });
    if (result === "failed") console.error(`[daily-log] could not write ${place.channelId} ${day}`);
    results.push(result);
  }
  return results;
}

/**
 * Each channel whose Daily logs were just turned on: the backfill when ticked, then one notice from this bot in `language` saying what was recorded.
 * Runs in the background and is not retried; nothing is posted when the bot is offline or cannot post there.
 */
export function startDailyLogs(manager: Manager & Pick<DiscordBotManager, "background">, where: GuildPlace, turnedOn: DailyLogChannel[], language: Language) {
  if (!manager.clientOf(where.botId)) return;
  const notice = textIn(language).dailyLogNotice;
  for (const { channelId, backfill } of turnedOn) {
    manager.background((async () => {
      const results = backfill ? await writeMissingDays(manager, { ...where, channelId }, daysBefore(where.timezone, now(), BACKFILL_DAYS)) : [];
      const recorded = !backfill ? "none" : results.some((r) => r === "failed" || r === "off") ? "incomplete" : "done";
      const channel: any = await manager.clientOf(where.botId)?.channels.fetch(channelId).catch(() => null);
      if (channel?.isTextBased?.()) await channel.send({ content: notice(recorded, BACKFILL_DAYS), allowedMentions: { parse: [] } }).catch(() => {});
    })());
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
