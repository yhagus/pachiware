import type { Effect, SkillModule, ToolDefinition, ToolHandler, ToolPolicy } from "../types.js";
import { listPlaneProjects } from "../plane/client.js";
import { loadPlaneAccess, planeConnOf, allowedPlaneProjectIds, PLANE_NOT_ENABLED } from "../plane/scope.js";
import { workItemTools, workItemHandlers, workItemToolPolicy } from "../plane/workItems.js";

/** Tool groups in display order, as Availability rules and the console show them. Every Plane tool joins one; a group shows once it holds a tool. */
export const PLANE_GROUPS = ["Browse", "Work items", "Cycles", "Modules", "Intake", "Project admin", "Workspace"];

const R: Effect = "read";

export const planeTools: ToolDefinition[] = [
  { name: "planeAccounts", description: "Lists the Plane accounts you may use in this channel, the Plane user each acts as, and the Plane projects open here (id, identifier and name). Call it first when unsure which account or Plane project to use.",
    parameters: { type: "object", properties: {} } },
  ...workItemTools,
];

export const planeToolPolicy: Record<string, ToolPolicy> = {
  planeAccounts: { effect: R, group: "Browse" },
  ...workItemToolPolicy,
};

export const planeHandlers: Record<string, ToolHandler> = {
  planeAccounts: async (_a, ctx) => {
    const list = await loadPlaneAccess(ctx);
    if (!list.length) throw new Error(PLANE_NOT_ENABLED);
    return {
      accounts: await Promise.all(list.map(async (access) => {
        const head = { name: access.account.name, planeUser: access.account.planeUserName };
        try {
          const open = allowedPlaneProjectIds(access);
          const projects = (await listPlaneProjects(planeConnOf(access.account))).filter((p) => !open || open.includes(p.id.toLowerCase()));
          return { ...head, projects: projects.map(({ id, identifier, name }) => ({ id, identifier, name })) };
        } catch (e) {
          return { ...head, error: (e as Error).message };
        }
      })),
    };
  },
  ...workItemHandlers,
};

export const planeSkill: SkillModule = {
  id: "plane",
  name: "Plane",
  description: "Read and change work items in the Plane projects enabled for this server and channel.",
  tools: planeTools,
  handlers: planeHandlers,
  capabilities: ["plane"],
  toolPolicy: planeToolPolicy,
  groups: PLANE_GROUPS.filter((g) => Object.values(planeToolPolicy).some((p) => p.group === g)),
};
