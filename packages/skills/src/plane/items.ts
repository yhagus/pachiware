/** Work items listed inside a cycle or a module, in the short shape the model reads: key, title, state, assignees, priority. */
import { planeList, inWorkspace } from "./client.js";
import type { PlaneProjectTarget } from "./projectRef.js";

const MAX_PAGES = 5, PER_PAGE = 200;

export async function listWorkItemsIn(t: PlaneProjectTarget, path: string): Promise<{ workItems: unknown[]; more?: true }> {
  const { conn, project } = t;
  const { items, more } = await planeList<any>(conn, inWorkspace(conn, `projects/${project.id}/${path}`), {
    query: { expand: "state,assignees", fields: "id,name,sequence_id,state,assignees,priority" }, perPage: PER_PAGE, maxPages: MAX_PAGES,
  });
  const workItems = items.map((w) => ({
    key: `${project.identifier}-${w.sequence_id}`, id: w.id, title: w.name,
    state: typeof w.state === "object" && w.state ? w.state.name : null,
    stateGroup: typeof w.state === "object" && w.state ? w.state.group : null,
    assignees: (Array.isArray(w.assignees) ? w.assignees : []).map((u: any) => typeof u === "object" && u ? u.display_name || [u.first_name, u.last_name].filter(Boolean).join(" ") : String(u)),
    priority: w.priority ?? null,
  }));
  return more ? { workItems, more: true } : { workItems };
}
