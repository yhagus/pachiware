/**
 * Write tools for work items (group "Work items"). Each one is a `planeWrite`: names are resolved and arguments checked
 * before the change is queued for the asker's Confirm, and again when it runs. Descriptions and comments arrive as
 * Markdown and go to Plane as HTML.
 */
import type { ToolDefinition, ToolPolicy } from "../types.js";
import { planeRequest, inWorkspace, PlaneError } from "./client.js";
import { planeHtml } from "./markdown.js";
import { planeTarget, resolvePlaneProject, UUID, type PlaneTarget } from "./projectRef.js";
import { resolveWorkItem, workItemKey, workItemPath, projectNames, planeUserName } from "./resolve.js";
import { planeWrite, originLine, ORIGIN_LINE } from "./write.js";
import { ACCOUNT, ITEM, PROJECT_OF_ID, PRIORITIES } from "./workItems.js";

type Obj = Record<string, any>;

const NAMES = (what: string) => ({ type: "array", items: { type: "string" }, description: `${what} names, as planeMembers or planeLabels list them.` });
const DATE = (what: string, clear = "") => ({ type: "string", description: `${what} as YYYY-MM-DD${clear}.` });
const NONE = ', or "none" to clear it';
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
  { name: "workItemUpdate", description: `Changes a work item's title, description (Markdown, replaces the old one), state, priority, dates or parent, and adds or removes assignees and labels one by one while keeping the others. Pass only what changes. Names must be the Plane project's own; ask the person when a name is unclear or is "me".${CONFIRM}`,
    parameters: { type: "object", properties: {
      item: ITEM, project: PROJECT_OF_ID,
      name: { type: "string", description: "New title, at most 255 characters." },
      description: { type: "string", description: "New description in Markdown; it replaces the whole description." },
      state: { type: "string", description: "State name, as planeStates lists it." },
      priority: { type: "string", enum: PRIORITIES },
      startDate: DATE("Start date", NONE),
      targetDate: DATE("Due date", NONE),
      parent: { type: "string", description: 'Key of the parent work item in the same Plane project, or "none" to clear it.' },
      addAssignees: NAMES("Member"), removeAssignees: NAMES("Member"),
      addLabels: NAMES("Label"), removeLabels: NAMES("Label"),
      account: ACCOUNT,
    }, required: ["item"] } },
  { name: "workItemComment", description: `Comments on a work item. The body is Markdown; a line saying who asked from which Discord channel is added at its end.${CONFIRM}`,
    parameters: { type: "object", properties: { item: ITEM, project: PROJECT_OF_ID, body: { type: "string", description: "Markdown." }, account: ACCOUNT }, required: ["item", "body"] } },
  { name: "workItemEditComment", description: `Replaces the text of a comment that this Plane account wrote (see workItemComments for ids). Comments written by people are refused.${CONFIRM}`,
    parameters: { type: "object", properties: { item: ITEM, project: PROJECT_OF_ID, comment: { type: "string", description: "The comment's id." }, body: { type: "string", description: "The new text, in Markdown." }, account: ACCOUNT }, required: ["item", "comment", "body"] } },
];

export const workItemWriteToolPolicy: Record<string, ToolPolicy> = {
  workItemCreate: { effect: "write", group: "Work items" },
  workItemUpdate: { effect: "write", group: "Work items" },
  workItemComment: { effect: "write", group: "Work items" },
  workItemEditComment: { effect: "write", group: "Work items" },
};

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const isNone = (v: unknown) => text(v)?.toLowerCase() === "none";
const list = (v: unknown, what: string): string[] => {
  if (v === undefined || v === null) return [];
  if (typeof v === "string") return [v];
  if (!Array.isArray(v)) throw new Error(`${what} must be a list of names`);
  return v.map(String);
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** undefined when not given; null for "none", which clears the date. */
function date(v: unknown, what: string): string | null | undefined {
  const d = text(v);
  if (d === null) return undefined;
  if (isNone(d)) return null;
  if (!DAY.test(d) || Number.isNaN(Date.parse(d))) throw new Error(`${what} must be a date such as 2026-10-20, or "none"`);
  return d;
}
function title(v: unknown): string | null {
  const name = text(v);
  if (name && name.length > 255) throw new Error("name must be at most 255 characters");
  return name;
}
const resolveAll = (names: string[], one: (name: string) => Promise<Obj>) => Promise.all(names.map((n) => one(n)));
function markdown(v: unknown, what: string): string {
  const md = text(v);
  if (!md) throw new Error(`Pass "${what}", in Markdown.`);
  return md;
}
const clip = (s: string, max = 300) => (s.length > max ? `${s.slice(0, max)}…` : s);

/** The work item a per-item write is about, with its target. */
async function itemOf(a: Obj, ctx: Parameters<typeof planeTarget>[0]) {
  const t = await planeTarget(ctx, a);
  return { t, w: await resolveWorkItem(t, a.item, a.project, { fields: "id,name,sequence_id,project" }) };
}

/** The assignees Plane dropped from a write without saying so: people who are Guests or no longer in the Plane project. */
function droppedNote(wanted: Obj[], kept: unknown) {
  const ids = new Set((Array.isArray(kept) ? kept : []).map((x: any) => String(x?.id ?? x)));
  const names = wanted.filter((u) => !ids.has(String(u.id))).map(planeUserName);
  return names.length ? { notAssigned: names, note: "Plane dropped these assignees without an error; they may be Guests in this Plane project." } : {};
}

/** The single-value fields a create or update sets, resolved within the Plane project, and how the summary says them. */
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
  if (start !== undefined) { body.start_date = start; said.push(start ? `start ${start}` : "no start date"); }
  if (target !== undefined) { body.target_date = target; said.push(target ? `due ${target}` : "no due date"); }
  if (isNone(a.parent)) { body.parent = null; said.push("no parent"); }
  else if (text(a.parent)) {
    const parent = await resolveWorkItem(t, a.parent, undefined, { fields: "id,sequence_id,project" });
    if (String(parent.project.id) !== String(project.id)) throw new Error(`The parent must be in the same Plane project (${project.identifier}); ${parent.key} is not.`);
    body.parent = parent.item.id; said.push(`parent ${parent.key}`);
  }
  return { body, said, names };
}

export const workItemWriteHandlers = {
  workItemCreate: planeWrite("workItemCreate", async (a, ctx) => {
    const t = await resolvePlaneProject(ctx, a);
    const name = title(a.name);
    if (!name) throw new Error(`Pass "name", the work item's title.`);
    const { body, said, names } = await fields(t, t.project, a);
    const assignees = await resolveAll(list(a.assignees, "assignees"), names.member);
    const labels = await resolveAll(list(a.labels, "labels"), names.label);
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
        return { key: workItemKey(t.project, created), id: created.id, name: created.name, ...droppedNote(assignees, created.assignees) };
      },
    };
  }),
  workItemUpdate: planeWrite("workItemUpdate", async (a, ctx) => {
    const { t, w } = await itemOf(a, ctx);
    const { body, said, names } = await fields(t, w.project, a);
    const name = title(a.name);
    if (name) { body.name = name; said.push(`title "${name}"`); }
    if (typeof a.description === "string") { body.description_html = planeHtml(a.description); said.push("new description"); }
    const sets = {
      assignees: { add: await resolveAll(list(a.addAssignees, "addAssignees"), names.member), remove: await resolveAll(list(a.removeAssignees, "removeAssignees"), names.member), show: planeUserName },
      labels: { add: await resolveAll(list(a.addLabels, "addLabels"), names.label), remove: await resolveAll(list(a.removeLabels, "removeLabels"), names.label), show: (l: Obj) => String(l.name) },
    };
    for (const [field, { add, remove, show }] of Object.entries(sets)) {
      if (add.length) said.push(`add ${field} ${add.map(show).join(", ")}`);
      if (remove.length) said.push(`remove ${field} ${remove.map(show).join(", ")}`);
    }
    if (!said.length) throw new Error("Nothing to change: pass at least one field to change.");
    return {
      t,
      summary: `Update ${w.key} "${w.item.name}": ${said.join(", ")}`,
      run: async () => {
        // Plane replaces the whole set it is sent, so the current one is read just before the change and merged.
        const touched = Object.entries(sets).filter(([, s]) => s.add.length || s.remove.length);
        if (touched.length) {
          const current = await planeRequest<Obj>(t.conn, workItemPath(t, w), { query: { fields: "id,assignees,labels" } });
          for (const [field, { add, remove }] of touched) {
            const gone = new Set(remove.map((x) => String(x.id)));
            const ids = [...(current?.[field] ?? []).map(String), ...add.map((x) => String(x.id))].filter((id) => !gone.has(id));
            body[field] = [...new Set(ids)];
          }
        }
        const updated = await planeRequest<Obj>(t.conn, workItemPath(t, w), { method: "PATCH", body });
        return { key: w.key, changed: said, ...droppedNote(sets.assignees.add, updated?.assignees) };
      },
    };
  }),
  workItemComment: planeWrite("workItemComment", async (a, ctx) => {
    const { t, w } = await itemOf(a, ctx);
    const body = markdown(a.body, "body");
    return {
      t,
      summary: `Comment on ${w.key} "${w.item.name}": ${clip(body)}`,
      run: async () => {
        const c = await planeRequest<Obj>(t.conn, workItemPath(t, w, "comments/"), { method: "POST", body: { comment_html: planeHtml(body) + await originLine(ctx), access: "INTERNAL" } });
        return { key: w.key, commentId: c?.id };
      },
    };
  }),
  workItemEditComment: planeWrite("workItemEditComment", async (a, ctx) => {
    const { t, w } = await itemOf(a, ctx);
    const id = text(a.comment);
    if (!id || !UUID.test(id)) throw new Error(`Pass "comment" with the comment's id, as workItemComments lists it.`);
    const body = markdown(a.body, "body");
    let old: Obj;
    try { old = await planeRequest<Obj>(t.conn, workItemPath(t, w, `comments/${id.toLowerCase()}/`), { query: { expand: "actor" } }); }
    catch (e) { if (e instanceof PlaneError && e.status === 404) throw new Error(`${w.key} has no comment ${id}.`); throw e; }
    // Plane lets any project member change any comment, so the tool checks the author itself: `actor` is who wrote it.
    const author = String(old?.actor?.id ?? old?.actor ?? "");
    const self = t.access.account.planeUserId;
    if (!self || author !== String(self)) throw new Error(`That comment was written by ${planeUserName(old?.actor)}, not by this account's Plane user, so it cannot be edited. Comment again instead.`);
    // The comment keeps the line that says who asked for it.
    const origin = ORIGIN_LINE.exec(String(old.comment_html ?? ""))?.[0] ?? "";
    return {
      t,
      summary: `Edit a comment on ${w.key} "${w.item.name}" to: ${clip(body)}`,
      run: async () => {
        await planeRequest(t.conn, workItemPath(t, w, `comments/${id.toLowerCase()}/`), { method: "PATCH", body: { comment_html: planeHtml(body) + origin } });
        return { key: w.key, commentId: id, edited: true };
      },
    };
  }),
};
