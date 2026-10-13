import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("a mention opens a thread and the model's answer is posted there", async (s) => {
  s.model.script("Hi Alice, the deploy is green.");
  const brief = await s.discord.send(`${s.discord.mention} is the deploy green?`);
  expect(brief.thread).toBeDefined();
  expect(s.discord.botMessages.map((m) => [m.channelId, m.content])).toEqual([[brief.thread!.id, "Hi Alice, the deploy is green."]]);
});

discordScenario("a follow-up in the bot's thread is answered without a mention", async (s) => {
  s.model.script("Which service?", "Restarting api is safe now.");
  const ask = await s.discord.send(`${s.discord.mention} can I restart it?`);
  await s.discord.send("the api one", { channel: ask.thread });
  expect(s.discord.botMessages.map((m) => [m.channelId, m.content])).toEqual([[ask.thread!.id, "Which service?"], [ask.thread!.id, "Restarting api is safe now."]]);
});

discordScenario("a scripted git read reaches the stubbed provider and its result reaches the model", async (s) => {
  await s.git({ repos: ["acme/*"] });
  s.http.on("GET api.github.com/repos/acme/api/issues", () => [{ number: 12, title: "Login loops on Safari", state: "open", user: { login: "bob" }, labels: [], html_url: "https://github.com/acme/api/issues/12", created_at: "x" }]);
  s.model.script({ tool: "repoIssues", args: { repo: "acme/api" } }, (turn) => `Open: ${turn.toolResults[0].items.map((i: any) => `#${i.number} ${i.title}`).join(", ")}`);
  await s.discord.send(`${s.discord.mention} what is open in acme/api?`);
  expect(s.http.requests.map((r) => r.method + " " + new URL(r.url).pathname)).toEqual(["GET /repos/acme/api/issues"]);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Open: #12 Login loops on Safari");
});

discordScenario("a git write waits for its asker's Confirm click before reaching the provider", async (s) => {
  await s.git({ repos: ["acme/*"] });
  s.http.on("POST api.github.com/repos/acme/api/issues/3/comments", () => ({ html_url: "https://github.com/acme/api/issues/3#c1" }));
  s.model.script({ tool: "repoComment", args: { repo: "acme/api", number: 3, kind: "issue", body: "Fixed in main" } }, "Queued the comment for your confirmation.");
  await s.discord.send(`${s.discord.mention} comment "Fixed in main" on acme/api#3`);
  const confirmation = s.discord.botMessages.at(-1)!;
  expect(s.http.requests).toEqual([]);

  const stranger = await s.discord.click(confirmation, "Confirm", { user: s.discord.bob });
  expect(stranger.responses).toMatchObject([{ kind: "reply", payload: { ephemeral: true } }]);
  expect(s.http.requests).toEqual([]);

  await s.discord.click(confirmation, "Confirm");
  expect(s.http.requests.map((r) => [r.method, r.body])).toEqual([["POST", { body: "Fixed in main" }]]);
  expect(confirmation.content).toContain("Completed");
  expect(confirmation.components).toEqual([]);
});

discordScenario("a message context-menu command reaches the bot through the fake client", async (s) => {
  const brief = await s.discord.send("- login loops on Safari\n- export CSV is slow", { author: s.discord.alice });
  const run = await s.discord.contextMenu("Retired command", brief);
  // No playbook names this command any more, so the bot only tells the person privately.
  expect(run.responses).toMatchObject([{ kind: "reply", payload: { ephemeral: true } }]);
  expect(s.model.calls).toEqual([]);
});

discordScenario("a scenario reads what the agent wrote to the Workspace", async (s) => {
  s.model.script({ tool: "writeFile", args: { path: "channel/notes/standup.md", content: "# Standup\n- ship CSV export" } }, "Saved.");
  const ask = await s.discord.send(`${s.discord.mention} note: ship CSV export`);
  expect(s.discord.botMessages.at(-1)).toMatchObject({ channelId: ask.thread!.id, content: "Saved." });
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/notes/standup.md")).toBe("# Standup\n- ship CSV export");
});
