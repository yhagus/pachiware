import type { Context, Hono } from "hono";
import { db, bots, repositories, type Schedule } from "@pachiware/db";
import { and, eq, ne } from "drizzle-orm";

const reminderOut = (r: Schedule) => ({
  id: r.id, ownerId: r.ownerId, ownerName: r.ownerName, guildId: r.guildId, channelId: r.channelId, text: r.text, withTasks: r.withTasks, mentions: r.mentions,
  recurrence: r.recurrence, weekdays: r.weekdays, dayOfMonth: r.dayOfMonth, timeOfDay: r.timeOfDay, timezone: r.timezone, until: r.until, nextAt: r.nextAt, lastFiredAt: r.lastFiredAt, createdAt: r.createdAt,
});

/**
 * GET lists the bot's active Reminders soonest first; DELETE `/:reminderId` marks one cancelled (the row stays for the scheduler's history). Nothing creates one here: Reminders come from chat.
 * The bot must not be deleted and, when `tenantOf` is given, must belong to that tenant; otherwise 404.
 */
export function botReminderRoutes(app: Hono<any>, botPath: string, param: string, tenantOf?: (c: Context<any>) => string) {
  const botOf = async (c: Context<any>) => {
    const botId = c.req.param(param)!, tenantId = tenantOf?.(c);
    const [bot] = await db.select({ id: bots.id }).from(bots).where(and(eq(bots.id, botId), ne(bots.connectionStatus, "deleted"), tenantId ? eq(bots.tenantId, tenantId) : undefined)).limit(1);
    return bot?.id ?? null;
  };
  const active = (botId: string, id?: string) => repositories().schedules.list({ botId, kind: "reminder", status: "active", ...(id ? { id } : {}) });
  app.get(`${botPath}/reminders`, async (c) => {
    const botId = await botOf(c);
    if (!botId) return c.json({ error: "Not found" }, 404);
    const rows = await active(botId);
    return c.json({ success: true, reminders: rows.map(reminderOut) });
  });
  app.delete(`${botPath}/reminders/:reminderId`, async (c) => {
    const botId = await botOf(c);
    const [row] = botId ? await active(botId, c.req.param("reminderId")!) : [];
    if (!row) return c.json({ error: "Reminder not found" }, 404);
    await repositories().schedules.update(row.id, { status: "cancelled" });
    return c.json({ success: true, reminder: reminderOut({ ...row, status: "cancelled" }) });
  });
}
