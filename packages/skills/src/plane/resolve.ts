/** Turns what the model names into Plane ids inside the Plane scope: a work item by key or id, and states, labels and members by name. */
import { PLANE_ID } from "@pachiware/db";
import { planeRequest, planeList, inWorkspace, PlaneError, type Obj } from "./client.js";
import { findPlaneProject, type PlaneTarget, type PlaneProjectDetail } from "./projectRef.js";
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
    if (PLANE_ID.test(raw)) {
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

/**
 * Work items by key (or id) that must all be in the Plane project `p`, as cycles and modules require; `holder` names
 * what holds them in the refusal, such as "a cycle". Duplicates are dropped.
 */
export async function workItemsIn(t: PlaneTarget, p: PlaneProjectDetail, refs: string[], holder: string): Promise<ResolvedWorkItem[]> {
  const found: ResolvedWorkItem[] = [];
  for (const ref of refs) {
    const w = await resolveWorkItem(t, ref, p.id, { fields: "id,name,sequence_id,project" });
    if (String(w.project.id) !== String(p.id)) throw new Error(`${w.key} is in ${w.project.identifier}; ${holder} in ${p.identifier} holds only work items of ${p.identifier}.`);
    if (!found.some((x) => x.item.id === w.item.id)) found.push(w);
  }
  return found;
}

/**
 * An archived cycle or module of `p`, by id or name. Plane's cycle and module lookups leave archived ones out, so they are
 * matched in the archived list instead.
 */
export async function findArchived(t: PlaneTarget, p: PlaneProjectDetail, kind: "cycle" | "module", ref: unknown): Promise<Obj> {
  const raw = typeof ref === "string" ? ref.trim() : "";
  if (!raw) throw new Error(`Pass "${kind}" with the archived ${kind}'s id or name.`);
  const { items } = await planeList<Obj>(t.conn, inWorkspace(t.conn, `projects/${p.id}/archived-${kind}s/`), { perPage: 1000, maxPages: 3 });
  const hits = items.filter((x) => String(x.id) === raw.toLowerCase() || String(x.name ?? "").toLowerCase() === raw.toLowerCase());
  if (!hits.length) throw new Error(`No archived ${kind} "${raw}" in ${p.identifier}.`);
  if (hits.length > 1) throw new Error(`Several archived ${kind}s in ${p.identifier} are named "${raw}"; pass the id of one: ${hits.map((x) => x.id).join(", ")}`);
  return hits[0]!;
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

/** Words a person uses for themselves. Plane cannot tell who that is, so a tool asks for the name instead. */
export const ME = /^(me|myself|i|saya|aku)$/i;

/** The one entry `name` means; none or several throw with the choices, so the model asks. `private` keeps the full list out of a no-match. */
export function pickByName<T>(list: T[], name: unknown, aliases: (x: T) => string[], what: string, show: (x: T) => string, options: { private?: boolean } = {}): T {
  const raw = typeof name === "string" ? name.trim() : "";
  if (!raw) throw new Error(`A ${what} name is empty.`);
  const hits = matchByName(list, raw, aliases);
  if (hits.length === 1) return hits[0]!;
  if (hits.length > 1) throw new Error(`"${raw}" could mean several ${what}s: ${hits.map(show).join("; ")}. Ask the person which one they mean.`);
  if (options.private) throw new Error(`No ${what} matches "${raw}". Ask the person for the name or username they have in Plane.`);
  throw new Error(`No ${what} matches "${raw}". The ${what}s are: ${list.map(show).join("; ") || "none"}.`);
}

/**
 * States, labels and members of one Plane project by name, each list read once and only when needed. Write tools resolve
 * every name through it before anything is queued, so a wrong or ambiguous name is refused before Confirm.
 */
export function projectNames(t: PlaneTarget, p: Obj) {
  let states: Promise<Obj[]> | null = null, labels: Promise<Obj[]> | null = null, members: Promise<Obj[]> | null = null;
  const nameOf = (x: Obj) => String(x.name);
  return {
    async state(name: unknown): Promise<Obj> {
      const list = (await (states ??= projectStates(t, p))).filter((s) => !s.is_triage);
      return pickByName(list, name, (s) => [String(s.name).toLowerCase()], "state", nameOf);
    },
    async label(name: unknown): Promise<Obj> {
      return pickByName(await (labels ??= projectLabels(t, p)), name, (l) => [String(l.name).toLowerCase()], "label", nameOf);
    },
    async member(name: unknown): Promise<Obj> {
      if (typeof name === "string" && ME.test(name.trim())) throw new Error(`Plane does not know who "${name.trim()}" is. Ask the person for their name as planeMembers lists it.`);
      return pickByName(await (members ??= projectMembers(t, p)), name, planeUserAliases, "member", planeUserName);
    },
  };
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
