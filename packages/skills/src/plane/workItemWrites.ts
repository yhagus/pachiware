/**
 * Write tools for work items (group "Work items"). Each one is a `planeWrite`: names are resolved and arguments checked
 * before the change is queued for the asker's Confirm, and again when it runs. Descriptions and comments arrive as
 * Markdown and go to Plane as HTML.
 */
import type { ToolDefinition, ToolPolicy } from "../types.js";
import { planeRequest, inWorkspace } from "./client.js";
import { planeHtml } from "./markdown.js";
import { resolvePlaneProject, type PlaneTarget } from "./projectRef.js";
import { resolveWorkItem, workItemKey, projectNames, planeUserName } from "./resolve.js";
import { planeWrite, originLine } from "./write.js";
import { ACCOUNT, PRIORITIES } from "./workItems.js";

type Obj = Record<string, any>;

const NAMES = (what: string) => ({ type: "array", items: { type: "string" }, description: `${what} names, as planeMembers or planeLabels list them.` });
const DATE = (what: string) => ({ type: "string", description: `${what} as YYYY-MM-DD.` });
const CONFIRM = " Waits for the asker's Confirm in Discord before anything changes.";

export const workItemWriteTools: ToolDefinition[] = [
  { name: "workItemCreate", description: `Creates a work item in a Plane project. The description is Markdown; a line saying who asked from which Discord channel is added at its end. Names of state, assignees and labels must be the Plane project's own; ask the person when a name is unclear or is "me".${CONFIRM}`,
    parameters: { type: "object", properties: {
      project: { type: "string", description: "The Plane project: its id, its identifier such as ENG, or its name." },
      name: { type: "string", description: "Title, at most 255 characters." },
      description: { type: "string", description: "Markdown." },
      state: { type: "string", description: "State name, as planeStates lists it; Plane's default state when left out." },
      priority: { type: "string", enum: PRIORITIES },
      assignees: NAMES("Member"),
      labels: NAMES("Label"),
      startDate: DATE("Start date"),
      targetDate: DATE("Due date"),
      parent: { type: "string", description: "Key of the parent work item, such as ENG-7, in the same Plane project." },
      account: ACCOUNT,
    }, required: ["project", "name"] } },
];

export const workItemWriteToolPolicy: Record<string, ToolPolicy> = {
  workItemCreate: { effect: "write", group: "Work items" },
};

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const list = (v: unknown, what: string): string[] => {
  if (v === undefined || v === null) return [];
  if (typeof v === "string") return [v];
  if (!Array.isArray(v)) throw new Error(`${what} must be a list of names`);
  return v.map(String);
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function date(v: unknown, what: string): string | null {
  const d = text(v);
  if (d === null) return null;
  if (!DAY.test(d) || Number.isNaN(Date.parse(d))) throw new Error(`${what} must be a date such as 2026-10-20`);
  return d;
}

/** The names Plane dropped from a write without saying so: people who are Guests or no longer in the Plane project. */
function dropped(wanted: Obj[], kept: unknown): string[] {
  const ids = new Set((Array.isArray(kept) ? kept : []).map((x: any) => String(x?.id ?? x)));
  return wanted.filter((u) => !ids.has(String(u.id))).map(planeUserName);
}
const droppedNote = (names: string[]) => (names.length ? { notAssigned: names, note: "Plane dropped these assignees without an error; they may be Guests in this Plane project." } : {});

/** The fields a create or update sets from the model's arguments, resolved within the Plane project, and how to describe them. */
async function fields(t: PlaneTarget, project: Obj, a: Obj) {
  const names = projectNames(t, project);
  const body: Obj = {}, said: string[] = [];
  if (text(a.state)) { const s = await names.state(a.state); body.state = s.id; said.push(`state ${s.name}`); }
  const priority = text(a.priority)?.toLowerCase();
  if (priority) {
    if (!PRIORITIES.includes(priority)) throw new Error(`priority must be one of ${PRIORITIES.join(", ")}`);
    body.priority = priority; said.push(`priority ${priority}`);
  }
  const start = date(a.startDate, "startDate"), target = date(a.targetDate, "targetDate");
  if (start && target && start > target) throw new Error("startDate cannot be after targetDate");
  if (start) { body.start_date = start; said.push(`start ${start}`); }
  if (target) { body.target_date = target; said.push(`due ${target}`); }
  if (text(a.parent)) {
    const parent = await resolveWorkItem(t, a.parent, undefined, { fields: "id,sequence_id,project" });
    if (String(parent.project.id) !== String(project.id)) throw new Error(`The parent must be in the same Plane project (${project.identifier}); ${parent.key} is not.`);
    body.parent = parent.item.id; said.push(`parent ${parent.key}`);
  }
  return { body, said, names };
}

export const workItemWriteHandlers = {
  workItemCreate: planeWrite("workItemCreate", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    const name = text(a.name);
    if (!name) throw new Error(`Pass "name", the work item's title.`);
    if (name.length > 255) throw new Error("name must be at most 255 characters");
    const { body, said, names } = await fields(t, t.project, a);
    const assignees = await Promise.all(list(a.assignees, "assignees").map(names.member));
    const labels = await Promise.all(list(a.labels, "labels").map(names.label));
    if (assignees.length) { body.assignees = assignees.map((u) => u.id); said.push(`assignees ${assignees.map(planeUserName).join(", ")}`); }
    if (labels.length) { body.labels = labels.map((l) => l.id); said.push(`labels ${labels.map((l) => l.name).join(", ")}`); }
    const description = typeof a.description === "string" ? a.description : "";
    return {
      t,
      summary: `Create work item "${name}" in ${t.project.identifier} (${t.project.name})${said.length ? `: ${said.join(", ")}` : ""}`,
      run: async () => {
        const created = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, `projects/${t.project.id}/work-items/`), {
          method: "POST", body: { name, ...body, description_html: planeHtml(description) + await originLine(ctx) },
        });
        return { key: workItemKey(t.project, created), id: created.id, name: created.name, ...droppedNote(dropped(assignees, created.assignees)) };
      },
    };
  }),
};
