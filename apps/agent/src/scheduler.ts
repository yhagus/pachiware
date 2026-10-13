import { db, schedules, agentsConfig, eq, and, type Schedule } from "@pachiware/db";
import { asc, lte } from "drizzle-orm";
import { now, nextOccurrence, wallClock, LATE_LIMIT_MS, LATE_NOTE_MS, MAX_POST_ATTEMPTS, MESSAGE_LIMIT, configuredLanguage, textIn } from "@pachiware/skills";
import { loadGuildSettings } from "./loop/prompt.js";
import type { DiscordBotManager } from "./discord/client.js";

export const SCHEDULER_INTERVAL_MS = 60_000;
let running: Promise<void> | null = null;

/** One scheduler pass: every active row due at `at` is posted through its bot's client and moved on. A pass still running when the next starts is awaited, never doubled. */
export function schedulerTick(manager: DiscordBotManager, at = now()): Promise<void> {
  if (running) return running;
  running = pass(manager, at).finally(() => { running = null; });
  return running;
}

export function startScheduler(manager: DiscordBotManager, everyMs = SCHEDULER_INTERVAL_MS) {
  const timer = setInterval(() => { schedulerTick(manager).catch(() => {}); }, everyMs);
  timer.unref?.();
  return timer;
}

async function pass(manager: DiscordBotManager, at: number) {
  const due = await db.select().from(schedules).where(and(eq(schedules.status, "active"), lte(schedules.nextAt, new Date(at)))).orderBy(asc(schedules.nextAt));
  for (const row of due) await fire(manager, row, at).catch(() => {});
}

async function fire(manager: DiscordBotManager, row: Schedule, at: number) {
  const client = manager.clientOf(row.botId);
  if (!client) return;
  const late = at - row.nextAt.getTime();
  if (late > LATE_LIMIT_MS) { await moveOn(row, at, null); return; }
  try { await post(client, row, late > LATE_NOTE_MS); }
  catch (error: any) { await failed(row, error?.message || String(error)); return; }
  await moveOn(row, at, new Date(at));
}

/** The one message that pings: the owner and the people named when the Reminder was made. A late post says when it was due, in the row's zone. */
async function post(client: any, row: Schedule, late: boolean) {
  const channel: any = await client.channels.fetch(row.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error("The channel is gone or cannot be posted in.");
  const [agent] = await db.select({ language: agentsConfig.language }).from(agentsConfig).where(eq(agentsConfig.tenantId, row.tenantId)).limit(1);
  const guild = row.guildId ? await loadGuildSettings(row.tenantId, row.botId, row.guildId) : null;
  const t = textIn(configuredLanguage(guild, agent));
  const users = [...new Set([row.ownerId, ...row.mentions].filter((id): id is string => !!id))];
  const lines = [[...users.map((id) => `<@${id}>`), t.reminder(row.text)].join(" ")];
  if (late) { const w = wallClock(row.timezone, row.nextAt.getTime()); lines.push(t.reminderLate(w.day, w.month, `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`)); }
  await channel.send({ content: lines.join("\n").slice(0, MESSAGE_LIMIT), allowedMentions: { users } });
}

async function moveOn(row: Schedule, at: number, firedAt: Date | null) {
  const next = nextOccurrence(row, at);
  await db.update(schedules).set({ nextAt: next === null ? row.nextAt : new Date(next), status: next === null ? "done" : "active", lastFiredAt: firedAt ?? row.lastFiredAt, attempts: 0, error: null }).where(eq(schedules.id, row.id));
}

async function failed(row: Schedule, reason: string) {
  const attempts = row.attempts + 1;
  const over = attempts >= MAX_POST_ATTEMPTS;
  await db.update(schedules).set({ attempts, ...(over ? { status: "done" as const, error: `Could not post after ${attempts} attempts: ${reason.slice(0, 200)}` } : {}) }).where(eq(schedules.id, row.id));
}
