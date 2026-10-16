import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { fakePlane } from "./support/fakePlane";

// Plane is faked at fetch in the shapes Plane v1.3.1 answers with. The account's Plane user is "u-bot". Alice is the
// Trusted member in every scenario; Bob is not.

const P1 = "11111111-1111-4111-8111-111111111111", P2 = "22222222-2222-4222-8222-222222222222";

/** ENG is open here, with its intake on and Budi and the bot as members. */
function world(plane: ReturnType<typeof fakePlane>, engRole = 15) {
  const budi = plane.user({ id: "u-budi", first_name: "Budi", last_name: "Santoso", display_name: "budi", email: "budi@acme.test" });
  plane.user({ id: "u-bot", first_name: "Plane", last_name: "Bot", display_name: "pachibot", email: "bot@acme.test" });
  const eng = plane.project({ id: P1, name: "Engineering", identifier: "ENG", intake_view: true, member_role: engRole }, [budi.id, "u-bot"]);
  const todo = plane.state({ project: P1, name: "Todo", group: "unstarted", default: true });
  return { budi, eng, todo };
}

/** Asks for one tool call and returns its result and the confirmation message the bot posted, if any. */
async function ask(s: Scenario, tool: string, args: Record<string, unknown>, options: { author?: any; channel?: string } = {}) {
  let result: any;
  const before = s.discord.botMessages.length;
  s.model.script({ tool, args }, (turn: any) => { result = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} ${tool}`, options);
  const confirmation = s.discord.botMessages.slice(before).find((m) => m.components.length);
  return { result, confirmation };
}
const sent = (plane: ReturnType<typeof fakePlane>) => plane.writes.map((x) => `${x.method} ${x.path}`);
const labels = (m: { components: any[] }) => m.components.flatMap((row: any) => row.components.map((b: any) => b.label));

discordScenario("workItemDelete is refused for someone who is not a Trusted member before any confirmation, and waits for its own Confirm even under a thread grant", async (s) => {
  process.env.TRUSTED_DISCORD_IDS = s.discord.alice.id;
  await s.plane({ projects: [P1] });
  const plane = fakePlane(s);
  const w = world(plane);
  const item = plane.item({ project: P1, sequence_id: 42, name: "Fix login", state: w.todo.id });

  const refused = await ask(s, "workItemDelete", { item: "ENG-42" }, { author: s.discord.bob });
  expect(refused.result.error).toContain("limited to Trusted members");
  expect(refused.confirmation).toBeUndefined();

  // Alice grants the thread with an ordinary write first.
  const comment = await ask(s, "workItemComment", { item: "ENG-42", body: "Looking at it" });
  await s.discord.click(comment.confirmation!, "Confirm changes in this thread");
  expect(plane.writes.map((x) => x.method)).toEqual(["POST"]);

  const del = await ask(s, "workItemDelete", { item: "ENG-42" }, { channel: comment.confirmation!.channelId });
  expect(del.result).toMatchObject({ pending: true, ownConfirmation: true });
  expect(del.result.summary).toContain(`Delete work item ENG-42 "Fix login"`);
  expect(labels(del.confirmation!)).toEqual(["Confirm", "Cancel"]);
  expect(plane.writes.length).toBe(1);

  await s.discord.click(del.confirmation!, "Confirm");
  expect(sent(plane).at(-1)).toBe(`DELETE projects/${P1}/work-items/${item.id}/`);
  expect(plane.find.item(item.id)).toBeUndefined();
  expect(del.confirmation!.content).toContain("Completed");
});

discordScenario("workItemDeleteComment refuses a comment the account's Plane user did not write, and Plane's refusal to delete another user's work item is reported plainly", async (s) => {
  process.env.TRUSTED_DISCORD_IDS = s.discord.alice.id;
  await s.plane({ projects: [P1] });
  const plane = fakePlane(s);
  const w = world(plane);
  const item = plane.item({ project: P1, sequence_id: 42, name: "Fix login", state: w.todo.id });
  const theirs = plane.comment({ issue: item.id, project: P1, comment_html: "<p>Repro on Safari</p>", actor: w.budi.id, created_by: w.budi.id });
  const ours = plane.comment({ issue: item.id, project: P1, comment_html: "<p>On it</p>", actor: "u-bot" });

  const refused = await ask(s, "workItemDeleteComment", { item: "ENG-42", comment: theirs.id });
  expect(refused.result.error).toContain("written by Budi Santoso (budi), not by this account's Plane user");
  expect(refused.confirmation).toBeUndefined();

  const del = await ask(s, "workItemDeleteComment", { item: "ENG-42", comment: ours.id });
  expect(del.result.summary).toContain("Delete a comment on ENG-42");
  expect(labels(del.confirmation!)).toEqual(["Confirm", "Cancel"]);
  expect(plane.writes).toEqual([]);
  await s.discord.click(del.confirmation!, "Confirm");
  expect(sent(plane)).toEqual([`DELETE projects/${P1}/work-items/${item.id}/comments/${ours.id}/`]);

  const budis = plane.item({ project: P1, sequence_id: 43, name: "Budi's item", state: w.todo.id, created_by: w.budi.id });
  const notCreator = await ask(s, "workItemDelete", { item: "ENG-43" });
  await s.discord.click(notCreator.confirmation!, "Confirm");
  expect(notCreator.confirmation!.content).toContain("couldn't complete");
  expect(notCreator.confirmation!.content).toContain("pachibot (bot@acme.test), did not create ENG-43 and is not an Admin of the Plane project ENG");
  expect(plane.find.item(budis.id)).toBeDefined();
});

discordScenario("cycleDelete, moduleDelete and intakeDelete run after their own Confirm; Plane's refusal to delete a module another user made is reported plainly", async (s) => {
  process.env.TRUSTED_DISCORD_IDS = s.discord.alice.id;
  await s.plane({ projects: [P1] });
  const plane = fakePlane(s);
  const w = world(plane);
  const item = plane.item({ project: P1, sequence_id: 42, name: "Fix login", state: w.todo.id });
  const sprint = plane.cycle({ project: P1, name: "Sprint 42", start_date: "2026-10-01T00:00:01Z", end_date: "2026-10-14T23:59:00Z" }, [item.id]);
  const billing = plane.module({ project: P1, name: "Billing v2" }, [item.id]);
  const budis = plane.module({ project: P1, name: "Search", created_by: w.budi.id });
  const pending = plane.intake({ project: P1, name: "Export fails on Safari", sequence_id: 57 });

  const notTrusted = await ask(s, "cycleDelete", { project: "ENG", cycle: "Sprint 42" }, { author: s.discord.bob });
  expect(notTrusted.result.error).toContain("limited to Trusted members");

  const cycle = await ask(s, "cycleDelete", { project: "ENG", cycle: "sprint 42" });
  expect(cycle.result.summary).toContain("Delete cycle Sprint 42 in ENG");
  expect(cycle.result.summary).toContain("its 1 work item stays");
  const mod = await ask(s, "moduleDelete", { project: "ENG", module: "Billing v2" });
  const theirs = await ask(s, "moduleDelete", { project: "ENG", module: "Search" });
  const intake = await ask(s, "intakeDelete", { project: "ENG", workItem: "ENG-57" });
  expect(intake.result.summary).toContain("ENG-57");
  expect(intake.result.summary).toContain("deletes its work item too");
  for (const r of [cycle, mod, theirs, intake]) expect(labels(r.confirmation!)).toEqual(["Confirm", "Cancel"]);
  expect(plane.writes).toEqual([]);

  for (const r of [cycle, mod, theirs, intake]) await s.discord.click(r.confirmation!, "Confirm");
  expect(sent(plane)).toEqual([
    `DELETE projects/${P1}/cycles/${sprint.id}/`,
    `DELETE projects/${P1}/modules/${billing.id}/`,
    `DELETE projects/${P1}/modules/${budis.id}/`,
    `DELETE projects/${P1}/intake-issues/${pending.issue}/`,
  ]);
  expect(plane.find.cycle(sprint.id)).toBeUndefined();
  expect(plane.find.module(billing.id)).toBeUndefined();
  expect(plane.find.item(item.id)).toBeDefined();
  expect(theirs.confirmation!.content).toContain("did not create the module Search and is not an Admin of the Plane project ENG");
  expect(plane.find.module(budis.id)).toBeDefined();
  expect(plane.find.intake(pending.issue)).toBeUndefined();
  expect(plane.find.item(pending.issue)).toBeUndefined();
});

discordScenario("stateDelete refuses the default state before Confirm and reports Plane's refusal of a state that still holds work items; labelDelete removes a label", async (s) => {
  process.env.TRUSTED_DISCORD_IDS = s.discord.alice.id;
  await s.plane({ projects: [P1] });
  const plane = fakePlane(s);
  const w = world(plane);
  const doing = plane.state({ project: P1, name: "In Progress", group: "started" });
  const review = plane.state({ project: P1, name: "In Review", group: "started" });
  plane.item({ project: P1, sequence_id: 42, name: "Fix login", state: doing.id });
  const bug = plane.label({ project: P1, name: "bug" });

  const def = await ask(s, "stateDelete", { project: "ENG", state: "todo" });
  expect(def.result.error).toContain("Todo is the default state of ENG");
  expect(def.confirmation).toBeUndefined();

  const busy = await ask(s, "stateDelete", { project: "ENG", state: "in progress" });
  const empty = await ask(s, "stateDelete", { project: "ENG", state: "In Review" });
  const label = await ask(s, "labelDelete", { project: "ENG", label: "BUG" });
  expect(label.result.summary).toContain("Delete the label bug from ENG");
  expect(plane.writes).toEqual([]);
  for (const r of [busy, empty, label]) await s.discord.click(r.confirmation!, "Confirm");
  expect(sent(plane)).toEqual([`DELETE projects/${P1}/states/${doing.id}/`, `DELETE projects/${P1}/states/${review.id}/`, `DELETE projects/${P1}/labels/${bug.id}/`]);
  expect(busy.confirmation!.content).toContain("The state In Progress still holds work items");
  expect(plane.find.state(P1, "In Progress")).toBeDefined();
  expect(plane.find.state(P1, "In Review")).toBeUndefined();
  expect(plane.find.label(P1, "bug")).toBeUndefined();
  expect(plane.find.state(P1, w.todo.name)).toBeDefined();
});
