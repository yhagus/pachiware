/**
 * A fake Plane v1.3.1 `/api/v1/` for the Discord scenario harness, answering in the shapes the v1.3.1 source produces:
 * the pagination envelope (`per_page`, `cursor` "<per_page>:<page>:0", `next_page_results`), plain arrays where Plane
 * answers with one, `expand=` on work items, and get-by-key matching the project identifier case-sensitively.
 *
 *   const plane = fakePlane(s);           // after s.plane(...)
 *   plane.project({ id: P1, identifier: "ENG", name: "Engineering" });
 *   plane.item({ project: P1, sequence_id: 42, name: "Fix login", state: S1 });
 *
 * Writes change the fake as Plane would (assignees and labels outside the Plane project are dropped silently, a PATCH of
 * either replaces the whole set). `plane.writes` lists every request that is not a GET, in order, with its path inside the
 * Plane workspace, so a test can assert that nothing changed before Confirm.
 *
 * Cycles, modules, intake, Plane project create and PATCH, and state and label writes follow v1.3.1 too: a cycle create
 * needs `project_id` in the body; cycles or modules switched off refuse create and update; a work item is in at most one
 * cycle but any number of modules; archiving a cycle without dates, or transferring to a missing cycle, is a 500; intake
 * triage by a Plane user who is not a project Admin (`member_role` 15, the default) is ignored with a 200; a Plane project
 * created through the API has cycles, modules and intake off, and gets no intake until a PATCH switches it on.
 */
import type { HttpRequest } from "./discordScenario";

type Obj = Record<string, any>;
type Scenario = { http: { on(match: RegExp, respond: (req: HttpRequest) => unknown): void } };

export const STAMP = "2026-10-01T09:00:00.000000Z";

export function fakePlane(s: Scenario, { host = "api.plane.so", slug = "acme", uploadUrl = "https://plane-uploads.s3.amazonaws.com/uploads" } = {}) {
  const projects: Obj[] = [], states: Obj[] = [], labels: Obj[] = [], users: Obj[] = [], items: Obj[] = [];
  const members = new Map<string, string[]>();
  const comments: Obj[] = [], activities: Obj[] = [], links: Obj[] = [], attachments: Obj[] = [];
  const relations = new Map<string, Obj>();
  const cycles: Obj[] = [], cycleIssues: Obj[] = [], modules: Obj[] = [], moduleIssues: Obj[] = [], intake: Obj[] = [];
  /** Plane projects with an Intake row: one created with intake on, or switched on by a PATCH. */
  const intakeRows = new Set<string>();
  const writes: { method: string; path: string; body: any }[] = [];
  let n = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

  const userLite = (id: string) => { const u = users.find((x) => x.id === id); return u ? { ...u } : null; };
  const stateLite = (id: string) => { const st = states.find((x) => x.id === id); return st ? { id: st.id, name: st.name, color: st.color, group: st.group } : null; };
  const expandItem = (it: Obj, expand: string[]) => {
    const out: Obj = { ...it };
    if (expand.includes("state")) out.state = stateLite(it.state);
    if (expand.includes("assignees")) out.assignees = it.assignees.map(userLite).filter(Boolean);
    if (expand.includes("labels")) out.labels = it.labels.map((id: string) => labels.find((l) => l.id === id)).filter(Boolean);
    if (expand.includes("created_by")) out.created_by = userLite(it.created_by);
    if (expand.includes("parent") && it.parent) { const p = items.find((x) => x.id === it.parent); out.parent = p ? { id: p.id, sequence_id: p.sequence_id, project_id: p.project } : null; }
    if (expand.includes("project")) { const p = projects.find((x) => x.id === it.project); out.project = p ? { id: p.id, identifier: p.identifier, name: p.name } : null; }
    return out;
  };
  const pick = (o: Obj, fields: string[]) => (fields.length ? Object.fromEntries(Object.entries(o).filter(([k]) => fields.includes(k))) : o);

  function page(list: Obj[], url: URL) {
    const perPage = Number(url.searchParams.get("per_page") ?? 1000);
    if (perPage > 1000) return json(400, { detail: "Invalid per_page value. Cannot exceed 1000." });
    const index = Number((url.searchParams.get("cursor") ?? `${perPage}:0:0`).split(":")[1]);
    const results = list.slice(index * perPage, (index + 1) * perPage);
    const more = (index + 1) * perPage < list.length;
    return {
      grouped_by: null, sub_grouped_by: null, total_count: list.length, next_cursor: `${perPage}:${index + 1}:0`, prev_cursor: `${perPage}:${index - 1}:1`,
      next_page_results: more, prev_page_results: index > 0, count: results.length, total_pages: Math.ceil(list.length / perPage), total_results: list.length, extra_stats: null, results,
    };
  }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const missing = () => json(404, { error: "The requested resource does not exist." });
  const html404 = () => new Response("<!doctype html><title>Not Found</title>", { status: 404, headers: { "Content-Type": "text/html" } });

  function respond(req: HttpRequest): unknown {
    const url = new URL(req.url);
    const path = url.pathname.replace(`/api/v1/workspaces/${slug}/`, "");
    const expand = (url.searchParams.get("expand") ?? "").split(",").filter(Boolean);
    const fields = (url.searchParams.get("fields") ?? "").split(",").filter(Boolean);
    const seg = path.split("/").filter(Boolean);
    if (req.method !== "GET") {
      writes.push({ method: req.method, path, body: req.body });
      return write(req, seg);
    }

    if (seg[0] === "work-items" && seg[1] === "search") {
      const q = (url.searchParams.get("search") ?? "").toLowerCase();
      if (!q) return { issues: [] };
      const nums: string[] = q.match(/\b\d+\b/g) ?? [];
      const onlyProject = url.searchParams.get("workspace_search") !== "true" && url.searchParams.get("project_id");
      const hits = items.filter((it) => {
        const p = projects.find((x) => x.id === it.project)!;
        if (p.is_member === false || p.archived_at) return false;
        if (onlyProject && it.project !== onlyProject) return false;
        return it.name.toLowerCase().includes(q) || p.identifier.toLowerCase().includes(q) || nums.includes(String(it.sequence_id));
      }).slice(0, Number(url.searchParams.get("limit") ?? 10));
      return { issues: hits.map((it) => ({ name: it.name, id: it.id, sequence_id: it.sequence_id, project__identifier: projects.find((x) => x.id === it.project)!.identifier, project_id: it.project, workspace__slug: slug })) };
    }
    if (seg[0] === "work-items" && seg.length === 2) {
      const [ident, seq] = [seg[1]!.slice(0, seg[1]!.lastIndexOf("-")), seg[1]!.slice(seg[1]!.lastIndexOf("-") + 1)];
      const p = projects.find((x) => x.identifier === ident);
      if (!p) return json(403, { detail: "You do not have permission to perform this action." });
      const it = items.find((x) => x.project === p.id && String(x.sequence_id) === seq);
      return it ? pick(expandItem(it, expand), fields) : missing();
    }
    if (seg[0] !== "projects") return html404();
    if (seg.length === 1) return page(projects, url);
    const p = projects.find((x) => x.id === seg[1]);
    if (!p) return missing();
    if (seg.length === 2) return { ...p, project_lead: expand.includes("project_lead") ? userLite(p.project_lead) : p.project_lead };
    const inProject = (list: Obj[]) => list.filter((x) => x.project === p.id);
    switch (seg[2]) {
      case "states": return page(inProject(states), url);
      case "labels": return page(inProject(labels), url);
      case "members": return (members.get(p.id) ?? []).map(userLite);
      case "cycles": case "archived-cycles": case "modules": case "archived-modules": return readPlanning(p, seg, url, expand, fields);
      case "intake-issues": return readIntake(p, seg, url);
      case "work-items": break;
      default: return html404();
    }
    if (seg.length === 3) {
      let list = inProject(items);
      const order = url.searchParams.get("order_by") ?? "-created_at";
      const key = order.replace(/^-/, "");
      list = [...list].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (order.startsWith("-") ? -1 : 1));
      const out = page(list, url);
      return out instanceof Response ? out : { ...out, results: out.results.map((it) => pick(expandItem(it, expand), fields)) };
    }
    const it = items.find((x) => x.id === seg[3] && x.project === p.id);
    if (!it) return missing();
    if (seg.length === 4) return pick(expandItem(it, expand), fields);
    const of = (list: Obj[]) => list.filter((x) => x.issue === it.id);
    if (seg.length === 6 && seg[4] === "comments") {
      const c = of(comments).find((x) => x.id === seg[5]);
      return !c ? missing() : expand.includes("actor") ? { ...c, actor: userLite(c.actor) } : c;
    }
    switch (seg[4]) {
      case "comments": return page(of(comments).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((c) => (expand.includes("actor") ? { ...c, actor: userLite(c.actor) } : c)), url);
      case "activities": return page(of(activities).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).map((a) => (expand.includes("actor") ? { ...a, actor: userLite(a.actor) } : a)), url);
      case "links": return page(of(links), url);
      case "attachments": return of(attachments).filter((a) => a.is_uploaded);
      case "relations": return { blocking: [], blocked_by: [], duplicate: [], relates_to: [], start_after: [], start_before: [], finish_after: [], finish_before: [], ...relations.get(it.id) };
      default: return html404();
    }
  }

  /** The API user is "u-bot", the Plane user `s.plane()` records for its account. */
  function write(req: HttpRequest, seg: string[]): unknown {
    const body = (req.body ?? {}) as Obj;
    if (seg[0] === "projects" && seg.length === 1 && req.method === "POST") return createProject(body);
    const p = seg[0] === "projects" ? projects.find((x) => x.id === seg[1]) : undefined;
    if (!p) return missing();
    if (seg.length === 2 && req.method === "PATCH") return patchProject(p, body);
    if (seg[2] === "cycles" || seg[2] === "archived-cycles") return writeCycle(p, seg, req.method, body);
    if (seg[2] === "modules" || seg[2] === "archived-modules") return writeModule(p, seg, req.method, body);
    if (seg[2] === "intake-issues") return writeIntake(p, seg, req.method, body);
    if (seg[2] === "states" || seg[2] === "labels") return writeStateOrLabel(p, seg, req.method, body);
    const memberIds = members.get(p.id) ?? [];
    const settable = (o: Obj) => {
      const out: Obj = { ...o };
      if (Array.isArray(o.assignees)) out.assignees = o.assignees.filter((id: string) => memberIds.includes(id));
      if (Array.isArray(o.labels)) out.labels = o.labels.filter((id: string) => labels.some((l) => l.id === id && l.project === p.id));
      return out;
    };
    if (seg[2] === "work-items" && seg.length === 3 && req.method === "POST") {
      if (!body.name) return json(400, { name: ["This field is required."] });
      const seq = Math.max(0, ...items.filter((x) => x.project === p.id).map((x) => x.sequence_id)) + 1;
      const it = base({ name: "", description_html: "<p></p>", description_binary: null, priority: "none", start_date: null, target_date: null, completed_at: null, archived_at: null, is_draft: false, created_by: "u-bot", parent: null, state: null, assignees: [], labels: [], workspace: "ws-1", ...settable(body), sequence_id: seq, project: p.id });
      items.push(it);
      return json(201, it);
    }
    const it = seg[2] === "work-items" ? items.find((x) => x.id === seg[3] && x.project === p.id) : undefined;
    if (!it) return missing();
    if (seg.length === 4 && req.method === "PATCH") {
      Object.assign(it, settable(body), { updated_at: "2026-10-02T09:00:00.000000Z" });
      return it;
    }
    if (seg[4] === "comments") {
      // Like Plane, the comment's actor is the API user, and created_by is taken from the body when sent.
      if (seg.length === 5 && req.method === "POST") return json(201, api.comment({ issue: it.id, project: p.id, comment_html: body.comment_html ?? "", access: body.access ?? "INTERNAL", actor: "u-bot", created_by: body.created_by ?? "u-bot" }));
      const c = comments.find((x) => x.id === seg[5] && x.issue === it.id);
      if (!c) return missing();
      if (req.method === "PATCH") return Object.assign(c, { comment_html: body.comment_html ?? c.comment_html, edited_at: "2026-10-02T09:00:00.000000Z" });
    }
    if (seg[4] === "links") {
      if (seg.length === 5 && req.method === "POST") {
        if (!/^https?:\/\//.test(String(body.url ?? ""))) return json(400, { url: ["Invalid URL scheme."] });
        if (links.some((l) => l.issue === it.id && l.url === body.url)) return json(400, { error: "URL already exists for this Issue" });
        return json(201, api.link({ issue: it.id, project: p.id, url: body.url, title: body.title ?? null, created_by: "u-bot" }));
      }
      const at = links.findIndex((l) => l.id === seg[5] && l.issue === it.id);
      if (at < 0) return missing();
      if (req.method === "DELETE") { links.splice(at, 1); return new Response(null, { status: 204 }); }
    }
    if (seg[4] === "attachments") {
      if (seg.length === 5 && req.method === "POST") {
        if (!body.name || typeof body.size !== "number") return json(400, { error: "Invalid request.", status: false });
        const asset = `ws-1/${uuid().slice(-6)}-${body.name}`;
        const a = api.attachment({ issue: it.id, project: p.id, attributes: { name: body.name, type: body.type, size: body.size }, size: body.size, is_uploaded: false, asset });
        return { upload_data: { url: uploadUrl, fields: { "Content-Type": body.type, key: asset, policy: "cG9saWN5", "x-amz-signature": "sig" } }, asset_id: a.id, attachment: a, asset_url: `/api/assets/v2/workspaces/${slug}/projects/${p.id}/issues/${it.id}/attachments/${a.id}/` };
      }
      const a = attachments.find((x) => x.id === seg[5] && x.issue === it.id);
      if (!a) return missing();
      if (req.method === "PATCH") { a.is_uploaded = true; return new Response(null, { status: 204 }); }
    }
    if (seg[4] === "relations" && seg.length === 5 && req.method === "POST") {
      const rel: Obj = relations.get(it.id) ?? {};
      const others = (body.issues ?? []).map((id: string) => items.find((x) => x.id === id)).filter(Boolean);
      rel[body.relation_type] = [...(rel[body.relation_type] ?? []), ...others.map((o: Obj) => ({ project_id: o.project, issue_id: o.id }))];
      relations.set(it.id, rel);
      return json(201, others.map((o: Obj) => ({ id: o.id, project_id: o.project, sequence_id: o.sequence_id, relation_type: body.relation_type, name: o.name, state_id: o.state, priority: o.priority, created_by: "u-bot", created_at: STAMP, updated_at: STAMP, updated_by: "u-bot" })));
    }
    return json(405, { detail: `Method "${req.method}" not allowed.` });
  }

  const now = () => Date.now();
  const ended = (c: Obj) => !!c.end_date && Date.parse(c.end_date) < now();
  const draft = (c: Obj) => !c.start_date && !c.end_date;
  const noContent = () => new Response(null, { status: 204 });
  const failed = () => json(500, { error: "Something went wrong please try again later" });
  const counts = (ids: string[]) => {
    const group = (g: string) => ids.filter((id) => stateLite(items.find((x) => x.id === id)?.state)?.group === g).length;
    return { total_issues: ids.length, cancelled_issues: group("cancelled"), completed_issues: group("completed"), started_issues: group("started"), unstarted_issues: group("unstarted"), backlog_issues: group("backlog") };
  };
  const cycleOut = (c: Obj) => ({ ...counts(cycleIssues.filter((r) => r.cycle === c.id).map((r) => r.issue)), ...c });
  const moduleOut = (m: Obj) => ({ ...counts(moduleIssues.filter((r) => r.module === m.id).map((r) => r.issue)), ...m });
  const itemsOf = (rows: Obj[], url: URL, expand: string[], fields: string[]) => {
    const out = page(rows.map((r) => items.find((x) => x.id === r.issue)).filter(Boolean) as Obj[], url);
    return out instanceof Response ? out : { ...out, results: out.results.map((it) => pick(expandItem(it, expand), fields)) };
  };

  function readPlanning(p: Obj, seg: string[], url: URL, expand: string[], fields: string[]): unknown {
    const isCycle = seg[2]!.endsWith("cycles");
    const all = (isCycle ? cycles : modules).filter((x) => x.project === p.id);
    if (seg[2]!.startsWith("archived-")) return seg.length === 3 ? page(all.filter((x) => x.archived_at).map(isCycle ? cycleOut : moduleOut), url) : html404();
    const live = all.filter((x) => !x.archived_at);
    if (seg.length === 3) {
      if (!isCycle) return page(live.map(moduleOut), url);
      const view = url.searchParams.get("cycle_view") ?? "all";
      const starts = (c: Obj) => (c.start_date ? Date.parse(c.start_date) : NaN);
      if (view === "current") return live.filter((c) => starts(c) <= now() && !ended(c)).map(cycleOut);
      const inView: Record<string, (c: Obj) => boolean> = { upcoming: (c) => starts(c) > now(), completed: ended, draft, incomplete: (c) => !ended(c) };
      return page(live.filter(inView[view] ?? (() => true)).map(cycleOut), url);
    }
    const x = live.find((c) => c.id === seg[3]);
    if (!x) return missing();
    if (seg.length === 4) return isCycle ? cycleOut(x) : moduleOut(x);
    if (seg.length === 5 && seg[4] === (isCycle ? "cycle-issues" : "module-issues")) return itemsOf((isCycle ? cycleIssues : moduleIssues).filter((r) => (isCycle ? r.cycle : r.module) === x.id), url, expand, fields);
    return html404();
  }

  /** Cycle dates are kept as Plane keeps them: the start at 00:00:01 and the end at 23:59:00 (in UTC here). */
  const cycleDate = (d: unknown, end: boolean) => (typeof d === "string" && d ? `${d.slice(0, 10)}T${end ? "23:59:00" : "00:00:01"}Z` : null);

  function writeCycle(p: Obj, seg: string[], method: string, body: Obj): unknown {
    if (seg[2] === "archived-cycles") {
      const c = cycles.find((x) => x.id === seg[3] && x.project === p.id && x.archived_at);
      if (!c || seg[4] !== "unarchive" || method !== "DELETE") return missing();
      c.archived_at = null; return noContent();
    }
    if (seg.length === 3 && method === "POST") {
      if (!body.project_id) return json(400, { non_field_errors: ["Project ID is required"] });
      if (projects.find((x) => x.id === body.project_id)?.cycle_view === false) return json(400, { non_field_errors: ["Cycles are not enabled for this project"] });
      if (!body.start_date !== !body.end_date) return json(400, { error: "Both start date and end date are either required or are to be null" });
      const c = api.cycle({ name: body.name, description: body.description ?? "", start_date: cycleDate(body.start_date, false), end_date: cycleDate(body.end_date, true), project: p.id });
      return json(201, c);
    }
    const c = cycles.find((x) => x.id === seg[3] && x.project === p.id);
    if (!c) return missing();
    if (seg.length === 4 && method === "PATCH") {
      if (c.archived_at) return json(400, { error: "Archived cycle cannot be edited" });
      if (p.cycle_view === false) return json(400, { non_field_errors: ["Cycles are not enabled for this project"] });
      if (ended(c)) return json(400, { error: "The Cycle has already been completed so it cannot be edited" });
      const next: Obj = { ...body };
      if ("start_date" in body) next.start_date = cycleDate(body.start_date, false);
      if ("end_date" in body) next.end_date = cycleDate(body.end_date, true);
      return Object.assign(c, next);
    }
    if (seg[4] === "cycle-issues") {
      if (seg.length === 5 && method === "POST") {
        if (!body.issues?.length) return json(400, { error: "Work items are required", code: "MISSING_WORK_ITEMS" });
        if (ended(c)) return json(400, { code: "CYCLE_COMPLETED", message: "The Cycle has already been completed so no new issues can be added" });
        // A work item is in at most one cycle: adding it here moves it out of any other.
        for (const id of body.issues) {
          const at = cycleIssues.findIndex((r) => r.issue === id);
          if (at >= 0) cycleIssues.splice(at, 1);
          cycleIssues.push(base({ issue: id, cycle: c.id, project: p.id }));
        }
        return cycleIssues.filter((r) => r.cycle === c.id);
      }
      const at = cycleIssues.findIndex((r) => r.cycle === c.id && r.issue === seg[5]);
      if (method !== "DELETE" || at < 0) return missing();
      cycleIssues.splice(at, 1); return noContent();
    }
    if (seg[4] === "transfer-issues" && method === "POST") {
      if (!ended(c) && !draft(c)) return json(400, { error: "The old cycle is not completed yet" });
      const target = cycles.find((x) => x.id === body.new_cycle_id && x.project === p.id);
      if (!target) return failed();
      if (ended(target)) return json(400, { error: "The cycle where the issues are transferred is already completed" });
      for (const r of cycleIssues.filter((r) => r.cycle === c.id)) if (["backlog", "unstarted", "started"].includes(stateLite(items.find((x) => x.id === r.issue)?.state)?.group ?? "")) r.cycle = target.id;
      return { message: "Success" };
    }
    if (seg[4] === "archive" && method === "POST") {
      if (!c.end_date) return failed();
      if (!ended(c)) return json(400, { error: "Only completed cycles can be archived" });
      c.archived_at = "2026-10-02T09:00:00.000000Z"; return noContent();
    }
    return json(405, { detail: `Method "${method}" not allowed.` });
  }

  const MODULE_FIELDS = ["name", "description", "start_date", "target_date", "status", "lead", "external_source", "external_id"];

  function writeModule(p: Obj, seg: string[], method: string, body: Obj): unknown {
    if (seg[2] === "archived-modules") {
      const m = modules.find((x) => x.id === seg[3] && x.project === p.id && x.archived_at);
      if (!m || seg[4] !== "unarchive" || method !== "DELETE") return missing();
      m.archived_at = null; return noContent();
    }
    const others = (id?: string) => modules.filter((x) => x.project === p.id && x.id !== id);
    const memberIds = members.get(p.id) ?? [];
    if (seg.length === 3 && method === "POST") {
      if (p.module_view === false) return json(400, { non_field_errors: ["Modules are not enabled for this project"] });
      const dup = others().find((x) => x.name === body.name);
      if (dup) return json(400, { id: dup.id, code: "MODULE_NAME_ALREADY_EXISTS", error: "Module with this name already exists", message: "Module with this name already exists" });
      return json(201, api.module({ ...body, members: (body.members ?? []).filter((id: string) => memberIds.includes(id)), project: p.id }));
    }
    const m = modules.find((x) => x.id === seg[3] && x.project === p.id);
    if (!m) return missing();
    if (seg.length === 4 && method === "PATCH") {
      if (m.archived_at) return json(400, { error: "Archived module cannot be edited" });
      if (p.module_view === false) return json(400, { non_field_errors: ["Modules are not enabled for this project"] });
      if (body.name && others(m.id).some((x) => x.name === body.name)) return json(400, { error: "Module with this name already exists" });
      Object.assign(m, body, Array.isArray(body.members) ? { members: body.members.filter((id: string) => memberIds.includes(id)) } : {});
      // Plane answers a module PATCH with its write serializer: no id, no counts, no members.
      return Object.fromEntries(MODULE_FIELDS.map((k) => [k, m[k] ?? null]));
    }
    if (seg[4] === "module-issues") {
      if (seg.length === 5 && method === "POST") {
        if (!body.issues?.length) return json(400, { error: "Issues are required" });
        // A work item can be in several modules; ids outside the Plane project are dropped silently.
        for (const id of body.issues) if (items.some((x) => x.id === id && x.project === p.id) && !moduleIssues.some((r) => r.module === m.id && r.issue === id)) moduleIssues.push(base({ issue: id, module: m.id, project: p.id }));
        return moduleIssues.filter((r) => r.module === m.id);
      }
      const at = moduleIssues.findIndex((r) => r.module === m.id && r.issue === seg[5]);
      if (method !== "DELETE" || at < 0) return missing();
      moduleIssues.splice(at, 1); return noContent();
    }
    if (seg[4] === "archive" && method === "POST") {
      if (!["completed", "cancelled"].includes(m.status)) return json(400, { error: "Only completed or cancelled modules can be archived" });
      m.archived_at = "2026-10-02T09:00:00.000000Z"; return noContent();
    }
    return json(405, { detail: `Method "${method}" not allowed.` });
  }

  const intakeOut = (r: Obj) => {
    const it = items.find((x) => x.id === r.issue)!;
    return { ...r, issue_detail: { ...it, description: {}, state: stateLite(it.state) } };
  };
  /** Plane hides intake items whose snooze has passed. */
  const visibleIntake = (p: Obj) => intake.filter((r) => r.project === p.id && (!r.snoozed_till || Date.parse(r.snoozed_till) >= now()));

  function readIntake(p: Obj, seg: string[], url: URL): unknown {
    if (seg.length === 3) return page(p.intake_view === false ? [] : visibleIntake(p).map(intakeOut), url);
    const r = p.intake_view === false ? undefined : visibleIntake(p).find((x) => x.issue === seg[3]);
    return r ? intakeOut(r) : missing();
  }

  function writeIntake(p: Obj, seg: string[], method: string, body: Obj): unknown {
    if (!intakeRows.has(p.id)) return p.intake_view === false ? json(400, { error: "Intake is not enabled for this project enable it through the project's api" }) : failed();
    if (seg.length === 3 && method === "POST") {
      const issue = body.issue ?? {};
      if (!issue.name) return json(400, { error: "Name is required" });
      if (issue.priority && !["urgent", "high", "medium", "low", "none"].includes(issue.priority)) return json(400, { error: "Invalid priority" });
      const r = api.intake({ project: p.id, name: issue.name, description_html: issue.description_html, priority: issue.priority });
      return json(201, intakeOut(r));
    }
    const r = intake.find((x) => x.project === p.id && x.issue === seg[3]);
    if (!r) return missing();
    if (method === "PATCH") {
      // Plane applies a status change only for a project Admin; for a Member it answers 200 with nothing changed.
      if (body.status !== undefined && p.member_role > 15) {
        if (body.status === 1) {
          const def = states.find((x) => x.project === p.id && x.default);
          if (!def) return json(400, { status: ["Cannot accept intake issue: No default state found for the project"] });
          items.find((x) => x.id === r.issue)!.state = def.id;
        }
        r.status = body.status;
        if (body.status === 0) r.snoozed_till = body.snoozed_till ?? null;
        if (body.status === 2) r.duplicate_to = body.duplicate_to ?? null;
      }
      return intakeOut(r);
    }
    return json(405, { detail: `Method "${method}" not allowed.` });
  }

  const SPECIAL = /^.*[&+,:;$^}{*=?@#|'<>.()%!-].*$/;

  function createProject(body: Obj): unknown {
    if (SPECIAL.test(String(body.name ?? "")) || SPECIAL.test(String(body.identifier ?? ""))) return json(400, { non_field_errors: ["Project name cannot contain special characters."] });
    if (projects.some((x) => x.name === body.name)) return json(409, { name: "The project name is already taken" });
    const identifier = String(body.identifier ?? "").toUpperCase();
    if (projects.some((x) => x.identifier === identifier)) return json(409, { identifier: "The project identifier is already taken" });
    // Plane's model defaults: cycles, modules and intake off; only a PATCH makes the Intake row. The creator is Admin.
    const p = api.project({ cycle_view: false, module_view: false, intake_view: false, page_view: true, ...body, identifier, member_role: 20 }, ["u-bot"]);
    intakeRows.delete(p.id);
    for (const [name, group, isDefault] of [["Backlog", "backlog", false], ["Todo", "unstarted", true], ["In Progress", "started", false], ["Done", "completed", false], ["Cancelled", "cancelled", false]] as const) api.state({ project: p.id, name, group, default: isDefault });
    return json(201, p);
  }

  function patchProject(p: Obj, body: Obj): unknown {
    if (p.archived_at) return json(400, { error: "Archived project cannot be updated" });
    Object.assign(p, body);
    if (body.intake_view === true) intakeRows.add(p.id);
    return p;
  }

  function writeStateOrLabel(p: Obj, seg: string[], method: string, body: Obj): unknown {
    const isState = seg[2] === "states";
    const list = isState ? states : labels;
    if (seg.length === 3 && method === "POST") {
      if (isState && body.group === "triage") return json(400, { non_field_errors: ["Cannot create triage state"] });
      const dup = list.find((x) => x.project === p.id && x.name === body.name);
      if (dup) return json(409, { error: `${isState ? "State" : "Label"} with the same name already exists in the project`, id: dup.id });
      // Plane answers a state create with 200 and a label create with 201.
      return isState ? api.state({ ...body, project: p.id }) : json(201, api.label({ ...body, project: p.id }));
    }
    const x = list.find((y) => y.id === seg[3] && y.project === p.id);
    if (!x) return missing();
    if (seg.length === 4 && method === "PATCH") {
      if (body.name && list.some((y) => y.project === p.id && y.id !== x.id && y.name === body.name)) return json(400, { error: "The payload is not valid" });
      return Object.assign(x, body, { updated_at: "2026-10-02T09:00:00.000000Z" });
    }
    return json(405, { detail: `Method "${method}" not allowed.` });
  }

  s.http.on(new RegExp(`^[A-Z]+ https://${host.replace(/\./g, "\\.")}/api/v1/`), respond);
  // The presigned upload, at either scheme so a test sees which one was used. Its body is recorded as the form's keys in order and the file.
  const upload = new URL(uploadUrl);
  s.http.on(new RegExp(`^POST https?://${upload.host.replace(/\./g, "\\.")}${upload.pathname}$`), async (req) => {
    const form = req.body as FormData;
    const file = form.get("file") as File | null;
    writes.push({ method: "POST", path: req.url, body: { keys: [...form.keys()], file: file && { name: file.name, type: file.type, text: await file.text() } } });
    return new Response(null, { status: 204 });
  });

  const base = (o: Obj): Obj => ({ id: uuid(), created_at: STAMP, updated_at: STAMP, deleted_at: null, ...o });
  const api = {
    writes,
    user(o: Obj): Obj { const u = { avatar: "", avatar_url: null, first_name: "", last_name: "", email: "", ...o }; users.push(u); return u; },
    /** `member_role` is the account's Plane user's role in it: 15 Member (the default) or 20 Admin. Intake on comes with its Intake row. */
    project(o: Obj, memberIds: string[] = []) {
      const p = base({ name: "Project", identifier: "PRJ", description: "", network: 2, is_member: true, member_role: 15, archived_at: null, cycle_view: true, module_view: true, intake_view: false, timezone: "UTC", project_lead: null, default_state: null, total_members: memberIds.length, total_cycles: 0, total_modules: 0, ...o });
      projects.push(p); members.set(p.id, memberIds);
      if (p.intake_view) intakeRows.add(p.id);
      return p;
    },
    /** A cycle, with dates as Plane renders them (ISO datetimes) or none for a draft, holding the work items `itemIds`. */
    cycle(o: Obj, itemIds: string[] = []) {
      const c = base({ name: "Cycle", description: "", start_date: null, end_date: null, archived_at: null, owned_by: "u-bot", created_by: "u-bot", workspace: "ws-1", timezone: "UTC", ...o });
      cycles.push(c);
      for (const id of itemIds) cycleIssues.push(base({ issue: id, cycle: c.id, project: c.project }));
      return c;
    },
    module(o: Obj, itemIds: string[] = []) {
      const m = base({ name: "Module", description: "", description_text: null, description_html: null, start_date: null, target_date: null, status: "planned", lead: null, members: [], archived_at: null, created_by: "u-bot", workspace: "ws-1", ...o });
      modules.push(m);
      for (const id of itemIds) moduleIssues.push(base({ issue: id, module: m.id, project: m.project }));
      return m;
    },
    /** An intake item: a work item in the Plane project's triage state, with status -2 (pending) unless given. */
    intake(o: Obj & { project: string; name: string }) {
      const triage = states.find((x) => x.project === o.project && x.group === "triage") ?? api.state({ project: o.project, name: "Triage", group: "triage", is_triage: true, color: "#4E5355" });
      const seq = o.sequence_id ?? Math.max(0, ...items.filter((x) => x.project === o.project).map((x) => x.sequence_id)) + 1;
      const it = api.item({ project: o.project, name: o.name, sequence_id: seq, state: triage.id, description_html: o.description_html ?? "<p></p>", priority: o.priority ?? "none" });
      const r = base({ issue: it.id, project: o.project, intake: `in-${o.project.slice(0, 8)}`, status: o.status ?? -2, snoozed_till: null, duplicate_to: null, source: "IN_APP", source_email: null, created_by: "u-bot", workspace: "ws-1" });
      intake.push(r); return r;
    },
    /** What a test asserts on after a write. */
    projects,
    cycleOf: (itemId: string): string | null => cycleIssues.find((r) => r.issue === itemId)?.cycle ?? null,
    modulesOf: (itemId: string): string[] => moduleIssues.filter((r) => r.issue === itemId).map((r) => r.module),
    find: {
      project: (id: string) => projects.find((x) => x.id === id), cycle: (id: string) => cycles.find((x) => x.id === id), module: (id: string) => modules.find((x) => x.id === id),
      item: (id: string) => items.find((x) => x.id === id), intake: (itemId: string) => intake.find((x) => x.issue === itemId),
      state: (project: string, name: string) => states.find((x) => x.project === project && x.name === name), label: (project: string, name: string) => labels.find((x) => x.project === project && x.name === name),
    },
    state(o: Obj) { const st = base({ name: "Todo", color: "#888888", group: "unstarted", default: false, sequence: 1000, is_triage: false, ...o }); states.push(st); return st; },
    label(o: Obj) { const l = base({ name: "label", color: "#EF4444", parent: null, description: "", ...o }); labels.push(l); return l; },
    item(o: Obj) {
      const it = base({ name: "Work item", description_html: "<p></p>", description_binary: "AAEC", priority: "none", start_date: null, target_date: null, sequence_id: items.length + 1, completed_at: null, archived_at: null, is_draft: false, created_by: "u-bot", parent: null, state: null, assignees: [], labels: [], workspace: "ws-1", ...o });
      items.push(it); return it;
    },
    comment(o: Obj) { const c = base({ comment_html: "<p></p>", access: "INTERNAL", attachments: [], edited_at: null, actor: "u-bot", created_by: "u-bot", ...o }); comments.push(c); return c; },
    activity(o: Obj) { const a = base({ verb: "updated", field: null, old_value: null, new_value: null, comment: "", attachments: [], old_identifier: null, new_identifier: null, actor: "u-bot", ...o }); activities.push(a); return a; },
    link(o: Obj) { const l = base({ title: "", url: "https://example.com", metadata: {}, ...o }); links.push(l); return l; },
    attachment(o: Obj) { const a = base({ attributes: { name: "file.txt", type: "text/plain", size: 10 }, asset: "ws-1/abc-file.txt", entity_type: "ISSUE_ATTACHMENT", is_uploaded: true, size: 10, storage_metadata: {}, ...o }); attachments.push(a); return a; },
    relate(itemId: string, rel: Obj) { relations.set(itemId, rel); },
  };
  return api;
}
