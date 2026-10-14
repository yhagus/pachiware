import { db, schedules, agentsConfig, eq, and, type Schedule } from "@pachiware/db";
import { asc, lte } from "drizzle-orm";
import { now, nextOccurrence, wallClock, hhmm, LATE_LIMIT_MS, LATE_NOTE_MS, MAX_POST_ATTEMPTS, MESSAGE_LIMIT, configuredLanguage, textIn, loadTasks, readInFull, workspaceStore, dueMoment, taskLine, isOpen, isAssignee, type Strings } from "@pachiware/skills";
import { loadGuildSettings } from "./loop/prompt.js";
import { digestLines } from "./digest.js";
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
  try { await post(client, row, at, late > LATE_NOTE_MS); }
  catch (error: any) { await failed(row, error?.message || String(error)); return; }
  await moveOn(row, at, new Date(at));
}

/** A Reminder is the one message that pings: the owner and the people named when it was made; a late one says when it was due, in the row's zone. A Digest pings nobody and is skipped on a day with nothing to report. */
async function post(client: any, row: Schedule, at: number, late: boolean) {
  const channel: any = await client.channels.fetch(row.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error("The channel is gone or cannot be posted in.");
  const [agent] = await db.select({ language: agentsConfig.language }).from(agentsConfig).where(eq(agentsConfig.tenantId, row.tenantId)).limit(1);
  const guild = row.guildId ? await loadGuildSettings(row.tenantId, row.botId, row.guildId) : null;
  const strings = textIn(configuredLanguage(guild, agent));
  if (row.kind === "digest") {
    const [first, ...rest] = await digestLines(row, strings, at);
    if (first) await channel.send({ content: withinLimit(first, rest), allowedMentions: { parse: [] } });
    return;
  }
  const users = [...new Set([row.ownerId, ...row.mentions].filter((id): id is string => !!id))];
  let head = [...users.map((id) => `<@${id}>`), strings.reminder(row.text)].join(" ");
  if (late) { const w = wallClock(row.timezone, row.nextAt.getTime()); head += `\n${strings.reminderLate(w.day, w.month, hhmm(w.hour, w.minute))}`; }
  const lines = row.withTasks ? await ownerTaskLines(row, channel.isThread?.() ? channel.parentId ?? undefined : undefined, strings, at) : [];
  await channel.send({ content: withinLimit(head.slice(0, MESSAGE_LIMIT), lines), allowedMentions: { users } });
}

/** The owner's open tasks (assigned to or created by them, by id or name) in the folders visible from the posting place, soonest due first, as the turn context lists them. Empty without any. */
async function ownerTaskLines(row: Schedule, parentChannelId: string | undefined, strings: Strings, at: number): Promise<string[]> {
  if (!row.ownerId) return [];
  const mine = new Set([row.ownerId, row.ownerName].filter((v): v is string => !!v));
  const where = { tenantId: row.tenantId, guildId: row.guildId ?? undefined, channelId: row.channelId, parentChannelId, userId: row.ownerId };
  const store = workspaceStore(), found = (await loadTasks(store, where))
    .filter(({ task: t }) => isOpen(t) && (isAssignee(t.assignedTo, { id: row.ownerId, names: [...mine] }) || [t.createdBy, t.createdByName].some((v) => v && mine.has(v))));
  const open = (await readInFull(store, row.tenantId, found))
    .sort((a, b) => (dueMoment(a.dueAt, row.timezone) ?? Infinity) - (dueMoment(b.dueAt, row.timezone) ?? Infinity) || a.createdAt.localeCompare(b.createdAt));
  return open.length ? [strings.openTasks, ...open.map((t) => taskLine(t, row.timezone, at))] : [];
}

/** Whole lines only: a task list that would cross Discord's limit stops at the last line that fits. */
function withinLimit(head: string, lines: string[]): string {
  let content = head;
  for (const line of lines) { if (content.length + 1 + line.length > MESSAGE_LIMIT) break; content += `\n${line}`; }
  return content;
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
