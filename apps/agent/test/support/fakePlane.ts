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
    const p = seg[0] === "projects" ? projects.find((x) => x.id === seg[1]) : undefined;
    if (!p) return missing();
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

  s.http.on(new RegExp(`^[A-Z]+ https://${host.replace(/\./g, "\\.")}/api/v1/`), respond);
  // The presigned upload, at either scheme so a test sees which one was used. Its body is recorded as the form's keys in order and the file.
  const upload = new URL(uploadUrl);
  s.http.on(new RegExp(`^POST https?://${upload.host.replace(/\./g, "\\.")}${upload.pathname}$`), async (req) => {
    const form = req.body as FormData;
    const file = form.get("file") as File | null;
    writes.push({ method: "POST", path: req.url, body: { keys: [...form.keys()], file: file && { name: file.name, type: file.type, text: await file.text() } } });
    return new Response(null, { status: 204 });
  });

  const base = (o: Obj) => ({ id: uuid(), created_at: STAMP, updated_at: STAMP, deleted_at: null, ...o });
  const api = {
    writes,
    user(o: Obj): Obj { const u = { avatar: "", avatar_url: null, first_name: "", last_name: "", email: "", ...o }; users.push(u); return u; },
    project(o: Obj, memberIds: string[] = []) {
      const p = base({ name: "Project", identifier: "PRJ", description: "", network: 2, is_member: true, member_role: 15, archived_at: null, cycle_view: true, module_view: true, intake_view: false, timezone: "UTC", project_lead: null, default_state: null, total_members: memberIds.length, total_cycles: 0, total_modules: 0, ...o });
      projects.push(p); members.set(p.id, memberIds); return p;
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
