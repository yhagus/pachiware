/**
 * Read tools for finding one's way around a Plane workspace (group "Browse"): the Plane projects open here, one Plane
 * project's settings, and its states, labels and members, which write tools need by name.
 */
import type { ToolDefinition, ToolHandler, ToolPolicy } from "../types.js";
import { planeRequest, inWorkspace, type Obj } from "./client.js";
import { planeTarget, findPlaneProject, PROJECT_ARGS } from "./projectRef.js";
import { projectStates, projectLabels, projectMembers, planeUserName } from "./resolve.js";


export const browseTools: ToolDefinition[] = [
  { name: "planeProjects", description: "Lists the Plane projects open in this channel: id, identifier (the prefix of work item keys, such as ENG) and name, and whether cycles, modules and intake are switched on.",
    parameters: { type: "object", properties: { account: PROJECT_ARGS.account! } } },
  { name: "planeProject", description: "Reads one Plane project: description, visibility, timezone, lead, features switched on, and how many members, cycles and modules it has.",
    parameters: { type: "object", properties: { ...PROJECT_ARGS }, required: ["project"] } },
  { name: "planeStates", description: "Lists a Plane project's states in board order, with their group (backlog, unstarted, started, completed, cancelled) and which is the default.",
    parameters: { type: "object", properties: { ...PROJECT_ARGS }, required: ["project"] } },
  { name: "planeLabels", description: "Lists a Plane project's labels, with the parent label of nested ones.",
    parameters: { type: "object", properties: { ...PROJECT_ARGS }, required: ["project"] } },
  { name: "planeMembers", description: "Lists a Plane project's members by name. Plane also lists members who were removed from the Plane project.",
    parameters: { type: "object", properties: { ...PROJECT_ARGS }, required: ["project"] } },
];

export const browseToolPolicy: Record<string, ToolPolicy> = Object.fromEntries(browseTools.map((t) => [t.name, { effect: "read", group: "Browse" }]));

const features = (p: Obj) => ({ cycles: !!p.cycle_view, modules: !!p.module_view, intake: !!p.intake_view });

export const browseHandlers: Record<string, ToolHandler> = {
  planeProjects: async (args, ctx) => {
    const t = await planeTarget(ctx, args);
    return { projects: (await t.openProjects()).map((p) => ({ id: p.id, identifier: p.identifier, name: p.name, features: features(p) })) };
  },
  planeProject: async (args, ctx) => {
    const t = await planeTarget(ctx, args);
    const ref = await findPlaneProject(t, args.project);
    const p = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, `projects/${ref.id}/`), { query: { expand: "project_lead" } });
    return {
      id: p.id, identifier: p.identifier, name: p.name, description: p.description || null,
      visibility: p.network === 0 ? "secret" : "public", timezone: p.timezone ?? null,
      lead: p.project_lead && typeof p.project_lead === "object" ? planeUserName(p.project_lead) : null,
      features: features(p), members: p.total_members ?? null, cycles: p.total_cycles ?? null, modules: p.total_modules ?? null,
      archived: !!p.archived_at, botIsMember: p.is_member !== false,
    };
  },
  planeStates: async (args, ctx) => {
    const t = await planeTarget(ctx, args);
    const states = await projectStates(t, await findPlaneProject(t, args.project));
    return { states: [...states].sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0)).map((st) => ({ id: st.id, name: st.name, group: st.group, default: !!st.default })) };
  },
  planeLabels: async (args, ctx) => {
    const t = await planeTarget(ctx, args);
    const labels = await projectLabels(t, await findPlaneProject(t, args.project));
    const byId = new Map(labels.map((l) => [String(l.id), l]));
    return { labels: labels.map((l) => ({ id: l.id, name: l.name, ...(l.parent ? { parent: byId.get(String(l.parent))?.name ?? null } : {}) })) };
  },
  planeMembers: async (args, ctx) => {
    const t = await planeTarget(ctx, args);
    const members = await projectMembers(t, await findPlaneProject(t, args.project));
    return { members: members.map((m) => ({ id: m.id, name: planeUserName(m) })) };
  },
};
