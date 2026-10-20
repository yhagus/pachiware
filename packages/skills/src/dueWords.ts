/**
 * A due date people wrote in words ("Jumat", "besok", "20 Oktober", "end of month") as the day it names, counted from `from`,
 * the day it was said (YYYY-MM-DD). Null when the words name no single day, such as "minggu depan" or "ASAP": the text then stays as written.
 */
export function dueFromWords(text: string | null | undefined, from: string): string | null {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
  const said = text.toLowerCase().normalize("NFKC").replace(/[’']/g, "").replace(/\s+/g, " ").trim();
  const base = new Date(`${from}T00:00:00Z`);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const plus = (days: number) => iso(new Date(base.getTime() + days * 86_400_000));
  const real = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? iso(t) : null; };
  // A day without a year is the next one on or after the day it was said.
  const upcoming = (m: number, d: number) => { const y = base.getUTCFullYear(), same = real(y, m, d); return same && same >= from ? same : real(y + 1, m, d); };

  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(said);
  if (m) return real(Number(m[1]), Number(m[2]), Number(m[3]));
  // Day first, as Indonesian and most English outside the US write it: 20/10, 20/10/2026, 20-10-2026. A dot is a time ("17.00"), never a date.
  m = /(?<![\d.:])(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?![\d.:])/.exec(said);
  if (m) { const y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : null; return y ? real(y, Number(m[2]), Number(m[1])) : upcoming(Number(m[2]), Number(m[1])); }
  m = new RegExp(`\\b(\\d{1,2}) (${MONTH_WORDS})\\b(?: (\\d{4}))?`).exec(said) ?? null;
  if (m) { const month = monthOf(m[2]!); return m[3] ? real(Number(m[3]), month, Number(m[1])) : upcoming(month, Number(m[1])); }
  m = new RegExp(`\\b(${MONTH_WORDS}) (\\d{1,2})(?:st|nd|rd|th)?\\b(?:,? (\\d{4}))?`).exec(said);
  if (m) { const month = monthOf(m[1]!); return m[3] ? real(Number(m[3]), month, Number(m[2])) : upcoming(month, Number(m[2])); }

  // "minggu depan" and "next week" name a week, not a day; "minggu" alone is Sunday.
  if (/\b(minggu|pekan) (depan|ini)\b|\b(next|this) week\b/.test(said)) return null;
  if (/\b(hari ini|today|eod|end of (the )?day)\b/.test(said)) return from;
  if (/\b(besok|tomorrow)\b/.test(said)) return plus(1);
  if (/\blusa\b|\bday after tomorrow\b/.test(said)) return plus(2);
  if (/\b(akhir bulan|end of (the )?month|eom)\b/.test(said)) return iso(new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)));

  // "1.5 minggu" is a span, not a day: never read as Sunday ("Minggu").
  if (/\d[.,]\d+ (hari|days?|minggu|pekan|weeks?)\b/.test(said)) return null;
  m = /(?<![\d.,])(\d{1,2}) (hari|days?|minggu|pekan|weeks?)\b/.exec(said);
  if (m) return plus(Number(m[1]) * (/^(hari|day)/.test(m[2]!) ? 1 : 7));

  const day = WEEKDAYS.findIndex((words) => words.some((w) => new RegExp(`\\b${w}\\b`).test(said)));
  if (day < 0) return null;
  // The coming one, never the day it was said; "Jumat depan" or "next Friday" is the one in the following week.
  const today = base.getUTCDay(), ahead = (day - today + 7) % 7 || 7;
  const next = /\b(depan|next)\b/.test(said) && ahead + today <= 7 ? ahead + 7 : ahead;
  return plus(next);
}

/** Sunday first, as Date.getUTCDay counts; Indonesian then English, with common short forms. */
const WEEKDAYS = [
  ["minggu", "ahad", "sunday", "sun"], ["senin", "monday", "mon"], ["selasa", "tuesday", "tue", "tues"], ["rabu", "wednesday", "wed"],
  ["kamis", "thursday", "thu", "thurs"], ["jumat", "jum at", "friday", "fri"], ["sabtu", "saturday", "sat"],
];
/** Each month's names, Indonesian and English, whole words only, so "maybe" is never May. */
const MONTHS = [
  ["jan", "januari", "january"], ["feb", "peb", "februari", "pebruari", "february"], ["mar", "maret", "march"], ["apr", "april"], ["mei", "may"], ["jun", "juni", "june"],
  ["jul", "juli", "july"], ["agu", "ags", "agustus", "aug", "august"], ["sep", "sept", "september"], ["okt", "oktober", "oct", "october"], ["nov", "nop", "november", "nopember"], ["des", "desember", "dec", "december"],
];
export const MONTH_WORDS = MONTHS.flat().sort((a, b) => b.length - a.length).join("|");
const monthOf = (word: string) => MONTHS.findIndex((forms) => forms.includes(word)) + 1;
