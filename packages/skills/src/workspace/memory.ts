import { visibleRoots } from "./paths.js";
import { workspaceStore } from "./store.js";
import { today } from "../clock.js";
import { textIn } from "../language.js";
import type { SkillContext } from "../types.js";

export const MAX_MEMORY_CHARS = 4000;
/** Lines dated this recently must survive a compaction. */
export const MEMORY_KEEP_DAYS = 30;
const DAY = 86_400_000;
const LINE = /^- (\d{4}-\d{2}-\d{2}) \([^)]+\): \S.*$/;
const dateOf = (at: Date) => at.toISOString().slice(0, 10);

type Where = Pick<SkillContext, "tenantId" | "guildId" | "channelId" | "parentChannelId" | "userId" | "complete" | "language">;
export type MemoryLevel = "tenant" | "guild" | "channel" | "dm";

/** MEMORY.md of the tenant, then the guild, then the channel (or the user's DM folder), cut at the cap each. Missing files are skipped. */
export async function loadMemory(ctx: Where): Promise<{ level: MemoryLevel; text: string }[]> {
  const roots = visibleRoots(ctx), out: { level: MemoryLevel; text: string }[] = [];
  for (const level of ["tenant", "guild", "channel", "dm"] as const) {
    if (!roots[level]) continue;
    const text = (await readMemory(ctx, level))?.content.trim();
    if (text) out.push({ level, text: text.length > MAX_MEMORY_CHARS ? text.slice(0, MAX_MEMORY_CHARS) + "… (truncated)" : text });
  }
  return out;
}

/** The Memory the agent may change from here: "guild" or "channel" in a guild; in a DM either name means the person's own folder. */
export function memoryLevel(ctx: Where, requested: unknown): MemoryLevel {
  if (requested !== "guild" && requested !== "channel") throw new Error('level must be "channel" or "guild"');
  const roots = visibleRoots(ctx);
  if (roots.dm) return "dm";
  if (!roots[requested]) throw new Error(`No ${requested} Memory here.`);
  return requested;
}

const memoryFile = (ctx: Where, level: MemoryLevel) => `${visibleRoots(ctx)[level]}/MEMORY.md`;
const readMemory = (ctx: Where, level: MemoryLevel) => workspaceStore().read(ctx.tenantId, memoryFile(ctx, level)).catch(() => null);

/** Appends `- <date> (<name>): <text>` to that level's MEMORY.md, compacts the file when that leaves it over the cap, and returns the line. */
export async function remember(ctx: Where, level: MemoryLevel, text: string, name: string): Promise<string> {
  const line = `- ${dateOf(today())} (${name}): ${text}`;
  const current = await readMemory(ctx, level);
  const body = current?.content.trimEnd();
  const next = body ? `${body}\n${line}` : line;
  const { version } = await workspaceStore().write(ctx.tenantId, memoryFile(ctx, level), next, current?.version);
  if (next.length > MAX_MEMORY_CHARS) await compact(ctx, level, next, version);
  return line;
}

/** Removes every line of that level's MEMORY.md containing `match`, case-insensitively, and returns how many went. */
export async function forget(ctx: Where, level: MemoryLevel, match: string): Promise<number> {
  const current = await readMemory(ctx, level);
  if (!current) return 0;
  const needle = match.toLowerCase(), lines = current.content.split("\n");
  const kept = lines.filter((l) => !l.toLowerCase().includes(needle));
  if (kept.length !== lines.length) await workspaceStore().write(ctx.tenantId, memoryFile(ctx, level), kept.join("\n").trim(), current.version);
  return lines.length - kept.length;
}

const COMPACT_PROMPT = (since: string) => `You compact the Memory file of an assistant: one Markdown list, one fact per line in the form "- YYYY-MM-DD (name): text".
Merge duplicates and lines that say the same thing into one line, keeping the latest date and the name on it. Drop lines that are stale: superseded by a later line, or about something that has passed.
Keep every line dated ${since} or later exactly as it is, character for character. Keep each line's language. Add nothing that is not in the file.
Reply with the lines only, in date order, no headings or commentary, under ${MAX_MEMORY_CHARS} characters.`;

/**
 * One model call rewrites the file. The result is kept only when it is in the line format, holds every line of the last 30 days
 * verbatim, and fits the cap; otherwise the oldest lines before that window go until the rest fits. Either way a dated line says so.
 * A write that lost to another change is dropped: the next remember compacts again.
 */
async function compact(ctx: Where, level: MemoryLevel, text: string, version: string): Promise<void> {
  const at = today(), since = dateOf(new Date(at.getTime() - MEMORY_KEEP_DAYS * DAY));
  const lines = text.split("\n").filter((l) => l.trim());
  const dated = lines.map((l, i) => ({ i, date: l.match(LINE)?.[1] ?? "" }));
  const recent = lines.filter((_, i) => dated[i].date >= since);
  const t = textIn(ctx.language), stamp = (note: string) => `- ${dateOf(at)} (bot): ${note}`;
  const proposed = await ctx.complete?.({ system: COMPACT_PROMPT(since), user: text }).catch(() => null);
  const kept = proposed?.split("\n").map((l) => l.trim()).filter(Boolean) ?? [];
  const compacted = [...kept, stamp(t.memoryCompacted(lines.length, kept.length))].join("\n");
  const accepted = kept.length > 0 && kept.every((l) => LINE.test(l)) && recent.every((l) => kept.includes(l.trim())) && compacted.length <= MAX_MEMORY_CHARS;
  let out = compacted;
  if (!accepted) {
    const oldestFirst = dated.filter((d) => d.date < since).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i));
    const drop = new Set<number>();
    const cut = () => [...lines.filter((_, i) => !drop.has(i)), stamp(t.memoryCut(drop.size))].join("\n");
    for (const d of oldestFirst) { if (cut().length <= MAX_MEMORY_CHARS) break; drop.add(d.i); }
    if (!drop.size) return;
    out = cut();
  }
  await workspaceStore().write(ctx.tenantId, memoryFile(ctx, level), out, version).catch(() => {});
}
