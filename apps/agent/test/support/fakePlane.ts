/**
 * A fake Plane v1.3.1 `/api/v1/` for the Discord scenario harness, answering in the shapes the v1.3.1 source produces:
 * the pagination envelope (`per_page`, `cursor` "<per_page>:<page>:0", `next_page_results`), plain arrays where Plane
 * answers with one, `expand=` on work items, and get-by-key matching the project identifier case-sensitively.
 *
 *   const plane = fakePlane(s);           // after s.plane(...)
 *   plane.project({ id: P1, identifier: "ENG", name: "Engineering" });
 *   plane.item({ project: P1, sequence_id: 42, name: "Fix login", state: S1 });
 *
 * Writes are not modelled yet; `plane.requests` holds the Plane requests seen, after the harness's own `s.http.requests`.
 */
import type { HttpRequest } from "./discordScenario";

type Obj = Record<string, any>;
type Scenario = { http: { on(match: RegExp, respond: (req: HttpRequest) => unknown): void } };

export const STAMP = "2026-10-01T09:00:00.000000Z";

export function fakePlane(s: Scenario, { host = "api.plane.so", slug = "acme" } = {}) {
  const projects: Obj[] = [], states: Obj[] = [], labels: Obj[] = [], users: Obj[] = [], items: Obj[] = [];
  const members = new Map<string, string[]>();
  const comments: Obj[] = [], activities: Obj[] = [], links: Obj[] = [], attachments: Obj[] = [];
  const relations = new Map<string, Obj>();
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
    if (req.method !== "GET") return json(405, { detail: `Method "${req.method}" not allowed.` });

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
    switch (seg[4]) {
      case "comments": return page(of(comments).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((c) => (expand.includes("actor") ? { ...c, actor: userLite(c.actor) } : c)), url);
      case "activities": return page(of(activities).sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).map((a) => (expand.includes("actor") ? { ...a, actor: userLite(a.actor) } : a)), url);
      case "links": return page(of(links), url);
      case "attachments": return of(attachments);
      case "relations": return { blocking: [], blocked_by: [], duplicate: [], relates_to: [], start_after: [], start_before: [], finish_after: [], finish_before: [], ...relations.get(it.id) };
      default: return html404();
    }
  }

  s.http.on(new RegExp(`^[A-Z]+ https://${host.replace(/\./g, "\\.")}/api/v1/`), respond);

  const base = (o: Obj) => ({ id: uuid(), created_at: STAMP, updated_at: STAMP, deleted_at: null, ...o });
  return {
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
}
