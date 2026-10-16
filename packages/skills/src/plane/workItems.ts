/**
 * Read tools for work items (group "Work items"): get, search, list, and a work item's comments, activity, links,
 * relations and attachments. Every tool resolves its Plane project inside the Plane scope first (`resolve.ts`).
 */
import type { ToolDefinition, ToolHandler, ToolPolicy } from "../types.js";
import { planeList } from "./client.js";
import { planeMarkdown } from "./markdown.js";
import { planeTarget, resolveWorkItem, workItemPath, projectRef, planeUserName, type PlaneTarget, type ResolvedWorkItem } from "./resolve.js";

type Obj = Record<string, any>;

const ACCOUNT = { type: "string", description: "Plane account name; needed only when several are available (see planeAccounts)." };
const ITEM = { type: "string", description: "Work item key such as ENG-42, or its id (then pass project too)." };
const PROJECT_OF_ID = { type: "string", description: "Plane project id, identifier or name; needed only when item is an id." };

const ITEM_FIELDS = "id,name,description_html,priority,state,assignees,labels,start_date,target_date,completed_at,parent,sequence_id,project,created_by,created_at,updated_at";

export const workItemTools: ToolDefinition[] = [
  { name: "workItemGet", description: "Reads one work item: description (Markdown), state, priority, assignees, labels, dates, parent, cycle and modules. Takes its key such as ENG-42.",
    parameters: { type: "object", properties: { item: ITEM, project: PROJECT_OF_ID, account: ACCOUNT }, required: ["item"] } },
];

export const workItemToolPolicy: Record<string, ToolPolicy> = {
  workItemGet: { effect: "read", group: "Work items" },
};

/** The current cycle and modules of a work item, replayed from its activity, since Plane's work item carries neither. */
function cycleAndModules(activities: Obj[]): { cycle: string | null; modules: string[] } {
  let cycle: string | null = null;
  const modules = new Map<string, string>();
  for (const a of activities) {
    if (a.field === "cycles") cycle = a.verb === "deleted" ? null : (a.new_value ?? null);
    if (a.field === "modules") {
      if (a.verb === "deleted") modules.delete(String(a.old_identifier ?? a.old_value));
      else if (a.new_value) modules.set(String(a.new_identifier ?? a.new_value), String(a.new_value));
    }
  }
  return { cycle, modules: [...modules.values()] };
}

async function activitiesOf(t: PlaneTarget, w: ResolvedWorkItem, expandActor = false) {
  return planeList<Obj>(t.conn, workItemPath(t, w, "activities/"), { perPage: 1000, maxPages: 2, query: expandActor ? { expand: "actor" } : {} });
}

export const workItemHandlers: Record<string, ToolHandler> = {
  workItemGet: async (args, ctx) => {
    const t = await planeTarget(ctx, args);
    const w = await resolveWorkItem(t, args.item, args.project, { fields: ITEM_FIELDS, expand: "state,assignees,labels,parent,created_by" });
    const { item } = w;
    const projects = await t.projects();
    const parentProject = item.parent ? projects.find((p) => String(p.id) === String(item.parent.project_id)) : null;
    const names = new Map<string, string>([...(item.assignees ?? []), item.created_by].filter((u: Obj | null) => u?.id).map((u: Obj) => [String(u.id), planeUserName(u)]));
    const { cycle, modules } = cycleAndModules((await activitiesOf(t, w)).items);
    return {
      key: w.key, id: item.id, name: item.name, project: projectRef(w.project),
      state: item.state ? { name: item.state.name, group: item.state.group } : null,
      priority: item.priority,
      assignees: (item.assignees ?? []).map(planeUserName),
      labels: (item.labels ?? []).map((l: Obj) => l.name),
      startDate: item.start_date ?? null, targetDate: item.target_date ?? null, completedAt: item.completed_at ?? null,
      parent: item.parent ? { key: parentProject ? `${parentProject.identifier}-${item.parent.sequence_id}` : null, id: item.parent.id } : null,
      cycle, modules,
      createdBy: item.created_by ? planeUserName(item.created_by) : null, createdAt: item.created_at, updatedAt: item.updated_at,
      description: planeMarkdown(item.description_html, names),
    };
  },
};
