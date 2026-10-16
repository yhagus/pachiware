import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { fakePlane } from "./support/fakePlane";

// Plane is faked at fetch in the shapes Plane v1.3.1 answers with. The account's Plane user is "u-bot".

const P1 = "11111111-1111-4111-8111-111111111111", P2 = "22222222-2222-4222-8222-222222222222", P3 = "33333333-3333-4333-8333-333333333333";
const PAST = { start_date: "2020-01-06T00:00:01Z", end_date: "2020-01-19T23:59:00Z" };
const NOW = { start_date: "2020-01-20T00:00:01Z", end_date: "2099-12-31T23:59:00Z" };
const LATER = { start_date: "2099-01-01T00:00:01Z", end_date: "2099-01-14T23:59:00Z" };

/** ENG (cycles and modules on) and OPS (both off) are open here; SEC is not. */
function world(plane: ReturnType<typeof fakePlane>) {
  const budi = plane.user({ id: "u-budi", first_name: "Budi", last_name: "Santoso", display_name: "budi", email: "budi@acme.test" });
  plane.user({ id: "u-bot", first_name: "Plane", last_name: "Bot", display_name: "pachibot", email: "bot@acme.test" });
  plane.project({ id: P1, name: "Engineering", identifier: "ENG" }, [budi.id, "u-bot"]);
  plane.project({ id: P2, name: "Operations", identifier: "OPS", cycle_view: false, module_view: false }, ["u-bot"]);
  plane.project({ id: P3, name: "Secret", identifier: "SEC" });
  const todo = plane.state({ project: P1, name: "Todo", group: "unstarted", default: true });
  const done = plane.state({ project: P1, name: "Done", group: "completed" });
  return { budi, todo, done };
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

discordScenario("cycleCreate sends the Plane project id in the body after Confirm, and a Plane project with cycles off is refused plainly", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  world(plane);

  const { result, confirmation } = await ask(s, "cycleCreate", { project: "ENG", name: "Sprint 43", description: "Billing", startDate: "2099-02-01", endDate: "2099-02-14" });
  expect(result).toMatchObject({ pending: true });
  expect(result.summary).toContain("Sprint 43");
  expect(result.summary).toContain("2099-02-01");
  expect(plane.writes).toEqual([]);

  await s.discord.click(confirmation!, "Confirm");
  expect(plane.writes).toEqual([{ method: "POST", path: `projects/${P1}/cycles/`, body: { name: "Sprint 43", description: "Billing", start_date: "2099-02-01", end_date: "2099-02-14", project_id: P1 } }]);
  expect(confirmation!.content).toContain("Completed");

  const off = await ask(s, "cycleCreate", { project: "OPS", name: "Sprint 1" });
  expect(off.result.error).toContain("Cycles are switched off in the Plane project OPS");
  expect(off.confirmation).toBeUndefined();
  const oneDate = await ask(s, "cycleCreate", { project: "ENG", name: "Sprint 44", startDate: "2099-03-01" });
  expect(oneDate.result.error).toContain("both");
  const outside = await ask(s, "cycleCreate", { project: P3, name: "Sprint 1" });
  expect(outside.result.error).toContain("is not open in this channel");
  expect(plane.writes.length).toBe(1);
});

discordScenario("cycleAddItems moves work items out of any other cycle and says so; cycleRemoveItem and cycleUpdate change one cycle", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  const w = world(plane);
  const a = plane.item({ project: P1, sequence_id: 41, name: "Auth refactor", state: w.todo.id });
  const b = plane.item({ project: P1, sequence_id: 42, name: "Fix login", state: w.todo.id });
  plane.item({ project: P2, sequence_id: 1, name: "Rotate keys" });
  plane.cycle({ project: P1, name: "Sprint 41", ...NOW }, [a.id]);
  const next = plane.cycle({ project: P1, name: "Sprint 42", ...LATER });
  const done = plane.cycle({ project: P1, name: "Sprint 40", ...PAST });

  const add = await ask(s, "cycleAddItems", { project: "ENG", cycle: "sprint 42", items: ["ENG-41", "eng-42"] });
  expect(add.result.summary).toContain("ENG-41, ENG-42");
  expect(add.result.summary).toContain("moved out of");
  expect(plane.writes).toEqual([]);
  await s.discord.click(add.confirmation!, "Confirm");
  expect(plane.writes).toEqual([{ method: "POST", path: `projects/${P1}/cycles/${next.id}/cycle-issues/`, body: { issues: [a.id, b.id] } }]);
  expect([plane.cycleOf(a.id), plane.cycleOf(b.id)]).toEqual([next.id, next.id]);

  const otherProject = await ask(s, "cycleAddItems", { project: "ENG", cycle: "Sprint 42", items: ["OPS-1"] });
  expect(otherProject.result.error).toContain("OPS-1 is in OPS");
  const ended = await ask(s, "cycleAddItems", { project: "ENG", cycle: "Sprint 40", items: ["ENG-41"] });
  expect(ended.result.error).toContain("has ended");
  const editEnded = await ask(s, "cycleUpdate", { project: "ENG", cycle: done.id, name: "Old" });
  expect(editEnded.result.error).toContain("has ended");
  const notIn = await ask(s, "cycleRemoveItem", { project: "ENG", cycle: "Sprint 41", item: "ENG-42" });
  expect(notIn.result.error).toContain("ENG-42 is not in the cycle Sprint 41");
  expect(plane.writes.length).toBe(1);

  const remove = await ask(s, "cycleRemoveItem", { project: "ENG", cycle: "Sprint 42", item: "ENG-42" });
  const rename = await ask(s, "cycleUpdate", { project: "ENG", cycle: "Sprint 42", name: "Sprint 42b", startDate: "2099-01-02", endDate: "2099-01-16" });
  expect(rename.result.summary).toContain(`"Sprint 42b"`);
  await s.discord.click(remove.confirmation!, "Confirm");
  await s.discord.click(rename.confirmation!, "Confirm");
  expect(plane.writes.slice(1)).toEqual([
    { method: "DELETE", path: `projects/${P1}/cycles/${next.id}/cycle-issues/${b.id}/`, body: null },
    { method: "PATCH", path: `projects/${P1}/cycles/${next.id}/`, body: { name: "Sprint 42b", start_date: "2099-01-02", end_date: "2099-01-16" } },
  ]);
  expect(plane.cycleOf(b.id)).toBeNull();
});

discordScenario("cycleTransfer moves the unfinished work items of an ended cycle, and archiving needs an ended cycle; Plane's 500s are refused first", async (s) => {
  await s.plane({ projects: [P1, P2] });
  const plane = fakePlane(s);
  const w = world(plane);
  const open = plane.item({ project: P1, sequence_id: 41, name: "Auth refactor", state: w.todo.id });
  const finished = plane.item({ project: P1, sequence_id: 42, name: "Fix login", state: w.done.id });
  const ended = plane.cycle({ project: P1, name: "Sprint 40", ...PAST }, [open.id, finished.id]);
  const older = plane.cycle({ project: P1, name: "Sprint 39", ...PAST });
  const running = plane.cycle({ project: P1, name: "Sprint 41", ...NOW });
  const next = plane.cycle({ project: P1, name: "Sprint 42", ...LATER });
  plane.cycle({ project: P1, name: "Someday" });

  const fromRunning = await ask(s, "cycleTransfer", { project: "ENG", cycle: "Sprint 41", to: "Sprint 42" });
  expect(fromRunning.result.error).toContain("Sprint 41 has not ended");
  const toMissing = await ask(s, "cycleTransfer", { project: "ENG", cycle: "Sprint 40", to: "Sprint 99" });
  expect(toMissing.result.error).toContain(`No cycle named "Sprint 99"`);
  const toEnded = await ask(s, "cycleTransfer", { project: "ENG", cycle: "Sprint 40", to: older.id });
  expect(toEnded.result.error).toContain("Sprint 39 has ended too");
  const archiveDraft = await ask(s, "cycleArchive", { project: "ENG", cycle: "Someday" });
  expect(archiveDraft.result.error).toContain("Someday has no dates");
  const archiveRunning = await ask(s, "cycleArchive", { project: "ENG", cycle: running.id });
  expect(archiveRunning.result.error).toContain("Sprint 41 has not ended");
  expect(plane.writes).toEqual([]);

  const transfer = await ask(s, "cycleTransfer", { project: "ENG", cycle: "Sprint 40", to: "Sprint 42" });
  expect(transfer.result.summary).toContain("unfinished");
  await s.discord.click(transfer.confirmation!, "Confirm");
  expect(plane.writes).toEqual([{ method: "POST", path: `projects/${P1}/cycles/${ended.id}/transfer-issues/`, body: { new_cycle_id: next.id } }]);
  expect([plane.cycleOf(open.id), plane.cycleOf(finished.id)]).toEqual([next.id, ended.id]);

  const archive = await ask(s, "cycleArchive", { project: "ENG", cycle: "Sprint 40" });
  await s.discord.click(archive.confirmation!, "Confirm");
  expect(plane.writes.at(-1)).toEqual({ method: "POST", path: `projects/${P1}/cycles/${ended.id}/archive/`, body: null });
  expect(plane.find.cycle(ended.id)!.archived_at).not.toBeNull();

  const unarchive = await ask(s, "cycleUnarchive", { project: "ENG", cycle: "sprint 40" });
  await s.discord.click(unarchive.confirmation!, "Confirm");
  expect(plane.writes.at(-1)).toEqual({ method: "DELETE", path: `projects/${P1}/archived-cycles/${ended.id}/unarchive/`, body: null });
  expect(plane.find.cycle(ended.id)!.archived_at).toBeNull();
  const notArchived = await ask(s, "cycleUnarchive", { project: "ENG", cycle: "Sprint 41" });
  expect(notArchived.result.error).toContain(`No archived cycle "Sprint 41"`);
});
