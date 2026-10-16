import type { SkillContext } from "./types.js";

/** The concrete Discord conversation a sensitive-action grant belongs to. */
export type ThreadConfirmationContext = Pick<SkillContext, "tenantId" | "botId" | "guildId" | "channelId" | "parentChannelId" | "userId">;

const active = new Set<string>();

/**
 * Grants are deliberately process-local. A restart clears the set, and the
 * concrete channel (thread) is part of the key so confirmation cannot bleed into
 * a sibling thread or its parent channel.
 */
export function threadConfirmationKey(ctx: ThreadConfirmationContext): string | null {
  if (!ctx.tenantId || !ctx.botId || !ctx.guildId || !ctx.channelId) return null;
  return [ctx.tenantId, ctx.botId, ctx.guildId, ctx.channelId, ctx.parentChannelId ?? ""].map((v) => encodeURIComponent(v)).join("\u001f");
}

const idsIn = (list: string | undefined) => (list ?? "").split(",").map((id) => id.trim()).filter(Boolean);

/**
 * Trusted members are configured by the host deployment, not by model-supplied data. A blank TRUSTED_DISCORD_IDS
 * counts as unset, so installations that only have GIT_OWNER_DISCORD_IDS keep their list. Empty means nobody.
 */
// ponytail: env list for now; move to a per-bot list in the console when deployments need different Trusted members.
export function isTrustedMember(ctx: Pick<ThreadConfirmationContext, "userId">): boolean {
  if (!ctx.userId) return false;
  const trusted = idsIn(process.env.TRUSTED_DISCORD_IDS);
  return (trusted.length ? trusted : idsIn(process.env.GIT_OWNER_DISCORD_IDS)).includes(ctx.userId);
}

export function hasThreadConfirmation(ctx: ThreadConfirmationContext): boolean {
  const key = threadConfirmationKey(ctx);
  return key !== null && active.has(key);
}

/** Only a Trusted member can create a grant, and an incomplete context cannot be granted. */
export function grantThreadConfirmation(ctx: ThreadConfirmationContext): boolean {
  if (!isTrustedMember(ctx)) return false;
  const key = threadConfirmationKey(ctx);
  if (!key) return false;
  active.add(key);
  return true;
}

export function revokeThreadConfirmation(ctx: ThreadConfirmationContext): boolean {
  const key = threadConfirmationKey(ctx);
  return key !== null && active.delete(key);
}

/** Used by tests and by a host when a bot runtime is intentionally reset. */
export function resetThreadConfirmations(): void {
  active.clear();
}

