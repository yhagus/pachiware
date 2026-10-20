/** Plane scope at run time: which Plane workspaces of the bot's Plane accounts, and which Plane projects of each, a tool may use here. */
import { repositories, decryptSecret, ALL_PLANE_PROJECTS, type PlaneAccount } from "@pachiware/db";
import type { SkillContext } from "../types.js";
import { assertPlaneUrl, type PlaneConn } from "./client.js";
import { findPlaneVersion, unknownPlaneVersion } from "./versions.js";

type Rule = { planeAccountId: string; workspaceSlug: string; channelId: string; projectIds: string[] };

/**
 * One Plane workspace of an account, usable here. `name` is what the model passes as `account`: the account's name when this is
 * its only workspace here, else `account/workspace`. A Plane project is allowed only when every set allows it (the guild's, then
 * the channel's).
 */
export interface PlaneAccess { account: PlaneAccount; workspace: string; name: string; sets: string[][] }

export const PLANE_NOT_ENABLED = "Plane is not enabled here. An admin can enable a Plane account for this server, and its Plane projects, in the console.";

/**
 * Guild rules switch a Plane workspace on and a channel rule narrows them; a thread uses its parent channel's rule, never its
 * own. Only workspaces the account has switched on count, but a channel's rules for switched-off ones still make it a channel
 * with rules of its own, so switching a workspace off never opens the guild's others there.
 */
export function computePlaneAccess(attached: PlaneAccount[], rules: Rule[], channelId?: string, parentChannelId?: string): PlaneAccess[] {
  const place = parentChannelId || channelId;
  const channelRules = place ? rules.filter((r) => r.channelId === place) : [];
  const out: PlaneAccess[] = [];
  for (const account of attached) {
    for (const { slug } of account.workspaces.filter((w) => w.enabled)) {
      const same = (r: Rule) => r.planeAccountId === account.id && r.workspaceSlug === slug;
      const guild = rules.find((r) => r.channelId === "" && same(r));
      if (!guild) continue;
      const sets = [guild.projectIds];
      if (channelRules.length) {
        const own = channelRules.find(same);
        if (!own) continue;
        sets.push(own.projectIds);
      }
      out.push({ account, workspace: slug, name: account.name, sets });
    }
  }
  for (const a of out) if (out.some((b) => b !== a && b.account.id === a.account.id)) a.name = fullName(a);
  return out;
}

/** `account/workspace`, which names an entry whatever else is usable. */
const fullName = (a: PlaneAccess) => `${a.account.name}/${a.workspace}`;

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

/**
 * The entry `name` names, in any case: `account/workspace` always, a bare account name when that account has one workspace
 * here; null when none matches. A bare name with several is refused, listing them.
 */
export function findPlaneAccess(list: PlaneAccess[], name: string): PlaneAccess | null {
  const want = name.trim().toLowerCase();
  const full = list.find((a) => fullName(a).toLowerCase() === want);
  if (full) return full;
  const bare = list.filter((a) => a.account.name.toLowerCase() === want);
  if (bare.length > 1) throw new Error(`Plane account "${bare[0]!.account.name}" has several Plane workspaces here; pass "account" with one of: ${bare.map((a) => a.name).join(", ")}`);
  return bare[0] ?? null;
}

/**
 * The full name of the entry a call picks: the one `name` names, or the only one usable when none is named; null when it picks
 * none yet. A write keeps it in its arguments while it waits for Confirm, so it runs in the Plane workspace it was asked for, or
 * is refused, even if other workspaces were switched on or off meanwhile.
 */
export function pinnedPlaneAccess(list: PlaneAccess[], name?: unknown): string | null {
  const given = typeof name === "string" ? name.trim() : "";
  const hit = given ? findPlaneAccess(list, given) : list.length === 1 ? list[0]! : null;
  return hit ? fullName(hit) : null;
}

/** `name` may be omitted only when exactly one Plane workspace is usable. */
export function pickPlaneAccess(list: PlaneAccess[], name?: unknown): PlaneAccess {
  if (!list.length) throw new Error(PLANE_NOT_ENABLED);
  const names = list.map((a) => a.name).join(", ");
  if (typeof name !== "string" || !name.trim()) {
    if (list.length === 1) return list[0]!;
    throw new Error(`Several Plane accounts are available; pass "account" with one of: ${names}`);
  }
  const hit = findPlaneAccess(list, name);
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

/**
 * The connection of an account to one of its Plane workspaces, with its key decrypted; Allowed hosts is checked again, since it
 * may have changed. An account whose Plane version this server does not know is refused here, so it fails alone.
 */
export function planeConnOf(account: PlaneAccount, workspaceSlug: string): PlaneConn {
  assertPlaneUrl(account.baseUrl);
  const version = findPlaneVersion(account.planeVersion);
  if (!version) throw new Error(unknownPlaneVersion(account));
  return { baseUrl: account.baseUrl, workspaceSlug, apiKey: decryptSecret(account.apiKeyEncrypted), version };
}
