/**
 * Turns what the model names into Plane ids, inside the Plane scope: the account, a Plane project (id, identifier or
 * name), a work item (key such as `ENG-42`, or id), and states, labels and members by name. Read and write tools share it,
 * so a Plane project outside the scope is refused the same way everywhere, before Plane is asked anything about it.
 */
import type { SkillContext } from "../types.js";
import { planeRequest, planeList, inWorkspace, PlaneError, type PlaneConn } from "./client.js";
import { loadPlaneAccess, pickPlaneAccess, planeProjectAllowed, planeConnOf, type PlaneAccess } from "./scope.js";

type Obj = Record<string, any>;
type Query = Record<string, string | number | boolean | undefined>;

/** The account a tool acts through here, its connection, and the Plane workspace's projects, read once per call. */
export interface PlaneTarget {
  access: PlaneAccess;
  conn: PlaneConn;
  /** Every Plane project Plane lists for the account's user, in scope or not, archived ones included. */
  projects(): Promise<Obj[]>;
  /** The Plane projects this place may use, without archived ones and ones the Plane user is not a member of. */
  openProjects(): Promise<Obj[]>;
}

/** Resolves `args.account` (optional when one account is usable) to a target. Throws when Plane is not enabled here. */
export async function planeTarget(ctx: SkillContext, args: Obj): Promise<PlaneTarget> {
  const access = pickPlaneAccess(await loadPlaneAccess(ctx), args.account);
  const conn = planeConnOf(access.account);
  let cached: Promise<Obj[]> | null = null;
  const projects = () => (cached ??= planeList<Obj>(conn, inWorkspace(conn, "projects/"), { perPage: 1000, maxPages: 3 }).then((r) => r.items));
  return {
    access, conn, projects,
    openProjects: async () => (await projects()).filter((p) => planeProjectAllowed(access, String(p.id)) && !p.archived_at && p.is_member !== false),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^([A-Za-z0-9]{1,12})-(\d+)$/;
export const isPlaneId = (v: unknown): v is string => typeof v === "string" && UUID.test(v.trim());

const notOpen = (ref: string) => new Error(`Plane project "${ref}" is not open in this channel. Call planeProjects to see the ones that are.`);

/** A Plane project by id, identifier or name, refused unless the Plane scope allows it. */
export async function resolvePlaneProject(t: PlaneTarget, ref: unknown): Promise<Obj> {
  if (typeof ref !== "string" || !ref.trim()) throw new Error(`Pass "project": the id, identifier (such as ENG) or name of a Plane project. Call planeProjects to see them.`);
  const want = ref.trim().toLowerCase();
  const all = await t.projects();
  const hit = all.find((p) => String(p.id).toLowerCase() === want) ?? all.find((p) => String(p.identifier).toLowerCase() === want) ?? all.find((p) => String(p.name).toLowerCase() === want);
  if (!hit || !planeProjectAllowed(t.access, String(hit.id))) throw notOpen(ref.trim());
  return hit;
}

export const projectRef = (p: Obj) => ({ id: String(p.id), identifier: String(p.identifier), name: String(p.name) });

/** `ENG-42`, from a project's identifier and a work item's sequence number. */
export const workItemKey = (project: Obj, item: Obj) => `${project.identifier}-${item.sequence_id}`;

export interface ResolvedWorkItem { project: Obj; item: Obj; key: string }

/**
 * A work item by key (`ENG-42`, any case) or by id with `project`. Plane's get-by-key matches the identifier
 * case-sensitively, so the key is rebuilt from the Plane project's own identifier. `query` passes `fields`/`expand`.
 */
export async function resolveWorkItem(t: PlaneTarget, ref: unknown, project?: unknown, query: Query = {}): Promise<ResolvedWorkItem> {
  const raw = typeof ref === "string" ? ref.trim() : "";
  const key = KEY.exec(raw);
  try {
    if (key) {
      const p = await resolvePlaneProject(t, key[1]!);
      const item = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, `work-items/${encodeURIComponent(`${p.identifier}-${key[2]}`)}/`), { query });
      return { project: p, item, key: workItemKey(p, item ?? { sequence_id: key[2] }) };
    }
    if (isPlaneId(raw)) {
      if (project === undefined || project === null || project === "") throw new Error(`A work item id needs "project" too; or pass its key, such as ENG-42.`);
      const p = await resolvePlaneProject(t, project);
      const item = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, `projects/${p.id}/work-items/${raw.toLowerCase()}/`), { query });
      return { project: p, item, key: workItemKey(p, item) };
    }
  } catch (e) {
    if (e instanceof PlaneError && e.status === 404) throw new Error(`Work item ${raw} was not found. It may be archived, a draft, still in intake, or deleted.`);
    throw e;
  }
  throw new Error(`Pass "item" as a work item key such as ENG-42, or its id with "project". Use workItemSearch to find one.`);
}

/** The path of a resolved work item's sub-resource, e.g. `comments/`. */
export const workItemPath = (t: PlaneTarget, w: ResolvedWorkItem, sub = "") => inWorkspace(t.conn, `projects/${w.project.id}/work-items/${w.item.id}/${sub}`);

/** "Budi Santoso (budi)": a Plane user's full name and display name, whichever exist. Email is left out. */
export function planeUserName(u: Obj | null | undefined): string {
  if (!u) return "unknown";
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  if (full && u.display_name && full.toLowerCase() !== String(u.display_name).toLowerCase()) return `${full} (${u.display_name})`;
  return full || u.display_name || "unknown";
}

/** The names a person might call a Plane user by, lowercased: display name, full name, first name, email and its local part. */
export function planeUserAliases(u: Obj): string[] {
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
  const email = String(u.email ?? "");
  return [u.display_name, full, u.first_name, email, email.split("@")[0]].filter(Boolean).map((v) => String(v).toLowerCase());
}

/**
 * The entries a name refers to: exact (case-insensitive) matches on any alias, else the ones whose alias contains it.
 * Callers decide what to do with none or several; write tools ask instead of guessing.
 */
export function matchByName<T>(list: T[], name: string, aliases: (x: T) => string[]): T[] {
  const q = name.trim().toLowerCase();
  if (!q) return [];
  const exact = list.filter((x) => aliases(x).some((a) => a === q));
  return exact.length ? exact : list.filter((x) => aliases(x).some((a) => a.includes(q)));
}

/** A Plane project's states, labels or members, as Plane lists them (members as a plain array of users). */
export async function projectStates(t: PlaneTarget, p: Obj): Promise<Obj[]> {
  return (await planeList<Obj>(t.conn, inWorkspace(t.conn, `projects/${p.id}/states/`), { perPage: 1000, maxPages: 2 })).items;
}
export async function projectLabels(t: PlaneTarget, p: Obj): Promise<Obj[]> {
  return (await planeList<Obj>(t.conn, inWorkspace(t.conn, `projects/${p.id}/labels/`), { perPage: 1000, maxPages: 2 })).items;
}
export async function projectMembers(t: PlaneTarget, p: Obj): Promise<Obj[]> {
  return (await planeRequest<Obj[]>(t.conn, inWorkspace(t.conn, `projects/${p.id}/members/`))) ?? [];
}
