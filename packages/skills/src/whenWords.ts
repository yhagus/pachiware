import { DAY_MS, hhmm, isoInZone, wallToInstant } from "./clock.js";
import { dueFromWords, MONTH_WORDS } from "./dueWords.js";
import { nextOccurrence, parseWhen, type Recurrence } from "./schedule.js";

/**
 * When and how often a Reminder or Routine runs, read from the asker's own words ("jam 9 pagi setiap hari kerja"). The model's
 * arguments are checked against this reading, so what the words leave open ("jam 9": morning or evening? once or every day?)
 * is asked about, never guessed.
 */

/** How often the words say a schedule runs. */
export type Repeat = { recurrence: "once" } | { recurrence: "daily" } | { recurrence: "weekly"; weekdays: number[] } | { recurrence: "monthly"; dayOfMonth: number };
/** What the words leave open: an hour without morning or evening, no time at all, no repetition, a weekly one's days, a monthly one's date, "setiap minggu" (every week or every Sunday), or two zones. */
export type Unclear = "am-pm" | "time" | "repetition" | "days" | "date" | "week-or-sunday" | "zone";

export interface WhenReading {
  /** The clock time, "HH:MM", once the words fix one. */
  time: string | null;
  /** The two clock times an hour said without morning or evening may be, the earlier first ("jam 9": 09:00 and 21:00). */
  either: [string, string] | null;
  /** A span from when it was said ("30 menit lagi"), in milliseconds. */
  after: number | null;
  repeat: Repeat | null;
  /** The day a once schedule runs on, YYYY-MM-DD in its zone, when the words name one. */
  day: string | null;
  /** The first day a repeating schedule may run ("mulai Senin"), YYYY-MM-DD. */
  start: string | null;
  /** The zone a zone word names (WIB, WITA, WIT, UTC). */
  zone: string | null;
  unclear: Unclear[];
  /** Words asking for something no schedule keeps ("tiap 2 jam", "30 menit sebelum rapat"), as written. */
  unsupported: string | null;
}

const EVERY = String.raw`(?:setiap|tiap-tiap|tiap2|tiap|saban|every|each)`;
const UNITS: Record<string, number> = { satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9 };
const UNIT_WORDS = Object.keys(UNITS).join("|");
/** "one" stays a word: "one time" is a way to say once. */
const NUMBER_WORDS: Record<string, number> = {
  ...UNITS, sepuluh: 10, sebelas: 11, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30,
};
const ZONES: Record<string, string> = { wib: "Asia/Jakarta", wita: "Asia/Makassar", wit: "Asia/Jayapura", utc: "UTC", gmt: "UTC" };

/** Sunday first, as Date.getUTCDay counts; Indonesian, then English with plurals ("mondays") and short forms. */
const DAY_NAMES = [
  ["minggu", "ahad", "sunday", "sundays", "sun"], ["senin", "monday", "mondays", "mon"], ["selasa", "tuesday", "tuesdays", "tue", "tues"], ["rabu", "wednesday", "wednesdays", "wed"],
  ["kamis", "thursday", "thursdays", "thu", "thurs"], ["jumat", "friday", "fridays", "fri"], ["sabtu", "saturday", "saturdays", "sat"],
];
const DAY = `(?:${DAY_NAMES.flat().sort((a, b) => b.length - a.length).join("|")})`;
const dayNumber = (word: string) => DAY_NAMES.findIndex((names) => names.includes(word));
const WORK_DAYS = [1, 2, 3, 4, 5], WEEKEND = [0, 6];

/** Parts of the day, longest first. */
const PARTS = "dini hari|tengah malam|tengah hari|in the morning|in the afternoon|in the evening|at night|tonight|pagi|siang|sore|petang|malam|subuh|morning|afternoon|evening|night|a\\.m\\.|p\\.m\\.|am|pm";
const PART_OF: Record<string, string> = { "in the morning": "morning", "in the afternoon": "afternoon", "in the evening": "evening", "at night": "night", tonight: "night", "a.m.": "am", "p.m.": "pm" };
const part = (word: string) => PART_OF[word] ?? word;
/** The hour on a 24-hour clock that an hour said with a part of the day names, or null when the two do not go together ("jam 12 pagi", "jam 8 sore"). */
const HOUR_IN: Record<string, (h: number) => number | null> = {
  pagi: (h) => (h >= 1 && h <= 11 ? h : null),
  morning: (h) => (h >= 1 && h <= 11 ? h : null),
  am: (h) => (h === 12 ? 0 : h),
  subuh: (h) => (h >= 3 && h <= 6 ? h : null),
  "dini hari": (h) => (h === 12 ? 0 : h <= 4 ? h : null),
  siang: (h) => (h === 12 ? 12 : h >= 10 ? h : h <= 5 ? h + 12 : null),
  "tengah hari": (h) => (h === 12 ? 12 : null),
  afternoon: (h) => (h === 12 ? 12 : h <= 6 ? h + 12 : null),
  pm: (h) => (h === 12 ? 12 : h + 12),
  sore: (h) => (h <= 7 ? h + 12 : null),
  petang: (h) => (h >= 4 && h <= 7 ? h + 12 : null),
  evening: (h) => (h >= 4 && h <= 11 ? h + 12 : null),
  malam: (h) => (h === 12 ? 0 : h >= 6 ? h + 12 : h <= 3 ? h : null),
  night: (h) => (h === 12 ? 0 : h >= 6 ? h + 12 : h <= 3 ? h : null),
  "tengah malam": (h) => (h === 12 ? 0 : null),
};

/** Repetitions no schedule keeps: by the hour or minute, every other day or week, yearly, or relative to another event. */
const UNSUPPORTED = [
  new RegExp(String.raw`\b${EVERY}\s+(?:\d+\s+)?(?:jam|menit|detik|hours?|minutes?|seconds?|hrs?|mins?)\b(?!\s*(?:setengah\s+)?\d)`),
  new RegExp(String.raw`\b${EVERY}\s+(?:[2-9]|\d{2,}|other)\s+(?:hari|minggu|pekan|bulan|days?|weeks?|months?)\b`),
  /\b(?:[2-9]|\d{2,})\s+(?:hari|minggu|pekan|bulan|jam|menit)\s+sekali\b/,
  new RegExp(String.raw`\b(?:hourly|biweekly|bi-weekly|fortnightly|yearly|annually|per jam|perjam|1 jam sekali|${EVERY}\s+(?:tahun|year))\b`),
  /\b\d+\s*(?:menit|jam|minutes?|hours?|hari|days?)\s+(?:sebelum|sebelumnya|setelah|sesudah|before|after)\b/,
];

const SPAN = String.raw`(\d+)\s*(jam|hours?|hrs?|menit|minutes?|mins?)(?:\s*(?:dan|and)?\s*(\d+)\s*(menit|minutes?|mins?))?`;
const LATER = new RegExp(String.raw`\b(?:(?:dalam|in)\s+(?:waktu\s+)?)?${SPAN}\s+(?:lagi|dari sekarang|from now|kemudian)\b|\b(?:dalam|in)\s+(?:waktu\s+)?${SPAN}\b`, "g");
const BARE_SPAN = new RegExp(String.raw`\b${SPAN}\b`, "g");
const spanMs = (n: string, unit: string, m?: string) => ((/^(?:jam|hour|hr)/.test(unit) ? Number(n) * 60 : Number(n)) + (m ? Number(m) : 0)) * 60_000;

const TODAY_WORDS = /\b(?:hari ini|today|tonight|nanti|malam ini|pagi ini|siang ini|sore ini|this (?:morning|afternoon|evening))\b/;
const ONCE_WORDS = /\b(?:sekali saja|sekali aja|hanya sekali|cuma sekali|sekali|just once|once|one time|1 kali)\b/;
const DATE_WORDS = new RegExp(String.raw`\b(?:besok|tomorrow|lusa|day after tomorrow|akhir bulan|end of (?:the )?month|\d+ (?:hari|days?) lagi|in \d+ days?)\b|\b\d{4}-\d{2}-\d{2}\b|(?<![\d.:])\d{1,2}[/-]\d{1,2}(?![\d.:])|\b\d{1,2} (?:${MONTH_WORDS})\b|\b(?:${MONTH_WORDS}) \d{1,2}\b`);

/** Lower case, without mentions, apostrophes and repeated spaces, number words as digits, and greetings ("selamat pagi") gone. */
function plainWords(text: string) {
  return text.toLowerCase().normalize("NFKC").replace(/<[@#][!&]?\d+>/g, " ").replace(/[’'`]/g, "").replace(/[–—]/g, "-")
    .replace(/\b(?:selamat|good)\s+(?:pagi|siang|sore|malam|morning|afternoon|evening|night)\b/g, " ")
    .replace(new RegExp(`\\b(${UNIT_WORDS}) puluh(?: (${UNIT_WORDS}))?\\b`, "g"), (_, a: string, b?: string) => String(10 * UNITS[a]! + (b ? UNITS[b]! : 0)))
    .replace(new RegExp(`\\b(${UNIT_WORDS}) belas\\b`, "g"), (_, a: string) => String(10 + UNITS[a]!))
    .replace(/\bsetengah jam\b|\bhalf an hour\b/g, "30 menit").replace(/\bseperempat jam\b|\ba quarter of an hour\b/g, "15 menit").replace(/\bsejam\b|\ban hour\b/g, "1 jam")
    .replace(new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "g"), (w) => String(NUMBER_WORDS[w]))
    .replace(/\s+/g, " ").trim();
}

/** A quote as matched against the asker's lines: plain words, without the punctuation or quote marks at its ends. */
export function quoteText(text: string) {
  return text.toLowerCase().normalize("NFKC").replace(/<[@#][!&]?\d+>/g, " ").replace(/[’'`]/g, "").replace(/\s+/g, " ").trim().replace(/^[\s"“”.,!?;:()-]+|[\s"“”.,!?;:()-]+$/g, "");
}

/** The first quote that none of the asker's lines holds, or null when each is their own words. */
export function unheardQuote(said: string[], lines: string[]): string | null {
  const heard = lines.map(quoteText);
  return said.find((q) => !quoteText(q) || !heard.some((line) => line.includes(quoteText(q)))) ?? null;
}

const dayOf = (zone: string, at: number) => isoInZone(zone, at).slice(0, 10);

/** The days from `a` to `b` going forward through the week, both included ("Jumat-Senin" is Friday to Monday). */
function dayRange(a: number, b: number) {
  const days = [a];
  for (let d = a; d !== b; ) days.push((d = (d + 1) % 7));
  return days;
}

/** `or`: offered as another choice ("jam 9 atau 21.00"), so the words fix no one time. */
type Clock = { minutes: number[]; or?: true };

/**
 * The clock times the words name, each as its possible minutes of the day: one when the words fix it, two for an hour said without
 * morning or evening, none when the hour and its part of the day do not go together. A bare number is a time only with "jam",
 * "pukul" or "at", with minutes ("9.30"), with "setengah", or with a part of the day ("9 pagi"), so "tanggal 25" never is.
 */
function clockTimes(t: string): Clock[] {
  const said = [...t.matchAll(new RegExp(`\\b(${PARTS})(?![\\w.])`, "g"))].map((m) => part(m[1]!));
  // A part of the day said apart from the hour ("jam 9", then "pagi" in an answer) counts when it is the only one said.
  const loose = new Set(said.filter((p) => p !== "am" && p !== "pm")).size === 1 ? said.find((p) => p !== "am" && p !== "pm")! : null;
  const clocks: Clock[] = [];
  const CLOCK = /(?:\b(jam|pukul|pkl\.?|at)\s+)?(?:\b(setengah)\s+)?(?<![\d.:/-])(\d{1,2})(?:[.:](\d{2}))?(?![\d/])(?:\s*(lewat|lebih|kurang)\s+(\d{1,2}|seperempat)(?:\s*menit)?)?/g;
  for (const m of t.matchAll(CLOCK)) {
    const [whole, lead, half, hourText, minuteText, offWord, offText] = m;
    const before = t.slice(0, m.index), rest = t.slice(m.index! + whole.length);
    if (/(?:tanggal|tgl\.?|the|on|tahun)\s*$/.test(before)) continue;
    const after = new RegExp(`^\\s*(${PARTS})(?![\\w.])`).exec(rest)?.[1];
    const ahead = new RegExp(`(?:^|\\s)(${PARTS})(?:\\s+ini)?\\s*,?\\s*$`).exec(before)?.[1];
    // "jam 9 atau 10" offers a second hour.
    const other = clocks.length > 0 && /\b(?:atau|or)\s+(?:(?:jam|pukul|pkl\.?|at)\s+)?$/.test(before);
    if (!lead && !minuteText && !half && !offWord && !after && !other) continue;
    const hour = Number(hourText), minute = minuteText ? Number(minuteText) : 0;
    if (hour > 23 || minute > 59) continue;
    const named = after ?? ahead ?? loose, p = named ? part(named) : null;
    let hours: number[];
    if (hour === 0 || hour >= 13) hours = [hour];
    else if (p && HOUR_IN[p]) { const h = HOUR_IN[p]!(hour); hours = h === null ? [] : [h]; }
    // A leading zero, or a two-digit hour with minutes ("09.00", "10.30"), is the 24-hour clock.
    else if (hourText!.startsWith("0") || (hourText!.length === 2 && minuteText)) hours = [hour];
    else hours = hour === 12 ? [12, 0] : [hour, hour + 12];
    const shift = (offWord ? (offWord === "kurang" ? -1 : 1) * (offText === "seperempat" ? 15 : Number(offText)) : 0) - (half ? 30 : 0);
    clocks.push({ minutes: hours.map((h) => (((h * 60 + minute + shift) % 1440) + 1440) % 1440), ...(other ? { or: true as const } : {}) });
  }
  if (/\b(?:noon|midday|tengah hari)\b/.test(t)) clocks.push({ minutes: [720] });
  if (/\b(?:midnight|tengah malam)\b/.test(t)) clocks.push({ minutes: [0] });
  return clocks;
}

const asTime = (minutes: number) => hhmm(Math.floor(minutes / 60), minutes % 60);

/**
 * Reads when and how often from the asker's words, as said at `from` in `timeZone` (a zone word in the words wins). `move` reads
 * words that move one post ("tunda 30 menit"), where a bare span is a time from now.
 */
export function whenFromWords(said: string, from: number, timeZone: string, opts: { move?: boolean } = {}): WhenReading {
  const reading: WhenReading = { time: null, either: null, after: null, repeat: null, day: null, start: null, zone: null, unclear: [], unsupported: null };
  let t = plainWords(said);
  const unsupported = UNSUPPORTED.map((r) => r.exec(t)?.[0]).find(Boolean);
  if (unsupported) return { ...reading, unsupported };
  const unclear = new Set<Unclear>();

  const zones = new Set([...t.matchAll(/\b(wib|wita|wit|utc|gmt)\b/g)].map((m) => ZONES[m[1]!]!));
  t = t.replace(/\b(?:wib|wita|wit|utc|gmt)\b/g, " ");
  if (zones.size > 1) unclear.add("zone");
  else reading.zone = [...zones][0] ?? null;
  const zone = reading.zone ?? timeZone, today = dayOf(zone, from);

  const spans = [...t.matchAll(LATER)].map((m) => (m[1] ? spanMs(m[1], m[2]!, m[3]) : spanMs(m[5]!, m[6]!, m[7])));
  t = t.replace(LATER, " ");
  if (opts.move && !spans.length) { spans.push(...[...t.matchAll(BARE_SPAN)].map((m) => spanMs(m[1]!, m[2]!, m[3]))); t = t.replace(BARE_SPAN, " "); }
  if (new Set(spans).size > 1) unclear.add("time");
  else reading.after = spans[0] ?? null;

  const startMatch = new RegExp(String.raw`\b(?:mulai|dimulai|starting|from)\s+(?:dari\s+|on\s+)?((?:minggu|pekan|bulan) depan|next (?:week|month)|tanggal \d{1,2}(?: (?:${MONTH_WORDS}))?|besok|lusa|hari ini|today|tomorrow|(?:hari )?${DAY}(?: (?:depan|ini))?|next ${DAY})\b`).exec(t);
  if (startMatch) {
    const words = startMatch[1]!, date = /^tanggal (\d{1,2})$/.exec(words);
    reading.start = /^(?:minggu|pekan) depan|^next week/.test(words) ? nextMonday(today)
      : /^bulan depan|^next month/.test(words) ? firstOfNextMonth(today)
      : date ? nextDate(today, Number(date[1])) : /^(?:hari ini|today)$/.test(words) ? today : dueFromWords(words.replace(/^hari /, ""), today);
    t = t.replace(startMatch[0], " ");
  }

  // "hari Minggu" is the day; "minggu depan", "seminggu" and "2 minggu" are weeks; "setiap minggu" may be either.
  const weekly = new RegExp(String.raw`\b(?:mingguan|weekly|every week|each week|once a week|seminggu sekali|sekali seminggu|1 minggu sekali|${EVERY}\s+pekan)\b`).test(t);
  t = t.replace(/\bhari (?:minggu|ahad)\b/g, "sunday").replace(/\bakhir (?:pekan|minggu)\b/g, "weekend")
    .replace(/\b(?:minggu|pekan) (?:depan|ini|lalu|kemarin|berikutnya)\b|\bseminggu\b|\bmingguan\b|\bper (?:minggu|pekan)\b|\b\d+ (?:minggu|pekan)\b/g, " ");
  const weekOrSunday = new RegExp(String.raw`\b${EVERY}\s+minggu\b`).test(t);
  t = t.replace(new RegExp(String.raw`\b${EVERY}\s+minggu\b`, "g"), " setiap ");

  const excluded = new Set<number>();
  t = t.replace(new RegExp(String.raw`\b(?:kecuali|selain|except|excluding|but not|tidak termasuk)\s+((?:(?:hari\s+)?(?:${DAY}|weekends?)(?:\s*(?:,|dan|and|&|atau|or|serta)\s*)?)+)`, "g"), (_, list: string) => {
    for (const m of list.matchAll(new RegExp(`\\b(${DAY}|weekends?)\\b`, "g"))) (m[1]!.startsWith("weekend") ? WEEKEND : [dayNumber(m[1]!)]).forEach((d) => excluded.add(d));
    return " ";
  });
  const grouped = new Set<number>();
  t = t.replace(new RegExp(String.raw`\b(${DAY})\s*(?:-|sampai dengan|sampai|s/d|s\.d\.?|sd|hingga|to|through|thru|until)\s*(${DAY})\b`, "g"), (_, a: string, b: string) => {
    dayRange(dayNumber(a), dayNumber(b)).forEach((d) => grouped.add(d));
    return " ";
  });
  if (/\b(?:hari kerja|hari-hari kerja|weekdays?|workdays?|working days?|business days?)\b/.test(t)) WORK_DAYS.forEach((d) => grouped.add(d));
  if (/\bweekends?\b/.test(t)) WEEKEND.forEach((d) => grouped.add(d));
  const namedWords = [...t.matchAll(new RegExp(`\\b(${DAY})\\b`, "g"))].map((m) => m[1]!);
  const named = new Set(namedWords.map(dayNumber));
  const every = new RegExp(String.raw`\b${EVERY}\b`).test(t);
  const plural = namedWords.some((w) => /days$/.test(w));

  const monthDay = new RegExp(String.raw`\b${EVERY}\s+(?:bulan\s+)?(?:pada\s+|di\s+)?(?:tanggal|tgl\.?)\s+(\d{1,2})\b|\b${EVERY}\s+(?:month\s+on\s+the\s+)?(\d{1,2})(?:st|nd|rd|th)\b`).exec(t);
  const monthly = monthDay || new RegExp(String.raw`\b(?:${EVERY}\s+(?:bulan|month)|bulanan|monthly|sebulan sekali|sekali sebulan|1 bulan sekali|once a month|${EVERY}\s+(?:awal|akhir)\s+bulan)\b`).test(t);
  const daily = new RegExp(String.raw`\b${EVERY}\s+(?:hari(?!\s+(?:kerja|${DAY}))|harinya|day|morning|afternoon|evening|night|pagi|siang|sore|petang|malam|subuh)\b|\b(?:harian|daily|everyday|sehari sekali|sekali sehari|once a day|1 hari sekali)\b|\b${EVERY}\s+(?:(?:jam|pukul|pkl|at)\s+(?:setengah\s+)?\d|\d{1,2}(?:[.:]\d{2}|\s*(?:am|pm)\b))`).test(t);

  if (monthly) {
    const at = monthDay ? Number(monthDay[1] ?? monthDay[2]) : /\bawal bulan\b|\bfirst (?:day )?of\b/.test(t) ? 1 : /\bakhir bulan\b|\blast day of\b|\bend of (?:every|each|the) month\b/.test(t) ? 31
      : Number(/\b(?:tanggal|tgl\.?)\s+(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)\b/.exec(t)?.slice(1).find(Boolean) ?? NaN);
    if (at >= 1 && at <= 31) reading.repeat = { recurrence: "monthly", dayOfMonth: at };
    else unclear.add("date");
  } else if (grouped.size || weekly || weekOrSunday || plural || (every && named.size) || named.size > 1) {
    const days = [...new Set([...grouped, ...named])].filter((d) => !excluded.has(d)).sort((a, b) => a - b);
    if (days.length) reading.repeat = { recurrence: "weekly", weekdays: days };
    else unclear.add(weekOrSunday ? "week-or-sunday" : "days");
  } else if (daily) {
    const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => !excluded.has(d));
    reading.repeat = excluded.size ? { recurrence: "weekly", weekdays: days } : { recurrence: "daily" };
  } else {
    const thisOrNext = new RegExp(String.raw`\b(?:${DAY}\s+(?:ini|depan)|(?:this|next)\s+${DAY})\b`).exec(t);
    const date = new RegExp(String.raw`\b(?:tanggal|tgl\.?)\s+(\d{1,2})\b(?!\s*(?:${MONTH_WORDS}))`).exec(t);
    if (reading.after !== null) reading.repeat = { recurrence: "once" };
    else if (TODAY_WORDS.test(t)) { reading.repeat = { recurrence: "once" }; reading.day = today; }
    else if (date) { reading.repeat = { recurrence: "once" }; reading.day = nextDate(today, Number(date[1])); if (!reading.day) unclear.add("date"); }
    else if (thisOrNext && /\b(?:ini|this)\b/.test(thisOrNext[0])) { reading.repeat = { recurrence: "once" }; reading.day = thisWeek(today, dayNumber(new RegExp(`\\b(${DAY})\\b`).exec(thisOrNext[0])![1]!)); }
    else if (thisOrNext || DATE_WORDS.test(t)) { reading.repeat = { recurrence: "once" }; reading.day = dueFromWords(t, today); if (!reading.day) unclear.add("date"); }
    // A weekday alone ("Jumat jam 10") may be this Friday or every Friday; with "sekali" it is the coming one.
    else if (ONCE_WORDS.test(t)) { reading.repeat = { recurrence: "once" }; if (named.size) reading.day = dueFromWords(namedWords[0]!, today); }
    else unclear.add("repetition");
  }
  if (reading.repeat?.recurrence === "once" && !reading.day && reading.start) reading.day = reading.start;

  const clocks = clockTimes(t);
  const fixed = new Set(clocks.filter((c) => c.minutes.length === 1).map((c) => c.minutes[0]!));
  const open = clocks.filter((c) => c.minutes.length === 2);
  if (clocks.some((c) => c.or)) unclear.add("time");
  else if (fixed.size === 1 && clocks.every((c) => c.minutes.includes([...fixed][0]!))) reading.time = asTime([...fixed][0]!);
  else if (!fixed.size && open.length && clocks.length === open.length && open.every((c) => c.minutes.join() === open[0]!.minutes.join())) {
    reading.either = [asTime(open[0]!.minutes[0]!), asTime(open[0]!.minutes[1]!)];
    unclear.add("am-pm");
  } else if (clocks.length || reading.after === null) unclear.add("time");
  if (reading.after !== null && clocks.length) unclear.add("time");
  reading.unclear = [...unclear];
  return reading;
}

const two = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
function nextMonday(today: string) { const d = new Date(`${today}T00:00:00Z`); return ymd(new Date(d.getTime() + ((8 - d.getUTCDay()) % 7 || 7) * DAY_MS)); }
function firstOfNextMonth(today: string) { const [y, m] = today.split("-").map(Number); return m === 12 ? `${y! + 1}-01-01` : `${y}-${two(m! + 1)}-01`; }
/** The coming date with this day of the month, today included; null when no month in the next two has it. */
function nextDate(today: string, date: number): string | null {
  const [y, m, d] = today.split("-").map(Number);
  for (let i = 0; i < 2; i++) {
    const month = ((m! - 1 + i) % 12) + 1, year = y! + (m! + i > 12 ? 1 : 0);
    if (date <= daysIn(year, month) && (i > 0 || date >= d!)) return `${year}-${two(month)}-${two(date)}`;
  }
  return null;
}
/** This week's `weekday`, today included. */
function thisWeek(today: string, weekday: number) { const d = new Date(`${today}T00:00:00Z`); return ymd(new Date(d.getTime() + ((weekday - d.getUTCDay() + 7) % 7) * DAY_MS)); }

/** "HH:MM" from "9:00" or "09:00". */
export function timeOfDay(input: unknown): string | null {
  const m = typeof input === "string" ? /^(\d{1,2}):(\d{2})$/.exec(input.trim()) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return hhmm(Number(m[1]), Number(m[2]));
}

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** Weekday numbers (0 = Sunday) from numbers or English names, sorted and without repeats. */
export function weekdayNumbers(input: unknown): number[] {
  if (!Array.isArray(input)) throw new Error("weekdays must be a list of weekday names or numbers (0 = Sunday)");
  const days = input.map((d) => (typeof d === "number" ? d : WEEKDAY_NAMES.findIndex((n) => n.startsWith(String(d).trim().toLowerCase().slice(0, 3)))));
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("weekdays must be weekday names or numbers from 0 (Sunday) to 6 (Saturday)");
  return [...new Set(days)].sort((a, b) => a - b);
}

/** A schedule as the words fix it, ready to store. */
export type WhenPlan = Pick<Recurrence, "recurrence" | "weekdays" | "dayOfMonth" | "timeOfDay" | "timezone"> & { nextAt: number };
export type WhenCheck =
  | { ask: Unclear[]; either: [string, string] | null }
  | { unsupported: string }
  | { mismatch: string }
  | { passed: true }
  | { plan: WhenPlan };
/** The model's arguments for when and how often, as the tool received them. */
export type WhenArgs = { recurrence?: unknown; at?: unknown; time?: unknown; weekdays?: unknown; dayOfMonth?: unknown };

/** How a plan reads to the model, for a mismatch: "weekly on [1,4] at 09:00", "once at 2026-03-06T15:00:00+07:00". */
function planText(p: { recurrence: string; timeOfDay?: string | null; weekdays?: number[]; dayOfMonth?: number | null; at?: number | null; timezone: string }) {
  if (p.recurrence === "once") return `once at ${p.at === null || p.at === undefined ? "?" : isoInZone(p.timezone, p.at)}`;
  return `${p.recurrence}${p.recurrence === "weekly" ? ` on ${JSON.stringify(p.weekdays)}` : ""}${p.recurrence === "monthly" ? ` on day ${p.dayOfMonth}` : ""} at ${p.timeOfDay ?? "?"}`;
}

/**
 * Whether the arguments say what the words say. Anything the words leave open is asked about; a disagreement is refused, naming both;
 * otherwise the plan is the words' reading. `move` checks only the time of one post (editReminder), so a repetition need not be said.
 * A relative time ("30 menit lagi") may be a few minutes off in the arguments, since the turn takes time.
 */
export function checkWhen(reading: WhenReading, args: WhenArgs, opts: { from: number; timeZone: string; move?: boolean }): WhenCheck {
  if (reading.unsupported) return { unsupported: reading.unsupported };
  const ask = opts.move ? reading.unclear.filter((u) => u === "am-pm" || u === "time" || u === "zone" || (u === "date" && reading.after === null)) : reading.unclear;
  if (ask.length) return { ask, either: reading.either };
  const timezone = reading.zone ?? opts.timeZone, from = opts.from;
  const repeat: Repeat = opts.move ? { recurrence: "once" } : reading.repeat!;
  const argsAt = parseWhen(args.at, timezone, from);

  if (repeat.recurrence === "once") {
    let at: number;
    if (reading.after !== null) at = from + reading.after;
    else {
      const [hour, minute] = reading.time!.split(":").map(Number);
      const on = (day: string) => { const [year, month, date] = day.split("-").map(Number); return wallToInstant(timezone, { year: year!, month: month!, day: date!, hour: hour!, minute: minute!, second: 0 }); };
      const today = dayOf(timezone, from);
      at = reading.day ? on(reading.day) : on(today) > from ? on(today) : on(dayOf(timezone, from + DAY_MS));
    }
    if (at <= from) return { passed: true };
    if (!opts.move && args.recurrence !== "once") return { mismatch: `The asker's words read ${planText({ recurrence: "once", at, timezone })}, but recurrence is ${JSON.stringify(args.recurrence ?? null)}.` };
    const off = argsAt === null ? Infinity : Math.abs(argsAt - at);
    if (off > (reading.after !== null ? 5 * 60_000 : 0)) return { mismatch: `The asker's words read ${planText({ recurrence: "once", at, timezone })}, but at is ${JSON.stringify(args.at ?? null)}.` };
    const wall = isoInZone(timezone, at).slice(11, 16);
    return { plan: { recurrence: "once", weekdays: [], dayOfMonth: null, timeOfDay: wall, timezone, nextAt: at } };
  }

  const weekdays = repeat.recurrence === "weekly" ? repeat.weekdays : [], dayOfMonth = repeat.recurrence === "monthly" ? repeat.dayOfMonth : null;
  const words = { recurrence: repeat.recurrence, timeOfDay: reading.time, weekdays, dayOfMonth, timezone };
  let given: number[] | null = null;
  try { given = args.weekdays === undefined || args.weekdays === null ? [] : weekdayNumbers(args.weekdays); } catch { given = null; }
  const agrees = args.recurrence === repeat.recurrence && timeOfDay(args.time ?? args.at) === reading.time
    && (repeat.recurrence !== "weekly" || (given !== null && given.join() === weekdays.join()))
    && (repeat.recurrence !== "monthly" || Number(args.dayOfMonth) === dayOfMonth);
  if (!agrees) {
    const argsText = planText({ recurrence: String(args.recurrence ?? "?"), timeOfDay: timeOfDay(args.time ?? args.at), weekdays: given ?? [], dayOfMonth: Number(args.dayOfMonth) || null, at: argsAt, timezone });
    return { mismatch: `The asker's words read ${planText(words)}, but the arguments say ${argsText}.` };
  }
  // A start ("mulai Senin") counts from the first moment of that day.
  const startAt = reading.start ? wallToInstant(timezone, { ...dayParts(reading.start), hour: 0, minute: 0, second: 0 }) - 1 : from;
  const nextAt = nextOccurrence({ ...words, until: null }, Math.max(from, startAt));
  if (nextAt === null) return { passed: true };
  return { plan: { ...words, timeOfDay: reading.time, nextAt } };
}

const dayParts = (day: string) => { const [year, month, date] = day.split("-").map(Number); return { year: year!, month: month!, day: date! }; };
