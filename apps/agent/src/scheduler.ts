import { db, schedules, agentsConfig, eq, and, type Schedule } from "@pachiware/db";
import { asc, lte } from "drizzle-orm";
import { now, nextOccurrence, LATE_LIMIT_MS, MAX_POST_ATTEMPTS, MESSAGE_LIMIT, configuredLanguage, textIn } from "@pachiware/skills";
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
  if (at - row.nextAt.getTime() > LATE_LIMIT_MS) { await moveOn(row, at, null); return; }
  try { await post(client, row); }
  catch (error: any) { await failed(row, error?.message || String(error)); return; }
  await moveOn(row, at, new Date(at));
}

/** The one message that pings: the owner and the people named when the Reminder was made. */
async function post(client: any, row: Schedule) {
  const channel: any = await client.channels.fetch(row.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error("The channel is gone or cannot be posted in.");
  const [agent] = await db.select({ language: agentsConfig.language }).from(agentsConfig).where(eq(agentsConfig.tenantId, row.tenantId)).limit(1);
  const guild = row.guildId ? await loadGuildSettings(row.tenantId, row.botId, row.guildId) : null;
  const users = [...new Set([row.ownerId, ...row.mentions].filter((id): id is string => !!id))];
  const content = [...users.map((id) => `<@${id}>`), textIn(configuredLanguage(guild, agent)).reminder(row.text)].join(" ").slice(0, MESSAGE_LIMIT);
  await channel.send({ content, allowedMentions: { users } });
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
