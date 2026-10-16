/**
 * Turns what the model names into Plane ids, inside the Plane scope: a work item (key such as `ENG-42`, or id with its
 * Plane project), and states, labels and members by name. Read and write tools share it; Plane projects resolve
 * through `projectRef.ts`, so one outside the scope is refused the same way everywhere.
 */
import { planeRequest, planeList, inWorkspace, PlaneError } from "./client.js";
import { findPlaneProject, UUID, type PlaneTarget, type PlaneProjectDetail } from "./projectRef.js";

type Obj = Record<string, any>;
type Query = Record<string, string | number | boolean | undefined>;

/** A work item key: a Plane project identifier (letters and digits, at most 12) and a sequence number. */
const KEY = /^([A-Za-z0-9]{1,12})-(\d+)$/;

/** `ENG-42`, from a project's identifier and a work item's sequence number. */
export const workItemKey = (project: Obj, item: Obj) => `${project.identifier}-${item.sequence_id}`;

export interface ResolvedWorkItem { project: PlaneProjectDetail; item: Obj; key: string }

/**
 * A work item by key (`ENG-42`, any case) or by id with `project`. Plane's get-by-key matches the identifier
 * case-sensitively, so the key is rebuilt from the Plane project's own identifier. `query` passes `fields`/`expand`.
 */
export async function resolveWorkItem(t: PlaneTarget, ref: unknown, project?: unknown, query: Query = {}): Promise<ResolvedWorkItem> {
  const raw = typeof ref === "string" ? ref.trim() : "";
  const key = KEY.exec(raw);
  try {
    if (key) {
      const p = await findPlaneProject(t, key[1]!);
      const item = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, `work-items/${encodeURIComponent(`${p.identifier}-${key[2]}`)}/`), { query });
      return { project: p, item, key: workItemKey(p, item ?? { sequence_id: key[2] }) };
    }
    if (UUID.test(raw)) {
      if (project === undefined || project === null || project === "") throw new Error(`A work item id needs "project" too; or pass its key, such as ENG-42.`);
      const p = await findPlaneProject(t, project);
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
