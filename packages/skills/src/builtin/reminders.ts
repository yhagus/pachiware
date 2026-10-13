import { schedules, eq, and, or, type Schedule } from "@pachiware/db";
import { count } from "drizzle-orm";
import type { SkillContext, SkillModule } from "../types.js";
import { DEFAULT_TIMEZONE, isoInZone, now, wallClock } from "../clock.js";
import { textIn } from "../language.js";
import { parseWhen } from "../schedule.js";

/** Pings and framing share Discord's 2000 characters with the text. */
const MAX_TEXT = 1500;
const MAX_MENTIONS = 10;
export const MAX_ACTIVE_PER_OWNER = 50;
export const MAX_ACTIVE_PER_TENANT = 500;

/** User ids as written or as `<@id>` pings, without the owner and without repeats. */
function mentionIds(input: unknown, ownerId: string): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error("mentions must be a list of Discord user ids");
  const ids = input.map((m) => String(m).trim().replace(/^<@!?([\w-]+)>$/, "$1")).filter((id) => /^[\w-]{1,64}$/.test(id) && id !== ownerId);
  return [...new Set(ids)].slice(0, MAX_MENTIONS);
}

const canModerate = (ctx: SkillContext) => !!ctx.auth?.permissions.some((p) => p === "Administrator" || p === "ManageMessages");
const activeReminders = (ctx: SkillContext) => and(eq(schedules.tenantId, ctx.tenantId), eq(schedules.kind, "reminder"), eq(schedules.status, "active"));

const describe = (row: Schedule) => ({
  id: row.id, text: row.text, channelId: row.channelId, guildId: row.guildId, owner: { id: row.ownerId, name: row.ownerName },
  nextAt: isoInZone(row.timezone, row.nextAt.getTime()), recurrence: row.recurrence, weekdays: row.weekdays, dayOfMonth: row.dayOfMonth, timeOfDay: row.timeOfDay,
  until: row.until ? isoInZone(row.timezone, row.until.getTime()) : null, timezone: row.timezone, mentions: row.mentions, withTasks: row.withTasks,
});

async function assertUnderLimits(ctx: SkillContext) {
  const t = textIn(ctx.language);
  const [owner] = await ctx.db.select({ n: count() }).from(schedules).where(and(activeReminders(ctx), eq(schedules.ownerId, ctx.userId!)));
  if (owner!.n >= MAX_ACTIVE_PER_OWNER) throw new Error(t.reminderLimitOwner(MAX_ACTIVE_PER_OWNER));
  const [tenant] = await ctx.db.select({ n: count() }).from(schedules).where(activeReminders(ctx));
  if (tenant!.n >= MAX_ACTIVE_PER_TENANT) throw new Error(t.reminderLimitTenant(MAX_ACTIVE_PER_TENANT));
}

export const remindersSkill: SkillModule = {
  id: "reminders",
  name: "Reminders",
  description: "Post a message at a time a person chose, where they asked, pinging them.",
  capabilities: ["reminders"],
  allowedScopes: ["tenant", "channel", "user"],
  toolPolicy: {
    createReminder: { effect: "write", requiresConfirmation: false },
    listReminders: { effect: "read" },
    cancelReminder: { effect: "write", requiresConfirmation: false },
  },
  tools: [
    {
      name: "createReminder",
      description: "Sets a Reminder: posts the text in this channel at the given time, pinging the asker and anyone in mentions. Turn the asker's words into a date and time with the time line of the context; never ask for a format.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "What to post, in the asker's words" },
          at: { type: "string", description: 'When to post, e.g. "2026-03-06T15:00" or "15:00"; read in this place\'s time zone unless it carries an offset' },
          mentions: { type: "array", items: { type: "string" }, description: "Discord user ids to ping besides the asker" },
          withTasks: { type: "boolean", description: "true: the post also lists the asker's open tasks (assigned to or created by them) visible from this place, so a morning DM Reminder doubles as their overview" },
        },
        required: ["text", "at"],
      },
    },
    {
      name: "listReminders",
      description: "Lists the asker's active Reminders with id, text, where they post, next time and recurrence; with Manage Messages, everyone's in this server too.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "cancelReminder",
      description: "Cancels a Reminder by id. Allowed for its owner, or for anyone with Manage Messages in this server.",
      parameters: { type: "object", properties: { id: { type: "string", description: "The Reminder's id, from listReminders or from when it was set" } }, required: ["id"] },
    },
  ],
  handlers: {
    createReminder: async (args, ctx) => {
      if (!ctx.botId || !ctx.channelId || !ctx.userId) throw new Error("Reminders can only be set from a Discord channel or DM.");
      await assertUnderLimits(ctx);
      const text = typeof args.text === "string" ? args.text.replace(/\s+/g, " ").trim() : "";
      if (!text) throw new Error("text is required");
      if (text.length > MAX_TEXT) throw new Error(`text must be at most ${MAX_TEXT} characters`);
      const timezone = ctx.timezone ?? DEFAULT_TIMEZONE, from = now();
      const at = parseWhen(args.at, timezone, from);
      if (at === null) throw new Error('at must be a date and time such as "2026-03-06T15:00"');
      if (at <= from) throw new Error("That time has already passed; pick a later one.");
      const mentions = mentionIds(args.mentions, ctx.userId), withTasks = args.withTasks === true || args.withTasks === "true";
      const wall = wallClock(timezone, at);
      const [row] = await ctx.db.insert(schedules).values({
        tenantId: ctx.tenantId, botId: ctx.botId, kind: "reminder", guildId: ctx.guildId ?? null, channelId: ctx.channelId,
        ownerId: ctx.userId, ownerName: ctx.userName ?? null, text, withTasks, mentions, recurrence: "once",
        timeOfDay: `${String(wall.hour).padStart(2, "0")}:${String(wall.minute).padStart(2, "0")}`, timezone, nextAt: new Date(at),
      }).returning({ id: schedules.id });
      return { id: row!.id, at: isoInZone(timezone, at), text, mentions, withTasks, channelId: ctx.channelId };
    },
    listReminders: async (_args, ctx) => {
      if (!ctx.userId) throw new Error("Reminders can only be listed from a Discord channel or DM.");
      const mine = eq(schedules.ownerId, ctx.userId);
      const visible = canModerate(ctx) && ctx.guildId ? or(mine, eq(schedules.guildId, ctx.guildId)) : mine;
      const rows: Schedule[] = await ctx.db.select().from(schedules).where(and(activeReminders(ctx), visible)).orderBy(schedules.nextAt, schedules.id);
      return { reminders: rows.map(describe), count: rows.length };
    },
    cancelReminder: async (args, ctx) => {
      if (!ctx.userId) throw new Error("Reminders can only be cancelled from a Discord channel or DM.");
      const t = textIn(ctx.language), id = typeof args.id === "string" ? args.id.trim() : "";
      const [row]: Schedule[] = id ? await ctx.db.select().from(schedules).where(and(activeReminders(ctx), eq(schedules.id, id))).limit(1) : [];
      if (!row) throw new Error(t.reminderNotFound);
      // Manage Messages reaches only the moderator's own guild; a DM Reminder has none, so only its owner can cancel it.
      if (row.ownerId !== ctx.userId && !(canModerate(ctx) && row.guildId && row.guildId === ctx.guildId)) throw new Error(t.reminderNotYours);
      await ctx.db.update(schedules).set({ status: "cancelled" }).where(eq(schedules.id, row.id));
      return { id: row.id, cancelled: true, text: row.text };
    },
  },
};
