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
