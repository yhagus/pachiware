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

/** "Friday, 6 March 2026, 09:30 Asia/Jakarta (UTC+07:00)": what the model needs to resolve "Friday" and "in two hours". */
export function describeTime(timeZone: string, at = now()): string {
  const date = new Date(at);
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", ...o }).format(date);
  const wall = new Date(part({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/(\d+)\/(\d+)\/(\d+), (\d+:\d+:\d+)/, "$3-$2-$1T$4Z"));
  const offset = Math.round((wall.getTime() - date.getTime()) / 60_000);
  const sign = offset < 0 ? "-" : "+", abs = Math.abs(offset);
  return `${part({ weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${part({ hour: "2-digit", minute: "2-digit" })} ${timeZone} (UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")})`;
}
