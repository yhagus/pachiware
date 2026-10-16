import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { fakePlane } from "./support/fakePlane";

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
