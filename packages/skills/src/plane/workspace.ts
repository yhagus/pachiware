/**
 * Workspace-level Plane tools: they reach the whole Plane workspace, so they run only where the Plane scope is "all Plane projects".
 * `WORKSPACE_LEVEL_TOOLS` names every such tool (later ones, such as projectCreate, join it); `hiddenWorkspaceTools` keeps them from
 * the model elsewhere, and `pickWorkspaceAccess` is how their handlers choose an account.
 */
import type { Effect, SkillContext, ToolDefinition, ToolHandler, ToolPolicy } from "../types.js";
import { planeRequest, inWorkspace } from "./client.js";
import { loadPlaneAccess, pickPlaneAccess, allPlaneProjectsAllowed, planeConnOf, type PlaneAccess } from "./scope.js";

const R: Effect = "read";

/** Tools offered only where some usable Plane account has all its Plane projects open. */
export const WORKSPACE_LEVEL_TOOLS = ["workspaceMembers", "workspaceInvitations"];

/** The workspace-level tools to hide here: all of them unless some usable account has every Plane project open. */
export async function hiddenWorkspaceTools(ctx: SkillContext): Promise<string[]> {
  return (await loadPlaneAccess(ctx)).some(allPlaneProjectsAllowed) ? [] : WORKSPACE_LEVEL_TOOLS;
}

/** The account a workspace-level tool uses: only accounts with every Plane project open here count. */
export async function pickWorkspaceAccess(ctx: SkillContext, name?: unknown): Promise<PlaneAccess> {
  const list = await loadPlaneAccess(ctx);
  const whole = list.filter(allPlaneProjectsAllowed);
  if (list.length && !whole.length) throw new Error("This needs the whole Plane workspace, and this channel is limited to specific Plane projects.");
  return pickPlaneAccess(whole, name);
}

const ACCOUNT_ARG = { account: { type: "string", description: "Plane account name; needed only when several are usable here (see planeAccounts)." } };
const ROLE: Record<string, string> = { "20": "Admin", "15": "Member", "5": "Guest" };
const roleName = (r: unknown) => ROLE[String(r)] ?? String(r);

export const workspaceTools: ToolDefinition[] = [
  { name: "workspaceMembers", description: "Lists the members of the Plane workspace with their workspace role (Admin, Member or Guest).",
    parameters: { type: "object", properties: { ...ACCOUNT_ARG } } },
  { name: "workspaceInvitations", description: "Lists the invitations to the Plane workspace: email, role, and whether each was accepted. Plane allows this only when the bot's Plane user is a workspace Admin.",
    parameters: { type: "object", properties: { ...ACCOUNT_ARG } } },
];

export const workspaceToolPolicy: Record<string, ToolPolicy> = {
  workspaceMembers: { effect: R, group: "Workspace" },
  workspaceInvitations: { effect: R, group: "Workspace" },
};

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
};
