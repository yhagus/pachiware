import type { PlaneScope, PlaneScopeRule, PlaneScopeRuleInput, PlaneWorkspace } from "./types.js";

/** In a rule's projectIds, every Plane project of the account. It stands alone. */
export const ALL_PLANE_PROJECTS = "*";

/** The Plane version every account made before accounts carried one was built for (Plane 1.3.1); it never follows the newest. */
export const FIRST_PLANE_VERSION = "1.3.1";

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

/** A rule's account and Plane workspace as one key. */
const keyOf = (r: { planeAccountId: string; workspaceSlug: string }) => `${r.planeAccountId}/${r.workspaceSlug}`;

/** The Plane workspace a rule names: one the account lists, switched on or not; left out, the account's only one. */
function workspaceOf(rule: PlaneScopeRuleInput, workspaces: PlaneWorkspace[]): string {
  const given = typeof rule.workspaceSlug === "string" ? rule.workspaceSlug.trim().toLowerCase() : "";
  if (!given) {
    if (workspaces.length === 1) return workspaces[0]!.slug;
    throw new Error("workspaceSlug is required: the Plane account has several Plane workspaces");
  }
  if (!workspaces.some((w) => w.slug === given)) throw new Error("Plane workspace is not listed on this Plane account");
  return given;
}

/**
 * Checks the rules of one scope against the accounts the bot holds (each with the Plane workspaces it lists) and, for a
 * channel, the guild rules; returns them cleaned. Shared by every engine, so the same rules reject everywhere.
 */
export function checkPlaneScopeRules(rules: PlaneScopeRuleInput[], linked: Map<string, PlaneWorkspace[]>, channelId: string, current: PlaneScope[]): PlaneScopeRule[] {
  const seen = new Set<string>();
  const clean = rules.map((r) => {
    const workspaces = linked.get(r.planeAccountId);
    if (!workspaces) throw new Error("Plane account is not attached to this bot");
    const rule = { planeAccountId: r.planeAccountId, workspaceSlug: workspaceOf(r, workspaces), projectIds: cleanProjectIds(r.projectIds) };
    if (seen.has(keyOf(rule))) throw new Error("Duplicate Plane account and workspace in rules");
    seen.add(keyOf(rule));
    return rule;
  });
  if (channelId) {
    const guild = new Map(current.filter((r) => r.channelId === "").map((r) => [keyOf(r), r.projectIds]));
    for (const r of clean) {
      const parent = guild.get(keyOf(r));
      if (!parent) throw new Error("Channel rule needs the Plane account enabled in the guild first");
      if (within(parent, r.projectIds).length !== r.projectIds.length) throw new Error("Channel rule reaches a Plane project the guild rule does not allow");
    }
  }
  return clean;
}

/** After the guild rules change, what a channel rule becomes: its project ids that still fit, or null when it must go. */
export function narrowPlaneChannelRule(guild: PlaneScopeRule[], channel: PlaneScope): string[] | null {
  const parent = guild.find((r) => keyOf(r) === keyOf(channel))?.projectIds;
  if (!parent) return null;
  const narrowed = within(parent, channel.projectIds);
  return narrowed.length ? narrowed : null;
}
