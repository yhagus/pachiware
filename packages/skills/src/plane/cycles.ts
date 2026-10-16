/** Read tools for the cycles of a Plane project: cycleList, cycleGet, cycleItems. */
import type { Effect, ToolDefinition, ToolHandler, ToolPolicy } from "../types.js";
import { planeList, planeRequest, inWorkspace } from "./client.js";
import { resolvePlaneProject, projectHead, PROJECT_ARGS, UUID, type PlaneProjectTarget } from "./projectRef.js";
import { listWorkItemsIn } from "./items.js";

const R: Effect = "read";
export const CYCLE_VIEWS = ["all", "current", "upcoming", "completed", "draft", "incomplete"];
const CYCLE_ARG = { cycle: { type: "string", description: "The cycle: its id, or its name." } };

export const cycleTools: ToolDefinition[] = [
  { name: "cycleList", description: "Lists the cycles (sprints) of a Plane project open here, with dates and work-item counts per state group. view: current (running now), upcoming, completed, draft (no dates), incomplete (not finished), or all (default).",
    parameters: { type: "object", properties: { ...PROJECT_ARGS, view: { type: "string", enum: CYCLE_VIEWS } }, required: ["project"] } },
  { name: "cycleGet", description: "One cycle of a Plane project open here: dates, description and work-item counts per state group.",
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...CYCLE_ARG }, required: ["project", "cycle"] } },
  { name: "cycleItems", description: "The work items in one cycle of a Plane project open here, with key, title, state, assignees and priority.",
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...CYCLE_ARG }, required: ["project", "cycle"] } },
];

export const cycleToolPolicy: Record<string, ToolPolicy> = {
  cycleList: { effect: R, group: "Cycles" },
  cycleGet: { effect: R, group: "Cycles" },
  cycleItems: { effect: R, group: "Cycles" },
};

const cycleView = (c: any) => ({
  id: c.id, name: c.name, description: c.description ?? "", startDate: c.start_date ?? null, endDate: c.end_date ?? null,
  workItems: { total: c.total_issues, backlog: c.backlog_issues, unstarted: c.unstarted_issues, started: c.started_issues, completed: c.completed_issues, cancelled: c.cancelled_issues },
});

const cyclesOff = (t: PlaneProjectTarget) => t.project.cycle_view === false ? { note: `Cycles are switched off in the Plane project ${t.project.identifier}.` } : {};

/** A cycle named by id, or by its name among the project's cycles; the full cycle as Plane answers it. */
async function findCycle(t: PlaneProjectTarget, ref: unknown): Promise<any> {
  const name = typeof ref === "string" ? ref.trim() : "";
  if (!name) throw new Error('Pass "cycle" with a cycle id or name (see cycleList).');
  const { conn, project } = t;
  if (UUID.test(name)) return planeRequest(conn, inWorkspace(conn, `projects/${project.id}/cycles/${name}/`));
  const { items } = await planeList<any>(conn, inWorkspace(conn, `projects/${project.id}/cycles/`), { query: { cycle_view: "all" } });
  const hits = items.filter((c) => String(c.name ?? "").toLowerCase() === name.toLowerCase());
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`No cycle named "${name}" in ${project.identifier}; see cycleList.`);
  throw new Error(`Several cycles in ${project.identifier} are named "${name}"; pass the id of one: ${hits.map((c) => c.id).join(", ")}`);
}

export const cycleHandlers: Record<string, ToolHandler> = {
  cycleList: async (args, ctx) => {
    const t = await resolvePlaneProject(ctx, args);
    const view = CYCLE_VIEWS.includes(args.view) ? args.view : "all";
    // Plane answers "current" with a plain array and the other views with its paginated envelope; planeList reads both.
    const { items, more } = await planeList<any>(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/cycles/`), { query: { cycle_view: view } });
    return { project: projectHead(t.project), view, cycles: items.map(cycleView), ...(more ? { more: true } : {}), ...cyclesOff(t) };
  },
  cycleGet: async (args, ctx) => {
    const t = await resolvePlaneProject(ctx, args);
    return { project: projectHead(t.project), cycle: cycleView(await findCycle(t, args.cycle)) };
  },
  cycleItems: async (args, ctx) => {
    const t = await resolvePlaneProject(ctx, args);
    const c = await findCycle(t, args.cycle);
    return { project: projectHead(t.project), cycle: { id: c.id, name: c.name }, ...(await listWorkItemsIn(t, `cycles/${c.id}/cycle-issues/`)) };
  },
};
