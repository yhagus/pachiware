/**
 * Write tools for the intake; an intake item's id in Plane's intake path is its work item id. Plane answers a triage by
 * anyone but a Plane project Admin with 200 and changes nothing, so `intakeTriage` reads the status back.
 */
import type { ToolDefinition, ToolPolicy } from "../types.js";
import { planeRequest, inWorkspace, type Obj } from "./client.js";
import { planeHtml } from "./markdown.js";
import { resolvePlaneProject, PROJECT_ARGS, type PlaneProjectTarget } from "./projectRef.js";
import { resolveWorkItem } from "./resolve.js";
import { findIntakeItem, intakeOff, STATUS } from "./intake.js";
import { PRIORITIES } from "./workItems.js";
import { text, title } from "./args.js";
import { planeWrite, CONFIRM_NOTE, originLine, DANGER, DANGER_NOTE, notCreator } from "./write.js";

/** Plane's intake status numbers for each triage action. */
const ACTIONS: Record<string, number> = { accept: 1, reject: -1, snooze: 0, duplicate: 2 };
const WORK_ITEM = { workItem: { type: "string", description: "The intake item's work item id, or its key such as ENG-57 (see intakeList)." } };

export const intakeWriteTools: ToolDefinition[] = [
  { name: "intakeCreate", description: `Adds a work item to the intake of a Plane project open here, for someone to triage. The description is Markdown; a line saying who asked from which Discord channel is added at its end.${CONFIRM_NOTE}`,
    parameters: { type: "object", properties: {
      ...PROJECT_ARGS,
      name: { type: "string", description: "Title, at most 255 characters." },
      description: { type: "string", description: "Markdown." },
      priority: { type: "string", enum: PRIORITIES },
    }, required: ["project", "name"] } },
  { name: "intakeTriage", description: `Triages an intake item: accept (it becomes a work item in the Plane project's default state), reject, snooze until a date, or mark it a duplicate of another work item. Plane allows this only when the bot's Plane user is an Admin of the Plane project.${CONFIRM_NOTE}`,
    parameters: { type: "object", properties: {
      ...PROJECT_ARGS, ...WORK_ITEM,
      action: { type: "string", enum: Object.keys(ACTIONS) },
      snoozeUntil: { type: "string", description: "For snooze: YYYY-MM-DD or an ISO date and time, in the future." },
      duplicateOf: { type: "string", description: "For duplicate: key of the work item it duplicates, such as ENG-41." },
    }, required: ["project", "workItem", "action"] } },
  { name: "intakeDelete", description: `Removes an item from the intake. One not yet accepted takes its work item with it, which Plane allows only for the work item's creator or an Admin of the Plane project; an accepted one leaves its work item in place.${DANGER_NOTE}`,
    parameters: { type: "object", properties: { ...PROJECT_ARGS, ...WORK_ITEM }, required: ["project", "workItem"] } },
];

export const intakeWriteToolPolicy: Record<string, ToolPolicy> = {
  intakeCreate: { effect: "write", group: "Intake" },
  intakeTriage: { effect: "write", group: "Intake" },
  intakeDelete: { effect: "danger", group: "Intake" },
};

/** Refused before Confirm: with intake off Plane refuses the write, or fails with a 500 when it has no intake yet. */
function intakeOn(t: PlaneProjectTarget) {
  if (t.project.intake_view === false) throw new Error(`${intakeOff(t)} Someone with the Admin role can switch it on in the Plane project's settings.`);
}

const keyOf = (t: PlaneProjectTarget, i: Obj) => (i?.issue_detail?.sequence_id != null ? `${t.project.identifier}-${i.issue_detail.sequence_id}` : null);

/** A snooze end in the future: a day (taken as 00:00 UTC) or a full ISO date and time. */
function snoozeEnd(v: unknown): string {
  const raw = text(v);
  if (!raw) throw new Error(`Pass "snoozeUntil", the date the intake item comes back, such as 2026-11-01.`);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) throw new Error("snoozeUntil must be a date such as 2026-11-01, or an ISO date and time.");
  if (at <= Date.now()) throw new Error("snoozeUntil must be in the future.");
  return iso;
}

export const intakeWriteHandlers = {
  intakeCreate: planeWrite("intakeCreate", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    intakeOn(t);
    const name = title(a.name);
    if (!name) throw new Error(`Pass "name", the intake item's title.`);
    const priority = text(a.priority)?.toLowerCase();
    if (priority && !PRIORITIES.includes(priority)) throw new Error(`priority must be one of ${PRIORITIES.join(", ")}`);
    const description = typeof a.description === "string" ? a.description : "";
    return {
      target: t, refusals: [[/Intake is not enabled/, intakeOff(t)]],
      summary: `Add "${name}" to the intake of ${t.project.identifier} (${t.project.name})${priority ? `, priority ${priority}` : ""}`,
      run: async () => {
        // The intake item is a new work item, so it carries the origin line like workItemCreate.
        const i = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/intake-issues/`), {
          method: "POST", body: { issue: { name, description_html: planeHtml(description) + await originLine(ctx), ...(priority ? { priority } : {}) } },
        });
        return { key: keyOf(t, i), workItemId: i?.issue ?? i?.issue_detail?.id, status: "pending" };
      },
    };
  }),
  intakeTriage: planeWrite("intakeTriage", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    const action = text(a.action)?.toLowerCase() ?? "";
    if (!(action in ACTIONS)) throw new Error(`action must be one of ${Object.keys(ACTIONS).join(", ")}`);
    const i = await findIntakeItem(t, a.workItem);
    const itemId = String(i.issue ?? i.issue_detail?.id);
    const key = keyOf(t, i) ?? itemId;
    const body: Obj = { status: ACTIONS[action] };
    let said = `${action[0]!.toUpperCase()}${action.slice(1)} ${key} "${i.issue_detail?.name ?? ""}" in the intake of ${t.project.identifier}`;
    if (action === "snooze") { body.snoozed_till = snoozeEnd(a.snoozeUntil); said += ` until ${body.snoozed_till}`; }
    if (action === "duplicate") {
      if (!text(a.duplicateOf)) throw new Error(`Pass "duplicateOf" with the key of the work item it duplicates.`);
      const original = await resolveWorkItem(t, a.duplicateOf, t.project.id, { fields: "id,name,sequence_id,project" });
      if (String(original.item.id) === itemId) throw new Error("An intake item cannot be a duplicate of itself.");
      body.duplicate_to = original.item.id;
      said = `Mark ${key} "${i.issue_detail?.name ?? ""}" in the intake of ${t.project.identifier} as a duplicate of ${original.key}`;
    }
    const path = inWorkspace(t.conn, `projects/${t.project.id}/intake-issues/${itemId}/`);
    return {
      target: t, role: `an Admin of the Plane project ${t.project.identifier}`,
      refusals: [[/No default state found/, `The Plane project ${t.project.identifier} has no default state, so Plane cannot accept intake items. Set a default state in Plane first.`]],
      summary: said,
      run: async () => {
        await planeRequest(t.conn, path, { method: "PATCH", body });
        // Plane ignores a status change from anyone but a project Admin and still answers 200, so the result is read back.
        const after = await planeRequest<Obj>(t.conn, path);
        if (after?.status !== body.status) {
          throw new Error(`Plane did not triage ${key}, which is still ${STATUS[String(after?.status)] ?? "unchanged"}: the bot's Plane user ${t.access.account.planeUserName} is not an Admin of the Plane project ${t.project.identifier}, and only an Admin can triage intake.`);
        }
        return { key, status: STATUS[String(after.status)] };
      },
    };
  }),
  intakeDelete: planeWrite("intakeDelete", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    intakeOn(t);
    const i = await findIntakeItem(t, a.workItem);
    const itemId = String(i.issue ?? i.issue_detail?.id);
    const key = keyOf(t, i) ?? itemId;
    // Plane deletes the work item along with an intake item it has not accepted.
    const accepted = i.status === 1;
    return {
      target: t, role: `the work item's creator or an Admin of the Plane project ${t.project.identifier}`,
      refusals: [[/Only admin or creator can delete the work item/, notCreator(t, key, t.project)], [/Intake is not enabled/, intakeOff(t)]],
      summary: `Remove ${key} "${i.issue_detail?.name ?? ""}" (${STATUS[String(i.status)] ?? "pending"}) from the intake of ${t.project.identifier}; ${accepted ? "its work item stays" : "this deletes its work item too"}`,
      run: async () => {
        await planeRequest(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/intake-issues/${itemId}/`), { method: "DELETE" });
        return { key, removed: true, workItemDeleted: !accepted };
      },
    };
  }, DANGER),
};
