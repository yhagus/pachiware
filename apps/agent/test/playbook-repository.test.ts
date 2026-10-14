import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("in a playbook thread the repository tool lists only what git scope allows in the parent channel, and with several the agent asks", async (s) => {
  const { addTracker, acmeRepos } = await import(process.cwd() + "/apps/agent/test/support/trackerPlaybook.ts");
  await addTracker(s);
  await acmeRepos(s, ["acme/api", "acme/web"]);
  s.model.script(
    { tool: "playbookRepositories" },
    (turn) => {
      expect(turn.toolResults[0]).toMatchObject({ repositories: [{ repo: "acme/api", account: "github" }, { repo: "acme/web", account: "github" }] });
      expect(turn.toolResults[0].chosen).toBeUndefined();
      expect(turn.toolResults[0].note).toContain("Ask");
      return "Which repository: acme/api or acme/web?";
    },
  );
  const start = await s.discord.send(`${s.discord.mention} track: plan the CSV export work`);
  expect(s.discord.botMessages.map((m) => [m.channelId, m.content])).toEqual([[start.thread!.id, "Which repository: acme/api or acme/web?"]]);
});

discordScenario("a playbook that requires a repository is refused privately where git scope allows none, and starts once one is allowed", async (s) => {
  const { addTracker } = await import(process.cwd() + "/apps/agent/test/support/trackerPlaybook.ts");
  await addTracker(s);
  const brief = await s.discord.send("- plan the CSV export work");
  const run = await s.discord.contextMenu("Track work", brief);
  expect(run.responses).toEqual([
    { kind: "deferReply", payload: expect.objectContaining({ ephemeral: true }) },
    { kind: "editReply", payload: expect.objectContaining({ content: "The tracker playbook needs a repository, and git scope allows none here. An admin can open one in the console under the server's git access." }) },
  ]);
  expect(brief.thread).toBeUndefined();
  expect(s.model.calls).toEqual([]);

  await s.git({ repos: ["acme/api"] });
  s.model.script("Tracking.");
  const again = await s.discord.contextMenu("Track work", brief);
  expect(again.responses.at(-1)!.payload.content).toContain("Following the tracker playbook");
  expect(brief.thread).toBeDefined();
});

discordScenario("with one repository allowed the playbook thread takes it without asking", async (s) => {
  const { addTracker } = await import(process.cwd() + "/apps/agent/test/support/trackerPlaybook.ts");
  await addTracker(s);
  await s.git({ repos: ["acme/api"] });
  s.model.script(
    { tool: "playbookRepositories" },
    (turn) => {
      expect(turn.toolResults[0]).toMatchObject({ repositories: [{ repo: "acme/api" }], chosen: { repo: "acme/api", account: "github" } });
      expect(turn.toolResults[0].note).toContain("do not ask");
      return "Working in acme/api.";
    },
    "Next step.",
  );
  const start = await s.discord.send(`${s.discord.mention} track: plan the CSV export work`);
  await s.discord.send("what next?", { channel: start.thread });
  expect(String(s.model.calls.at(-1)![0]!.content)).toContain("This thread's repository: acme/api (git account github).");
});

discordScenario("the repository chosen in a playbook thread is kept and offered back on later turns", async (s) => {
  const { addTracker, acmeRepos } = await import(process.cwd() + "/apps/agent/test/support/trackerPlaybook.ts");
  await addTracker(s);
  await acmeRepos(s, ["acme/api", "acme/web"]);
  s.model.script(
    { tool: "playbookRepositories" }, "Which repository: acme/api or acme/web?",
    { tool: "playbookRepositories", args: { repo: "acme/web" } },
    (turn) => { expect(turn.toolResults[0]).toMatchObject({ chosen: { repo: "acme/web", account: "github" } }); return "Using acme/web."; },
    { tool: "playbookRepositories" },
    (turn) => { expect(turn.toolResults[0].chosen).toEqual({ repo: "acme/web", account: "github" }); expect(turn.toolResults[0].note).toContain("do not ask"); return "Still acme/web."; },
  );
  const start = await s.discord.send(`${s.discord.mention} track: plan the CSV export work`);
  await s.discord.send("acme/web please", { channel: start.thread });
  await s.discord.send("what next?", { channel: start.thread });

  const kept = s.model.calls.map((call) => String(call[0]!.content).includes("This thread's repository: acme/web (git account github)."));
  expect(kept).toEqual([false, false, false, false, true, true]);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["Which repository: acme/api or acme/web?", "Using acme/web.", "Still acme/web."]);
});
