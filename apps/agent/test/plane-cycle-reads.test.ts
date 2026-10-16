import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

// Plane is faked at fetch in the shapes Plane v1.3.1 answers with (cycles, modules, intake, workspace members and invitations).

const ENG = "11111111-1111-4111-8111-111111111111", SEC = "33333333-3333-4333-8333-333333333333";
const API = "api.plane.so/api/v1/workspaces/acme";
const envelope = (results: unknown[], next = false, cursor = "100:1:0") => ({
  grouped_by: null, sub_grouped_by: null, total_count: results.length, next_cursor: cursor, prev_cursor: "100:-1:1", next_page_results: next, prev_page_results: false,
  count: results.length, total_pages: 1, total_results: results.length, extra_stats: null, results,
});
const project = (over: Record<string, unknown> = {}) => ({ id: ENG, name: "Engineering", identifier: "ENG", cycle_view: true, module_view: true, intake_view: true, archived_at: null, ...over });
const cycle = (id: string, name: string, start: string | null, end: string | null) => ({
  id, total_issues: 12, cancelled_issues: 0, completed_issues: 5, started_issues: 3, unstarted_issues: 2, backlog_issues: 2,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", deleted_at: null, name, description: "",
  start_date: start, end_date: end, view_props: {}, sort_order: 65535.0, external_source: null, external_id: null, progress_snapshot: {}, archived_at: null,
  logo_props: {}, timezone: "UTC", version: 1, created_by: "u-bot", updated_by: null, project: ENG, workspace: "w-1", owned_by: "u-bot",
});
const SPRINT = "dd440000-0000-4000-8000-000000000001", NEXT = "dd440000-0000-4000-8000-000000000002";

/** Runs one tool call through the bot and returns what the tool answered. */
async function ask(s: any, tool: string, args: Record<string, unknown> = {}) {
  let result: any;
  s.model.script({ tool, args }, (turn: any) => { result = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} ${tool}`);
  return result;
}

discordScenario("cycleList reads the current cycle from Plane's unpaginated list, and the other views across pages", async (s) => {
  await s.plane({ projects: [ENG] });
  s.http.on(`GET ${API}/projects/`, () => envelope([project(), project({ id: SEC, name: "Secret", identifier: "SEC" })]));
  s.http.on(`GET ${API}/projects/${ENG}/`, () => project());
  s.http.on(`GET ${API}/projects/${ENG}/cycles/`, (req) => {
    const url = new URL(req.url);
    if (url.searchParams.get("cycle_view") === "current") return [cycle(SPRINT, "Sprint 42", "2026-10-13T00:00:01Z", "2026-10-26T23:59:00Z")];
    if (!url.searchParams.get("cursor")) return envelope([cycle(SPRINT, "Sprint 42", "2026-10-13T00:00:01Z", "2026-10-26T23:59:00Z")], true);
    return envelope([cycle(NEXT, "Sprint 43", "2026-10-27T00:00:01Z", "2026-11-09T23:59:00Z")]);
  });

  const current = await ask(s, "cycleList", { project: ENG, view: "current" });
  expect(current.project).toEqual({ id: ENG, identifier: "ENG", name: "Engineering" });
  expect(current.cycles).toEqual([{
    id: SPRINT, name: "Sprint 42", description: "", startDate: "2026-10-13T00:00:01Z", endDate: "2026-10-26T23:59:00Z",
    workItems: { total: 12, backlog: 2, unstarted: 2, started: 3, completed: 5, cancelled: 0 },
  }]);

  const all = await ask(s, "cycleList", { project: "eng" });
  expect(all.cycles.map((c: any) => c.name)).toEqual(["Sprint 42", "Sprint 43"]);
  const lists = s.http.requests.filter((r) => r.url.includes("/cycles/"));
  expect(lists.map((r) => new URL(r.url).searchParams.get("cycle_view"))).toEqual(["current", "all", "all"]);
});

const BUDI = { id: "u-budi", first_name: "Budi", last_name: "Santoso", email: "budi@example.com", avatar: "", avatar_url: null, display_name: "budi" };
const workItem = (seq: number, name: string, state: { name: string; group: string }, assignees: unknown[] = []) => ({
  id: `9a8b0000-0000-4000-8000-0000000000${seq}`, name, sequence_id: seq, priority: "high", assignees,
  state: { id: `s-${state.name}`, name: state.name, color: "#000", group: state.group },
});

discordScenario("cycleGet finds a cycle by its name, and cycleItems lists its work items with key, title, state and assignees", async (s) => {
  await s.plane({ projects: [ENG] });
  s.http.on(`GET ${API}/projects/${ENG}/`, () => project());
  s.http.on(`GET ${API}/projects/${ENG}/cycles/`, () => envelope([cycle(SPRINT, "Sprint 42", "2026-10-13T00:00:01Z", "2026-10-26T23:59:00Z"), cycle(NEXT, "Sprint 43", null, null)]));
  s.http.on(`GET ${API}/projects/${ENG}/cycles/${SPRINT}/`, () => cycle(SPRINT, "Sprint 42", "2026-10-13T00:00:01Z", "2026-10-26T23:59:00Z"));
  s.http.on(`GET ${API}/projects/${ENG}/cycles/${SPRINT}/cycle-issues/`, () => envelope([
    workItem(42, "Fix login redirect", { name: "In Progress", group: "started" }, [BUDI]),
    workItem(43, "Write release notes", { name: "Todo", group: "unstarted" }),
  ]));

  const got = await ask(s, "cycleGet", { project: ENG, cycle: "sprint 42" });
  expect(got.cycle.id).toBe(SPRINT);
  expect(got.cycle.workItems.completed).toBe(5);

  const items = await ask(s, "cycleItems", { project: ENG, cycle: SPRINT });
  expect(items.cycle).toEqual({ id: SPRINT, name: "Sprint 42" });
  expect(items.workItems.map(({ key, title, state, assignees }: any) => ({ key, title, state, assignees }))).toEqual([
    { key: "ENG-42", title: "Fix login redirect", state: "In Progress", assignees: ["budi"] },
    { key: "ENG-43", title: "Write release notes", state: "Todo", assignees: [] },
  ]);
  const read = s.http.requests.find((r) => r.url.includes("/cycle-issues/"))!;
  expect(new URL(read.url).searchParams.get("expand")).toBe("state,assignees");
});

discordScenario("a Plane project outside the channel's scope is refused before Plane is asked about it", async (s) => {
  await s.plane({ projects: [ENG] });
  s.http.on(`GET ${API}/projects/`, () => envelope([project(), project({ id: SEC, name: "Secret", identifier: "SEC" })]));
  for (const [tool, args] of [["cycleList", { project: SEC }], ["moduleList", { project: "SEC" }], ["intakeList", { project: SEC }], ["cycleItems", { project: SEC, cycle: SPRINT }]] as const) {
    const result = await ask(s, tool, args);
    expect(JSON.stringify(result)).toContain("is not open in this channel");
  }
  expect(s.http.requests.filter((r) => r.url.includes(SEC))).toEqual([]);
});

const BILLING = "ee550000-0000-4000-8000-000000000001";
const mod = { id: BILLING, members: ["u-budi"], total_issues: 8, cancelled_issues: 0, completed_issues: 2, started_issues: 4, unstarted_issues: 1, backlog_issues: 1,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", deleted_at: null, name: "Billing v2", description: "", description_text: null, description_html: null,
  start_date: "2026-10-01", target_date: "2026-11-15", status: "in-progress", view_props: {}, sort_order: 65535.0, external_source: null, external_id: null, archived_at: null,
  logo_props: {}, created_by: "u-bot", updated_by: null, project: ENG, workspace: "w-1", lead: "u-budi" };

discordScenario("moduleList, moduleGet and moduleItems read a Plane project's modules and the work items in one", async (s) => {
  await s.plane({ projects: [ENG] });
  s.http.on(`GET ${API}/projects/${ENG}/`, () => project());
  s.http.on(`GET ${API}/projects/${ENG}/modules/`, () => envelope([mod]));
  s.http.on(`GET ${API}/projects/${ENG}/modules/${BILLING}/`, () => mod);
  s.http.on(`GET ${API}/projects/${ENG}/modules/${BILLING}/module-issues/`, () => envelope([workItem(44, "Invoice PDF", { name: "Done", group: "completed" }, [BUDI])]));

  const list = await ask(s, "moduleList", { project: ENG });
  expect(list.modules).toEqual([{ id: BILLING, name: "Billing v2", status: "in-progress", description: "", startDate: "2026-10-01", targetDate: "2026-11-15",
    workItems: { total: 8, backlog: 1, unstarted: 1, started: 4, completed: 2, cancelled: 0 } }]);
  expect((await ask(s, "moduleGet", { project: ENG, module: BILLING })).module.name).toBe("Billing v2");
  const items = await ask(s, "moduleItems", { project: ENG, module: "billing v2" });
  expect(items.module).toEqual({ id: BILLING, name: "Billing v2" });
  expect(items.workItems.map(({ key, title, state, assignees }: any) => ({ key, title, state, assignees }))).toEqual([{ key: "ENG-44", title: "Invoice PDF", state: "Done", assignees: ["budi"] }]);
});

const intakeItem = (seq: number, name: string, status: number) => ({
  id: `ff660000-0000-4000-8000-0000000000${seq}`, inbox: "i-1", status, snoozed_till: null, source: "IN_APP", source_email: null, external_source: null, external_id: null, extra: {},
  created_at: "2026-10-15T08:00:00Z", updated_at: "2026-10-15T08:00:00Z", deleted_at: null, created_by: "u-bot", updated_by: null, project: ENG, workspace: "w-1", intake: "i-1",
  issue: `9a8b0000-0000-4000-8000-0000000000${seq}`, duplicate_to: null,
  issue_detail: { id: `9a8b0000-0000-4000-8000-0000000000${seq}`, name, description: {}, description_html: "<p>Clicking <strong>Export</strong> does nothing.</p><ul><li>Safari 18</li></ul>", priority: "none",
    state: { id: "tr00", name: "Triage", color: "#4E5355", group: "triage" }, labels: [], assignees: [], sequence_id: seq, project: ENG, workspace: "w-1", start_date: null, target_date: null },
});

discordScenario("intakeList lists a Plane project's intake with its triage status, and intakeGet reads one by key", async (s) => {
  await s.plane({ projects: [ENG] });
  s.http.on(`GET ${API}/projects/${ENG}/`, () => project());
  s.http.on(`GET ${API}/projects/${ENG}/intake-issues/`, () => envelope([intakeItem(57, "Export fails on Safari", -2), intakeItem(58, "Dark mode", 1)]));

  const list = await ask(s, "intakeList", { project: ENG });
  expect(list.intake.map(({ key, title, status }: any) => ({ key, title, status }))).toEqual([
    { key: "ENG-57", title: "Export fails on Safari", status: "pending" },
    { key: "ENG-58", title: "Dark mode", status: "accepted" },
  ]);
  expect(list.note).toBeUndefined();

  const got = await ask(s, "intakeGet", { project: ENG, workItem: "ENG-57" });
  expect(got.item).toMatchObject({ key: "ENG-57", title: "Export fails on Safari", status: "pending", state: "Triage", description: "Clicking Export does nothing.\n- Safari 18" });
});

discordScenario("intakeList answers an empty list with a note when the Plane project has intake switched off", async (s) => {
  await s.plane({ projects: ["*"] });
  s.http.on(`GET ${API}/projects/${ENG}/`, () => project({ intake_view: false }));
  s.http.on(`GET ${API}/projects/${ENG}/intake-issues/`, () => envelope([]));
  const list = await ask(s, "intakeList", { project: ENG });
  expect(list.intake).toEqual([]);
  expect(list.note).toBe("Intake is switched off in the Plane project ENG.");
});

discordScenario("workspace tools are offered only where the scope is all Plane projects, and read the Plane workspace's members and invitations", async (s) => {
  const { repositories } = await import("../../../packages/db/src/index.ts");
  const acc = await s.plane({ projects: ["*"] });
  s.http.on(`GET ${API}/members/`, () => [{ ...BUDI, role: 15 }, { id: "u-bot", first_name: "Plane", last_name: "Bot", email: "bot@acme.test", avatar: "", avatar_url: null, display_name: "pachibot", role: 20 }]);
  s.http.on(`GET ${API}/invitations/`, () => [{ id: "inv-1", email: "sari@example.com", role: 5, created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z", responded_at: null, accepted: false }]);

  const members = await ask(s, "workspaceMembers");
  expect(members.members).toEqual([{ id: "u-budi", displayName: "budi", name: "Budi Santoso", role: "Member" }, { id: "u-bot", displayName: "pachibot", name: "Plane Bot", role: "Admin" }]);
  const invitations = await ask(s, "workspaceInvitations");
  expect(invitations.invitations).toEqual([{ id: "inv-1", email: "sari@example.com", role: "Guest", invitedAt: "2026-10-10T00:00:00Z", accepted: false, respondedAt: null }]);
  expect(s.model.tools.at(-1)).toEqual(expect.arrayContaining(["workspaceMembers", "workspaceInvitations", "cycleList"]));

  // A channel rule naming one Plane project narrows the scope there: the workspace tools are not offered, and a call is refused.
  await repositories().plane.replaceScopes(s.tenant.id, s.bot.id, "guild-1", "channel-2", [{ planeAccountId: acc.id, projectIds: [ENG] }]);
  s.discord.channel("channel-2");
  const before = s.http.requests.length;
  let refused: any;
  s.model.script({ tool: "workspaceMembers" }, (turn) => { refused = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} who is in the Plane workspace?`, { channel: "channel-2" });
  const offered = s.model.tools.at(-1)!;
  expect(offered).toContain("cycleList");
  expect(offered).not.toContain("workspaceMembers");
  expect(offered).not.toContain("workspaceInvitations");
  expect(JSON.stringify(refused)).toContain("unavailable here");
  expect(s.http.requests.length).toBe(before);
});
