/**
 * Finds the account and Plane project a tool names inside the Plane scope; one outside it is refused before Plane is asked.
 * Tools spanning Plane projects start from `planeTarget` and call `findPlaneProject` for each.
 */
import { PLANE_ID } from "@pachiware/db";
import type { SkillContext, ToolPropertySchema } from "../types.js";
import { planeList, planeRequest, inWorkspace, PlaneError, type PlaneConn } from "./client.js";
import { loadPlaneAccess, pickPlaneAccess, planeProjectAllowed, planeConnOf, type PlaneAccess } from "./scope.js";

/** A Plane project as Plane lists or answers it; `cycle_view`, `module_view` and `intake_view` say which features are on. */
export type PlaneProjectDetail = { id: string; name: string; identifier: string; cycle_view?: boolean; module_view?: boolean; intake_view?: boolean; [k: string]: any };

/** The account a tool acts through here, its connection, and the Plane workspace's projects, listed at most once per call. */
export interface PlaneTarget {
  access: PlaneAccess;
  conn: PlaneConn;
  /** Every Plane project Plane lists for the account's user, in scope or not, archived ones included. */
  projects(): Promise<PlaneProjectDetail[]>;
  /** The Plane projects this place may use, without archived ones and ones the Plane user is not a member of. */
  openProjects(): Promise<PlaneProjectDetail[]>;
}
export type PlaneProjectTarget = PlaneTarget & { project: PlaneProjectDetail };

export const ACCOUNT_ARG: ToolPropertySchema = { type: "string", description: "Plane account name; needed only when several are usable here (see planeAccounts)." };

/** The `account` and `project` arguments every tool on one Plane project takes. */
export const PROJECT_ARGS: Record<string, ToolPropertySchema> = {
  account: ACCOUNT_ARG,
  project: { type: "string", description: "The Plane project: its id, its identifier such as ENG, or its name." },
};

/** Short project fields to echo back, so the model can name the project it read. */
export const projectHead = (p: PlaneProjectDetail) => ({ id: String(p.id), identifier: String(p.identifier), name: String(p.name) });

/** Resolves `args.account` (optional when one account is usable). Throws when Plane is not enabled here. */
export async function planeTarget(ctx: SkillContext, args: { account?: unknown }): Promise<PlaneTarget> {
  return planeTargetOf(pickPlaneAccess(await loadPlaneAccess(ctx), args.account));
}

/** The target of an account already chosen, e.g. by `pickWorkspaceAccess` for a workspace-level tool. */
export function planeTargetOf(access: PlaneAccess): PlaneTarget {
  const conn = planeConnOf(access.account);
  let listed: Promise<PlaneProjectDetail[]> | null = null;
  const projects = () => (listed ??= planeList<PlaneProjectDetail>(conn, inWorkspace(conn, "projects/"), { perPage: 1000, maxPages: 3 }).then((r) => r.items));
  return {
    access, conn, projects,
    openProjects: async () => (await projects()).filter((p) => planeProjectAllowed(access, String(p.id)) && !p.archived_at && p.is_member !== false),
  };
}

/** A Plane project by id, identifier or name (any case), refused unless the Plane scope allows it; an id is checked before it is read. */
export async function findPlaneProject(t: PlaneTarget, ref: unknown): Promise<PlaneProjectDetail> {
  const raw = typeof ref === "string" ? ref.trim() : "";
  if (!raw) throw new Error('Pass "project" with a Plane project id, identifier such as ENG, or name (see planeProjects).');
  const refused = () => new Error(`The Plane project "${raw}" is not open in this channel. Call planeProjects to see the ones that are.`);
  if (PLANE_ID.test(raw)) {
    if (!planeProjectAllowed(t.access, raw)) throw refused();
    try { return await planeRequest<PlaneProjectDetail>(t.conn, inWorkspace(t.conn, `projects/${raw.toLowerCase()}/`)); }
    catch (e) { if (e instanceof PlaneError && e.status === 404) throw refused(); throw e; }
  }
  const want = raw.toLowerCase();
  const all = await t.projects();
  const hit = all.find((p) => String(p.identifier ?? "").toLowerCase() === want) ?? all.find((p) => String(p.name ?? "").toLowerCase() === want);
  if (!hit || !planeProjectAllowed(t.access, String(hit.id))) throw refused();
  return hit;
}

/** The account and the one Plane project `args.project` names. */
export async function resolvePlaneProject(ctx: SkillContext, args: { account?: unknown; project?: unknown }): Promise<PlaneProjectTarget> {
  const t = await planeTarget(ctx, args);
  return { ...t, project: await findPlaneProject(t, args.project) };
}
