import { schedules } from "@pachiware/db";
import type { SkillModule } from "../types.js";
import { DEFAULT_TIMEZONE, isoInZone, now, wallClock, wallToInstant } from "../clock.js";
import { nextOccurrence, parseWhen } from "../schedule.js";

/** Pings and framing share Discord's 2000 characters with the text. */
const MAX_TEXT = 1500;
const MAX_MENTIONS = 10;
const RECURRENCES = ["once", "daily", "weekly", "monthly"] as const;
type RecurrenceKind = (typeof RECURRENCES)[number];
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const TIME = /^(\d{1,2}):(\d{2})$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** User ids as written or as `<@id>` pings, without the owner and without repeats. */
function mentionIds(input: unknown, ownerId: string): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error("mentions must be a list of Discord user ids");
  const ids = input.map((m) => String(m).trim().replace(/^<@!?([\w-]+)>$/, "$1")).filter((id) => /^[\w-]{1,64}$/.test(id) && id !== ownerId);
  return [...new Set(ids)].slice(0, MAX_MENTIONS);
}

/** "HH:MM" from "9:00" or "09:00". */
function timeOfDay(input: unknown): string | null {
  const m = typeof input === "string" ? TIME.exec(input.trim()) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1]!.padStart(2, "0")}:${m[2]}`;
}

/** Weekday numbers (0 = Sunday) from numbers or English names, sorted and without repeats. */
function weekdayNumbers(input: unknown): number[] {
  if (!Array.isArray(input)) throw new Error("weekdays must be a list of weekday names or numbers (0 = Sunday)");
  const days = input.map((d) => (typeof d === "number" ? d : WEEKDAY_NAMES.findIndex((n) => n.startsWith(String(d).trim().toLowerCase().slice(0, 3)))));
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("weekdays must be weekday names or numbers from 0 (Sunday) to 6 (Saturday)");
  return [...new Set(days)].sort((a, b) => a - b);
}

/** The end of a day given as "YYYY-MM-DD" in `timeZone`, or an instant given with its time. */
function untilInstant(input: unknown, timeZone: string, from: number): number | null {
  if (typeof input !== "string") return null;
  const m = DATE.exec(input.trim());
  if (m) return wallToInstant(timeZone, { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: 23, minute: 59, second: 59 });
  return parseWhen(input, timeZone, from);
}

export const remindersSkill: SkillModule = {
  id: "reminders",
  name: "Reminders",
  description: "Post a message at a time a person chose, once or repeating, where they asked, pinging them.",
  capabilities: ["reminders"],
  allowedScopes: ["tenant", "channel", "user"],
  toolPolicy: { createReminder: { effect: "write", requiresConfirmation: false } },
  tools: [
    {
      name: "createReminder",
      description: "Sets a Reminder: posts the text in this channel at the given time, pinging the asker and anyone in mentions. Once at `at`, or repeating daily, weekly on `weekdays`, or monthly on `dayOfMonth` at `time`, until `until` when given. Turn the asker's words into these arguments with the time line of the context; never ask for a format.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "What to post, in the asker's words" },
          at: { type: "string", description: 'When to post once, e.g. "2026-03-06T15:00" or "15:00"; read in this place\'s time zone unless it carries an offset' },
          mentions: { type: "array", items: { type: "string" }, description: "Discord user ids to ping besides the asker" },
          recurrence: { type: "string", enum: [...RECURRENCES], description: 'How it repeats; "once" (the default) posts at `at` only' },
          time: { type: "string", description: 'Time of day for a repeating Reminder, e.g. "09:00", in this place\'s time zone' },
          weekdays: { type: "array", items: { type: "string" }, description: 'For weekly: the days it posts on, e.g. ["monday", "thursday"]' },
          dayOfMonth: { type: "integer", description: "For monthly: the date it posts on, 1 to 31; a month without that date uses its last day" },
          until: { type: "string", description: 'Last day a repeating Reminder may post, e.g. "2026-12-31"' },
        },
        required: ["text"],
      },
    },
  ],
  handlers: {
    createReminder: async (args, ctx) => {
      if (!ctx.botId || !ctx.channelId || !ctx.userId) throw new Error("Reminders can only be set from a Discord channel or DM.");
      const text = typeof args.text === "string" ? args.text.replace(/\s+/g, " ").trim() : "";
      if (!text) throw new Error("text is required");
      if (text.length > MAX_TEXT) throw new Error(`text must be at most ${MAX_TEXT} characters`);
      const timezone = ctx.timezone ?? DEFAULT_TIMEZONE, from = now();
      const recurrence: RecurrenceKind = args.recurrence === undefined || args.recurrence === null ? "once" : args.recurrence;
      if (!RECURRENCES.includes(recurrence)) throw new Error(`recurrence must be one of ${RECURRENCES.join(", ")}`);
      const mentions = mentionIds(args.mentions, ctx.userId);
      const base = { tenantId: ctx.tenantId, botId: ctx.botId, kind: "reminder" as const, guildId: ctx.guildId ?? null, channelId: ctx.channelId, ownerId: ctx.userId, ownerName: ctx.userName ?? null, text, mentions, timezone };

      if (recurrence === "once") {
        const at = parseWhen(args.at, timezone, from);
        if (at === null) throw new Error('at must be a date and time such as "2026-03-06T15:00"');
        if (at <= from) throw new Error("That time has already passed; pick a later one.");
        const wall = wallClock(timezone, at);
        const [row] = await ctx.db.insert(schedules).values({ ...base, recurrence, timeOfDay: `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`, nextAt: new Date(at) }).returning({ id: schedules.id });
        return { id: row!.id, at: isoInZone(timezone, at), recurrence, text, mentions, channelId: ctx.channelId };
      }

      const time = timeOfDay(args.time ?? args.at);
      if (!time) throw new Error('time must be a time of day such as "09:00"');
      const weekdays = recurrence === "weekly" ? weekdayNumbers(args.weekdays) : [];
      if (recurrence === "weekly" && weekdays.length === 0) throw new Error("weekly needs at least one weekday");
      const dayOfMonth = recurrence === "monthly" ? Number(args.dayOfMonth) : null;
      if (recurrence === "monthly" && (!Number.isInteger(dayOfMonth) || dayOfMonth! < 1 || dayOfMonth! > 31)) throw new Error("monthly needs a dayOfMonth from 1 to 31");
      const untilAt = args.until === undefined || args.until === null ? null : untilInstant(args.until, timezone, from);
      if (args.until !== undefined && args.until !== null && untilAt === null) throw new Error('until must be a date such as "2026-12-31"');
      const until = untilAt === null ? null : new Date(untilAt);
      const next = nextOccurrence({ recurrence, weekdays, dayOfMonth, timeOfDay: time, timezone, until }, from);
      if (next === null) throw new Error("That end date comes before the first time it would post; pick a later one.");
      const [row] = await ctx.db.insert(schedules).values({ ...base, recurrence, weekdays, dayOfMonth, timeOfDay: time, until, nextAt: new Date(next) }).returning({ id: schedules.id });
      return { id: row!.id, at: isoInZone(timezone, next), recurrence, time, ...(weekdays.length ? { weekdays } : {}), ...(dayOfMonth ? { dayOfMonth } : {}), ...(until ? { until: isoInZone(timezone, until.getTime()) } : {}), text, mentions, channelId: ctx.channelId };
    },
  },
};
