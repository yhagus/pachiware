import { visibleRoots } from "./paths.js";
import { workspaceStore } from "./store.js";
import type { SkillContext } from "../types.js";

export const MAX_MEMORY_CHARS = 4000;

/** MEMORY.md of the tenant, then the guild, then the channel (or the user's DM folder), cut at the cap each. Missing files are skipped. */
export async function loadMemory(ctx: Pick<SkillContext, "tenantId" | "guildId" | "channelId" | "parentChannelId" | "userId">): Promise<string[]> {
  const roots = visibleRoots(ctx), out: string[] = [];
  for (const name of ["tenant", "guild", "channel", "dm"]) {
    if (!roots[name]) continue;
    const file = await workspaceStore().read(ctx.tenantId, `${roots[name]}/MEMORY.md`).catch(() => null);
    const text = file?.content.trim();
    if (text) out.push(`[${name}] ${text.length > MAX_MEMORY_CHARS ? text.slice(0, MAX_MEMORY_CHARS) + "… (truncated)" : text}`);
  }
  return out;
}
