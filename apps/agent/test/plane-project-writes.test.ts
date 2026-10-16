import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { fakePlane } from "./support/fakePlane";

// Plane is faked at fetch in the shapes Plane v1.3.1 answers with. The account's Plane user is "u-bot".

const P1 = "11111111-1111-4111-8111-111111111111", P2 = "22222222-2222-4222-8222-222222222222";

/** ENG (intake on, the bot's Plane user a Member) and OPS (intake off) are open here. */
function world(plane: ReturnType<typeof fakePlane>, engRole = 15) {
  plane.user({ id: "u-bot", first_name: "Plane", last_name: "Bot", display_name: "pachibot", email: "bot@acme.test" });
  plane.project({ id: P1, name: "Engineering", identifier: "ENG", intake_view: true, member_role: engRole }, ["u-bot"]);
  plane.project({ id: P2, name: "Operations", identifier: "OPS", intake_view: false }, ["u-bot"]);
  const todo = plane.state({ project: P1, name: "Todo", group: "unstarted", default: true });
  return { todo };
}

/** Asks for one tool call and returns its result and the confirmation message the bot posted, if any. */
async function ask(s: Scenario, tool: string, args: Record<string, unknown>) {
  let result: any;
  const before = s.discord.botMessages.length;
  s.model.script({ tool, args }, (turn: any) => { result = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} ${tool}`);
  const confirmation = s.discord.botMessages.slice(before).find((m) => m.components.length);
  return { result, confirmation };
}

discordScenario("intakeCreate adds to the intake after Confirm with Markdown as HTML and an origin line; intake switched off is refused", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  world(plane);

  const { result, confirmation } = await ask(s, "intakeCreate", { project: "ENG", name: "Export fails on Safari", description: "Clicking **Export** does nothing.", priority: "high" });
  expect(result.summary).toContain("Export fails on Safari");
  expect(plane.writes).toEqual([]);
  await s.discord.click(confirmation!, "Confirm");
  expect(plane.writes.map((w) => `${w.method} ${w.path}`)).toEqual([`POST projects/${P1}/intake-issues/`]);
  const body = plane.writes[0]!.body;
  expect(body.issue).toMatchObject({ name: "Export fails on Safari", priority: "high" });
  expect(body.issue.description_html).toMatch(/^<p>Clicking <strong>Export<\/strong> does nothing\.<\/p><p><em>Sent from Discord by Alice in #channel-1 \(thread: intakeCreate\)<\/em><\/p>$/);
  expect(confirmation!.content).toContain("ENG-1");

  const off = await ask(s, "intakeCreate", { project: "OPS", name: "Disk full" });
  expect(off.result.error).toContain("Intake is switched off in the Plane project OPS");
  expect(off.confirmation).toBeUndefined();
  expect(plane.writes.length).toBe(1);
});

discordScenario("intakeTriage by a Plane user who is not a project Admin reports the role problem, since Plane answers 200 and changes nothing", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  world(plane, 15);
  const pending = plane.intake({ project: P1, name: "Export fails on Safari", sequence_id: 57 });

  const accept = await ask(s, "intakeTriage", { project: "ENG", workItem: "ENG-57", action: "accept" });
  expect(accept.result.summary).toContain("Accept ENG-57");
  expect(plane.writes).toEqual([]);
  await s.discord.click(accept.confirmation!, "Confirm");
  expect(plane.writes).toEqual([{ method: "PATCH", path: `projects/${P1}/intake-issues/${pending.issue}/`, body: { status: 1 } }]);
  expect(plane.find.intake(pending.issue)!.status).toBe(-2);
  expect(accept.confirmation!.content).toContain("couldn't complete");
  expect(accept.confirmation!.content).toContain("pachibot (bot@acme.test) is not an Admin of the Plane project ENG");
});

discordScenario("intakeTriage accepts, snoozes until a date, and marks a duplicate of a work item, when the bot's Plane user is a project Admin", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  const w = world(plane, 20);
  const original = plane.item({ project: P1, sequence_id: 41, name: "Safari export broken", state: w.todo.id });
  const a = plane.intake({ project: P1, name: "Export fails on Safari", sequence_id: 57 });
  const b = plane.intake({ project: P1, name: "Dark mode", sequence_id: 58 });
  const c = plane.intake({ project: P1, name: "Safari export again", sequence_id: 59 });

  const past = await ask(s, "intakeTriage", { project: "ENG", workItem: "ENG-58", action: "snooze", snoozeUntil: "2020-01-01" });
  expect(past.result.error).toContain("in the future");
  const noDate = await ask(s, "intakeTriage", { project: "ENG", workItem: "ENG-58", action: "snooze" });
  expect(noDate.result.error).toContain("snoozeUntil");
  const noTarget = await ask(s, "intakeTriage", { project: "ENG", workItem: "ENG-59", action: "duplicate" });
  expect(noTarget.result.error).toContain("duplicateOf");
  const missing = await ask(s, "intakeTriage", { project: "ENG", workItem: "ENG-99", action: "accept" });
  expect(missing.result.error).toContain(`No intake item "ENG-99"`);
  expect(plane.writes).toEqual([]);

  const accept = await ask(s, "intakeTriage", { project: "ENG", workItem: "ENG-57", action: "accept" });
  const snooze = await ask(s, "intakeTriage", { project: "ENG", workItem: b.issue, action: "snooze", snoozeUntil: "2099-03-01" });
  const duplicate = await ask(s, "intakeTriage", { project: "ENG", workItem: "ENG-59", action: "duplicate", duplicateOf: "ENG-41" });
  expect(duplicate.result.summary).toContain("duplicate of ENG-41");
  for (const r of [accept, snooze, duplicate]) await s.discord.click(r.confirmation!, "Confirm");
  expect(plane.writes.map((x) => x.body)).toEqual([{ status: 1 }, { status: 0, snoozed_till: "2099-03-01T00:00:00Z" }, { status: 2, duplicate_to: original.id }]);
  expect([a, b, c].map((r) => plane.find.intake(r.issue)!.status)).toEqual([1, 0, 2]);
  expect(plane.find.item(a.issue)!.state).toBe(w.todo.id);
  for (const r of [accept, snooze, duplicate]) expect(r.confirmation!.content).toContain("Completed");
});
