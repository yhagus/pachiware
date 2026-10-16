/** Read tools for the modules of a Plane project: moduleList, moduleGet, moduleItems. */
import type { Effect, ToolDefinition, ToolHandler, ToolPolicy } from "../types.js";
import { planeList, planeRequest, inWorkspace } from "./client.js";
import { resolvePlaneProject, projectHead, PROJECT_ARGS, UUID, type PlaneProjectTarget } from "./projectRef.js";
import { listWorkItemsIn } from "./items.js";

const R: Effect = "read";
const MODULE_ARG = { module: { type: "string", description: "The module: its id, or its name." } };

export const moduleTools: ToolDefinition[] = [
  { name: "moduleList", description: "Lists the modules of a Plane project open here, with status, dates and work-item counts per state group.",
    parameters: { type: "object", properties: { ...PROJECT_ARGS }, required: ["project"] } },
  { name: "moduleGet", description: "One module of a Plane project open here: status, dates, description and work-item counts per state group.",
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...MODULE_ARG }, required: ["project", "module"] } },
  { name: "moduleItems", description: "The work items in one module of a Plane project open here, with key, title, state, assignees and priority.",
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...MODULE_ARG }, required: ["project", "module"] } },
];

export const moduleToolPolicy: Record<string, ToolPolicy> = {
  moduleList: { effect: R, group: "Modules" },
  moduleGet: { effect: R, group: "Modules" },
  moduleItems: { effect: R, group: "Modules" },
};

const moduleView = (m: any) => ({
  id: m.id, name: m.name, status: m.status ?? null, description: m.description ?? "", startDate: m.start_date ?? null, targetDate: m.target_date ?? null,
  workItems: { total: m.total_issues, backlog: m.backlog_issues, unstarted: m.unstarted_issues, started: m.started_issues, completed: m.completed_issues, cancelled: m.cancelled_issues },
});

const modulesOff = (t: PlaneProjectTarget) => t.project.module_view === false ? { note: `Modules are switched off in the Plane project ${t.project.identifier}.` } : {};

/** A module named by id, or by its name among the project's modules; the full module as Plane answers it. */
async function findModule(t: PlaneProjectTarget, ref: unknown): Promise<any> {
  const name = typeof ref === "string" ? ref.trim() : "";
  if (!name) throw new Error('Pass "module" with a module id or name (see moduleList).');
  const { conn, project } = t;
  if (UUID.test(name)) return planeRequest(conn, inWorkspace(conn, `projects/${project.id}/modules/${name}/`));
  const { items } = await planeList<any>(conn, inWorkspace(conn, `projects/${project.id}/modules/`));
  const hit = items.find((m) => String(m.name ?? "").toLowerCase() === name.toLowerCase());
  if (!hit) throw new Error(`No module named "${name}" in ${project.identifier}; see moduleList.`);
  return hit;
}

export const moduleHandlers: Record<string, ToolHandler> = {
  moduleList: async (args, ctx) => {
    const t = await resolvePlaneProject(ctx, args);
    const { items, more } = await planeList<any>(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/modules/`));
    return { project: projectHead(t.project), modules: items.map(moduleView), ...(more ? { more: true } : {}), ...modulesOff(t) };
  },
  moduleGet: async (args, ctx) => {
    const t = await resolvePlaneProject(ctx, args);
    return { project: projectHead(t.project), module: moduleView(await findModule(t, args.module)) };
  },
  moduleItems: async (args, ctx) => {
    const t = await resolvePlaneProject(ctx, args);
    const m = await findModule(t, args.module);
    return { project: projectHead(t.project), module: { id: m.id, name: m.name }, ...(await listWorkItemsIn(t, `modules/${m.id}/module-issues/`)) };
  },
};
