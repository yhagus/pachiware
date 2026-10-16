import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { fakePlane } from "./support/fakePlane";

// Plane is faked at fetch in the shapes Plane v1.3.1 answers with; "plane-key" is the key s.plane() saves.

const P1 = "11111111-1111-4111-8111-111111111111", P2 = "22222222-2222-4222-8222-222222222222", P3 = "33333333-3333-4333-8333-333333333333";

/** Two Plane projects open here (ENG, DES) and one that is not (SEC), with Budi and Sari as members of ENG. */
function world(plane: ReturnType<typeof fakePlane>) {
  const budi = plane.user({ id: "u-budi", first_name: "Budi", last_name: "Santoso", display_name: "budi", email: "budi@acme.test" });
  const sari = plane.user({ id: "u-sari", first_name: "Sari", last_name: "Dewi", display_name: "sari", email: "sari@acme.test" });
  plane.user({ id: "u-bot", first_name: "Plane", last_name: "Bot", display_name: "pachibot", email: "bot@acme.test" });
  const eng = plane.project({ id: P1, name: "Engineering", identifier: "ENG" }, [budi.id, sari.id, "u-bot"]);
  const des = plane.project({ id: P2, name: "Design", identifier: "DES" }, [sari.id]);
  const sec = plane.project({ id: P3, name: "Secret", identifier: "SEC" });
  const todo = plane.state({ project: P1, name: "Todo", group: "unstarted", default: true });
  const doing = plane.state({ project: P1, name: "In Progress", group: "started" });
  const done = plane.state({ project: P1, name: "Done", group: "completed" });
  const bug = plane.label({ project: P1, name: "bug" });
  const ui = plane.label({ project: P1, name: "ui" });
  return { budi, sari, eng, des, sec, todo, doing, done, bug, ui };
}

async function ask(s: any, tool: string, args: Record<string, unknown>) {
  let result: any;
  s.model.script({ tool, args }, (turn: any) => { result = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} ${tool}`);
  return result;
}

discordScenario("workItemGet reads a work item by its key, with the description as Markdown and names instead of ids", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  const w = world(plane);
  const parent = plane.item({ project: P1, sequence_id: 7, name: "SSO epic" });
  const item = plane.item({
    project: P1, sequence_id: 42, name: "Fix login redirect", priority: "high", state: w.doing.id, assignees: [w.budi.id], labels: [w.bug.id],
    start_date: "2026-10-14", target_date: "2026-10-20", parent: parent.id, created_by: w.sari.id,
    description_html: `<p>Users land on <strong>/404</strong> after SSO.</p><ul><li>Safari only</li></ul><img src="https://bucket.s3.amazonaws.com/x.png?X-Amz-Signature=abc" alt="shot">`,
  });
  plane.activity({ issue: item.id, field: "cycles", verb: "updated", new_value: "Sprint 41", new_identifier: "c-41" });
  plane.activity({ issue: item.id, field: "cycles", verb: "updated", old_value: "Sprint 41", new_value: "Sprint 42", new_identifier: "c-42" });
  plane.activity({ issue: item.id, field: "modules", verb: "updated", new_value: "Billing v2", new_identifier: "m-1" });
  plane.activity({ issue: item.id, field: "modules", verb: "updated", new_value: "Auth", new_identifier: "m-2" });
  plane.activity({ issue: item.id, field: "modules", verb: "deleted", old_value: "Billing v2", old_identifier: "m-1" });

  const result = await ask(s, "workItemGet", { item: "eng-42" });
  expect(result).toMatchObject({
    key: "ENG-42", id: item.id, name: "Fix login redirect", project: { id: P1, identifier: "ENG", name: "Engineering" },
    state: { name: "In Progress", group: "started" }, priority: "high", assignees: ["Budi Santoso (budi)"], labels: ["bug"],
    startDate: "2026-10-14", targetDate: "2026-10-20", parent: { key: "ENG-7" }, createdBy: "Sari Dewi (sari)", cycle: "Sprint 42", modules: ["Auth"],
  });
  expect(result.description).toContain("Users land on **/404** after SSO.");
  expect(result.description).toContain("Safari only");
  const out = JSON.stringify(result);
  expect(out).not.toContain("<p>");
  expect(out).not.toContain("X-Amz-Signature");
  expect(out).not.toContain("plane-key");
  expect(s.http.requests.some((r) => r.url.includes("/work-items/ENG-42/"))).toBe(true);
});

discordScenario("a work item in a Plane project outside the scope is refused before Plane is asked for it; an id needs its Plane project", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  world(plane);
  const secret = plane.item({ project: P3, sequence_id: 1, name: "Layoffs plan" });
  const item = plane.item({ project: P1, sequence_id: 5, name: "Small fix" });

  const refused = await ask(s, "workItemGet", { item: "SEC-1" });
  expect(JSON.stringify(refused)).toContain(`Plane project \\"SEC\\" is not open in this channel`);
  const byIdElsewhere = await ask(s, "workItemGet", { item: secret.id, project: "Secret" });
  expect(JSON.stringify(byIdElsewhere)).toContain("is not open in this channel");
  expect(s.http.requests.some((r) => r.url.includes("SEC-1") || r.url.includes(secret.id))).toBe(false);

  expect(JSON.stringify(await ask(s, "workItemGet", { item: item.id }))).toContain(`needs \\"project\\"`);
  expect(await ask(s, "workItemGet", { item: item.id, project: "eng" })).toMatchObject({ key: "ENG-5", name: "Small fix" });
  expect(JSON.stringify(await ask(s, "workItemGet", { item: "ENG-404" }))).toContain("ENG-404 was not found");
});

discordScenario("workItemSearch uses Plane's workspace-wide search and drops results outside the scope; an exact key comes first", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  world(plane);
  plane.item({ project: P3, sequence_id: 42, name: "Login audit (secret)" });
  plane.item({ project: P2, sequence_id: 42, name: "Login screen mockups" });
  plane.item({ project: P1, sequence_id: 42, name: "Fix login redirect" });
  plane.item({ project: P1, sequence_id: 43, name: "Unrelated" });

  const hits = await ask(s, "workItemSearch", { query: "login" });
  expect(hits.items.map((i: any) => i.key).sort()).toEqual(["DES-42", "ENG-42"]);
  expect(JSON.stringify(hits)).not.toContain("secret");
  const search = s.http.requests.find((r) => r.url.includes("/work-items/search/"))!;
  expect(new URL(search.url).searchParams.get("workspace_search")).toBe("true");

  const byKey = await ask(s, "workItemSearch", { query: "ENG-42" });
  expect(byKey.items[0]).toMatchObject({ key: "ENG-42", name: "Fix login redirect", project: "ENG" });
  expect(byKey.items.map((i: any) => i.key)).not.toContain("SEC-42");

  const inDesign = await ask(s, "workItemSearch", { query: "login", project: "DES" });
  expect(inDesign.items.map((i: any) => i.key)).toEqual(["DES-42"]);
  expect(JSON.stringify(await ask(s, "workItemSearch", { query: "login", project: "SEC" }))).toContain("is not open in this channel");
});

discordScenario("workItemList filters on our side by state group, state, assignee, label, priority, change date and text, newest change first", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  const w = world(plane);
  const desTodo = plane.state({ project: P2, name: "Todo", group: "unstarted" });
  plane.item({ project: P1, sequence_id: 1, name: "Login loops", state: w.doing.id, assignees: [w.budi.id], labels: [w.bug.id], priority: "high", updated_at: "2026-10-15T10:00:00.000000Z" });
  plane.item({ project: P1, sequence_id: 2, name: "Old login bug", state: w.todo.id, assignees: [w.budi.id, w.sari.id], labels: [w.bug.id, w.ui.id], priority: "low", updated_at: "2026-09-01T10:00:00.000000Z" });
  plane.item({ project: P1, sequence_id: 3, name: "Shipped", state: w.done.id, assignees: [w.budi.id], updated_at: "2026-10-16T08:00:00.000000Z" });
  plane.item({ project: P1, sequence_id: 4, name: "Nobody's", state: w.todo.id, updated_at: "2026-10-10T08:00:00.000000Z" });
  plane.item({ project: P2, sequence_id: 1, name: "Mockups", state: desTodo.id, assignees: [w.sari.id], updated_at: "2026-10-12T08:00:00.000000Z" });
  plane.item({ project: P3, sequence_id: 1, name: "Secret", assignees: [w.budi.id], updated_at: "2026-10-16T09:00:00.000000Z" });
  const keys = (r: any) => r.items.map((i: any) => i.key);

  const budiOpen = await ask(s, "workItemList", { assignee: "Budi", stateGroup: "open" });
  expect(keys(budiOpen)).toEqual(["ENG-1", "ENG-2"]);
  expect(budiOpen.items[0]).toMatchObject({ key: "ENG-1", name: "Login loops", state: "In Progress", priority: "high", assignees: ["Budi Santoso (budi)"], labels: ["bug"] });
  expect(budiOpen.stoppedEarly).toBeUndefined();
  expect(s.http.requests.some((r) => r.url.includes(`/projects/${P3}/`))).toBe(false);
  const list = s.http.requests.find((r) => r.url.includes(`/projects/${P1}/work-items/`))!;
  expect(new URL(list.url).searchParams.get("order_by")).toBe("-updated_at");
  expect(new URL(list.url).searchParams.get("per_page")).toBe("1000");

  expect(keys(await ask(s, "workItemList", { project: "ENG", label: "ui" }))).toEqual(["ENG-2"]);
  expect(keys(await ask(s, "workItemList", { project: "ENG", priority: "high" }))).toEqual(["ENG-1"]);
  expect(keys(await ask(s, "workItemList", { project: "ENG", state: "done" }))).toEqual(["ENG-3"]);
  expect(keys(await ask(s, "workItemList", { project: "ENG", assignee: "none" }))).toEqual(["ENG-4"]);
  expect(keys(await ask(s, "workItemList", { changedSince: "2026-10-11" }))).toEqual(["ENG-3", "ENG-1", "DES-1"]);
  expect(keys(await ask(s, "workItemList", { text: "login" }))).toEqual(["ENG-1", "ENG-2"]);
  expect(keys(await ask(s, "workItemList", { assignee: "sari@acme.test" }))).toEqual(["DES-1", "ENG-2"]);
  expect(JSON.stringify(await ask(s, "workItemList", { assignee: "me" }))).toContain("name the person");
  expect(JSON.stringify(await ask(s, "workItemList", { project: "SEC" }))).toContain("is not open in this channel");
});

discordScenario("workItemList reads at most 2 pages of 1000 per Plane project and at most 20 Plane projects, and says when it stopped early", async (s) => {
  await s.plane({ projects: ["*"] });
  const plane = fakePlane(s);
  const ids = Array.from({ length: 22 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i + 1).padStart(12, "0")}`);
  ids.forEach((id, i) => plane.project({ id, name: `Team ${i + 1}`, identifier: `T${i + 1}` }));
  plane.project({ id: P3, name: "Old", identifier: "OLD", archived_at: "2026-01-01T00:00:00Z" });
  for (let n = 1; n <= 2001; n++) plane.item({ project: ids[0], sequence_id: n, name: `Item ${n}`, updated_at: `2026-10-${String(1 + (n % 15)).padStart(2, "0")}T00:00:00.000000Z` });
  plane.item({ project: ids[1], sequence_id: 1, name: "Needle" });

  const result = await ask(s, "workItemList", { text: "needle" });
  expect(result.items.map((i: any) => i.key)).toEqual(["T2-1"]);
  expect(result.stoppedEarly).toContain("T1");
  expect(result.stoppedEarly).toContain("20 of 22");
  const t1Pages = s.http.requests.filter((r) => r.url.includes(`/projects/${ids[0]}/work-items/`));
  expect(t1Pages.length).toBe(2);
  expect(s.http.requests.some((r) => r.url.includes(`/projects/${ids[21]}/work-items/`))).toBe(false);
  expect(s.http.requests.some((r) => r.url.includes(`/projects/${P3}/work-items/`))).toBe(false);

  const capped = await ask(s, "workItemList", { project: "T1", limit: 5 });
  expect(capped.items.length).toBe(5);
  expect(capped.matched).toBe(2000);
  expect(capped.stoppedEarly).toContain("T1");
}, 60000);

discordScenario("workItemComments and workItemActivity read a work item's comments newest first and its activity latest last, as Markdown", async (s) => {
  await s.plane({ projects: [P1] });
  const plane = fakePlane(s);
  const w = world(plane);
  const item = plane.item({ project: P1, sequence_id: 42, name: "Fix login" });
  plane.comment({ issue: item.id, actor: w.budi.id, created_at: "2026-10-14T08:00:00.000000Z", comment_html: `<p>Seen on <em>Safari</em>.</p>` });
  plane.comment({ issue: item.id, actor: w.sari.id, created_at: "2026-10-15T08:00:00.000000Z", comment_html: `<p>Ping <mention-component entity_identifier="u-budi" entity_name="user_mention"></mention-component></p>`, edited_at: "2026-10-15T09:00:00.000000Z" });
  for (let n = 1; n <= 60; n++) plane.activity({ issue: item.id, actor: w.budi.id, field: "priority", old_value: "low", new_value: "high", created_at: `2026-10-01T00:${String(n).padStart(2, "0")}:00.000000Z` });
  plane.activity({ issue: item.id, actor: w.sari.id, field: "description", old_value: "<p>old</p>", new_value: "<p>new <strong>text</strong></p>", created_at: "2026-10-02T00:00:00.000000Z" });

  const comments = await ask(s, "workItemComments", { item: "ENG-42" });
  expect(comments.key).toBe("ENG-42");
  expect(comments.comments).toEqual([
    { id: expect.any(String), author: "Sari Dewi (sari)", createdAt: "2026-10-15T08:00:00.000000Z", edited: true, body: "Ping @Budi Santoso (budi)" },
    { id: expect.any(String), author: "Budi Santoso (budi)", createdAt: "2026-10-14T08:00:00.000000Z", edited: false, body: "Seen on _Safari_." },
  ]);

  const activity = await ask(s, "workItemActivity", { item: "ENG-42", limit: 10 });
  expect(activity.activity.length).toBe(10);
  expect(activity.activity.at(-1)).toMatchObject({ at: "2026-10-02T00:00:00.000000Z", by: "Sari Dewi (sari)", field: "description", from: "old", to: "new **text**" });
  expect(activity.earlier).toBe(51);
  expect(JSON.stringify([comments, activity])).not.toMatch(/<\/?(p|strong|em|mention-component)/);
});

discordScenario("workItemLinks, workItemRelations and workItemAttachments list what is attached, never a download link or a work item outside the scope", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  world(plane);
  const item = plane.item({ project: P1, sequence_id: 42, name: "Fix login" });
  const blocker = plane.item({ project: P2, sequence_id: 3, name: "New login screen" });
  const hidden = plane.item({ project: P3, sequence_id: 9, name: "Secret thing" });
  plane.link({ issue: item.id, title: "PR #812", url: "https://github.com/acme/web/pull/812" });
  plane.relate(item.id, { blocked_by: [{ project_id: P2, issue_id: blocker.id }], relates_to: [{ project_id: P3, issue_id: hidden.id }] });
  plane.attachment({ issue: item.id, attributes: { name: "screenshot.png", type: "image/png", size: 48213 }, asset: "ws-1/3f9e-screenshot.png", size: 48213 });

  expect((await ask(s, "workItemLinks", { item: "ENG-42" })).links).toEqual([{ id: expect.any(String), title: "PR #812", url: "https://github.com/acme/web/pull/812" }]);

  const relations = await ask(s, "workItemRelations", { item: "ENG-42" });
  expect(relations.relations).toEqual({
    blocked_by: [{ key: "DES-3", name: "New login screen", id: blocker.id }],
    relates_to: [{ outsideScope: true }],
  });
  expect(s.http.requests.some((r) => r.url.includes(hidden.id))).toBe(false);

  const files = await ask(s, "workItemAttachments", { item: "ENG-42" });
  expect(files.attachments).toEqual([{ id: expect.any(String), name: "screenshot.png", type: "image/png", size: 48213, uploadedAt: expect.any(String) }]);
  expect(JSON.stringify(files)).not.toContain("3f9e");
});

discordScenario("Browse: planeProjects, planeProject, planeStates, planeLabels and planeMembers, inside the scope only", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  const w = world(plane);
  plane.label({ project: P1, name: "frontend", parent: w.ui.id });
  plane.project({ id: "44444444-4444-4444-8444-444444444444", name: "Archived", identifier: "ARC", archived_at: "2026-01-01T00:00:00Z" });

  const projects = await ask(s, "planeProjects", {});
  expect(projects.projects).toEqual([
    { id: P1, identifier: "ENG", name: "Engineering", features: { cycles: true, modules: true, intake: false } },
    { id: P2, identifier: "DES", name: "Design", features: { cycles: true, modules: true, intake: false } },
  ]);

  expect(await ask(s, "planeProject", { project: "eng" })).toMatchObject({ id: P1, identifier: "ENG", name: "Engineering", features: { cycles: true, modules: true, intake: false }, members: 3, archived: false });
  expect(JSON.stringify(await ask(s, "planeProject", { project: "SEC" }))).toContain("is not open in this channel");

  expect((await ask(s, "planeStates", { project: "ENG" })).states).toEqual([
    { id: w.todo.id, name: "Todo", group: "unstarted", default: true },
    { id: w.doing.id, name: "In Progress", group: "started", default: false },
    { id: w.done.id, name: "Done", group: "completed", default: false },
  ]);
  expect((await ask(s, "planeLabels", { project: "ENG" })).labels).toEqual([
    { id: w.bug.id, name: "bug" }, { id: w.ui.id, name: "ui" }, { id: expect.any(String), name: "frontend", parent: "ui" },
  ]);
  const members = await ask(s, "planeMembers", { project: "Engineering" });
  expect(members.members).toEqual([
    { id: "u-budi", name: "Budi Santoso (budi)" }, { id: "u-sari", name: "Sari Dewi (sari)" }, { id: "u-bot", name: "Plane Bot (pachibot)" },
  ]);
  expect(JSON.stringify(members)).not.toContain("@acme.test");
  expect(JSON.stringify(await ask(s, "planeMembers", { project: P3 }))).toContain("is not open in this channel");
  expect(s.http.requests.some((r) => r.url.includes(P3))).toBe(false);
});
