/**
 * Write tools for modules (group "Modules"). Each is a `planeWrite`: the Plane project, the module, its lead and members,
 * and the work items are resolved before the change is queued for the asker's Confirm, and again when it runs.
 * Unlike a cycle, a work item can be in several modules, and a module is archived by its status, not its dates.
 */
import type { SkillContext, ToolDefinition, ToolPolicy } from "../types.js";
import { planeRequest, planeList, inWorkspace } from "./client.js";
import { resolvePlaneProject, PROJECT_ARGS, type PlaneProjectTarget } from "./projectRef.js";
import { workItemsIn, findArchived, projectNames, planeUserName } from "./resolve.js";
import { modulesOff, findModule } from "./modules.js";
import { text, isNone, date, title, list } from "./args.js";
import { planeWrite, type PlaneRefusals } from "./write.js";
import { ITEMS } from "./cycleWrites.js";

type Obj = Record<string, any>;

const CONFIRM = " Waits for the asker's Confirm in Discord before anything changes.";
export const MODULE_STATUSES = ["backlog", "planned", "in-progress", "paused", "completed", "cancelled"];
const MODULE_ARG = { module: { type: "string", description: "The module: its id, or its name (see moduleList)." } };
const NAMES = (what: string) => ({ type: "array", items: { type: "string" }, description: `${what}, named as planeMembers lists them.` });

export const moduleWriteTools: ToolDefinition[] = [
  { name: "moduleCreate", description: `Creates a module in a Plane project open here. Lead and members must be members of the Plane project; ask the person when a name is unclear or is "me".${CONFIRM}`,
    parameters: { type: "object", properties: {
      ...PROJECT_ARGS,
      name: { type: "string", description: "The module's name, at most 255 characters; unique in the Plane project." },
      description: { type: "string", description: "Plain text." },
      status: { type: "string", enum: MODULE_STATUSES, description: "Plane's default is planned." },
      lead: { type: "string", description: "The lead, named as planeMembers lists them." },
      members: NAMES("Members"),
      startDate: { type: "string", description: "YYYY-MM-DD." }, targetDate: { type: "string", description: "YYYY-MM-DD." },
    }, required: ["project", "name"] } },
  { name: "moduleUpdate", description: `Changes a module's name, description, status, dates or lead, and adds or removes members one by one while keeping the others. Pass only what changes.${CONFIRM}`,
    parameters: { type: "object", properties: {
      ...PROJECT_ARGS, ...MODULE_ARG,
      name: { type: "string" }, description: { type: "string", description: "Plain text; replaces the old one." },
      status: { type: "string", enum: MODULE_STATUSES },
      lead: { type: "string", description: 'The new lead, or "none" to clear it.' },
      addMembers: NAMES("Members to add"), removeMembers: NAMES("Members to remove"),
      startDate: { type: "string", description: 'YYYY-MM-DD, or "none" to clear it.' }, targetDate: { type: "string", description: 'YYYY-MM-DD, or "none" to clear it.' },
    }, required: ["project", "module"] } },
  { name: "moduleAddItems", description: `Adds work items of the same Plane project to a module. A work item can be in several modules, so it stays in any other module it is in.${CONFIRM}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...MODULE_ARG, items: ITEMS }, required: ["project", "module", "items"] } },
  { name: "moduleRemoveItem", description: `Takes one work item out of a module; the work item itself stays.${CONFIRM}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...MODULE_ARG, item: { type: "string", description: "Key of the work item, such as ENG-42." } }, required: ["project", "module", "item"] } },
  { name: "moduleArchive", description: `Archives a module whose status is completed or cancelled, hiding it from the module list.${CONFIRM}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...MODULE_ARG }, required: ["project", "module"] } },
  { name: "moduleUnarchive", description: `Brings an archived module back, named by its id or name.${CONFIRM}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...MODULE_ARG }, required: ["project", "module"] } },
];

export const moduleWriteToolPolicy: Record<string, ToolPolicy> = {
  moduleCreate: { effect: "write", group: "Modules" },
  moduleUpdate: { effect: "write", group: "Modules" },
  moduleAddItems: { effect: "write", group: "Modules" },
  moduleRemoveItem: { effect: "write", group: "Modules" },
  moduleArchive: { effect: "write", group: "Modules" },
  moduleUnarchive: { effect: "write", group: "Modules" },
};

/** Refused before Confirm when modules are switched off, since Plane refuses create and update then. */
function modulesOn(t: PlaneProjectTarget) {
  const off = modulesOff(t).note;
  if (off) throw new Error(`${off} Someone with the Admin role can switch them on in the Plane project's settings.`);
}

const refusals = (t: PlaneProjectTarget, name?: string): PlaneRefusals => [
  [/Modules are not enabled/, `Modules are switched off in the Plane project ${t.project.identifier}.`],
  [/Module with this name already exists/, `${t.project.identifier} already has a module named "${name}".`],
];

const liveModules = async (t: PlaneProjectTarget) => (await planeList<Obj>(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/modules/`), { perPage: 1000, maxPages: 3 })).items;

/** A name no other module of the Plane project has; Plane refuses a taken one. */
async function freeName(t: PlaneProjectTarget, name: string, self?: string) {
  const taken = (await liveModules(t)).find((m) => String(m.id) !== self && String(m.name ?? "").toLowerCase() === name.toLowerCase());
  if (taken) throw new Error(`${t.project.identifier} already has a module named "${taken.name}".`);
}

function status(v: unknown): string | undefined {
  const s = text(v)?.toLowerCase();
  if (!s) return undefined;
  if (!MODULE_STATUSES.includes(s)) throw new Error(`status must be one of ${MODULE_STATUSES.join(", ")}`);
  return s;
}

/** Start and target dates, refused when the start is after the target. */
function dates(a: Obj, body: Obj, said: string[]) {
  const start = date(a.startDate, "startDate"), target = date(a.targetDate, "targetDate");
  if (start && target && start > target) throw new Error("startDate cannot be after targetDate");
  if (start !== undefined) { body.start_date = start; said.push(start ? `start ${start}` : "no start date"); }
  if (target !== undefined) { body.target_date = target; said.push(target ? `target ${target}` : "no target date"); }
}

async function moduleOf(a: Obj, ctx: SkillContext) {
  const t = await resolvePlaneProject(ctx, a);
  return { t, m: await findModule(t, a.module) };
}

export const moduleWriteHandlers = {
  moduleCreate: planeWrite("moduleCreate", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    modulesOn(t);
    const name = title(a.name);
    if (!name) throw new Error(`Pass "name", the module's name.`);
    const names = projectNames(t, t.project);
    const body: Obj = { name }, said: string[] = [];
    const description = text(a.description);
    if (description) body.description = description;
    const s = status(a.status);
    if (s) { body.status = s; said.push(`status ${s}`); }
    if (text(a.lead)) { const lead = await names.member(a.lead); body.lead = lead.id; said.push(`lead ${planeUserName(lead)}`); }
    const members = await Promise.all(list(a.members, "members").map((n) => names.member(n)));
    if (members.length) { body.members = members.map((u) => u.id); said.push(`members ${members.map(planeUserName).join(", ")}`); }
    dates(a, body, said);
    await freeName(t, name);
    return {
      t, refusals: refusals(t, name),
      summary: `Create module "${name}" in ${t.project.identifier} (${t.project.name})${said.length ? `: ${said.join(", ")}` : ""}`,
      run: async () => {
        const m = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/modules/`), { method: "POST", body });
        return { module: { id: m.id, name: m.name, status: m.status ?? null } };
      },
    };
  }),
  moduleUpdate: planeWrite("moduleUpdate", async (a, ctx) => {
    const { t, m } = await moduleOf(a, ctx);
    modulesOn(t);
    const names = projectNames(t, t.project);
    const body: Obj = {}, said: string[] = [];
    const name = title(a.name);
    if (name) { await freeName(t, name, String(m.id)); body.name = name; said.push(`name "${name}"`); }
    if (typeof a.description === "string") { body.description = a.description.trim(); said.push("new description"); }
    const s = status(a.status);
    if (s) { body.status = s; said.push(`status ${s}`); }
    if (isNone(a.lead)) { body.lead = null; said.push("no lead"); }
    else if (text(a.lead)) { const lead = await names.member(a.lead); body.lead = lead.id; said.push(`lead ${planeUserName(lead)}`); }
    dates(a, body, said);
    const add = await Promise.all(list(a.addMembers, "addMembers").map((n) => names.member(n)));
    const remove = await Promise.all(list(a.removeMembers, "removeMembers").map((n) => names.member(n)));
    if (add.length) said.push(`add members ${add.map(planeUserName).join(", ")}`);
    if (remove.length) said.push(`remove members ${remove.map(planeUserName).join(", ")}`);
    if (!said.length) throw new Error("Nothing to change: pass at least one field to change.");
    return {
      t, refusals: refusals(t, name ?? m.name),
      summary: `Update module ${m.name} in ${t.project.identifier}: ${said.join(", ")}`,
      run: async () => {
        if (add.length || remove.length) {
          // Plane replaces the whole member set it is sent, so the current one is read just before the change and merged.
          const current = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/modules/${m.id}/`));
          const gone = new Set(remove.map((u) => String(u.id)));
          body.members = [...new Set([...(current?.members ?? []).map(String), ...add.map((u) => String(u.id))])].filter((id) => !gone.has(id));
        }
        // Plane answers a module PATCH without the module's id, so the result names the module resolved before.
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/modules/${m.id}/`), { method: "PATCH", body });
        return { module: { id: m.id, name: body.name ?? m.name }, changed: said };
      },
    };
  }),
  moduleAddItems: planeWrite("moduleAddItems", async (a, ctx) => {
    const { t, m } = await moduleOf(a, ctx);
    const refs = list(a.items, "items");
    if (!refs.length) throw new Error(`Pass "items" with the keys of the work items, such as ENG-42.`);
    const found = await workItemsIn(t, t.project, refs, "a module");
    return {
      t, refusals: refusals(t),
      summary: `Add ${found.map((w) => w.key).join(", ")} to module ${m.name} in ${t.project.identifier}. Each stays in any other module it is in.`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/modules/${m.id}/module-issues/`), { method: "POST", body: { issues: found.map((w) => w.item.id) } });
        return { module: { id: m.id, name: m.name }, added: found.map((w) => w.key) };
      },
    };
  }),
  moduleRemoveItem: planeWrite("moduleRemoveItem", async (a, ctx) => {
    const { t, m } = await moduleOf(a, ctx);
    const [w] = await workItemsIn(t, t.project, [String(a.item ?? "")], "a module");
    const { items } = await planeList<Obj>(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/modules/${m.id}/module-issues/`), { query: { fields: "id" }, perPage: 1000, maxPages: 5 });
    if (!items.some((x) => String(x.id) === String(w!.item.id))) throw new Error(`${w!.key} is not in the module ${m.name}.`);
    return {
      t,
      summary: `Take ${w!.key} "${w!.item.name}" out of module ${m.name} in ${t.project.identifier}`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/modules/${m.id}/module-issues/${w!.item.id}/`), { method: "DELETE" });
        return { module: { id: m.id, name: m.name }, removed: w!.key };
      },
    };
  }),
  moduleArchive: planeWrite("moduleArchive", async (a, ctx) => {
    const { t, m } = await moduleOf(a, ctx);
    if (!["completed", "cancelled"].includes(String(m.status))) throw new Error(`The module ${m.name} is ${m.status}; Plane archives only a completed or cancelled module. Change its status first.`);
    return {
      t, refusals: [[/Only completed or cancelled/, `The module ${m.name} is no longer completed or cancelled.`]],
      summary: `Archive module ${m.name} (${m.status}) in ${t.project.identifier}`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/modules/${m.id}/archive/`), { method: "POST" });
        return { module: { id: m.id, name: m.name }, archived: true };
      },
    };
  }),
  moduleUnarchive: planeWrite("moduleUnarchive", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    const m = await findArchived(t, t.project, "module", a.module);
    return {
      t,
      summary: `Bring back the archived module ${m.name} in ${t.project.identifier}`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/archived-modules/${m.id}/unarchive/`), { method: "DELETE" });
        return { module: { id: m.id, name: m.name }, archived: false };
      },
    };
  }),
};
