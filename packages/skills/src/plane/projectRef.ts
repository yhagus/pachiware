/**
 * Finds the Plane project a tool names, by id or identifier, inside the Plane scope of the place it runs in.
 * A Plane project outside the scope is refused before Plane is asked anything about it.
 */
import type { SkillContext, ToolPropertySchema } from "../types.js";
import { planeList, planeRequest, inWorkspace, PlaneError, type PlaneConn } from "./client.js";
import { loadPlaneAccess, pickPlaneAccess, planeProjectAllowed, planeConnOf, type PlaneAccess } from "./scope.js";

/** The Plane project as Plane answers `projects/{id}/`; `cycle_view`, `module_view` and `intake_view` say which features are on. */
export type PlaneProjectDetail = { id: string; name: string; identifier: string; cycle_view?: boolean; module_view?: boolean; intake_view?: boolean; [k: string]: unknown };
export type PlaneProjectTarget = { access: PlaneAccess; conn: PlaneConn; project: PlaneProjectDetail };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `account` and `project` arguments every tool on one Plane project takes. */
export const PROJECT_ARGS: Record<string, ToolPropertySchema> = {
  account: { type: "string", description: "Plane account name; needed only when several are usable here (see planeAccounts)." },
  project: { type: "string", description: "The Plane project: its id, or its identifier such as ENG." },
};

/** Short project fields to echo back, so the model can name the project it read. */
export const projectHead = (p: PlaneProjectDetail) => ({ id: p.id, identifier: p.identifier, name: p.name });

export async function resolvePlaneProject(ctx: SkillContext, args: { account?: unknown; project?: unknown }): Promise<PlaneProjectTarget> {
  const access = pickPlaneAccess(await loadPlaneAccess(ctx), args.account);
  const ref = typeof args.project === "string" ? args.project.trim() : "";
  if (!ref) throw new Error('Pass "project" with a Plane project id or identifier (see planeAccounts).');
  const refused = () => new Error(`The Plane project "${ref}" is not open in this channel.`);
  const conn = planeConnOf(access.account);
  let id = ref;
  if (!UUID.test(ref)) {
    const { items } = await planeList<any>(conn, inWorkspace(conn, "projects/"), { maxPages: 10 });
    const hit = items.find((p) => String(p.identifier ?? "").toLowerCase() === ref.toLowerCase());
    if (!hit) throw refused();
    id = String(hit.id);
  }
  if (!planeProjectAllowed(access, id)) throw refused();
  let project: PlaneProjectDetail;
  try { project = await planeRequest<PlaneProjectDetail>(conn, inWorkspace(conn, `projects/${id}/`)); }
  catch (e) { if (e instanceof PlaneError && e.status === 404) throw refused(); throw e; }
  return { access, conn, project };
}
