import type { Schedule } from "@pachiware/db";
import { wallClock, wallToInstant } from "./clock.js";

/** A row later than this is skipped rather than posted (ADR 0006). */
export const LATE_LIMIT_MS = 6 * 60 * 60_000;
/** Posting failures before a row is marked done with an error note. */
export const MAX_POST_ATTEMPTS = 3;

export type Recurrence = Pick<Schedule, "recurrence" | "weekdays" | "dayOfMonth" | "timeOfDay" | "timezone" | "until">;

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const TIME = /^(\d{2}):(\d{2})$/;
const DAY_MS = 24 * 60 * 60_000;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

type Day = { year: number; month: number; day: number };
const dayFrom = (utc: number): Day => { const d = new Date(utc); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }; };
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

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
    const at = wallToInstant(timeZone, { year: year!, month: month!, day: day!, hour: hour!, minute: minute!, second });
    return Number.isNaN(at) ? null : at;
  }
  m = TIME.exec(text);
  if (m) {
    const today = wallClock(timeZone, from), hour = Number(m[1]), minute = Number(m[2]);
    const at = wallToInstant(timeZone, { ...today, hour, minute, second: 0 });
    return at > from ? at : wallToInstant(timeZone, { ...wallClock(timeZone, from + 24 * 60 * 60_000), hour, minute, second: 0 });
  }
  if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) return null;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : at;
}
