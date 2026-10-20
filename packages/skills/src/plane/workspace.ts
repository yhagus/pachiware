/**
 * Plane workspace tools, and which Plane tools a place offers. A tool exists only on the Plane versions its policy lists (all,
 * when it lists none). A tool whose policy sets `workspaceLevel` reaches the whole Plane workspace, so it is offered only where
 * the Plane scope is "all Plane projects", and its handler chooses an account with `pickWorkspaceAccess`.
 */
import type { Effect, SkillContext, ToolDefinition, ToolHandler, ToolPolicy } from "../types.js";
import { planeRequest, inWorkspace } from "./client.js";
import { PLANE_NOT_ENABLED, loadPlaneAccess, pickPlaneAccess, findPlaneAccess, allPlaneProjectsAllowed, type PlaneAccess } from "./scope.js";
import { planeTargetOf, ACCOUNT_ARG, type PlaneTarget } from "./projectRef.js";
import { planeWrite, inPlainWords, DANGER, DANGER_NOTE } from "./write.js";
import { PLANE_VERSIONS, findPlaneVersion, versionHasTool, onPlaneVersion, CHOOSE_PLANE_VERSION, type PlaneVersion } from "./versions.js";
import { text } from "./args.js";

const READ: Effect = "read";

/**
 * A Plane tool's policy. `versions` lists the Plane versions that have the tool (absent: every version); `workspaceLevel` hides
 * the tool unless a usable account has every Plane project open here.
 */
export type PlaneToolPolicy = ToolPolicy & { workspaceLevel?: true; versions?: string[] };
type Policies = Record<string, PlaneToolPolicy>;
type Versions = readonly PlaneVersion[];

const hasTool = (access: PlaneAccess, tool: string, policy: Policies, versions: Versions) =>
  versionHasTool(findPlaneVersion(access.account.planeVersion, versions), policy[tool]);

/** True when this account can run the tool here: its Plane version has it, and a workspace-level tool has every Plane project open. */
export const offersTool = (access: PlaneAccess, tool: string, policy: Policies, versions: Versions = PLANE_VERSIONS) =>
  hasTool(access, tool, policy, versions) && (!policy[tool]?.workspaceLevel || allPlaneProjectsAllowed(access));

/**
 * The Plane tools of `policy` to hide where these accounts are usable: all but planeAccounts when there are none, since each could
 * only refuse; else every tool no usable account offers.
 */
export function hiddenPlaneToolsFor(list: PlaneAccess[], policy: Policies, versions: Versions = PLANE_VERSIONS): string[] {
  return Object.keys(policy).filter((name) => name !== "planeAccounts" && !list.some((a) => offersTool(a, name, policy, versions)));
}

export const hiddenPlaneTools = async (ctx: SkillContext, policy: Policies) => hiddenPlaneToolsFor(await loadPlaneAccess(ctx), policy);

const WHOLE_WORKSPACE = "This needs the whole Plane workspace, and this channel is limited to specific Plane projects.";

const known = (access: PlaneAccess, versions: Versions) => !!findPlaneVersion(access.account.planeVersion, versions);

/** Why a hidden Plane tool is refused: Plane is not enabled here, no usable account's Plane version has it, or it needs every Plane project open. */
export function hiddenPlaneReasonFor(list: PlaneAccess[], tool: string, policy: Policies, versions: Versions = PLANE_VERSIONS): string {
  if (!list.length) return PLANE_NOT_ENABLED;
  if (list.some((a) => hasTool(a, tool, policy, versions))) return WHOLE_WORKSPACE;
  // A Plane version belongs to the account, so each account is named once however many of its workspaces are usable.
  const each = [...new Map(list.map((a) => [a.account.id, a.account])).values()].map((account) => `"${account.name}" ${onPlaneVersion(account, versions)}`).join("; ");
  return `No Plane account usable here has ${tool} on its Plane version: ${each}.${list.every((a) => known(a, versions)) ? "" : ` ${CHOOSE_PLANE_VERSION}`}`;
}

export const hiddenPlaneReason = async (ctx: SkillContext, tool: string, policy: Policies) => hiddenPlaneReasonFor(await loadPlaneAccess(ctx), tool, policy);

/**
 * The `account` a call to `tool` should run with, before its handler picks one. A named account whose Plane version lacks the tool
 * is refused, naming the accounts that have it; with none named, several usable and only one offering the tool, that one is used.
 * Null leaves the arguments as they are.
 */
export function accountForTool(list: PlaneAccess[], tool: string, named: unknown, policy: Policies, versions: Versions = PLANE_VERSIONS): string | null {
  const name = typeof named === "string" ? named.trim() : "";
  if (!name) {
    const able = list.filter((a) => offersTool(a, tool, policy, versions));
    return list.length > 1 && able.length === 1 ? able[0]!.name : null;
  }
  const hit = findPlaneAccess(list, name);
  if (!hit || hasTool(hit, tool, policy, versions)) return null;
  const others = list.filter((a) => hasTool(a, tool, policy, versions)).map((a) => a.name);
  const next = others.length ? ` Use one of: ${others.join(", ")}.` : known(hit, versions) ? "" : ` ${CHOOSE_PLANE_VERSION}`;
  throw new Error(`${tool} is not available on Plane account "${hit.name}": it ${onPlaneVersion(hit.account, versions)}.${next}`);
}

/** Wraps each Plane tool's handler so `accountForTool` runs first, on the model's call and again on the confirmed run. */
export function checkedByVersion(handlers: Record<string, ToolHandler>, policy: Policies): Record<string, ToolHandler> {
  return Object.fromEntries(Object.entries(handlers).map(([tool, handler]) => [tool, tool === "planeAccounts" ? handler : async (args, ctx) => {
    const account = accountForTool(await loadPlaneAccess(ctx), tool, args?.account, policy);
    return handler(account ? { ...args, account } : args, ctx);
  }]));
}

/** The account a workspace-level tool uses: only accounts with every Plane project open here count. */
export async function pickWorkspaceAccess(ctx: SkillContext, name?: unknown): Promise<PlaneAccess> {
  const list = await loadPlaneAccess(ctx);
  const whole = list.filter(allPlaneProjectsAllowed);
  if (list.length && !whole.length) throw new Error(WHOLE_WORKSPACE);
  return pickPlaneAccess(whole, name);
}

/** Plane's role numbers by display name, the same in a Plane project and the Plane workspace. */
const ROLES: Record<string, number> = { Admin: 20, Member: 15, Guest: 5 };
export const MEMBER_ROLES = Object.keys(ROLES).map((r) => r.toLowerCase());

/** A role argument as its display name and Plane's number; Member when left out. */
export function memberRole(v: unknown): [string, number] {
  const r = text(v)?.toLowerCase() ?? "member";
  const name = Object.keys(ROLES).find((x) => x.toLowerCase() === r);
  if (!name) throw new Error(`role must be one of ${MEMBER_ROLES.join(", ")}`);
  return [name, ROLES[name]!];
}

const roleName = (r: unknown) => Object.keys(ROLES).find((x) => ROLES[x] === Number(r)) ?? String(r);
const WORKSPACE_ADMIN = "an Admin of the Plane workspace";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const workspaceTools: ToolDefinition[] = [
  { name: "workspaceMembers", description: "Lists the members of the Plane workspace with their Plane workspace role (Admin, Member or Guest).",
    parameters: { type: "object", properties: { account: ACCOUNT_ARG } } },
  { name: "workspaceInvitations", description: "Lists the invitations to the Plane workspace: email, role, and whether each was accepted. Plane allows this only when the bot's Plane user is an Admin of the Plane workspace.",
    parameters: { type: "object", properties: { account: ACCOUNT_ARG } } },
  { name: "workspaceInvite", description: `Invites an email address to the Plane workspace as Admin, Member or Guest. Plane records the invitation but sends no email: the person joins by signing up or logging in to Plane with that address. Plane allows it only when the bot's Plane user is an Admin of the Plane workspace.${DANGER_NOTE}`,
    parameters: { type: "object", properties: {
      email: { type: "string", description: "The email address to invite." },
      role: { type: "string", enum: MEMBER_ROLES, description: "Default member." },
      account: ACCOUNT_ARG,
    }, required: ["email"] } },
  { name: "workspaceCancelInvite", description: `Cancels an invitation to the Plane workspace that nobody has answered yet, named by its email address or id (see workspaceInvitations).${DANGER_NOTE}`,
    parameters: { type: "object", properties: {
      invitation: { type: "string", description: "The invited email address, or the invitation's id." },
      account: ACCOUNT_ARG,
    }, required: ["invitation"] } },
];

export const workspaceToolPolicy: Record<string, PlaneToolPolicy> = {
  workspaceMembers: { effect: READ, group: "Plane workspace", workspaceLevel: true },
  workspaceInvitations: { effect: READ, group: "Plane workspace", workspaceLevel: true },
  workspaceInvite: { effect: "danger", group: "Plane workspace", workspaceLevel: true },
  workspaceCancelInvite: { effect: "danger", group: "Plane workspace", workspaceLevel: true },
};

/** The Plane workspace's invitations; Plane shows them only to a workspace Admin, which the refusal names. */
const invitationsOf = (t: PlaneTarget) => inPlainWords(t, planeRequest<any[]>(t.conn, inWorkspace(t.conn, "invitations/")), [], WORKSPACE_ADMIN).then((l) => l ?? []);

export const workspaceHandlers: Record<string, ToolHandler> = {
  workspaceMembers: async (args, ctx) => {
    const { conn } = planeTargetOf(await pickWorkspaceAccess(ctx, args.account));
    // Plane answers with a plain array, removed members included: v1.3.1 has no active flag on it.
    const members = await planeRequest<any[]>(conn, inWorkspace(conn, "members/"));
    return {
      members: (members ?? []).map((m) => ({ id: m.id, displayName: m.display_name ?? "", name: [m.first_name, m.last_name].filter(Boolean).join(" "), role: roleName(m.role) })),
    };
  },
  workspaceInvitations: async (args, ctx) => {
    const { conn } = planeTargetOf(await pickWorkspaceAccess(ctx, args.account));
    const invitations = await planeRequest<any[]>(conn, inWorkspace(conn, "invitations/"));
    return {
      invitations: (invitations ?? []).map((i) => ({ id: i.id, email: i.email, role: roleName(i.role), invitedAt: i.created_at ?? null, accepted: !!i.accepted, respondedAt: i.responded_at ?? null })),
    };
  },
  workspaceInvite: planeWrite("workspaceInvite", async (a, ctx) => {
    const t = planeTargetOf(await pickWorkspaceAccess(ctx, a.account));
    const email = text(a.email)?.toLowerCase() ?? "";
    if (!EMAIL.test(email)) throw new Error(`Pass "email" with the email address to invite, such as sari@example.com.`);
    const [name, role] = memberRole(a.role);
    if ((await invitationsOf(t)).some((i) => String(i.email).toLowerCase() === email)) throw new Error(`${email} is already invited to the Plane workspace.`);
    return {
      target: t, role: WORKSPACE_ADMIN,
      refusals: [[/Email already invited/, `${email} is already invited to the Plane workspace.`]],
      summary: `Invite ${email} to the Plane workspace as a ${name}`,
      run: async () => {
        const i = await planeRequest<any>(t.conn, inWorkspace(t.conn, "invitations/"), { method: "POST", body: { email, role } });
        return { invitation: { id: i?.id ?? null, email, role: name }, note: "Plane sends no invitation email. Tell the person to sign up or log in to Plane with this address." };
      },
    };
  }, DANGER),
  workspaceCancelInvite: planeWrite("workspaceCancelInvite", async (a, ctx) => {
    const t = planeTargetOf(await pickWorkspaceAccess(ctx, a.account));
    const ref = text(a.invitation)?.toLowerCase();
    if (!ref) throw new Error(`Pass "invitation" with the invited email address or the invitation's id.`);
    const i = (await invitationsOf(t)).find((x) => String(x.id).toLowerCase() === ref || String(x.email).toLowerCase() === ref);
    if (!i) throw new Error(`No invitation to the Plane workspace matches ${ref}; see workspaceInvitations.`);
    if (i.accepted) throw new Error(`${i.email} already accepted the invitation, so there is nothing to cancel.`);
    if (i.responded_at) throw new Error(`${i.email} already answered the invitation, so Plane does not cancel it.`);
    return {
      target: t, role: WORKSPACE_ADMIN,
      summary: `Cancel the invitation of ${i.email} (${roleName(i.role)}) to the Plane workspace`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `invitations/${i.id}/`), { method: "DELETE" });
        return { invitation: { id: i.id, email: i.email }, cancelled: true };
      },
    };
  }, DANGER),
};
