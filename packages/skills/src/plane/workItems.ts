/**
 * Read tools for work items (group "Work items"): get, search, list, and a work item's comments, activity, links,
 * relations and attachments. Every tool resolves its Plane project inside the Plane scope first (`resolve.ts`).
 */
import type { ToolDefinition, ToolHandler, ToolPolicy } from "../types.js";
import { planeList, planeRequest, inWorkspace, type Obj } from "./client.js";
import { planeProjectAllowed } from "./scope.js";
import { planeMarkdown, planeText } from "./markdown.js";
import { queriesWords, wordingsOf } from "../workspace/search.js";
import { planeTarget, findPlaneProject, projectHead, ACCOUNT_ARG, type PlaneTarget } from "./projectRef.js";
import { resolveWorkItem, workItemPath, workItemKey, planeUserName, planeUserAliases, matchByName, projectMembers, ME, type ResolvedWorkItem } from "./resolve.js";

export const ITEM = { type: "string", description: "Work item key such as ENG-42, or its id (then pass \"project\" too)." };
export const PROJECT_OF_ID = { type: "string", description: "Plane project id, identifier or name; needed only when item is an id." };

const STATE_GROUPS = ["backlog", "unstarted", "started", "completed", "cancelled"];
export const PRIORITIES = ["urgent", "high", "medium", "low", "none"];
const GROUP_ALIASES: Record<string, string[]> = { open: ["backlog", "unstarted", "started"], closed: ["completed", "cancelled"] };

/** `workItemList` reads Plane's unfiltered list: at most this many pages of PAGE per Plane project, and this many Plane projects. */
const LIST_PAGES = 2, LIST_PAGE = 1000, LIST_PROJECTS = 20;
const LIST_FIELDS = "id,name,priority,state,assignees,labels,target_date,sequence_id,project,updated_at";

const ITEM_FIELDS = "id,name,description_html,priority,state,assignees,labels,start_date,target_date,completed_at,parent,sequence_id,project,created_by,created_at,updated_at";

export const workItemTools: ToolDefinition[] = [
  { name: "workItemGet", description: "Reads one work item: description (Markdown), state, priority, assignees, labels, dates, parent, cycle and modules. Takes its key such as ENG-42.",
    parameters: { type: "object", properties: { item: ITEM, project: PROJECT_OF_ID, account: ACCOUNT_ARG }, required: ["item"] } },
  { name: "workItemSearch", description: "Finds work items by words in the title, or by key such as ENG-42, across the Plane projects open here (or in one). Plane's search covers title and key only; use workItemList to filter by state, assignee, label or priority.",
    parameters: { type: "object", properties: {
      query: { type: "string", description: "Words from the title, or a key such as ENG-42." },
      project: { type: "string", description: "Plane project id, identifier or name, to search only there." },
      limit: { type: "number", description: "At most this many results (default 20, max 50)." },
      account: ACCOUNT_ARG,
    }, required: ["query"] } },
  { name: "workItemList", description: "Lists work items, newest change first, filtered by state or state group, assignee, label, priority, change date and title text, in one Plane project or in all open here. Reads at most 2000 work items per Plane project and 20 Plane projects; stoppedEarly says when it hit that.",
    parameters: { type: "object", properties: {
      project: { type: "string", description: "Plane project id, identifier or name; omit for every Plane project open here." },
      stateGroup: { type: "string", enum: [...STATE_GROUPS, "open", "closed"], description: "open = backlog, unstarted or started; closed = completed or cancelled." },
      state: { type: "string", description: "State name, as planeStates lists it." },
      assignee: { type: "string", description: "A member's name, display name or email (see planeMembers), or \"none\" for unassigned." },
      label: { type: "string", description: "Label name, as planeLabels lists it." },
      priority: { type: "string", enum: PRIORITIES },
      changedSince: { type: "string", description: "Only work items changed on or after this date (YYYY-MM-DD or ISO 8601)." },
      text: { type: "string", description: "Words that must appear in the title or key." },
      queries: { type: "array", items: { type: "string" }, description: "Several wordings, such as Indonesian and English variants; a work item matches when its title or key holds every word of one of them." },
      limit: { type: "number", description: "At most this many results (default 50, max 200)." },
      account: ACCOUNT_ARG,
    } } },
  { name: "workItemComments", description: "Reads a work item's comments, newest first, as Markdown.",
    parameters: { type: "object", properties: { item: ITEM, project: PROJECT_OF_ID, limit: { type: "number", description: "At most this many (default 20, max 100)." }, account: ACCOUNT_ARG }, required: ["item"] } },
  { name: "workItemActivity", description: "Reads a work item's change history (who changed which field, from what to what), oldest first, ending with the latest changes.",
    parameters: { type: "object", properties: { item: ITEM, project: PROJECT_OF_ID, limit: { type: "number", description: "The latest this many changes (default 30, max 100)." }, account: ACCOUNT_ARG }, required: ["item"] } },
  { name: "workItemLinks", description: "Lists the links added to a work item (title and URL).",
    parameters: { type: "object", properties: { item: ITEM, project: PROJECT_OF_ID, account: ACCOUNT_ARG }, required: ["item"] } },
  { name: "workItemRelations", description: "Lists the work items related to a work item (blocking, blocked_by, duplicate, relates_to, start/finish before/after), by key and title.",
    parameters: { type: "object", properties: { item: ITEM, project: PROJECT_OF_ID, account: ACCOUNT_ARG }, required: ["item"] } },
  { name: "workItemAttachments", description: "Lists the files attached to a work item: name, type and size. File contents and download links are not available.",
    parameters: { type: "object", properties: { item: ITEM, project: PROJECT_OF_ID, account: ACCOUNT_ARG }, required: ["item"] } },
];

export const workItemToolPolicy: Record<string, ToolPolicy> = {
  workItemGet: { effect: "read", group: "Work items" },
  workItemSearch: { effect: "read", group: "Work items" },
  workItemList: { effect: "read", group: "Work items" },
  workItemComments: { effect: "read", group: "Work items" },
  workItemActivity: { effect: "read", group: "Work items" },
  workItemLinks: { effect: "read", group: "Work items" },
  workItemRelations: { effect: "read", group: "Work items" },
  workItemAttachments: { effect: "read", group: "Work items" },
};

/** The current cycle and modules of a work item, replayed from its activity, since Plane's work item carries neither. */
function cycleAndModules(activities: Obj[]): { cycle: string | null; modules: string[] } {
  let cycle: string | null = null;
  const modules = new Map<string, string>();
  for (const a of activities) {
    if (a.field === "cycles") cycle = a.verb === "deleted" ? null : (a.new_value ?? null);
    if (a.field === "modules") {
      if (a.verb === "deleted") modules.delete(String(a.old_identifier ?? a.old_value));
      else if (a.new_value) modules.set(String(a.new_identifier ?? a.new_value), String(a.new_value));
    }
  }
  return { cycle, modules: [...modules.values()] };
}

async function activitiesOf(t: PlaneTarget, w: ResolvedWorkItem, expandActor = false) {
  return planeList<Obj>(t.conn, workItemPath(t, w, "activities/"), { perPage: 1000, maxPages: 2, query: expandActor ? { expand: "actor" } : {} });
}

/** Plane's search returns at most `limit` hits across the whole Plane workspace, so it is asked for more than are shown and then cut to the scope. */
const SEARCH_FETCH = 100;

type ListFilter = (item: Obj) => boolean;

/** The filters of a workItemList call, checked before Plane is asked anything. */
function listFilters(args: Obj): { filters: ListFilter[]; since: number | null } {
  const filters: ListFilter[] = [];
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const group = text(args.stateGroup)?.toLowerCase();
  if (group) {
    const groups = GROUP_ALIASES[group] ?? (STATE_GROUPS.includes(group) ? [group] : null);
    if (!groups) throw new Error(`stateGroup must be one of ${[...STATE_GROUPS, "open", "closed"].join(", ")}`);
    filters.push((it) => groups.includes(String(it.state?.group)));
  }
  const state = text(args.state)?.toLowerCase();
  if (state) filters.push((it) => String(it.state?.name ?? "").toLowerCase() === state);
  const assignee = text(args.assignee);
  if (assignee) {
    if (ME.test(assignee)) throw new Error(`Plane does not know who "${assignee}" is: name the person, as planeMembers lists them.`);
    if (assignee.toLowerCase() === "none") filters.push((it) => !(it.assignees ?? []).length);
    else filters.push((it) => matchByName<Obj>(it.assignees ?? [], assignee, planeUserAliases).length > 0);
  }
  const label = text(args.label)?.toLowerCase();
  if (label) filters.push((it) => (it.labels ?? []).some((l: Obj) => String(l.name).toLowerCase() === label));
  const priority = text(args.priority)?.toLowerCase();
  if (priority) {
    if (!PRIORITIES.includes(priority)) throw new Error(`priority must be one of ${PRIORITIES.join(", ")}`);
    filters.push((it) => it.priority === priority);
  }
  const words = text(args.text)?.toLowerCase();
  if (words) filters.push((it) => `${it.key} ${it.name}`.toLowerCase().includes(words));
  const wordings = queriesWords(wordingsOf(undefined, args.queries));
  if (wordings.length) filters.push((it) => { const title = `${it.key} ${it.name}`.toLowerCase(); return wordings.some((ws) => ws.every((w) => title.includes(w))); });
  let since: number | null = null;
  const changed = text(args.changedSince);
  if (changed) {
    since = Date.parse(changed);
    if (Number.isNaN(since)) throw new Error(`changedSince must be a date such as 2026-10-01`);
    filters.push((it) => Date.parse(it.updated_at) >= since!);
  }
  return { filters, since };
}

/** One Plane project's work items, newest change first, stopping at the page cap or once older than `since`. */
async function readProjectItems(t: PlaneTarget, p: Obj, since: number | null): Promise<{ items: Obj[]; capped: boolean }> {
  const items: Obj[] = [];
  let cursor: string | undefined;
  for (let n = 0; n < LIST_PAGES; n++) {
    const page = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, `projects/${p.id}/work-items/`), {
      query: { order_by: "-updated_at", per_page: LIST_PAGE, fields: LIST_FIELDS, expand: "state,assignees,labels", ...(cursor ? { cursor } : {}) },
    });
    const results: Obj[] = page?.results ?? [];
    items.push(...results);
    if (!page?.next_page_results || !page.next_cursor) return { items, capped: false };
    if (since !== null && results.length && Date.parse(results.at(-1)!.updated_at) < since) return { items, capped: false };
    cursor = page.next_cursor;
  }
  return { items, capped: true };
}

/** At most this many related work items are looked up for their key and title; the rest are shown by id. */
const RELATION_LOOKUPS = 25;
const between = (v: unknown, fallback: number, max: number) => Math.min(Math.max(1, Number(v) || fallback), max);

/** Resolves the work item a tool is about; every per-item tool starts here. */
async function itemOf(args: Obj, ctx: Parameters<ToolHandler>[1]) {
  const t = await planeTarget(ctx, args);
  const w = await resolveWorkItem(t, args.item, args.project, { fields: "id,name,sequence_id,project" });
  return { t, w };
}

export const workItemHandlers: Record<string, ToolHandler> = {
  workItemComments: async (args, ctx) => {
    const { t, w } = await itemOf(args, ctx);
    const limit = between(args.limit, 20, 100);
    const { items, more } = await planeList<Obj>(t.conn, workItemPath(t, w, "comments/"), { perPage: limit, maxPages: 1, query: { expand: "actor" } });
    const authors = new Map(items.filter((c) => c.actor?.id).map((c) => [String(c.actor.id), planeUserName(c.actor)]));
    const members = items.some((c) => /mention-component/.test(c.comment_html ?? "")) ? await projectMembers(t, w.project) : [];
    for (const m of members) authors.set(String(m.id), planeUserName(m));
    return {
      key: w.key,
      comments: items.slice(0, limit).map((c) => ({ id: c.id, author: planeUserName(c.actor), createdAt: c.created_at, edited: !!c.edited_at, body: planeMarkdown(c.comment_html, authors) })),
      ...(more || items.length > limit ? { more: true } : {}),
    };
  },
  workItemActivity: async (args, ctx) => {
    const { t, w } = await itemOf(args, ctx);
    const limit = between(args.limit, 30, 100);
    const { items, more } = await activitiesOf(t, w, true);
    const latest = items.slice(-limit);
    return {
      key: w.key,
      activity: latest.map((a) => ({ at: a.created_at, by: planeUserName(a.actor), verb: a.verb, field: a.field ?? null, from: planeText(a.old_value), to: planeText(a.new_value) })),
      ...(items.length > latest.length ? { earlier: items.length - latest.length } : {}),
      ...(more ? { stoppedEarly: `Only the first ${items.length} changes were read.` } : {}),
    };
  },
  workItemLinks: async (args, ctx) => {
    const { t, w } = await itemOf(args, ctx);
    const { items, more } = await planeList<Obj>(t.conn, workItemPath(t, w, "links/"), { perPage: 100, maxPages: 2 });
    return { key: w.key, links: items.map((l) => ({ id: l.id, title: l.title || null, url: l.url })), ...(more ? { more: true } : {}) };
  },
  workItemRelations: async (args, ctx) => {
    const { t, w } = await itemOf(args, ctx);
    const raw = (await planeRequest<Obj>(t.conn, workItemPath(t, w, "relations/"))) ?? {};
    const projects = await t.projects();
    let lookups = 0;
    const relations: Record<string, Obj[]> = {};
    for (const [type, refs] of Object.entries(raw)) {
      if (!Array.isArray(refs) || !refs.length) continue;
      relations[type] = [];
      for (const ref of refs as Obj[]) {
        const p = projects.find((x) => String(x.id) === String(ref.project_id));
        if (!p || !planeProjectAllowed(t.access, String(ref.project_id))) { relations[type]!.push({ outsideScope: true }); continue; }
        if (lookups++ >= RELATION_LOOKUPS) { relations[type]!.push({ id: ref.issue_id, project: p.identifier }); continue; }
        try {
          const it = await planeRequest<Obj>(t.conn, inWorkspace(t.conn, `projects/${p.id}/work-items/${ref.issue_id}/`), { query: { fields: "id,name,sequence_id" } });
          relations[type]!.push({ key: workItemKey(p, it), name: it.name, id: it.id });
        } catch {
          relations[type]!.push({ id: ref.issue_id, project: p.identifier, unavailable: true });
        }
      }
    }
    return { key: w.key, relations };
  },
  workItemAttachments: async (args, ctx) => {
    const { t, w } = await itemOf(args, ctx);
    const list = (await planeRequest<Obj[]>(t.conn, workItemPath(t, w, "attachments/"))) ?? [];
    return {
      key: w.key,
      attachments: list.map((a) => ({ id: a.id, name: a.attributes?.name ?? null, type: a.attributes?.type ?? null, size: Number(a.attributes?.size ?? a.size ?? 0), uploadedAt: a.created_at })),
    };
  },
  workItemList: async (args, ctx) => {
    const { filters, since } = listFilters(args);
    const limit = Math.min(Math.max(1, Number(args.limit) || 50), 200);
    const t = await planeTarget(ctx, args);
    const open = args.project ? [await findPlaneProject(t, args.project)] : await t.openProjects();
    const read = open.slice(0, LIST_PROJECTS);
    const capped: string[] = [];
    const matched: Obj[] = [];
    for (const p of read) {
      const got = await readProjectItems(t, p, since);
      if (got.capped) capped.push(p.identifier);
      for (const it of got.items) {
        const row = { ...it, key: workItemKey(p, it) };
        if (filters.every((f) => f(row))) matched.push(row);
      }
    }
    matched.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    const notes = [
      ...(capped.length ? [`read only the ${LIST_PAGES * LIST_PAGE} most recently changed work items of ${capped.join(", ")}`] : []),
      ...(open.length > read.length ? [`read ${read.length} of ${open.length} Plane projects (${open.slice(read.length).map((p) => p.identifier).join(", ")} not read); name a Plane project to read it`] : []),
    ];
    return {
      items: matched.slice(0, limit).map((it) => ({
        key: it.key, name: it.name, state: it.state?.name ?? null, priority: it.priority,
        assignees: (it.assignees ?? []).map(planeUserName), labels: (it.labels ?? []).map((l: Obj) => l.name),
        targetDate: it.target_date ?? null, updatedAt: it.updated_at,
      })),
      matched: matched.length,
      ...(matched.length > limit ? { more: true } : {}),
      ...(notes.length ? { stoppedEarly: `Stopped early: ${notes.join("; ")}.` } : {}),
    };
  },
  workItemSearch: async (args, ctx) => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) throw new Error(`Pass "query": words from the title, or a key such as ENG-42.`);
    const limit = Math.min(Math.max(1, Number(args.limit) || 20), 50);
    const t = await planeTarget(ctx, args);
    const only = args.project ? await findPlaneProject(t, args.project) : null;
    const res = await planeRequest<{ issues?: Obj[] }>(t.conn, inWorkspace(t.conn, "work-items/search/"), {
      query: { search: query, limit: SEARCH_FETCH, ...(only ? { workspace_search: "false", project_id: String(only.id) } : { workspace_search: "true" }) },
    });
    const wanted = query.toUpperCase();
    const hits = (res?.issues ?? [])
      .filter((h) => planeProjectAllowed(t.access, String(h.project_id)) && (!only || String(h.project_id) === String(only.id)))
      .map((h) => ({ key: `${h.project__identifier}-${h.sequence_id}`, name: h.name, id: h.id, project: h.project__identifier }))
      .sort((a, b) => Number(b.key === wanted) - Number(a.key === wanted));
    return { items: hits.slice(0, limit), ...(hits.length > limit ? { more: true } : {}) };
  },
  workItemGet: async (args, ctx) => {
    const t = await planeTarget(ctx, args);
    const w = await resolveWorkItem(t, args.item, args.project, { fields: ITEM_FIELDS, expand: "state,assignees,labels,parent,created_by" });
    const { item } = w;
    const projects = await t.projects();
    const parentProject = item.parent ? projects.find((p) => String(p.id) === String(item.parent.project_id)) : null;
    const mentioned = /mention-component/.test(item.description_html ?? "") ? await projectMembers(t, w.project) : [];
    const names = new Map<string, string>([...(item.assignees ?? []), item.created_by, ...mentioned].filter((u: Obj | null) => u?.id).map((u: Obj) => [String(u.id), planeUserName(u)]));
    const { cycle, modules } = cycleAndModules((await activitiesOf(t, w)).items);
    return {
      key: w.key, id: item.id, name: item.name, project: projectHead(w.project),
      state: item.state ? { name: item.state.name, group: item.state.group } : null,
      priority: item.priority,
      assignees: (item.assignees ?? []).map(planeUserName),
      labels: (item.labels ?? []).map((l: Obj) => l.name),
      startDate: item.start_date ?? null, targetDate: item.target_date ?? null, completedAt: item.completed_at ?? null,
      parent: item.parent ? { key: parentProject ? `${parentProject.identifier}-${item.parent.sequence_id}` : null, id: item.parent.id } : null,
      cycle, modules,
      createdBy: item.created_by ? planeUserName(item.created_by) : null, createdAt: item.created_at, updatedAt: item.updated_at,
      description: planeMarkdown(item.description_html, names),
    };
  },
};
