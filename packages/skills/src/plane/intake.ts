/** Read tools for the intake of a Plane project: intakeList, intakeGet. */
import { PLANE_ID } from "@pachiware/db";
import type { Effect, ToolDefinition, ToolHandler, ToolPolicy } from "../types.js";
import { planeList, planeRequest, inWorkspace, PlaneError } from "./client.js";
import { planeMarkdown } from "./markdown.js";
import { resolvePlaneProject, projectHead, PROJECT_ARGS, type PlaneProjectTarget } from "./projectRef.js";

const READ: Effect = "read";
const MAX_PAGES = 2;
/** Plane stores the intake status as a number. */
export const STATUS: Record<string, string> = { "-2": "pending", "-1": "rejected", "0": "snoozed", "1": "accepted", "2": "duplicate" };

export const intakeTools: ToolDefinition[] = [
  { name: "intakeList", description: "Lists the intake of a Plane project open here: work items waiting for triage, and those accepted, rejected, snoozed or marked duplicate, newest first.",
    parameters: { type: "object", properties: { ...PROJECT_ARGS }, required: ["project"] } },
  { name: "intakeGet", description: "One intake item of a Plane project open here, with its description and triage status.",
    parameters: { type: "object", properties: { ...PROJECT_ARGS, workItem: { type: "string", description: "The intake item's work item id, or its key such as ENG-57 (see intakeList)." } }, required: ["project", "workItem"] } },
];

export const intakeToolPolicy: Record<string, ToolPolicy> = {
  intakeList: { effect: READ, group: "Intake" },
  intakeGet: { effect: READ, group: "Intake" },
};

export const intakeOff = (t: PlaneProjectTarget) => `Intake is switched off in the Plane project ${t.project.identifier}.`;

const intakeView = (t: PlaneProjectTarget, i: any) => {
  const w = i.issue_detail ?? {};
  return {
    workItemId: i.issue ?? w.id, key: w.sequence_id != null ? `${t.project.identifier}-${w.sequence_id}` : null, title: w.name ?? null,
    status: STATUS[String(i.status)] ?? String(i.status), priority: w.priority ?? null, createdAt: i.created_at ?? null,
    ...(i.snoozed_till ? { snoozedTill: i.snoozed_till } : {}), ...(i.duplicate_to ? { duplicateTo: i.duplicate_to } : {}),
  };
};

const listIntake = (t: PlaneProjectTarget, maxPages = MAX_PAGES) => planeList<any>(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/intake-issues/`), { maxPages });

/** An intake item of the Plane project by its work item id or key, as Plane answers it; refused when intake is off. */
export async function findIntakeItem(t: PlaneProjectTarget, workItem: unknown): Promise<any> {
  const ref = typeof workItem === "string" ? workItem.trim() : "";
  if (!ref) throw new Error('Pass "workItem" with the intake item\'s work item id or key (see intakeList).');
  if (t.project.intake_view === false) throw new Error(intakeOff(t));
  let item: any;
  if (PLANE_ID.test(ref)) {
    try { item = await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/intake-issues/${ref.toLowerCase()}/`)); }
    catch (e) { if (e instanceof PlaneError && e.status === 404) item = null; else throw e; }
  } else {
    // Intake items sit in Plane's triage state, which the work-item lookup by key leaves out, so the key is matched in the intake list.
    const seq = Number(/(\d+)\s*$/.exec(ref)?.[1] ?? NaN);
    item = (await listIntake(t, 10)).items.find((i) => i.issue_detail?.sequence_id === seq) ?? null;
  }
  if (!item) throw new Error(`No intake item "${ref}" in ${t.project.identifier}; see intakeList.`);
  return item;
}

export const intakeHandlers: Record<string, ToolHandler> = {
  intakeList: async (args, ctx) => {
    const t = await resolvePlaneProject(ctx, args);
    // With intake switched off Plane answers an empty list, not an error, so the project's own switch tells the two apart.
    const { items, more } = await listIntake(t);
    const off = t.project.intake_view === false && !items.length;
    return { project: projectHead(t.project), intake: items.map((i) => intakeView(t, i)), ...(more ? { more: true } : {}), ...(off ? { note: intakeOff(t) } : {}) };
  },
  intakeGet: async (args, ctx) => {
    const t = await resolvePlaneProject(ctx, args);
    const item = await findIntakeItem(t, args.workItem);
    const w = item.issue_detail ?? {};
    return {
      project: projectHead(t.project),
      item: { ...intakeView(t, item), state: w.state?.name ?? null, description: planeMarkdown(w.description_html), source: item.source ?? null },
    };
  },
};
