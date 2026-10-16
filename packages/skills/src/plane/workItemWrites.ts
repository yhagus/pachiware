/**
 * Write tools for work items (group "Work items"). Each one is a `planeWrite`: names are resolved and arguments checked
 * before the change is queued for the asker's Confirm, and again when it runs. Descriptions and comments arrive as
 * Markdown and go to Plane as HTML.
 */
import type { DiscordAttachmentInfo, DiscordMessageInfo, SkillContext, ToolDefinition, ToolPolicy } from "../types.js";
import { planeRequest, planeList, planeUpload, inWorkspace, PlaneError } from "./client.js";
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
const RELATIONS = ["blocking", "blocked_by", "duplicate", "relates_to", "start_before", "start_after", "finish_before", "finish_after"];
const RELATE_NOTE = "Plane's API cannot remove a relation; to undo it, remove it in Plane itself.";

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
  { name: "workItemAddLink", description: `Adds a link (an http or https URL, with an optional title) to a work item.${CONFIRM}`,
    parameters: { type: "object", properties: { item: ITEM, project: PROJECT_OF_ID, url: { type: "string", description: "http:// or https:// address." }, title: { type: "string" }, account: ACCOUNT }, required: ["item", "url"] } },
  { name: "workItemRemoveLink", description: `Removes a link from a work item, named by its URL or its id (see workItemLinks).${CONFIRM}`,
    parameters: { type: "object", properties: { item: ITEM, project: PROJECT_OF_ID, link: { type: "string", description: "The link's URL or id." }, account: ACCOUNT }, required: ["item", "link"] } },
  { name: "workItemRelate", description: `Relates a work item to other work items open here, such as "ENG-42 is blocked by ENG-41". Plane's API cannot remove a relation afterwards; that has to be done in Plane itself, so say so before asking for Confirm.${CONFIRM}`,
    parameters: { type: "object", properties: {
      item: ITEM, project: PROJECT_OF_ID,
      relation: { type: "string", enum: RELATIONS, description: "How item relates to the others, e.g. blocked_by: item is blocked by them." },
      related: { type: "array", items: { type: "string" }, description: "Keys of the other work items, such as ENG-41." },
      account: ACCOUNT,
    }, required: ["item", "relation", "related"] } },
  { name: "workItemAttach", description: `Attaches a file someone posted in this channel or thread to a work item, at most 5 MB. Name the message by its id, from a line such as "Alice (message 123): ..." or "[file: report.pdf (message 123)]".${CONFIRM}`,
    parameters: { type: "object", properties: {
      item: ITEM, project: PROJECT_OF_ID,
      messageId: { type: "string", description: "The id of the Discord message holding the file." },
      name: { type: "string", description: "The file's name, when the message holds more than one." },
      account: ACCOUNT,
    }, required: ["item", "messageId"] } },
];

export const workItemWriteToolPolicy: Record<string, ToolPolicy> = {
  workItemCreate: { effect: "write", group: "Work items" },
  workItemUpdate: { effect: "write", group: "Work items" },
  workItemComment: { effect: "write", group: "Work items" },
  workItemEditComment: { effect: "write", group: "Work items" },
  workItemAddLink: { effect: "write", group: "Work items" },
  workItemRemoveLink: { effect: "write", group: "Work items" },
  workItemRelate: { effect: "write", group: "Work items" },
  workItemAttach: { effect: "write", group: "Work items" },
};

/** Plane's default FILE_SIZE_LIMIT; its storage refuses a larger file. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** The file of a message in this channel, or in the channel a thread sits in, since a file is often posted before the bot's thread starts. */
async function discordFile(ctx: SkillContext, messageId: unknown, name: unknown): Promise<DiscordAttachmentInfo> {
  const id = text(messageId);
  if (!id) throw new Error(`Pass "messageId", the id of the message holding the file.`);
  if (!ctx.discord || !ctx.channelId) throw new Error("Files can be attached only from a Discord channel.");
  let message: DiscordMessageInfo | null = null;
  for (const channelId of new Set([ctx.channelId, ctx.parentChannelId].filter((c): c is string => !!c))) {
    message = await ctx.discord.fetchMessage({ channelId, messageId: id }).catch(() => null);
    if (message) break;
  }
  if (!message) throw new Error(`Message ${id} was not found in this channel.`);
  const wanted = text(name)?.toLowerCase();
  const files = wanted ? message.attachments.filter((a) => a.name.toLowerCase() === wanted) : message.attachments;
  if (!files.length) throw new Error(wanted ? `Message ${id} has no file named ${name}.` : `Message ${id} has no file.`);
  if (files.length > 1) throw new Error(`Message ${id} holds several files (${files.map((a) => a.name).join(", ")}); pass "name".`);
  const file = files[0]!;
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is ${mb(file.size)}; Plane takes files up to 5 MB.`);
  return file;
}
const mb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

async function download(file: DiscordAttachmentInfo): Promise<Uint8Array> {
  const res = await fetch(file.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }).catch(() => null);
  if (!res?.ok) throw new Error(`${file.name} could not be downloaded from Discord. Ask for it to be posted again.`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is ${mb(bytes.byteLength)}; Plane takes files up to 5 MB.`);
  return bytes;
}

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
  workItemAddLink: planeWrite("workItemAddLink", async (a, ctx) => {
    const { t, w } = await itemOf(a, ctx);
    const url = text(a.url) ?? "";
    let parsed: URL | null = null;
    try { parsed = new URL(url); } catch {}
    if (!parsed || !/^https?:$/.test(parsed.protocol)) throw new Error(`url must be a full http:// or https:// address.`);
    const linkTitle = text(a.title);
    if (linkTitle && linkTitle.length > 255) throw new Error("title must be at most 255 characters");
    return {
      t,
      summary: `Add link ${linkTitle ? `"${linkTitle}" ` : ""}${url} to ${w.key} "${w.item.name}"`,
      run: async () => {
        const link = await planeRequest<Obj>(t.conn, workItemPath(t, w, "links/"), { method: "POST", body: { url, ...(linkTitle ? { title: linkTitle } : {}) } });
        return { key: w.key, linkId: link?.id, url };
      },
    };
  }),
  workItemRemoveLink: planeWrite("workItemRemoveLink", async (a, ctx) => {
    const { t, w } = await itemOf(a, ctx);
    const ref = text(a.link);
    if (!ref) throw new Error(`Pass "link" with the link's URL or id, as workItemLinks lists it.`);
    const { items } = await planeList<Obj>(t.conn, workItemPath(t, w, "links/"), { perPage: 100, maxPages: 5 });
    const link = items.find((l) => String(l.id) === ref.toLowerCase()) ?? items.find((l) => l.url === ref);
    if (!link) throw new Error(`${w.key} has no link ${ref}. Its links: ${items.map((l) => l.url).join(", ") || "none"}.`);
    return {
      t,
      summary: `Remove link ${link.title ? `"${link.title}" ` : ""}${link.url} from ${w.key} "${w.item.name}"`,
      run: async () => {
        await planeRequest(t.conn, workItemPath(t, w, `links/${link.id}/`), { method: "DELETE" });
        return { key: w.key, removed: link.url };
      },
    };
  }),
  workItemRelate: planeWrite("workItemRelate", async (a, ctx) => {
    const { t, w } = await itemOf(a, ctx);
    const relation = text(a.relation)?.toLowerCase() ?? "";
    if (!RELATIONS.includes(relation)) throw new Error(`relation must be one of ${RELATIONS.join(", ")}`);
    const refs = list(a.related, "related");
    if (!refs.length) throw new Error(`Pass "related" with the keys of the other work items, such as ENG-41.`);
    const others: Obj[] = [];
    for (const ref of refs) {
      const o = await resolveWorkItem(t, ref, a.project, { fields: "id,name,sequence_id,project" });
      if (String(o.item.id) === String(w.item.id)) throw new Error(`A work item cannot be related to itself (${w.key}).`);
      if (!others.some((x) => x.item.id === o.item.id)) others.push(o);
    }
    return {
      t,
      summary: `Mark ${w.key} "${w.item.name}" as ${relation.replace(/_/g, " ")} ${others.map((o) => o.key).join(", ")}. ${RELATE_NOTE}`,
      run: async () => {
        await planeRequest(t.conn, workItemPath(t, w, "relations/"), { method: "POST", body: { relation_type: relation, issues: others.map((o) => o.item.id) } });
        return { key: w.key, relation, related: others.map((o) => o.key), note: RELATE_NOTE };
      },
    };
  }),
  workItemAttach: planeWrite("workItemAttach", async (a, ctx) => {
    const { t, w } = await itemOf(a, ctx);
    const file = await discordFile(ctx, a.messageId, a.name);
    return {
      t,
      summary: `Attach ${file.name} (${mb(file.size)}) to ${w.key} "${w.item.name}"`,
      run: async () => {
        const bytes = await download(file);
        const type = file.contentType?.split(";")[0]?.trim() || "application/octet-stream";
        const asked = await planeRequest<Obj>(t.conn, workItemPath(t, w, "attachments/"), { method: "POST", body: { name: file.name, type, size: bytes.byteLength } });
        if (!asked?.upload_data?.url || !asked.asset_id) throw new Error("Plane did not give an upload address for the file.");
        await planeUpload(t.conn, asked.upload_data, { name: file.name, type, bytes });
        // Plane lists the attachment only once it is told the upload finished.
        await planeRequest(t.conn, workItemPath(t, w, `attachments/${asked.asset_id}/`), { method: "PATCH", body: { is_uploaded: true } });
        return { key: w.key, attachment: { id: asked.asset_id, name: file.name, size: bytes.byteLength } };
      },
    };
  }),
};
