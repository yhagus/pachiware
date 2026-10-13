import { visibleRoots } from "./paths.js";
import { workspaceStore } from "./store.js";
import type { SkillContext } from "../types.js";

export const MAX_MEMORY_CHARS = 4000;

type Where = Pick<SkillContext, "tenantId" | "guildId" | "channelId" | "parentChannelId" | "userId">;
export type MemoryScope = "tenant" | "guild" | "channel" | "dm";

/** MEMORY.md of the tenant, then the guild, then the channel (or the user's DM folder), cut at the cap each. Missing files are skipped. */
export async function loadMemory(ctx: Where): Promise<{ scope: MemoryScope; text: string }[]> {
  const roots = visibleRoots(ctx), out: { scope: MemoryScope; text: string }[] = [];
  for (const scope of ["tenant", "guild", "channel", "dm"] as const) {
    if (!roots[scope]) continue;
    const text = (await readMemory(ctx, scope))?.content.trim();
    if (text) out.push({ scope, text: text.length > MAX_MEMORY_CHARS ? text.slice(0, MAX_MEMORY_CHARS) + "… (truncated)" : text });
  }
  return out;
}

/** The Memory the agent may change from here: "guild" or "channel" in a guild; in a DM either name means the person's own folder. */
export function memoryScope(ctx: Where, requested: unknown): MemoryScope {
  if (requested !== "guild" && requested !== "channel") throw new Error('scope must be "channel" or "guild"');
  const roots = visibleRoots(ctx);
  if (roots.dm) return "dm";
  if (!roots[requested]) throw new Error(`No ${requested} Memory here.`);
  return requested;
}

const memoryFile = (ctx: Where, scope: MemoryScope) => `${visibleRoots(ctx)[scope]}/MEMORY.md`;
const readMemory = (ctx: Where, scope: MemoryScope) => workspaceStore().read(ctx.tenantId, memoryFile(ctx, scope)).catch(() => null);

/** Appends `- <date> (<name>): <text>` to that scope's MEMORY.md and returns the line. */
export async function remember(ctx: Where, scope: MemoryScope, text: string, name: string, at = new Date()): Promise<string> {
  const line = `- ${at.toISOString().slice(0, 10)} (${name}): ${text}`;
  const current = await readMemory(ctx, scope);
  const body = current?.content.trimEnd();
  await workspaceStore().write(ctx.tenantId, memoryFile(ctx, scope), body ? `${body}\n${line}` : line, current?.version);
  return line;
}

/** Removes every line of that scope's MEMORY.md containing `match`, case-insensitively, and returns how many went. */
export async function forget(ctx: Where, scope: MemoryScope, match: string): Promise<number> {
  const current = await readMemory(ctx, scope);
  if (!current) return 0;
  const needle = match.toLowerCase(), lines = current.content.split("\n");
  const kept = lines.filter((l) => !l.toLowerCase().includes(needle));
  if (kept.length !== lines.length) await workspaceStore().write(ctx.tenantId, memoryFile(ctx, scope), kept.join("\n").trim(), current.version);
  return lines.length - kept.length;
}
