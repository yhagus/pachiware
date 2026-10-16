/**
 * Plane scope at run time: which of the bot's Plane accounts, and which Plane projects of each, a tool may use in this place.
 * Every Plane tool resolves its account with `loadPlaneAccess` + `pickPlaneAccess`, checks a Plane project with
 * `planeProjectAllowed`, and builds its connection with `planeConnOf`.
 */
import { repositories, decryptSecret, ALL_PLANE_PROJECTS, type PlaneAccount } from "@pachiware/db";
import type { SkillContext } from "../types.js";
import { assertPlaneUrl, type PlaneConn } from "./client.js";

type Rule = { planeAccountId: string; channelId: string; projectIds: string[] };

/** An account usable here. A Plane project is allowed only when every set allows it (the guild's, then the channel's). */
export interface PlaneAccess { account: PlaneAccount; sets: string[][] }

export const PLANE_NOT_ENABLED = "Plane is not enabled here. An admin can enable a Plane account for this server, and its Plane projects, in the console.";

/** Guild rules switch an account on and a channel rule narrows them; a thread uses its parent channel's rule, never its own. */
export function computePlaneAccess(attached: PlaneAccount[], rules: Rule[], channelId?: string, parentChannelId?: string): PlaneAccess[] {
  const place = parentChannelId || channelId;
  const channelRules = place ? rules.filter((r) => r.channelId === place) : [];
  const out: PlaneAccess[] = [];
  for (const account of attached) {
    const guild = rules.find((r) => r.channelId === "" && r.planeAccountId === account.id);
    if (!guild) continue;
    const sets = [guild.projectIds];
    if (channelRules.length) {
      const own = channelRules.find((r) => r.planeAccountId === account.id);
      if (!own) continue;
      sets.push(own.projectIds);
    }
    out.push({ account, sets });
  }
  return out;
}

export function planeProjectAllowed(access: PlaneAccess, projectId: string): boolean {
  const id = projectId.toLowerCase();
  return access.sets.every((set) => set.includes(ALL_PLANE_PROJECTS) || set.includes(id));
}

/** True when every Plane project of the account is open here; workspace-level actions need it. */
export function allPlaneProjectsAllowed(access: PlaneAccess): boolean {
  return access.sets.every((set) => set.includes(ALL_PLANE_PROJECTS));
}

/** The Plane project ids open here, or null when all of them are. */
export function allowedPlaneProjectIds(access: PlaneAccess): string[] | null {
  const limited = access.sets.filter((set) => !set.includes(ALL_PLANE_PROJECTS));
  if (!limited.length) return null;
  return limited.reduce((acc, set) => acc.filter((id) => set.includes(id)));
}

/** `name` may be omitted only when exactly one account is usable. */
export function pickPlaneAccess(list: PlaneAccess[], name?: unknown): PlaneAccess {
  if (!list.length) throw new Error(PLANE_NOT_ENABLED);
  const names = list.map((a) => a.account.name).join(", ");
  if (typeof name !== "string" || !name.trim()) {
    if (list.length === 1) return list[0]!;
    throw new Error(`Several Plane accounts are available; pass "account" with one of: ${names}`);
  }
  const hit = list.find((a) => a.account.name.toLowerCase() === name.trim().toLowerCase());
  if (!hit) throw new Error(`Unknown Plane account "${name}"; available: ${names}`);
  return hit;
}

/** The Plane access of the place a tool runs in; empty outside a guild channel, or with no guild rule. */
export async function loadPlaneAccess(ctx: SkillContext): Promise<PlaneAccess[]> {
  if (!ctx.botId || !ctx.guildId) return [];
  const { plane } = repositories();
  const attached = (await plane.listBotAccounts(ctx.botId)).filter((a) => a.tenantId === ctx.tenantId);
  const rules = (await plane.listScopes(ctx.botId, ctx.guildId)).filter((r) => r.tenantId === ctx.tenantId);
  return computePlaneAccess(attached, rules, ctx.channelId, ctx.parentChannelId);
}

/** The connection of an account, with its key decrypted; Allowed hosts is checked again, since it may have changed. */
export function planeConnOf(account: PlaneAccount): PlaneConn {
  assertPlaneUrl(account.baseUrl);
  return { baseUrl: account.baseUrl, workspaceSlug: account.workspaceSlug, apiKey: decryptSecret(account.apiKeyEncrypted) };
}
