import { repositories, type DailyLogChannel, type Schedule } from "@pachiware/db";
import { now, addDays, textIn, audit, failureOf, type Language } from "@pachiware/skills";
import { syncDailyRows, type GuildPlace } from "../digest.js";
import { writeDailyLog, dayBefore, daySpan, type DailyLogResult } from "./dailyLog.js";
import type { DiscordBotManager } from "./client.js";

/** Turning Daily logs on with the backfill tick writes this many days before today. */
export const BACKFILL_DAYS = 30;
/** Days a `daily-log` row still owes (nights missed while the bot was down, days whose write failed) are written this many days back at most. */
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
    let thrown: unknown;
    const result = await writeDailyLog(run).catch((error) => { thrown = error; return "failed" as const; });
    if (result === "failed") {
      const failure = thrown === undefined ? { error: "Unwritable", message: "the model gave no Daily log that could be read" } : failureOf(thrown);
      console.error(`[daily-log] could not write ${place.channelId} ${day}: ${failure.error}: ${failure.message}`);
      await audit({ tenantId: place.tenantId, botId: place.botId }, "daily_log_failed", { channelId: place.channelId, day, ...failure });
    }
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

/**
 * The first day a `daily-log` row still owes: the day its last run ended on, or, before any run, the day before it first came due.
 * Every day before it was handled: written, already there, without talk, or refused because an Availability rule turned the playbook off then.
 */
const owedFrom = (row: Schedule) => (row.lastFiredAt ? addDays(dayBefore(row.timezone, row.lastFiredAt.getTime()), 1) : dayBefore(row.timezone, row.nextAt.getTime()));

/**
 * Writes the Daily logs `row` still owes at `at`, up to yesterday and the last CATCH_UP_DAYS at most, and posts nothing.
 * Resolves to the row's next `lastFiredAt`: `at` when every day was handled, else the start of the first day still owed, so the next run or start writes it.
 * A day refused because the playbook was off counts as handled, so lifting the rule later never writes the nights it covered.
 */
export async function writeOwedDays(manager: Manager, row: Schedule & { guildId: string }, at: number): Promise<Date> {
  const recent = daysBefore(row.timezone, at, CATCH_UP_DAYS);
  const days = daysFrom(owedFrom(row), recent.at(-1)!).filter((day) => day >= recent[0]!);
  const place = { tenantId: row.tenantId, botId: row.botId, guildId: row.guildId, channelId: row.channelId, timezone: row.timezone };
  const results = days.length ? await writeMissingDays(manager, place, days) : [];
  const owed = days.find((_, i) => results[i] === undefined || results[i] === "failed");
  return owed ? new Date(daySpan(row.timezone, owed).since) : new Date(at);
}

/** On start: every channel this bot keeps Daily logs of gets the days its row still owes written. */
export async function catchUpDailyLogs(manager: Manager, botId: string) {
  const { schedules } = repositories();
  for (const row of await schedules.list({ botId, kind: "daily-log", status: "active" })) {
    if (row.guildId) await schedules.update(row.id, { lastFiredAt: await writeOwedDays(manager, { ...row, guildId: row.guildId }, now()) });
  }
}
