/** Reading the model's arguments for Plane write tools: trimmed text, "none", name lists, dates and titles. */

/** Trimmed text, or null when empty or not a string. */
export const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
export const isNone = (v: unknown) => text(v)?.toLowerCase() === "none";

/** A list of names; a single string counts as a list of one. */
export function list(v: unknown, what: string): string[] {
  if (v === undefined || v === null) return [];
  if (typeof v === "string") return [v];
  if (!Array.isArray(v)) throw new Error(`${what} must be a list of names`);
  return v.map(String);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD date: undefined when not given, null for "none" (which clears it). */
export function date(v: unknown, what: string): string | null | undefined {
  const d = text(v);
  if (d === null) return undefined;
  if (isNone(d)) return null;
  if (!DAY.test(d) || Number.isNaN(Date.parse(d))) throw new Error(`${what} must be a date such as 2026-10-20, or "none"`);
  return d;
}

/** A title of at most 255 characters, or null when not given. */
export function title(v: unknown, what = "name"): string | null {
  const name = text(v);
  if (name && name.length > 255) throw new Error(`${what} must be at most 255 characters`);
  return name;
}

export const clip = (s: string, max = 300) => (s.length > max ? `${s.slice(0, max)}…` : s);
