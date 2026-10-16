/**
 * Read tools for work items (group "Work items"): get, search, list, and a work item's comments, activity, links,
 * relations and attachments. Every tool resolves its Plane project inside the Plane scope first (`resolve.ts`).
 */
import type { ToolDefinition, ToolHandler, ToolPolicy } from "../types.js";
import { planeList, planeRequest, inWorkspace } from "./client.js";
import { planeProjectAllowed } from "./scope.js";
import { planeMarkdown } from "./markdown.js";
import { planeTarget, resolvePlaneProject, resolveWorkItem, workItemPath, projectRef, planeUserName, type PlaneTarget, type ResolvedWorkItem } from "./resolve.js";

type Obj = Record<string, any>;

const ACCOUNT = { type: "string", description: "Plane account name; needed only when several are available (see planeAccounts)." };
const ITEM = { type: "string", description: "Work item key such as ENG-42, or its id (then pass project too)." };
const PROJECT_OF_ID = { type: "string", description: "Plane project id, identifier or name; needed only when item is an id." };

const ITEM_FIELDS = "id,name,description_html,priority,state,assignees,labels,start_date,target_date,completed_at,parent,sequence_id,project,created_by,created_at,updated_at";

export const workItemTools: ToolDefinition[] = [
  { name: "workItemGet", description: "Reads one work item: description (Markdown), state, priority, assignees, labels, dates, parent, cycle and modules. Takes its key such as ENG-42.",
    parameters: { type: "object", properties: { item: ITEM, project: PROJECT_OF_ID, account: ACCOUNT }, required: ["item"] } },
  { name: "workItemSearch", description: "Finds work items by words in the title, or by key such as ENG-42, across the Plane projects open here (or in one). Plane's search covers title and key only; use workItemList to filter by state, assignee, label or priority.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Words from the title, or a key such as ENG-42." },
      project: { type: "string", description: "Plane project id, identifier or name, to search only there." },
      limit: { type: "number", description: "At most this many results (default 20, max 50)." },
      account: ACCOUNT,
    }, required: ["query"] } },
];

export const workItemToolPolicy: Record<string, ToolPolicy> = {
  workItemGet: { effect: "read", group: "Work items" },
  workItemSearch: { effect: "read", group: "Work items" },
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

/** Plane's search returns at most `limit` hits across the whole Plane workspace, so it is asked for more than are shown and then cut to the scope. */
const SEARCH_FETCH = 100;

export const workItemHandlers: Record<string, ToolHandler> = {
  workItemSearch: async (args, ctx) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) throw new Error(`Pass "query": words from the title, or a key such as ENG-42.`);
    const limit = Math.min(Math.max(1, Number(args.limit) || 20), 50);
    const t = await planeTarget(ctx, args);
    const only = args.project ? await resolvePlaneProject(t, args.project) : null;
    const res = await planeRequest<{ issues?: Obj[] }>(t.conn, inWorkspace(t.conn, "work-items/search/"), {
      query: { search: query, limit: SEARCH_FETCH, ...(only ? { workspace_search: "false", project_id: String(only.id) } : { workspace_search: "true" }) },
    });
    const wanted = query.toUpperCase();
    const hits = (res?.issues ?? [])
      .filter((h) => planeProjectAllowed(t.access, String(h.project_id)) && (!only || String(h.project_id) === String(only.id)))
      .map((h) => ({ key: `${h.project__identifier}-${h.sequence_id}`, name: h.name, id: h.id, project: h.project__identifier }))
      .sort((a, b) => Number(b.key === wanted) - Number(a.key === wanted));
    return { items: hits.slice(0, limit), ...(hits.length > limit ? { more: true } : {}) };
  },
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
