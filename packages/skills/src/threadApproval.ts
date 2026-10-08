import type { SkillContext } from "./types.js";

/** The concrete Discord conversation a sensitive-action grant belongs to. */
export type ThreadApprovalContext = Pick<SkillContext, "tenantId" | "botId" | "guildId" | "channelId" | "parentChannelId" | "userId">;

const active = new Set<string>();

/**
 * Grants are deliberately process-local. A restart clears the set, and the
 * concrete channel (thread) is part of the key so approval cannot bleed into
 * a sibling thread or its parent channel.
 */
export function threadApprovalKey(ctx: ThreadApprovalContext): string | null {
  if (!ctx.tenantId || !ctx.botId || !ctx.guildId || !ctx.channelId) return null;
  return [ctx.tenantId, ctx.botId, ctx.guildId, ctx.channelId, ctx.parentChannelId ?? ""].map((v) => encodeURIComponent(v)).join("\u001f");
}

/** Owners are configured by the host deployment, not by model-supplied data. */
export function isThreadApprovalOwner(ctx: Pick<ThreadApprovalContext, "userId">): boolean {
  if (!ctx.userId) return false;
  return (process.env.GIT_OWNER_DISCORD_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean).includes(ctx.userId);
}

export function hasThreadApproval(ctx: ThreadApprovalContext): boolean {
  const key = threadApprovalKey(ctx);
  return key !== null && active.has(key);
}

/** Only an owner can create a grant, and an incomplete context cannot be granted. */
export function grantThreadApproval(ctx: ThreadApprovalContext): boolean {
  if (!isThreadApprovalOwner(ctx)) return false;
  const key = threadApprovalKey(ctx);
  if (!key) return false;
  active.add(key);
  return true;
}

export function revokeThreadApproval(ctx: ThreadApprovalContext): boolean {
  const key = threadApprovalKey(ctx);
  return key !== null && active.delete(key);
}

/** Used by tests and by a host when a bot runtime is intentionally reset. */
export function resetThreadApprovals(): void {
  active.clear();
}

