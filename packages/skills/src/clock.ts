/**
 * The one clock the agent's time-of-business code reads: the time line in the turn context, task dates,
 * minutes windows, and the scheduler. Tests pin or advance it through `setClock`; bookkeeping stamps
 * (cache TTLs, updatedAt columns) stay on the real clock.
 */
let source: () => number = () => Date.now();
/** Milliseconds since the epoch. */
export const now = () => source();
export const today = () => new Date(now());
/** Tests only: `null` returns to the real clock. */
export function setClock(fn: (() => number) | null) { source = fn ?? (() => Date.now()); }

export const DEFAULT_TIMEZONE = "Asia/Jakarta";

/** The canonical IANA name when `value` names a zone, else null. */
export function canonicalTimezone(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || !value.includes("/") && value.trim().toUpperCase() !== "UTC") return null;
  try { return new Intl.DateTimeFormat("en-US", { timeZone: value.trim() }).resolvedOptions().timeZone; } catch { return null; }
}

/** The zone for a place: the guild's override, else the tenant's. */
export const configuredTimezone = (...levels: ({ timezone?: string | null } | null | undefined)[]): string => levels.find((l) => l?.timezone)?.timezone ?? DEFAULT_TIMEZONE;

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** What a clock on the wall in `timeZone` shows at `at`. */
export function wallClock(timeZone: string, at = now()): WallClock {
  const text = new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(at));
  const [, day, month, year, hour, minute, second] = /(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)/.exec(text)!.map(Number);
  return { year: year!, month: month!, day: day!, hour: hour!, minute: minute!, second: second! };
}

/** Minutes east of UTC in `timeZone` at `at`. */
export function zoneOffset(timeZone: string, at = now()): number {
  const w = wallClock(timeZone, at);
  return Math.round((Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - at) / 60_000);
}

/** The instant when the wall clock in `timeZone` shows these parts. Across a DST change the offset of the result is read once more, so a time in the gap lands on the offset after the change. */
export function wallToInstant(timeZone: string, w: Omit<WallClock, "second"> & { second?: number }): number {
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second ?? 0);
  const first = asUtc - zoneOffset(timeZone, asUtc) * 60_000;
  return asUtc - zoneOffset(timeZone, first) * 60_000;
}

const two = (n: number) => String(n).padStart(2, "0");
/** "2026-03-06T15:00:00+07:00": `at` as the wall clock in `timeZone` reads it, with its offset. */
export function isoInZone(timeZone: string, at = now()): string {
  const w = wallClock(timeZone, at), offset = zoneOffset(timeZone, at), abs = Math.abs(offset);
  return `${w.year}-${two(w.month)}-${two(w.day)}T${two(w.hour)}:${two(w.minute)}:${two(w.second)}${offset < 0 ? "-" : "+"}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

/** "Friday, 6 March 2026, 09:30 Asia/Jakarta (UTC+07:00)": what the model needs to resolve "Friday" and "in two hours". */
export function describeTime(timeZone: string, at = now()): string {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", ...o }).format(new Date(at));
  return `${part({ weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${part({ hour: "2-digit", minute: "2-digit" })} ${timeZone} (UTC${isoInZone(timeZone, at).slice(19)})`;
}
