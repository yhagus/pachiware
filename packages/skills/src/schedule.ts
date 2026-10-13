import type { Schedule } from "@pachiware/db";
import { wallClock, wallToInstant } from "./clock.js";

/** A row later than this is skipped rather than posted (ADR 0006). */
export const LATE_LIMIT_MS = 6 * 60 * 60_000;
/** Posting failures before a row is marked done with an error note. */
export const MAX_POST_ATTEMPTS = 3;

export type Recurrence = Pick<Schedule, "recurrence" | "weekdays" | "dayOfMonth" | "timeOfDay" | "timezone" | "until">;

/** The next time a schedule fires after `after`, or null when it is over: a `once` row, or a repeating one past `until`. */
export function nextOccurrence(schedule: Recurrence, after: number): number | null {
  // ponytail: daily, weekly and monthly land with #90; until then every row ends after its first time.
  void schedule; void after;
  return null;
}

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const TIME = /^(\d{2}):(\d{2})$/;

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
