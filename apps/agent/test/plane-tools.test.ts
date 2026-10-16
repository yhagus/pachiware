import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

// Plane is faked at fetch in the shapes Plane v1.3.1 answers with; "plane-key" is the key s.plane() saves.

discordScenario("with no guild rule, planeAccounts says Plane is not enabled here and calls Plane nothing", async (s) => {
  await s.plane({ projects: null });
  let result: any;
  s.model.script({ tool: "planeAccounts" }, (turn) => { result = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} which Plane accounts can you use?`);
  expect(JSON.stringify(result)).toContain("Plane is not enabled here");
  expect(s.http.requests).toEqual([]);
});

discordScenario("planeAccounts lists the Plane user and the Plane projects this channel may use; a thread follows its parent channel", async (s) => {
  const P1 = "11111111-1111-4111-8111-111111111111", P2 = "22222222-2222-4222-8222-222222222222", P3 = "33333333-3333-4333-8333-333333333333";
  const { repositories } = await import("../../../packages/db/src/index.ts");
  const acc = await s.plane({ projects: [P1, P2] });
  await repositories().plane.replaceScopes(s.tenant.id, s.bot.id, "guild-1", "channel-1", [{ planeAccountId: acc.id, projectIds: [P1] }]);
  s.http.on("GET api.plane.so/api/v1/workspaces/acme/projects/", (req) => ({
    grouped_by: null, sub_grouped_by: null, total_count: 3, next_cursor: "100:1:0", prev_cursor: "100:-1:1", next_page_results: false, prev_page_results: false, count: 3, total_pages: 1, total_results: 3, extra_stats: null,
    results: [{ id: P1, name: "Engineering", identifier: "ENG" }, { id: P2, name: "Design", identifier: "DES" }, { id: P3, name: "Secret", identifier: "SEC" }],
  }));
  const results: any[] = [];
  const ask = () => s.model.script({ tool: "planeAccounts" }, (turn) => { results.push(turn.toolResults[0]); return "done"; });

  ask();
  const msg = await s.discord.send(`${s.discord.mention} which Plane projects can you reach?`);
  expect(msg.thread).toBeDefined();
  expect(results[0]).toEqual({ accounts: [{ name: "plane", planeUser: "pachibot (bot@acme.test)", projects: [{ id: P1, identifier: "ENG", name: "Engineering" }] }] });

  ask();
  s.discord.channel("channel-2");
  await s.discord.send(`${s.discord.mention} and here?`, { channel: "channel-2" });
  expect(results[1].accounts[0].projects.map((p: any) => p.identifier)).toEqual(["ENG", "DES"]);

  const sent = JSON.stringify(results) + JSON.stringify(s.model.calls);
  expect(sent).not.toContain("plane-key");
  expect(sent).not.toContain("api.plane.so");
  expect(s.http.requests.every((r) => r.url.startsWith("https://api.plane.so/api/v1/"))).toBe(true);
});

discordScenario("a Plane scope rule stored on a thread is ignored: the thread uses its parent channel's rule", async (s) => {
  const P1 = "11111111-1111-4111-8111-111111111111", P2 = "22222222-2222-4222-8222-222222222222";
  const { repositories } = await import("../../../packages/db/src/index.ts");
  const acc = await s.plane({ projects: [P1, P2] });
  const thread = s.discord.channel("thread-9", { thread: true, parentId: "channel-1" });
  await repositories().plane.replaceScopes(s.tenant.id, s.bot.id, "guild-1", "channel-1", [{ planeAccountId: acc.id, projectIds: [P1] }]);
  await repositories().plane.replaceScopes(s.tenant.id, s.bot.id, "guild-1", "thread-9", [{ planeAccountId: acc.id, projectIds: [P2] }]);
  s.http.on("GET api.plane.so/api/v1/workspaces/acme/projects/", () => ({
    next_cursor: "100:1:0", next_page_results: false,
    results: [{ id: P1, name: "Engineering", identifier: "ENG" }, { id: P2, name: "Design", identifier: "DES" }],
  }));
  let result: any;
  s.model.script({ tool: "planeAccounts" }, (turn) => { result = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} which Plane projects can you reach?`, { channel: thread });
  expect(result.accounts[0].projects.map((p: any) => p.identifier)).toEqual(["ENG"]);
});

discordScenario("on Plane's rate limit the request waits once when the window reopens soon, and otherwise says when to try again", async (s) => {
  await s.plane();
  let calls = 0, wait = "1";
  s.http.on("GET api.plane.so/api/v1/workspaces/acme/projects/", () => {
    calls++;
    if (calls === 1 || wait === "30") return new Response(JSON.stringify({ error_code: 5900, error_message: "RATE_LIMIT_EXCEEDED" }), { status: 429, headers: { "Retry-After": wait, "Content-Type": "application/json" } });
    return { next_cursor: "100:1:0", next_page_results: false, results: [{ id: "11111111-1111-4111-8111-111111111111", name: "Engineering", identifier: "ENG" }] };
  });
  const results: any[] = [];
  const ask = () => s.model.script({ tool: "planeAccounts" }, (turn) => { results.push(turn.toolResults[0]); return "done"; });

  ask();
  const started = Date.now();
  await s.discord.send(`${s.discord.mention} which Plane projects?`);
  expect(calls).toBe(2);
  expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  expect(results[0].accounts[0].projects.map((p: any) => p.identifier)).toEqual(["ENG"]);

  ask();
  wait = "30";
  calls = 0;
  await s.discord.send(`${s.discord.mention} again?`);
  expect(calls).toBe(1);
  expect(results[1].accounts[0].error).toContain("Try again in about 30 seconds");
}, 30000);

discordScenario("Allowed hosts is checked again on every call, so a host taken off the list is no longer reached", async (s) => {
  const { saveAllowedHosts } = await import("../../../packages/db/src/index.ts");
  await s.plane({ name: "corp", baseUrl: "https://plane.corp.example" });
  saveAllowedHosts(["plane.other.example"]);
  let result: any;
  s.model.script({ tool: "planeAccounts" }, (turn) => { result = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} which Plane projects?`);
  expect(result.accounts[0].error).toContain("not in Allowed hosts");
  expect(s.http.requests).toEqual([]);
  saveAllowedHosts([]);
});
