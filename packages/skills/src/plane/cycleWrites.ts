/**
 * Write tools for cycles (group "Cycles"). Each is a `planeWrite`: the Plane project, the cycle and the work items are
 * resolved and the cycle's dates checked before the change is queued for the asker's Confirm, and again when it runs.
 * Plane answers some wrong requests with a 500 (archiving a cycle without dates, transferring to a missing cycle), so
 * those are refused here first.
 */
import type { SkillContext, ToolDefinition, ToolPolicy } from "../types.js";
import { planeRequest, planeList, inWorkspace } from "./client.js";
import { resolvePlaneProject, PROJECT_ARGS, type PlaneProjectTarget } from "./projectRef.js";
import { workItemsIn, findArchived } from "./resolve.js";
import { cyclesOff, findCycle } from "./cycles.js";
import { text, date, title, list } from "./args.js";
import { planeWrite, DANGER, DANGER_NOTE, notCreator, type PlaneRefusals } from "./write.js";

type Obj = Record<string, any>;

const CONFIRM = " Waits for the asker's Confirm in Discord before anything changes.";
const DATE = (what: string) => ({ type: "string", description: `${what} as YYYY-MM-DD; give both dates or neither.` });
const CYCLE_ARG = { cycle: { type: "string", description: "The cycle: its id, or its name (see cycleList)." } };
export const ITEMS = { type: "array", items: { type: "string" }, description: "Keys of the work items, such as ENG-42." };

export const cycleWriteTools: ToolDefinition[] = [
  { name: "cycleCreate", description: `Creates a cycle (sprint) in a Plane project open here. Give both dates or neither; without dates it is a draft.${CONFIRM}`,
    parameters: { type: "object", properties: {
      ...PROJECT_ARGS,
      name: { type: "string", description: "The cycle's name, at most 255 characters." },
      description: { type: "string", description: "Plain text." },
      startDate: DATE("First day"), endDate: DATE("Last day"),
    }, required: ["project", "name"] } },
  { name: "cycleUpdate", description: `Renames a cycle, changes its description, or moves its dates (give both). A cycle that has ended cannot be changed.${CONFIRM}`,
    parameters: { type: "object", properties: {
      ...PROJECT_ARGS, ...CYCLE_ARG,
      name: { type: "string", description: "New name." },
      description: { type: "string", description: "New description, plain text." },
      startDate: DATE("New first day"), endDate: DATE("New last day"),
    }, required: ["project", "cycle"] } },
  { name: "cycleAddItems", description: `Adds work items of the same Plane project to a cycle that has not ended. A work item is in at most one cycle, so one already in another cycle moves out of it; say so before asking for Confirm.${CONFIRM}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...CYCLE_ARG, items: ITEMS }, required: ["project", "cycle", "items"] } },
  { name: "cycleRemoveItem", description: `Takes one work item out of a cycle; the work item itself stays.${CONFIRM}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...CYCLE_ARG, item: { type: "string", description: "Key of the work item, such as ENG-42." } }, required: ["project", "cycle", "item"] } },
  { name: "cycleTransfer", description: `Moves the unfinished work items (backlog, unstarted or started) of a cycle that has ended into another cycle that has not. Finished and cancelled work items stay.${CONFIRM}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, cycle: { type: "string", description: "The ended cycle to move work items from: id or name." }, to: { type: "string", description: "The cycle to move them to: id or name." } }, required: ["project", "cycle", "to"] } },
  { name: "cycleArchive", description: `Archives a cycle that has ended, hiding it from the cycle list.${CONFIRM}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...CYCLE_ARG }, required: ["project", "cycle"] } },
  { name: "cycleUnarchive", description: `Brings an archived cycle back, named by its id or name.${CONFIRM}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...CYCLE_ARG }, required: ["project", "cycle"] } },
  { name: "cycleDelete", description: `Deletes a cycle for good; its work items stay in the Plane project. Plane allows it only for the cycle's owner or an Admin of the Plane project.${DANGER_NOTE}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...CYCLE_ARG }, required: ["project", "cycle"] } },
];

export const cycleWriteToolPolicy: Record<string, ToolPolicy> = {
  cycleCreate: { effect: "write", group: "Cycles" },
  cycleUpdate: { effect: "write", group: "Cycles" },
  cycleAddItems: { effect: "write", group: "Cycles" },
  cycleRemoveItem: { effect: "write", group: "Cycles" },
  cycleTransfer: { effect: "write", group: "Cycles" },
  cycleArchive: { effect: "write", group: "Cycles" },
  cycleUnarchive: { effect: "write", group: "Cycles" },
  cycleDelete: { effect: "danger", group: "Cycles" },
};

/** Plane needs an ended cycle for transfer and archive; a draft has no end, and archiving one is a 500 in Plane. */
function mustHaveEnded(c: Obj) {
  if (!c.end_date) throw new Error(`The cycle ${c.name} has no dates, so it has not ended. Plane only moves work items out of, or archives, a cycle that has ended.`);
  if (!hasEnded(c)) throw new Error(`The cycle ${c.name} has not ended yet (it ends ${day(c.end_date)}). Plane only moves work items out of, or archives, a cycle that has ended.`);
}

/** A cycle has ended once its last day is over; a draft (no dates) never ends. */
const hasEnded = (c: Obj) => !!c.end_date && Date.parse(c.end_date) < Date.now();
const day = (d: unknown) => (typeof d === "string" ? d.slice(0, 10) : null);

/** The Plane project and the cycle a tool names; `open` refuses a cycle that has ended, which Plane no longer lets change. */
async function cycleOf(a: Obj, ctx: SkillContext, open: string | null) {
  const t = await resolvePlaneProject(ctx, a);
  const c = await findCycle(t, a.cycle);
  if (open && hasEnded(c)) throw new Error(`The cycle ${c.name} has ended (${day(c.end_date)}), so Plane does not let ${open}.`);
  return { t, c };
}

/** Whether the work item is in the cycle, read from the cycle's list. */
async function holds(t: PlaneProjectTarget, path: string, itemId: string): Promise<boolean> {
  const { items } = await planeList<Obj>(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/${path}`), { query: { fields: "id" }, perPage: 1000, maxPages: 5 });
  return items.some((x) => String(x.id) === String(itemId));
}

/** Refused before Confirm when cycles are switched off, since Plane refuses create and update then. */
function cyclesOn(t: PlaneProjectTarget) {
  const off = cyclesOff(t).note;
  if (off) throw new Error(`${off} Someone with the Admin role can switch them on in the Plane project's settings.`);
}

const refusals = (t: PlaneProjectTarget): PlaneRefusals => [
  [/Cycles are not enabled/, `Cycles are switched off in the Plane project ${t.project.identifier}.`],
];

/** Both dates or neither, the first not after the last. */
function dates(a: Obj): { start_date?: string; end_date?: string } {
  const start = date(a.startDate, "startDate"), end = date(a.endDate, "endDate");
  if (!start !== !end) throw new Error("Give both startDate and endDate, or neither for a draft cycle.");
  if (!start || !end) return {};
  if (start > end) throw new Error("startDate cannot be after endDate.");
  return { start_date: start, end_date: end };
}

export const cycleWriteHandlers = {
  cycleCreate: planeWrite("cycleCreate", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    cyclesOn(t);
    const name = title(a.name);
    if (!name) throw new Error(`Pass "name", the cycle's name.`);
    const description = text(a.description);
    const when = dates(a);
    return {
      t, refusals: refusals(t),
      summary: `Create cycle "${name}" in ${t.project.identifier} (${t.project.name}), ${when.start_date ? `${when.start_date} to ${when.end_date}` : "a draft without dates"}`,
      run: async () => {
        // Plane v1.3.1 requires the Plane project's id in the body as well as in the path.
        const c = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/cycles/`), {
          method: "POST", body: { name, ...(description ? { description } : {}), ...when, project_id: t.project.id },
        });
        return { cycle: { id: c.id, name: c.name, startDate: c.start_date ?? null, endDate: c.end_date ?? null } };
      },
    };
  }),
  cycleUpdate: planeWrite("cycleUpdate", async (a, ctx) => {
    const { t, c } = await cycleOf(a, ctx, "it be changed");
    cyclesOn(t);
    const body: Obj = { ...dates(a) }, said: string[] = [];
    const name = title(a.name);
    if (name) { body.name = name; said.push(`name "${name}"`); }
    if (typeof a.description === "string") { body.description = a.description.trim(); said.push("new description"); }
    if (body.start_date) said.push(`dates ${body.start_date} to ${body.end_date}`);
    if (!said.length) throw new Error("Nothing to change: pass name, description, or both dates.");
    return {
      t, refusals: refusals(t),
      summary: `Update cycle ${c.name} in ${t.project.identifier}: ${said.join(", ")}`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/cycles/${c.id}/`), { method: "PATCH", body });
        return { cycle: { id: c.id, name: body.name ?? c.name }, changed: said };
      },
    };
  }),
  cycleAddItems: planeWrite("cycleAddItems", async (a, ctx) => {
    const { t, c } = await cycleOf(a, ctx, "work items be added to it");
    const refs = list(a.items, "items");
    if (!refs.length) throw new Error(`Pass "items" with the keys of the work items, such as ENG-42.`);
    const found = await workItemsIn(t, t.project, refs, "a cycle");
    const keys = found.map((w) => w.key).join(", ");
    return {
      t, refusals: refusals(t),
      summary: `Add ${keys} to cycle ${c.name} in ${t.project.identifier}. A work item already in another cycle is moved out of it.`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/cycles/${c.id}/cycle-issues/`), { method: "POST", body: { issues: found.map((w) => w.item.id) } });
        return { cycle: { id: c.id, name: c.name }, added: found.map((w) => w.key), note: "A work item is in at most one cycle; any of these that was in another cycle was moved out of it." };
      },
    };
  }),
  cycleRemoveItem: planeWrite("cycleRemoveItem", async (a, ctx) => {
    const { t, c } = await cycleOf(a, ctx, null);
    const [w] = await workItemsIn(t, t.project, [String(a.item ?? "")], "a cycle");
    if (!(await holds(t, `cycles/${c.id}/cycle-issues/`, w!.item.id))) throw new Error(`${w!.key} is not in the cycle ${c.name}.`);
    return {
      t,
      summary: `Take ${w!.key} "${w!.item.name}" out of cycle ${c.name} in ${t.project.identifier}`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/cycles/${c.id}/cycle-issues/${w!.item.id}/`), { method: "DELETE" });
        return { cycle: { id: c.id, name: c.name }, removed: w!.key };
      },
    };
  }),
  cycleTransfer: planeWrite("cycleTransfer", async (a, ctx) => {
    const { t, c } = await cycleOf(a, ctx, null);
    mustHaveEnded(c);
    // Plane answers a transfer to a cycle it cannot find with a 500, so the target is looked up here first.
    const to = await findCycle(t, a.to);
    if (String(to.id) === String(c.id)) throw new Error("Pick a different cycle to move the work items to.");
    if (hasEnded(to)) throw new Error(`The cycle ${to.name} has ended too (${day(to.end_date)}); pick one that has not.`);
    return {
      t, refusals: [...refusals(t), [/old cycle is not completed/, `The cycle ${c.name} has not ended yet.`], [/transferred is already completed/, `The cycle ${to.name} has already ended.`]],
      summary: `Move the unfinished work items (backlog, unstarted, started) of cycle ${c.name} into ${to.name} in ${t.project.identifier}`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/cycles/${c.id}/transfer-issues/`), { method: "POST", body: { new_cycle_id: to.id } });
        return { from: { id: c.id, name: c.name }, to: { id: to.id, name: to.name }, note: "Finished and cancelled work items stayed in the old cycle." };
      },
    };
  }),
  cycleArchive: planeWrite("cycleArchive", async (a, ctx) => {
    const { t, c } = await cycleOf(a, ctx, null);
    mustHaveEnded(c);
    return {
      t, refusals: [[/Only completed cycles/, `The cycle ${c.name} has not ended yet.`]],
      summary: `Archive cycle ${c.name} (${day(c.start_date)} to ${day(c.end_date)}) in ${t.project.identifier}`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/cycles/${c.id}/archive/`), { method: "POST" });
        return { cycle: { id: c.id, name: c.name }, archived: true };
      },
    };
  }),
  cycleUnarchive: planeWrite("cycleUnarchive", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    const c = await findArchived(t, t.project, "cycle", a.cycle);
    return {
      t,
      summary: `Bring back the archived cycle ${c.name} in ${t.project.identifier}`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/archived-cycles/${c.id}/unarchive/`), { method: "DELETE" });
        return { cycle: { id: c.id, name: c.name }, archived: false };
      },
    };
  }),
  cycleDelete: planeWrite("cycleDelete", async (a, ctx) => {
    const { t, c } = await cycleOf(a, ctx, null);
    return {
      t, role: `the cycle's owner or an Admin of the Plane project ${t.project.identifier}`,
      refusals: [[/Only admin or creator can delete the cycle/, notCreator(t, `the cycle ${c.name}`, t.project)]],
      summary: `Delete cycle ${c.name} in ${t.project.identifier} for good; ${staying(c.total_issues)}`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/cycles/${c.id}/`), { method: "DELETE" });
        return { cycle: { id: c.id, name: c.name }, deleted: true };
      },
    };
  }, DANGER),
};

/** What a cycle or module delete leaves: its work items, which stay in the Plane project. */
export const staying = (n: unknown) => (typeof n === "number" ? `its ${n} work item${n === 1 ? " stays" : "s stay"} in the Plane project` : "its work items stay in the Plane project");
