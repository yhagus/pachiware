import { hhmm, offsetText, wallClock, zoneOffset } from "./clock.js";
import { listOf, textIn, type Language } from "./language.js";
import { nextOccurrence } from "./schedule.js";

/** A Reminder or Routine as its tools return it, the fields the card shows. */
export interface CardSchedule {
  id: string; kind?: "reminder" | "routine"; text: string; channelId: string; guildId: string | null;
  /** Whether everyone in the server can view where it posts; null when unknown or in a DM. */
  public?: boolean | null;
  owner: { id: string | null }; mentions: string[]; withTasks?: boolean;
  /** ISO with offset. */ nextAt: string; until: string | null;
  recurrence: "once" | "daily" | "weekly" | "monthly"; weekdays: number[]; dayOfMonth: number | null; timeOfDay: string | null; timezone: string;
  /** The asker's words it was read from. */ said?: string[];
  changed?: boolean;
}
export interface CardEmbed { title: string; description: string; fields: { name: string; value: string; inline?: boolean }[]; footer: { text: string } }

/** The tools whose result is a set or changed schedule, each answered with the card. */
export const SCHEDULE_CARD_TOOLS = new Set(["createReminder", "createRoutine", "editReminder"]);

/** Indonesia's zone names, which people write after a time; anywhere else the offset says it. */
const ZONE_WORDS: Record<string, string> = { "Asia/Jakarta": "WIB", "Asia/Pontianak": "WIB", "Asia/Makassar": "WITA", "Asia/Jayapura": "WIT" };
const WORK_DAYS = "1,2,3,4,5", WEEKEND = "0,6";

/**
 * The fixed card the host posts after a schedule is set or changed: what it posts, when in words, the next three times, the zone,
 * the end, where it posts and whether that is public, who is pinged, and the words it was read from, so the asker can see at a glance
 * whether it is what they meant. It is the same for every model, unlike a reply.
 */
export function scheduleCard(s: CardSchedule, language: Language): CardEmbed {
  const t = textIn(language), zone = s.timezone, first = Date.parse(s.nextAt);
  const offset = `UTC${offsetText(zoneOffset(zone, first))}`, word = ZONE_WORDS[zone] ?? offset;
  const when = (at: number, year = false) => {
    const w = wallClock(zone, at), day = new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
    return `${t.dayShort[day]} ${w.day} ${t.monthShort[w.month - 1]}${year ? ` ${w.year}` : ""} ${hhmm(w.hour, w.minute)}`;
  };
  const days = s.weekdays.join();
  const repeat = s.recurrence === "once" ? `${t.cardOnce}, ${when(first, true)}`
    : s.recurrence === "daily" ? t.cardDaily
    : s.recurrence === "monthly" ? t.cardMonthly(s.dayOfMonth ?? 1)
    : days === WORK_DAYS ? t.cardWorkDays : days === WEEKEND ? t.cardWeekend : t.cardWeekly(listOf(s.weekdays.map((d) => t.dayNames[d]!), language));
  const schedule = s.recurrence === "once" ? `${repeat} ${word}` : `${repeat}, ${s.timeOfDay} ${word}`;

  const until = s.until ? Date.parse(s.until) : null, next = [first];
  if (s.recurrence !== "once") {
    const rule = { recurrence: s.recurrence, weekdays: s.weekdays, dayOfMonth: s.dayOfMonth, timeOfDay: s.timeOfDay, timezone: zone, until: until === null ? null : new Date(until) };
    for (let at: number | null = nextOccurrence(rule, first); at !== null && next.length < 3; at = nextOccurrence(rule, at)) next.push(at);
  }
  const where = !s.guildId ? t.cardDm : `<#${s.channelId}>${s.public === true ? ` (${t.cardPublic})` : s.public === false ? ` (${t.cardNotPublic})` : ""}`;
  const pings = [...new Set([s.owner.id, ...s.mentions].filter((id): id is string => !!id))].map((id) => `<@${id}>`);
  const routine = s.kind === "routine";

  const fields = [
    { name: t.cardWhen, value: schedule },
    ...(s.recurrence === "once" ? [] : [{ name: t.cardNext, value: next.map((at) => when(at)).join(" · ") }]),
    { name: t.cardZone, value: `${zone} (${ZONE_WORDS[zone] ? `${word}, ${offset}` : offset})`, inline: true },
    ...(s.recurrence === "once" ? [] : [{ name: t.cardUntil, value: until === null ? t.cardNoEnd : when(until, true), inline: true }]),
    { name: t.cardWhere, value: where, inline: true },
    ...(pings.length ? [{ name: t.cardPings, value: pings.join(" "), inline: true }] : []),
    ...(routine ? [{ name: t.cardAccess, value: t.cardReadsOnly }] : s.withTasks ? [{ name: t.cardTasks, value: t.cardTasksListed, inline: true }] : []),
    ...(s.said?.length ? [{ name: t.cardFrom, value: s.said.map((q) => `“${q}”`).join(" · ") }] : []),
    { name: t.cardId, value: `\`${s.id}\``, inline: true },
  ];
  return { title: t.cardTitle(routine ? "routine" : "reminder", !!s.changed), description: `> ${s.text}`, fields, footer: { text: t.cardFooter } };
}

/** The card for one tool call's result, or null when the call set or changed no schedule. */
export function scheduleCardOf(tool: string, data: any, language: Language): CardEmbed | null {
  return SCHEDULE_CARD_TOOLS.has(tool) && typeof data?.id === "string" && typeof data?.nextAt === "string" ? scheduleCard(data, language) : null;
}
