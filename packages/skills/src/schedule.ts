import type { Schedule } from "@pachiware/db";
import { DAY_MS, wallClock, wallToInstant } from "./clock.js";

/** A row later than this is skipped rather than posted (ADR 0006). */
export const LATE_LIMIT_MS = 6 * 60 * 60_000;
/** A row later than this posts with the late note; under it is the minute loop's own delay. */
export const LATE_NOTE_MS = 5 * 60_000;
/** The waits between a failed post and the next attempt. nextAt keeps the due time, so each wait counts from the due time on: 1, 6, then 36 minutes past it. */
export const RETRY_AFTER_MS = [60_000, 5 * 60_000, 30 * 60_000];
/** Posting failures before a row gives up on this time: a repeating row moves to its next time, a one-off ends with an error note. */
export const MAX_POST_ATTEMPTS = RETRY_AFTER_MS.length + 1;
/** How long past its due time a row that failed `attempts` times waits before trying again. */
export const retryDelay = (attempts: number) => RETRY_AFTER_MS.slice(0, attempts).reduce((sum, ms) => sum + ms, 0);

export type Recurrence = Pick<Schedule, "recurrence" | "weekdays" | "dayOfMonth" | "timeOfDay" | "timezone" | "until">;

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const TIME = /^(\d{2}):(\d{2})$/;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

type Day = { year: number; month: number; day: number };
const dayFrom = (utc: number): Day => { const d = new Date(utc); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }; };
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const clockTime = (hour: number, minute: number) => hour <= 23 && minute <= 59;

/** The next time a schedule fires after `after`, in the row's zone, or null when it is over: a `once` row, or a repeating one past `until`. A monthly day past the month's end lands on its last day. */
export function nextOccurrence(schedule: Recurrence, after: number): number | null {
  const m = schedule.recurrence === "once" ? null : TIME.exec(schedule.timeOfDay ?? "");
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2]), zone = schedule.timezone;
  const at = (d: Day) => wallToInstant(zone, { ...d, hour, minute, second: 0 });
  const start = wallClock(zone, after);
  let next: number | null = null;
  if (schedule.recurrence === "monthly") {
    const wanted = schedule.dayOfMonth ?? 1;
    for (let i = 0; i <= 1 && next === null; i++) {
      const month = ((start.month - 1 + i) % 12) + 1, year = start.year + (start.month + i > 12 ? 1 : 0);
      const t = at({ year, month, day: Math.min(wanted, daysInMonth(year, month)) });
      if (t > after) next = t;
    }
  } else {
    const days = schedule.recurrence === "weekly" ? schedule.weekdays : EVERY_DAY;
    const from = Date.UTC(start.year, start.month - 1, start.day);
    for (let i = 0; i <= 7 && next === null; i++) {
      const utc = from + i * DAY_MS;
      if (!days.includes(new Date(utc).getUTCDay())) continue;
      const t = at(dayFrom(utc));
      if (t > after) next = t;
    }
  }
  return next !== null && schedule.until && next > schedule.until.getTime() ? null : next;
}

/** A person's time as an instant: ISO text with an offset as written; a date-time without one as the wall clock in `timeZone`; "HH:MM" as that time today in `timeZone`, or tomorrow once it has passed. Null when it is not a time. */
export function parseWhen(input: unknown, timeZone: string, from: number): number | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  let m = DATE_TIME.exec(text);
  if (m) {
    const [year, month, day, hour, minute, second = 0] = m.slice(1).map((n) => (n === undefined ? 0 : Number(n)));
    // A day or time that does not exist ("30 February", "09:75") would roll over into another one.
    if (month! < 1 || month! > 12 || day! < 1 || day! > daysInMonth(year!, month!) || !clockTime(hour!, minute!) || second > 59) return null;
    const at = wallToInstant(timeZone, { year: year!, month: month!, day: day!, hour: hour!, minute: minute!, second });
    return Number.isNaN(at) ? null : at;
  }
  m = TIME.exec(text);
  if (m) {
    const today = wallClock(timeZone, from), hour = Number(m[1]), minute = Number(m[2]);
    if (!clockTime(hour, minute)) return null;
    const at = wallToInstant(timeZone, { ...today, hour, minute, second: 0 });
    return at > from ? at : wallToInstant(timeZone, { ...wallClock(timeZone, from + DAY_MS), hour, minute, second: 0 });
  }
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) return null;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : at;
}
