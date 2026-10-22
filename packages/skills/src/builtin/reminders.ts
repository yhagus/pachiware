import { repositories, type Schedule, type ScheduleKind } from "@pachiware/db";
import type { SkillContext, SkillModule } from "../types.js";
import { DEFAULT_TIMEZONE, isoInZone, now, wallToInstant } from "../clock.js";
import { hasPermission } from "../permissions.js";
import { textIn } from "../language.js";
import { parseWhen } from "../schedule.js";
import { checkWhen, timeOfDay, unheardQuote, whenFromWords, type WhenPlan } from "../whenWords.js";

/** Pings and framing share Discord's 2000 characters with the text. */
const MAX_TEXT = 1500;
const MAX_MENTIONS = 10;
export const MAX_ACTIVE_PER_OWNER = 50;
export const MAX_ACTIVE_PER_TENANT = 500;
/** Each Routine run is a turn of the bot's model, so far fewer may wait than Reminders. */
export const MAX_ROUTINES_PER_OWNER = 10;
export const MAX_ROUTINES_PER_TENANT = 100;
const RECURRENCES = ["once", "daily", "weekly", "monthly"] as const;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A schedule's `said`: a few short quotes. */
const MAX_QUOTES = 6, MAX_QUOTE = 300;

/** User ids as written or as `<@id>` pings, without the owner and without repeats. */
function mentionIds(input: unknown, ownerId: string): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error("mentions must be a list of Discord user ids");
  const ids = input.map((m) => String(m).trim().replace(/^<@!?([\w-]+)>$/, "$1")).filter((id) => /^[\w-]{1,64}$/.test(id) && id !== ownerId);
  return [...new Set(ids)].slice(0, MAX_MENTIONS);
}

const canModerate = (ctx: SkillContext) => hasPermission(ctx, "ManageMessages");
/** A person's Reminders and Routines are listed, cancelled and changed together. */
const activeSchedules = (ctx: SkillContext) => ({ tenantId: ctx.tenantId, kind: ["reminder", "routine"] as ScheduleKind[], status: "active" as const });

const describe = (row: Schedule) => ({
  id: row.id, kind: row.kind, text: row.text, channelId: row.channelId, guildId: row.guildId, owner: { id: row.ownerId, name: row.ownerName },
  nextAt: isoInZone(row.timezone, row.nextAt.getTime()), recurrence: row.recurrence, weekdays: row.weekdays, dayOfMonth: row.dayOfMonth, timeOfDay: row.timeOfDay,
  until: row.until ? isoInZone(row.timezone, row.until.getTime()) : null, timezone: row.timezone, mentions: row.mentions, withTasks: row.withTasks,
});

async function assertUnderLimits(ctx: SkillContext, kind: "reminder" | "routine") {
  const t = textIn(ctx.language), { schedules } = repositories(), active = { tenantId: ctx.tenantId, kind, status: "active" as const };
  const [owner, tenant] = kind === "routine" ? [MAX_ROUTINES_PER_OWNER, MAX_ROUTINES_PER_TENANT] : [MAX_ACTIVE_PER_OWNER, MAX_ACTIVE_PER_TENANT];
  if (await schedules.count({ ...active, ownerId: ctx.userId! }) >= owner) throw new Error(kind === "routine" ? t.routineLimitOwner(owner) : t.reminderLimitOwner(owner));
  if (await schedules.count(active) >= tenant) throw new Error(kind === "routine" ? t.routineLimitTenant(tenant) : t.reminderLimitTenant(tenant));
}

/** The end of a day given as "YYYY-MM-DD" in `timeZone`, or an instant given with its time. */
function untilInstant(input: unknown, timeZone: string, from: number): number | null {
  if (typeof input !== "string") return null;
  const m = DATE.exec(input.trim());
  if (m) return wallToInstant(timeZone, { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: 23, minute: 59, second: 59 });
  return parseWhen(input, timeZone, from);
}

/** Whether everyone in the server can view where the schedule posts, for its card; null in a DM or when the channel cannot be read. */
async function isPublic(ctx: SkillContext): Promise<boolean | null> {
  if (!ctx.guildId || !ctx.channelId || !ctx.userId || !ctx.discord) return null;
  return (await ctx.discord.channelView(ctx.channelId, ctx.userId).catch(() => null))?.channel?.public ?? null;
}
const CARD_NOTE = "Done. A card with every detail of it is posted under your reply: confirm in one short line, without repeating the details.";

/** What a schedule tool returns when the asker's words leave something open: the one question to put to them, and nothing set. */
type Asked = { set: false; question: string; note: string };
const SAID_ARG = { type: "array", items: { type: "string" }, description: 'The asker\'s own words that say when and how often, quoted exactly from their messages in this conversation: only those words, from each message that says them, e.g. ["jam 9 WIB", "pagi, tiap hari kerja"]' };
const SAID_RULES = "`said` quotes the asker's own words about when and how often, and the time and repetition you pass must say the same. Never fill in what they did not say (morning or evening, once or repeating, which days): when the result has a question, send it word for word as your whole reply, then call again with their answer added to said.";
const ASK_NOTE = "Nothing is set yet. Send the question to the asker word for word as your whole reply. When they answer, call again with said holding the earlier quotes and their answer.";

/**
 * When the asker said it runs: each quote must be in their own lines, the words are read, and the arguments must say the same.
 * What the words leave open comes back as the one question to ask; anything else wrong is thrown for the model to correct.
 * `move` reads the time of one post only (editReminder), in the row's zone.
 */
async function heardPlan(args: Record<string, any>, ctx: SkillContext, opts: { timeZone: string; move?: boolean }): Promise<{ plan: WhenPlan; said: string[] } | { asked: Asked }> {
  const said = Array.isArray(args.said) ? args.said.filter((q): q is string => typeof q === "string" && !!q.trim()).map((q) => q.trim()) : [];
  if (!said.length) throw new Error('said is required: the asker\'s own words that say when and how often, quoted exactly from their messages, e.g. ["setiap jam 9 pagi"]. If they never said when, ask them.');
  if (said.length > MAX_QUOTES || said.some((q) => q.length > MAX_QUOTE)) throw new Error(`said holds at most ${MAX_QUOTES} quotes of up to ${MAX_QUOTE} characters: only the words about when.`);
  if (!ctx.askerWords) throw new Error("Schedules can only be set from a Discord channel or DM.");
  const unheard = unheardQuote(said, await ctx.askerWords());
  if (unheard !== null) throw new Error(`"${unheard}" is not in the asker's own messages. said quotes their words exactly, and only theirs; if they never said when, ask them.`);
  const from = now(), check = checkWhen(whenFromWords(said.join(" ; "), from, opts.timeZone, { move: opts.move }), args, { from, timeZone: opts.timeZone, move: opts.move });
  const t = textIn(ctx.askerLanguage ?? ctx.language);
  if ("ask" in check) return { asked: { set: false, question: t.whenAsk(check.ask, check.either), note: ASK_NOTE } };
  if ("unsupported" in check) throw new Error(t.whenUnsupported(check.unsupported));
  if ("passed" in check) throw new Error("That time has already passed; pick a later one.");
  if ("mismatch" in check) throw new Error(`${check.mismatch} Pass what the words say; if the asker meant something else, ask them.`);
  return { plan: check.plan, said };
}

/** Sets a Reminder (its text is posted) or a Routine (its text is an instruction the bot carries out), once the asker's words fix when. */
async function createSchedule(kind: "reminder" | "routine", text: string, args: Record<string, any>, ctx: SkillContext) {
  if (!ctx.botId || !ctx.channelId || !ctx.userId) throw new Error(`${kind === "routine" ? "Routines" : "Reminders"} can only be set from a Discord channel or DM.`);
  await assertUnderLimits(ctx, kind);
  if (!text) throw new Error(`${kind === "routine" ? "instruction" : "text"} is required`);
  if (text.length > MAX_TEXT) throw new Error(`${kind === "routine" ? "instruction" : "text"} must be at most ${MAX_TEXT} characters`);
  if (!RECURRENCES.includes(args.recurrence)) throw new Error(`recurrence must be one of ${RECURRENCES.join(", ")}`);
  const timeZone = ctx.timezone ?? DEFAULT_TIMEZONE;
  if (args.recurrence === "once" && parseWhen(args.at, timeZone, now()) === null) throw new Error('at must be a date and time such as "2026-03-06T15:00"');
  if (args.recurrence !== "once" && !timeOfDay(args.time ?? args.at)) throw new Error('time must be a time of day such as "09:00"');
  const heard = await heardPlan(args, ctx, { timeZone });
  if ("asked" in heard) return heard.asked;
  const { plan, said } = heard, from = now();
  const until = plan.recurrence === "once" || args.until === undefined || args.until === null ? null : untilInstant(args.until, plan.timezone, from);
  if (plan.recurrence !== "once" && args.until !== undefined && args.until !== null && until === null) throw new Error('until must be a date such as "2026-12-31"');
  if (until !== null && until < plan.nextAt) throw new Error("That end date comes before the first time it would post; pick a later one.");
  const mentions = mentionIds(args.mentions, ctx.userId), withTasks = kind === "reminder" && (args.withTasks === true || args.withTasks === "true");
  const row = await repositories().schedules.create({
    tenantId: ctx.tenantId, botId: ctx.botId, kind, guildId: ctx.guildId ?? null, channelId: ctx.channelId, ownerId: ctx.userId, ownerName: ctx.userName ?? null, text, withTasks, mentions,
    recurrence: plan.recurrence, weekdays: plan.weekdays, dayOfMonth: plan.dayOfMonth, timeOfDay: plan.timeOfDay, timezone: plan.timezone, until: until === null ? null : new Date(until), nextAt: new Date(plan.nextAt),
  });
  return { ...describe(row), at: isoInZone(row.timezone, plan.nextAt), said, public: await isPublic(ctx), note: CARD_NOTE };
}

const oneLine = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

export const remindersSkill: SkillModule = {
  id: "reminders",
  name: "Reminders",
  category: "Tasks & reminders",
  description: "Post a message at a time a person chose, or carry out an instruction then and post what it found (a Routine), once or repeating, where they asked, pinging them.",
  capabilities: ["reminders"],
  allowedScopes: ["tenant", "channel", "user"],
  toolPolicy: {
    createReminder: { effect: "write", requiresConfirmation: false },
    createRoutine: { effect: "write", requiresConfirmation: false },
    listReminders: { effect: "read" },
    cancelReminder: { effect: "write", requiresConfirmation: false },
    editReminder: { effect: "write", requiresConfirmation: false },
  },
  tools: [
    {
      name: "createReminder",
      description: "Sets a Reminder: posts the text in this channel at the given time, pinging the asker and anyone in mentions. Once at `at`, or repeating daily, weekly on `weekdays`, or monthly on `dayOfMonth` at `time`, until `until` when given. Turn the asker's words into these arguments with the time line of the context; never ask for a format. " + SAID_RULES,
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "What to post, in the asker's words" },
          said: SAID_ARG,
          recurrence: { type: "string", enum: [...RECURRENCES], description: 'How it repeats, as the asker said; "once" posts at `at` only' },
          at: { type: "string", description: 'When to post once, e.g. "2026-03-06T15:00" or "15:00"; read in this place\'s time zone unless it carries an offset' },
          mentions: { type: "array", items: { type: "string" }, description: "Discord user ids to ping besides the asker" },
          time: { type: "string", description: 'Time of day for a repeating Reminder, e.g. "09:00", in this place\'s time zone' },
          weekdays: { type: "array", items: { type: "string" }, description: 'For weekly: the days it posts on, e.g. ["monday", "thursday"]' },
          dayOfMonth: { type: "integer", description: "For monthly: the date it posts on, 1 to 31; a month without that date uses its last day" },
          until: { type: "string", description: 'Last day a repeating Reminder may post, e.g. "2026-12-31"' },
          withTasks: { type: "boolean", description: "true: the post also lists the asker's open tasks (assigned to them, and their Personal tasks) visible from this place, so a morning DM Reminder doubles as their overview" },
        },
        required: ["text", "said", "recurrence"],
      },
    },
    {
      name: "createRoutine",
      description: "Sets a Routine: at the time the asker chose, once or repeating, the bot carries out the instruction as one turn of its own, as the asker, and posts what it found in this channel, pinging the asker and anyone in mentions. It only reads: it looks things up (tasks, files, notes, repositories) and reports; it changes nothing. Use it when the asker wants something done at that time (\"simpulkan tugasku setiap jam 9 pagi\", \"every Friday at 16:00 sum up this week's progress\"); to post their own words, use createReminder. A Routine about their own tasks shows them where it posts: in a channel others can view, suggest a DM first. " + SAID_RULES,
      parameters: {
        type: "object",
        properties: {
          instruction: { type: "string", description: "What the bot does each time, in the asker's words, e.g. \"simpulkan tugasku untuk hari ini\"" },
          said: SAID_ARG,
          recurrence: { type: "string", enum: [...RECURRENCES], description: 'How it repeats, as the asker said; "once" runs at `at` only' },
          at: { type: "string", description: 'When to run once, e.g. "2026-03-06T15:00" or "15:00"; read in this place\'s time zone unless it carries an offset' },
          time: { type: "string", description: 'Time of day for a repeating Routine, e.g. "09:00", in this place\'s time zone' },
          weekdays: { type: "array", items: { type: "string" }, description: 'For weekly: the days it runs on, e.g. ["monday", "thursday"]' },
          dayOfMonth: { type: "integer", description: "For monthly: the date it runs on, 1 to 31; a month without that date uses its last day" },
          until: { type: "string", description: 'Last day a repeating Routine may run, e.g. "2026-12-31"' },
          mentions: { type: "array", items: { type: "string" }, description: "Discord user ids to ping besides the asker" },
        },
        required: ["instruction", "said", "recurrence"],
      },
    },
    {
      name: "listReminders",
      description: "Lists the asker's active Reminders and Routines with id, kind, text (a Routine's instruction), where they post, next time and recurrence; with Manage Messages, everyone's in this server too.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "cancelReminder",
      description: "Cancels a Reminder or Routine by id. Allowed for its owner, or for anyone with Manage Messages in this server.",
      parameters: { type: "object", properties: { id: { type: "string", description: "The id, from listReminders or from when it was set" } }, required: ["id"] },
    },
    {
      name: "editReminder",
      description: "Changes the asker's own Reminder or Routine by id (#250): `at` moves its next post (\"snooze it 30 minutes\", \"move it to 16:00\"), with `said` quoting the asker's words for the new time; a repeating one keeps its schedule after that post. `text` rewrites what a Reminder posts, or a Routine's instruction. To change how often it repeats, cancel it and set a new one. Only its owner can change it. When the result has a question, send it word for word as your whole reply.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The id, from listReminders or from when it was set" },
          at: { type: "string", description: 'When it next posts, e.g. "2026-03-06T15:30" or "15:30", in this place\'s time zone unless it carries an offset' },
          said: { ...SAID_ARG, description: "With at: the asker's own words for the new time, quoted exactly, e.g. [\"tunda 30 menit\"]" },
          text: { type: "string", description: "What it posts from now on, or a Routine's new instruction, in the asker's words" },
        },
        required: ["id"],
      },
    },
  ],
  handlers: {
    createReminder: (args, ctx) => createSchedule("reminder", oneLine(args.text), args, ctx),
    createRoutine: (args, ctx) => createSchedule("routine", oneLine(args.instruction), args, ctx),
    listReminders: async (_args, ctx) => {
      if (!ctx.userId) throw new Error("Reminders can only be listed from a Discord channel or DM.");
      const visibleTo = { ownerId: ctx.userId, guildId: canModerate(ctx) ? ctx.guildId : undefined };
      const rows = await repositories().schedules.list({ ...activeSchedules(ctx), visibleTo });
      return { reminders: rows.map(describe), count: rows.length };
    },
    cancelReminder: async (args, ctx) => {
      if (!ctx.userId) throw new Error("Reminders can only be cancelled from a Discord channel or DM.");
      const t = textIn(ctx.language), id = typeof args.id === "string" ? args.id.trim() : "";
      const [row] = id ? await repositories().schedules.list({ ...activeSchedules(ctx), id }) : [];
      if (!row) throw new Error(t.reminderNotFound);
      // Manage Messages reaches only the moderator's own guild; a DM Reminder has none, so only its owner can cancel it.
      if (row.ownerId !== ctx.userId && !(canModerate(ctx) && row.guildId && row.guildId === ctx.guildId)) throw new Error(t.reminderNotYours);
      await repositories().schedules.update(row.id, { status: "cancelled" });
      return { id: row.id, cancelled: true, text: row.text };
    },
    editReminder: async (args, ctx) => {
      if (!ctx.userId) throw new Error("Reminders can only be changed from a Discord channel or DM.");
      const t = textIn(ctx.language), id = typeof args.id === "string" ? args.id.trim() : "";
      const [row] = id ? await repositories().schedules.list({ ...activeSchedules(ctx), id }) : [];
      if (!row) throw new Error(t.reminderNotFound);
      if (row.ownerId !== ctx.userId) throw new Error(t.reminderNotYoursToEdit);
      const text = typeof args.text === "string" ? oneLine(args.text) : undefined;
      if (text !== undefined && (!text || text.length > MAX_TEXT)) throw new Error(`text must be 1 to ${MAX_TEXT} characters`);
      const moving = args.at !== undefined && args.at !== null;
      if (!moving && text === undefined) throw new Error("Give a new time (at) or new text.");
      if (moving && parseWhen(args.at, row.timezone, now()) === null) throw new Error('at must be a date and time such as "2026-03-06T15:30"');
      const heard = moving ? await heardPlan(args, ctx, { timeZone: row.timezone, move: true }) : null;
      if (heard && "asked" in heard) return heard.asked;
      const plan = heard?.plan ?? null;
      // A once Reminder's time of day follows its one post; a repeating one keeps its own, so only this post moves.
      const changed = await repositories().schedules.update(row.id, {
        ...(text !== undefined ? { text } : {}),
        ...(plan ? { nextAt: new Date(plan.nextAt), attempts: 0, error: null, ...(row.recurrence === "once" ? { timeOfDay: plan.timeOfDay } : {}) } : {}),
      });
      return { ...describe(changed ?? row), changed: true, ...(heard ? { said: heard.said } : {}), public: await isPublic(ctx), note: CARD_NOTE };
    },
  },
};
