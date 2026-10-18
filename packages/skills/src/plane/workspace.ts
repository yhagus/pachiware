/**
 * Plane workspace tools. A tool whose policy sets `workspaceLevel` reaches the whole Plane workspace, so it is offered only
 * where the Plane scope is "all Plane projects", and its handler chooses an account with `pickWorkspaceAccess`.
 */
import type { Effect, SkillContext, ToolDefinition, ToolHandler, ToolPolicy } from "../types.js";
import { planeRequest, inWorkspace } from "./client.js";
import { PLANE_NOT_ENABLED, loadPlaneAccess, pickPlaneAccess, allPlaneProjectsAllowed, planeConnOf, type PlaneAccess } from "./scope.js";
import { planeTargetOf, ACCOUNT_ARG, type PlaneTarget } from "./projectRef.js";
import { planeWrite, inPlainWords, DANGER, DANGER_NOTE } from "./write.js";
import { text } from "./args.js";

const READ: Effect = "read";

/** A Plane tool's policy; `workspaceLevel` hides the tool unless some usable account has every Plane project open here. */
export type PlaneToolPolicy = ToolPolicy & { workspaceLevel?: true };

/**
 * The Plane tools of `policy` to hide here: all but planeAccounts where no Plane scope opens an account, since each could only refuse;
 * else the workspace-level ones, unless some usable account has every Plane project open.
 */
export async function hiddenWorkspaceTools(ctx: SkillContext, policy: Record<string, PlaneToolPolicy>): Promise<string[]> {
  const access = await loadPlaneAccess(ctx);
  if (!access.length) return Object.keys(policy).filter((name) => name !== "planeAccounts");
  if (access.some(allPlaneProjectsAllowed)) return [];
  return Object.keys(policy).filter((name) => policy[name]!.workspaceLevel);
}

const WHOLE_WORKSPACE = "This needs the whole Plane workspace, and this channel is limited to specific Plane projects.";
/** Why a hidden Plane tool is refused: no Plane scope opens an account here, or the tool needs every Plane project open. */
export const hiddenPlaneReason = async (ctx: SkillContext) => ((await loadPlaneAccess(ctx)).length ? WHOLE_WORKSPACE : PLANE_NOT_ENABLED);

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
    const conn = planeConnOf((await pickWorkspaceAccess(ctx, args.account)).account);
    // Plane answers with a plain array, removed members included: v1.3.1 has no active flag on it.
    const members = await planeRequest<any[]>(conn, inWorkspace(conn, "members/"));
    return {
      members: (members ?? []).map((m) => ({ id: m.id, displayName: m.display_name ?? "", name: [m.first_name, m.last_name].filter(Boolean).join(" "), role: roleName(m.role) })),
    };
  },
  workspaceInvitations: async (args, ctx) => {
    const conn = planeConnOf((await pickWorkspaceAccess(ctx, args.account)).account);
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
