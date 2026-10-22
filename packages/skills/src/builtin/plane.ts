import type { Effect, SkillModule, ToolDefinition, ToolHandler } from "../types.js";
import { listPlaneProjects } from "../plane/client.js";
import { loadPlaneAccess, planeConnOf, allowedPlaneProjectIds, PLANE_NOT_ENABLED } from "../plane/scope.js";
import { browseTools, browseHandlers, browseToolPolicy } from "../plane/browse.js";
import { workItemTools, workItemHandlers, workItemToolPolicy } from "../plane/workItems.js";
import { workItemWriteTools, workItemWriteHandlers, workItemWriteToolPolicy } from "../plane/workItemWrites.js";
import { cycleTools, cycleHandlers, cycleToolPolicy } from "../plane/cycles.js";
import { cycleWriteTools, cycleWriteHandlers, cycleWriteToolPolicy } from "../plane/cycleWrites.js";
import { moduleTools, moduleHandlers, moduleToolPolicy } from "../plane/modules.js";
import { moduleWriteTools, moduleWriteHandlers, moduleWriteToolPolicy } from "../plane/moduleWrites.js";
import { intakeTools, intakeHandlers, intakeToolPolicy } from "../plane/intake.js";
import { intakeWriteTools, intakeWriteHandlers, intakeWriteToolPolicy } from "../plane/intakeWrites.js";
import { projectAdminTools, projectAdminHandlers, projectAdminToolPolicy } from "../plane/projectAdmin.js";
import { workspaceTools, workspaceHandlers, workspaceToolPolicy, hiddenPlaneTools, hiddenPlaneReason, checkedByVersion, type PlaneToolPolicy } from "../plane/workspace.js";
import { findPlaneVersion } from "../plane/versions.js";

/** Tool groups in display order, as Availability rules and the console show them. Every Plane tool joins one; a group shows once it holds a tool. */
export const PLANE_GROUPS = ["Browse", "Work items", "Cycles", "Modules", "Intake", "Plane project admin", "Plane workspace"];

const READ: Effect = "read";

export const planeTools: ToolDefinition[] = [
  { name: "planeAccounts", description: "Lists the Plane accounts you may use in this channel, one entry per Plane workspace, with the Plane user and Plane version of each and the Plane projects open here (id, identifier and name). Pass an entry's name as \"account\". Call it first when unsure which account or Plane project to use.",
    parameters: { type: "object", properties: {} } },
  ...browseTools,
  ...workItemTools,
  ...workItemWriteTools,
  ...cycleTools,
  ...cycleWriteTools,
  ...moduleTools,
  ...moduleWriteTools,
  ...intakeTools,
  ...intakeWriteTools,
  ...projectAdminTools,
  ...workspaceTools,
];

/** Plane project and Plane workspace administration: off for the tenant until it is switched on (#251). */
const ADMIN_GROUPS = new Set(["Plane project admin", "Plane workspace"]);
const withAdminOff = (policy: Record<string, PlaneToolPolicy>) =>
  Object.fromEntries(Object.entries(policy).map(([tool, p]) => [tool, ADMIN_GROUPS.has(p.group ?? "") ? { ...p, defaultOff: true as const } : p]));

export const planeToolPolicy: Record<string, PlaneToolPolicy> = withAdminOff({
  planeAccounts: { effect: READ, group: "Browse" },
  ...browseToolPolicy,
  ...workItemToolPolicy,
  ...workItemWriteToolPolicy,
  ...cycleToolPolicy,
  ...cycleWriteToolPolicy,
  ...moduleToolPolicy,
  ...moduleWriteToolPolicy,
  ...intakeToolPolicy,
  ...intakeWriteToolPolicy,
  ...projectAdminToolPolicy,
  ...workspaceToolPolicy,
});

// Each handler first refuses an account whose Plane version lacks the tool (checkedByVersion).
export const planeHandlers: Record<string, ToolHandler> = checkedByVersion({
  planeAccounts: async (_a, ctx) => {
    const list = await loadPlaneAccess(ctx);
    if (!list.length) throw new Error(PLANE_NOT_ENABLED);
    return {
      accounts: await Promise.all(list.map(async (access) => {
        const { planeUserName, planeVersion } = access.account;
        const head = { name: access.name, workspace: access.workspace, planeUser: planeUserName, planeVersion: findPlaneVersion(planeVersion)?.label ?? `unknown ("${planeVersion}")` };
        try {
          const open = allowedPlaneProjectIds(access);
          const projects = (await listPlaneProjects(planeConnOf(access.account, access.workspace))).filter((p) => !open || open.includes(p.id.toLowerCase()));
          return { ...head, projects: projects.map(({ id, identifier, name }) => ({ id, identifier, name })) };
        } catch (e) {
          return { ...head, error: (e as Error).message };
        }
      })),
    };
  },
  ...browseHandlers,
  ...workItemHandlers,
  ...workItemWriteHandlers,
  ...cycleHandlers,
  ...cycleWriteHandlers,
  ...moduleHandlers,
  ...moduleWriteHandlers,
  ...intakeHandlers,
  ...intakeWriteHandlers,
  ...projectAdminHandlers,
  ...workspaceHandlers,
}, planeToolPolicy);

export const planeSkill: SkillModule = {
  id: "plane",
  name: "Plane",
  category: "Plane",
  description: "Read and change work items in the Plane projects enabled for this server and channel.",
  tools: planeTools,
  handlers: planeHandlers,
  capabilities: ["plane"],
  toolPolicy: planeToolPolicy,
  // Every write goes through planeWrite (plane/write.ts), which queues it for the asker's Confirm.
  confirmsInternally: true,
  // Offered only where a Plane scope opens an account whose Plane version has the tool (planeAccounts always), and workspace-level
  // tools only where that account has "all Plane projects".
  hiddenTools: (ctx) => hiddenPlaneTools(ctx, planeToolPolicy),
  hiddenReason: (ctx, tool) => hiddenPlaneReason(ctx, tool, planeToolPolicy),
  groups: PLANE_GROUPS.filter((g) => Object.values(planeToolPolicy).some((p) => p.group === g)),
};
