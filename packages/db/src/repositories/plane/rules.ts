import type { PlaneScope, PlaneScopeRule } from "./types.js";

/** In a rule's projectIds, every Plane project of the account. It stands alone. */
export const ALL_PLANE_PROJECTS = "*";

/** A Plane id (UUID), in any case. Project ids are stored lowercased so a channel rule compares with its guild rule exactly. */
export const PLANE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanProjectIds(ids: string[]): string[] {
  const out = [...new Set((ids || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
  if (!out.length) throw new Error("projectIds must not be empty");
  if (out.includes(ALL_PLANE_PROJECTS)) return [ALL_PLANE_PROJECTS];
  if (out.some((x) => !PLANE_ID.test(x))) throw new Error("Invalid Plane project id");
  return out;
}

/** The project ids of `channel` that `guild` allows. */
function within(guild: string[], channel: string[]): string[] {
  if (guild.includes(ALL_PLANE_PROJECTS)) return channel;
  return channel.filter((id) => guild.includes(id));
}

/**
 * Checks the rules of one scope against the accounts the bot holds and, for a channel, the guild rules; returns them cleaned.
 * Shared by every engine, so the same rules reject everywhere.
 */
export function checkPlaneScopeRules(rules: PlaneScopeRule[], linked: Set<string>, channelId: string, current: PlaneScope[]): PlaneScopeRule[] {
  const seen = new Set<string>();
  const clean = rules.map((r) => {
    if (!linked.has(r.planeAccountId)) throw new Error("Plane account is not attached to this bot");
    if (seen.has(r.planeAccountId)) throw new Error("Duplicate Plane account in rules");
    seen.add(r.planeAccountId);
    return { planeAccountId: r.planeAccountId, projectIds: cleanProjectIds(r.projectIds) };
  });
  if (channelId) {
    const guild = new Map(current.filter((r) => r.channelId === "").map((r) => [r.planeAccountId, r.projectIds]));
    for (const r of clean) {
      const parent = guild.get(r.planeAccountId);
      if (!parent) throw new Error("Channel rule needs the Plane account enabled in the guild first");
      if (within(parent, r.projectIds).length !== r.projectIds.length) throw new Error("Channel rule reaches a Plane project the guild rule does not allow");
    }
  }
  return clean;
}

/** After the guild rules change, what a channel rule becomes: its project ids that still fit, or null when it must go. */
export function narrowPlaneChannelRule(guild: PlaneScopeRule[], channel: PlaneScope): string[] | null {
  const parent = guild.find((r) => r.planeAccountId === channel.planeAccountId)?.projectIds;
  if (!parent) return null;
  const narrowed = within(parent, channel.projectIds);
  return narrowed.length ? narrowed : null;
}
