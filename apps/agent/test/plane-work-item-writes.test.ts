import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { fakePlane } from "./support/fakePlane";
import { attachment } from "./support/images";

// Plane is faked at fetch in the shapes Plane v1.3.1 answers with. The account's Plane user is "u-bot".

const P1 = "11111111-1111-4111-8111-111111111111", P2 = "22222222-2222-4222-8222-222222222222", P3 = "33333333-3333-4333-8333-333333333333";

/** ENG and DES are open here, SEC is not. Budi, Sari and the bot are members of ENG; Sari's namesake Sarah too. */
function world(plane: ReturnType<typeof fakePlane>) {
  const budi = plane.user({ id: "u-budi", first_name: "Budi", last_name: "Santoso", display_name: "budi", email: "budi@acme.test" });
  const sari = plane.user({ id: "u-sari", first_name: "Sari", last_name: "Dewi", display_name: "sari", email: "sari@acme.test" });
  const sarah = plane.user({ id: "u-sarah", first_name: "Sarah", last_name: "Lim", display_name: "sarah", email: "sarah@acme.test" });
  plane.user({ id: "u-bot", first_name: "Plane", last_name: "Bot", display_name: "pachibot", email: "bot@acme.test" });
  const eng = plane.project({ id: P1, name: "Engineering", identifier: "ENG" }, [budi.id, sari.id, sarah.id, "u-bot"]);
  plane.project({ id: P2, name: "Design", identifier: "DES" }, [sari.id]);
  plane.project({ id: P3, name: "Secret", identifier: "SEC" });
  const todo = plane.state({ project: P1, name: "Todo", group: "unstarted", default: true });
  const doing = plane.state({ project: P1, name: "In Progress", group: "started" });
  const bug = plane.label({ project: P1, name: "bug" });
  const ui = plane.label({ project: P1, name: "ui" });
  const desLabel = plane.label({ project: P2, name: "bug" });
  return { budi, sari, sarah, eng, todo, doing, bug, ui, desLabel };
}

/** Asks for one tool call and returns its result and the confirmation message the bot posted, if any. */
async function ask(s: Scenario, tool: string, args: Record<string, unknown>, options: { author?: any } = {}) {
  let result: any;
  const before = s.discord.botMessages.length;
  s.model.script({ tool, args }, (turn: any) => { result = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} ${tool}`, options);
  const confirmation = s.discord.botMessages.slice(before).find((m) => m.components.length);
  return { result, confirmation };
}

discordScenario("workItemCreate changes nothing before Confirm, runs only on the asker's Confirm, and sends Markdown as HTML with an origin line", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  const w = world(plane);

  const { result, confirmation } = await ask(s, "workItemCreate", {
    project: "ENG", name: "Fix login redirect", description: "Users land on **/404** after SSO.\n\n- Safari only",
    state: "in progress", priority: "high", assignees: ["Budi"], labels: ["bug"], targetDate: "2026-10-20",
  });
  expect(result).toMatchObject({ pending: true });
  expect(result.summary).toContain("Fix login redirect");
  expect(confirmation).toBeDefined();
  expect(plane.writes).toEqual([]);

  await s.discord.click(confirmation!, "Confirm", { user: s.discord.bob });
  expect(plane.writes).toEqual([]);

  await s.discord.click(confirmation!, "Confirm");
  expect(plane.writes.map((r) => `${r.method} ${r.path}`)).toEqual([`POST projects/${P1}/work-items/`]);
  const body = plane.writes[0]!.body;
  expect(body).toMatchObject({ name: "Fix login redirect", state: w.doing.id, priority: "high", assignees: [w.budi.id], labels: [w.bug.id], target_date: "2026-10-20" });
  expect(body.description_html).toContain("<strong>/404</strong>");
  expect(body.description_html).toContain("<li>Safari only</li>");
  expect(body.description_html).toMatch(/Sent from Discord by Alice in #channel-1 \(thread: workItemCreate\)<\/em><\/p>$/);
  for (const key of ["created_by", "created_at", "sequence_id", "is_draft", "archived_at"]) expect(body).not.toHaveProperty(key);
  expect(confirmation!.content).toContain("Completed");
  expect(confirmation!.content).toContain("ENG-1");
  expect(confirmation!.content).not.toContain("plane-key");
});

discordScenario("a confirmed write is refused when its Plane project left the scope after it was asked for", async (s) => {
  const account = await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  world(plane);
  const { confirmation } = await ask(s, "workItemCreate", { project: "ENG", name: "Rotate keys" });

  const { repositories } = await import("../../../packages/db/src/index.ts");
  await repositories().plane.replaceScopes(s.tenant.id, s.bot.id, s.discord.guildId, "", [{ planeAccountId: account.id, projectIds: [P2] }]);
  await s.discord.click(confirmation!, "Confirm");
  expect(confirmation!.content).toContain("couldn't complete");
  expect(confirmation!.content).toContain("is not open in this channel");
  expect(plane.writes).toEqual([]);
});

discordScenario("workItemUpdate adds or removes one assignee or label and keeps the rest; an unclear name or \"me\" is asked about", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  const w = world(plane);
  const item = plane.item({ project: P1, sequence_id: 42, name: "Fix login", assignees: [w.budi.id], labels: [w.bug.id] });

  const add = await ask(s, "workItemUpdate", { item: "ENG-42", addAssignees: ["sari"], addLabels: ["ui"] });
  expect(add.result.summary).toContain("Sari Dewi (sari)");
  expect(plane.writes).toEqual([]);
  await s.discord.click(add.confirmation!, "Confirm");
  expect(plane.writes.at(-1)).toMatchObject({ method: "PATCH", path: `projects/${P1}/work-items/${item.id}/`, body: { assignees: [w.budi.id, w.sari.id], labels: [w.bug.id, w.ui.id] } });

  const remove = await ask(s, "workItemUpdate", { item: "ENG-42", removeAssignees: ["budi"], removeLabels: ["bug"], priority: "urgent" });
  await s.discord.click(remove.confirmation!, "Confirm");
  expect(plane.writes.at(-1)!.body).toEqual({ priority: "urgent", assignees: [w.sari.id], labels: [w.ui.id] });

  const before = plane.writes.length;
  const unclear = await ask(s, "workItemUpdate", { item: "ENG-42", addAssignees: ["sar"] });
  expect(unclear.result.error).toContain("Sari Dewi (sari)");
  expect(unclear.result.error).toContain("Sarah Lim (sarah)");
  expect(unclear.confirmation).toBeUndefined();
  const me = await ask(s, "workItemUpdate", { item: "ENG-42", addAssignees: ["me"] });
  expect(me.result.error).toContain(`who "me" is`);
  const unknown = await ask(s, "workItemUpdate", { item: "ENG-42", state: "Done" });
  expect(unknown.result.error).toContain(`No state matches "Done"`);
  const nothing = await ask(s, "workItemUpdate", { item: "ENG-42" });
  expect(nothing.result.error).toContain("Nothing to change");
  expect(plane.writes.length).toBe(before);
});

discordScenario("a comment ends with the origin line and a field edit adds none; no write carries created_by", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  world(plane);
  const item = plane.item({ project: P1, sequence_id: 42, name: "Fix login" });

  const comment = await ask(s, "workItemComment", { item: "ENG-42", body: "Seen on **Safari** too." });
  expect(plane.writes).toEqual([]);
  await s.discord.click(comment.confirmation!, "Confirm");
  expect(plane.writes.at(-1)).toMatchObject({ method: "POST", path: `projects/${P1}/work-items/${item.id}/comments/` });
  expect(plane.writes.at(-1)!.body.comment_html).toMatch(/^<p>Seen on <strong>Safari<\/strong> too\.<\/p><p><em>Sent from Discord by Alice in #channel-1 \(thread: workItemComment\)<\/em><\/p>$/);

  const edit = await ask(s, "workItemUpdate", { item: "ENG-42", name: "Fix login on Safari", description: "Only *Safari*." });
  await s.discord.click(edit.confirmation!, "Confirm");
  expect(plane.writes.at(-1)!.body).toEqual({ name: "Fix login on Safari", description_html: "<p>Only <em>Safari</em>.</p>" });

  expect(plane.writes.length).toBe(2);
  for (const write of plane.writes) for (const key of ["created_by", "created_at", "actor"]) expect(write.body).not.toHaveProperty(key);
});

discordScenario("workItemEditComment edits only a comment the account's Plane user wrote, and keeps its origin line", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  const w = world(plane);
  const item = plane.item({ project: P1, sequence_id: 42, name: "Fix login" });
  const theirs = plane.comment({ issue: item.id, project: P1, actor: w.budi.id, created_by: w.budi.id, comment_html: "<p>I think it is the cookie.</p>" });
  const ours = plane.comment({ issue: item.id, project: P1, actor: "u-bot", created_by: "u-bot", comment_html: "<p>Seen on Safari.</p><p><em>Sent from Discord by Bob in #channel-1</em></p>" });

  const refused = await ask(s, "workItemEditComment", { item: "ENG-42", comment: theirs.id, body: "It is not the cookie." });
  expect(refused.result.error).toContain("Budi Santoso (budi)");
  expect(refused.confirmation).toBeUndefined();

  const edit = await ask(s, "workItemEditComment", { item: "ENG-42", comment: ours.id, body: "Seen on Safari and Firefox." });
  await s.discord.click(edit.confirmation!, "Confirm");
  expect(plane.writes).toEqual([{ method: "PATCH", path: `projects/${P1}/work-items/${item.id}/comments/${ours.id}/`, body: { comment_html: "<p>Seen on Safari and Firefox.</p><p><em>Sent from Discord by Bob in #channel-1</em></p>" } }]);
});

discordScenario("links are added and removed by URL; workItemRelate relates work items in the scope and says Plane cannot undo it", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  world(plane);
  const item = plane.item({ project: P1, sequence_id: 42, name: "Fix login" });
  const blocker = plane.item({ project: P1, sequence_id: 41, name: "Auth refactor" });
  const mockups = plane.item({ project: P2, sequence_id: 3, name: "Login mockups" });
  plane.item({ project: P3, sequence_id: 1, name: "Secret" });
  const old = plane.link({ issue: item.id, project: P1, url: "https://github.com/acme/web/pull/800", title: "Old PR" });

  const bad = await ask(s, "workItemAddLink", { item: "ENG-42", url: "javascript:alert(1)" });
  expect(bad.result.error).toContain("http");
  const add = await ask(s, "workItemAddLink", { item: "ENG-42", url: "https://github.com/acme/web/pull/812", title: "PR #812" });
  const remove = await ask(s, "workItemRemoveLink", { item: "ENG-42", link: "https://github.com/acme/web/pull/800" });
  expect(remove.result.summary).toContain("Old PR");
  expect(plane.writes).toEqual([]);
  await s.discord.click(add.confirmation!, "Confirm");
  await s.discord.click(remove.confirmation!, "Confirm");
  expect(plane.writes).toEqual([
    { method: "POST", path: `projects/${P1}/work-items/${item.id}/links/`, body: { url: "https://github.com/acme/web/pull/812", title: "PR #812" } },
    { method: "DELETE", path: `projects/${P1}/work-items/${item.id}/links/${old.id}/`, body: null },
  ]);

  const outside = await ask(s, "workItemRelate", { item: "ENG-42", relation: "blocked_by", related: ["SEC-1"] });
  expect(outside.result.error).toContain("is not open in this channel");
  const relate = await ask(s, "workItemRelate", { item: "ENG-42", relation: "blocked_by", related: ["ENG-41", "des-3"] });
  expect(relate.result.summary).toContain("blocked by ENG-41, DES-3");
  await s.discord.click(relate.confirmation!, "Confirm");
  expect(plane.writes.at(-1)).toEqual({ method: "POST", path: `projects/${P1}/work-items/${item.id}/relations/`, body: { relation_type: "blocked_by", issues: [blocker.id, mockups.id] } });
  expect(relate.confirmation!.content).toContain("cannot remove a relation");
});

discordScenario("workItemAttach uploads a file posted in Discord through Plane's presigned upload, at most 5 MB, after Confirm", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  world(plane);
  const item = plane.item({ project: P1, sequence_id: 42, name: "Fix login" });
  const log = new TextEncoder().encode("ERROR redirect loop\n");
  const [posted, huge] = s.discord.history([
    { content: "the log", attachments: [attachment(s, "error.log", log, { contentType: "text/plain" })] },
    { content: "the dump", attachments: [attachment(s, "heap.bin", null, { contentType: "application/octet-stream", size: 6 * 1024 * 1024 })] },
  ]);

  const tooBig = await ask(s, "workItemAttach", { item: "ENG-42", messageId: huge!.id });
  expect(tooBig.result.error).toContain("5 MB");
  const attach = await ask(s, "workItemAttach", { item: "ENG-42", messageId: posted!.id });
  expect(attach.result.summary).toContain("error.log");
  expect(plane.writes).toEqual([]);

  await s.discord.click(attach.confirmation!, "Confirm");
  const [request, upload, complete] = plane.writes;
  expect(request).toEqual({ method: "POST", path: `projects/${P1}/work-items/${item.id}/attachments/`, body: { name: "error.log", type: "text/plain", size: log.length } });
  expect(upload!.method).toBe("POST");
  expect(upload!.path).toBe("https://plane-uploads.s3.amazonaws.com/uploads");
  expect(upload!.body.keys).toEqual(["Content-Type", "key", "policy", "x-amz-signature", "file"]);
  expect(upload!.body.file).toEqual({ name: "error.log", type: expect.stringMatching(/^text\/plain/), text: "ERROR redirect loop\n" });
  expect(complete).toMatchObject({ method: "PATCH", path: expect.stringMatching(new RegExp(`^projects/${P1}/work-items/${item.id}/attachments/[0-9a-f-]+/$`)) });
  expect(attach.confirmation!.content).toContain("Completed");
  expect(attach.confirmation!.content).not.toMatch(/amazonaws|asset/);
});

discordScenario("on a self-hosted Plane whose file storage answers with its own host over http, the upload goes over https", async (s) => {
  await s.plane({ projects: ["*"], baseUrl: "https://plane.acme.test" });
  const plane = fakePlane(s, { host: "plane.acme.test", uploadUrl: "http://plane.acme.test/uploads" });
  world(plane);
  plane.item({ project: P1, sequence_id: 42, name: "Fix login" });
  const [posted] = s.discord.history([{ content: "shot", attachments: [attachment(s, "shot.txt", new TextEncoder().encode("x"), { contentType: "text/plain" })] }]);

  const attach = await ask(s, "workItemAttach", { item: "ENG-42", messageId: posted!.id });
  await s.discord.click(attach.confirmation!, "Confirm");
  expect(plane.writes.map((w) => w.path)[1]).toBe("https://plane.acme.test/uploads");
  expect(attach.confirmation!.content).toContain("Completed");
});
