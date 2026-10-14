import { db, schedules, agentsConfig, eq, and, type Schedule } from "@pachiware/db";
import { asc, lte } from "drizzle-orm";
import { now, nextOccurrence, wallClock, hhmm, LATE_LIMIT_MS, LATE_NOTE_MS, MAX_POST_ATTEMPTS, MESSAGE_LIMIT, configuredLanguage, textIn, readInFull, workspaceStore, taskLine, isOpen, scopeSources, tasksIn, inScope, groupTasks, PERSONAL_TASKS, type DiscordClientAdapter, type Strings } from "@pachiware/skills";
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
  try { await post(client, manager.adapterOf(row.botId, row.guildId ?? undefined), row, at, late > LATE_NOTE_MS); }
  catch (error: any) { await failed(row, error?.message || String(error)); return; }
  await moveOn(row, at, new Date(at));
}

/** A Reminder is the one message that pings: the owner and the people named when it was made; a late one says when it was due, in the row's zone. A Digest pings nobody and is skipped on a day with nothing to report. */
async function post(client: any, discord: DiscordClientAdapter | null, row: Schedule, at: number, late: boolean) {
  const channel: any = await client.channels.fetch(row.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error("The channel is gone or cannot be posted in.");
  const [agent] = await db.select({ language: agentsConfig.language }).from(agentsConfig).where(eq(agentsConfig.tenantId, row.tenantId)).limit(1);
  const guild = row.guildId ? await loadGuildSettings(row.tenantId, row.botId, row.guildId) : null;
  const strings = textIn(configuredLanguage(guild, agent));
  if (row.kind === "digest") {
    const [first, ...rest] = await digestLines(row, strings, at);
    if (first) await channel.send({ content: withinLimit(first, rest.map((line) => [line])), allowedMentions: { parse: [] } });
    return;
  }
  const users = [...new Set([row.ownerId, ...row.mentions].filter((id): id is string => !!id))];
  let head = [...users.map((id) => `<@${id}>`), strings.reminder(row.text)].join(" ");
  if (late) { const w = wallClock(row.timezone, row.nextAt.getTime()); head += `\n${strings.reminderLate(w.day, w.month, hhmm(w.hour, w.minute))}`; }
  const tasks = row.withTasks ? await ownerTaskLines(row, discord, strings, at) : [];
  await channel.send({ content: withinLimit(head.slice(0, MESSAGE_LIMIT), tasks), allowedMentions: { users } });
}

/**
 * The owner's open `mine` tasks, as they would list them from where the Reminder posts: assigned to them or kept as their Personal tasks,
 * in every project channel they can view (from a DM, in every guild the bot shares with them), one heading per channel, soonest due first. Empty without any.
 * One chunk per task line; the first of each channel also holds its heading (and the very first the list header), so a cut list never ends on a heading.
 */
async function ownerTaskLines(row: Schedule, discord: DiscordClientAdapter | null, strings: Strings, at: number): Promise<string[][]> {
  if (!row.ownerId) return [];
  const store = workspaceStore(), owner = { userId: row.ownerId, userName: row.ownerName ?? undefined };
  const sources = await scopeSources(store, { tenantId: row.tenantId, guildId: row.guildId ?? undefined, userId: row.ownerId, discord: discord ?? undefined });
  const groups = groupTasks((await tasksIn(store, row.tenantId, sources)).filter((f) => isOpen(f.task) && inScope("mine", owner)(f)), sources, row.timezone);
  const full = await readInFull(store, row.tenantId, groups.flatMap((g) => g.tasks));
  let i = 0;
  const chunks = groups.flatMap((g) => g.tasks.map((_, n) => [...(n ? [] : [g.source.label === PERSONAL_TASKS ? strings.personalTasks : g.source.label]), taskLine(full[i++]!, row.timezone, at)]));
  if (chunks[0]) chunks[0].unshift(strings.openTasks);
  return chunks;
}

/** Whole chunks of lines only: a list that would cross Discord's limit stops at the last chunk that fits. */
function withinLimit(head: string, chunks: string[][]): string {
  let content = head;
  for (const chunk of chunks) { const more = chunk.map((line) => `\n${line}`).join(""); if (content.length + more.length > MESSAGE_LIMIT) break; content += more; }
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
