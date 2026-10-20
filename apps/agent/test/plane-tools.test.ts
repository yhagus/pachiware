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
  expect(results[0]).toEqual({ accounts: [{ name: "plane", workspace: "acme", planeUser: "pachibot (bot@acme.test)", planeVersion: "Plane 1.3.1", projects: [{ id: P1, identifier: "ENG", name: "Engineering" }] }] });

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

discordScenario("one key on two Plane workspaces: the bot sees each switched-on one, by account/workspace when there are two, and never asks Plane about one switched off", async (s) => {
  const P1 = "11111111-1111-4111-8111-111111111111", P3 = "33333333-3333-4333-8333-333333333333";
  const { repositories } = await import("../../../packages/db/src/index.ts");
  const acc = await s.plane({ name: "main", workspaces: [{ slug: "acme", enabled: true }, { slug: "beta", enabled: false }] });
  const listed = (results: any[]) => ({ next_cursor: "100:1:0", next_page_results: false, results });
  s.http.on("GET api.plane.so/api/v1/workspaces/acme/projects/", () => listed([{ id: P1, name: "Engineering", identifier: "ENG" }]));
  s.http.on("GET api.plane.so/api/v1/workspaces/beta/projects/", () => listed([{ id: P3, name: "Beta", identifier: "BET" }]));
  const results: any[] = [];
  s.model.script({ tool: "planeAccounts" }, (turn) => { results.push(turn.toolResults.at(-1)); return "done"; });
  await s.discord.send(`${s.discord.mention} which Plane accounts can you use?`);
  expect(results[0]).toEqual({ accounts: [{ name: "main", workspace: "acme", planeUser: "pachibot (bot@acme.test)", planeVersion: "Plane 1.3.1", projects: [{ id: P1, identifier: "ENG", name: "Engineering" }] }] });
  expect(s.http.requests.some((r) => r.url.includes("/workspaces/beta/"))).toBe(false);

  await repositories().plane.updateAccount(acc.id, { workspaces: [{ slug: "acme", enabled: true }, { slug: "beta", enabled: true }] });
  s.model.script(
    { tool: "planeProjects", args: { account: "main" } },
    (turn) => { results.push(turn.toolResults.at(-1)); return { tool: "planeProjects", args: { account: "Main/Beta" } }; },
    (turn) => { results.push(turn.toolResults.at(-1)); return "done"; },
  );
  await s.discord.send(`${s.discord.mention} which Plane projects can you reach?`);
  expect(results[1].error).toBe('Plane account "main" has several Plane workspaces here; pass "account" with one of: main/acme, main/beta');
  expect(results[2].projects.map((p: any) => p.identifier)).toEqual(["BET"]);
});

discordScenario("a channel whose Plane rule is only for a switched-off Plane workspace gets no Plane: switching it off does not open the server's others there", async (s) => {
  const { repositories } = await import("../../../packages/db/src/index.ts");
  const acc = await s.plane({ name: "main", workspaces: [{ slug: "acme", enabled: true }, { slug: "beta", enabled: true }] });
  await repositories().plane.replaceScopes(s.tenant.id, s.bot.id, "guild-1", "channel-1", [{ planeAccountId: acc.id, workspaceSlug: "beta", projectIds: ["*"] }]);
  await repositories().plane.updateAccount(acc.id, { workspaces: [{ slug: "acme", enabled: true }, { slug: "beta", enabled: false }] });
  let result: any;
  s.model.script({ tool: "planeAccounts" }, (turn) => { result = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} which Plane accounts can you use?`);
  expect(JSON.stringify(result)).toContain("Plane is not enabled here");
  expect(s.http.requests).toEqual([]);
});

discordScenario("an account on a Plane version this server does not know is refused alone; the bot's other Plane account keeps working", async (s) => {
  const P1 = "11111111-1111-4111-8111-111111111111";
  await s.plane({ name: "work" });
  // On Plane's cloud too: another scenario in this file changes Allowed hosts, which the scenario processes share.
  await s.plane({ name: "old", workspaceSlug: "legacy", version: "0.9" });
  s.http.on("GET api.plane.so/api/v1/workspaces/acme/projects/", () => ({ next_cursor: "100:1:0", next_page_results: false, results: [{ id: P1, name: "Engineering", identifier: "ENG" }] }));
  const results: any[] = [];
  s.model.script(
    { tool: "planeProjects", args: { account: "old" } },
    (turn) => { results.push(turn.toolResults.at(-1)); return { tool: "planeProjects" }; },
    (turn) => { results.push(turn.toolResults.at(-1)); return { tool: "planeAccounts" }; },
    (turn) => { results.push(turn.toolResults.at(-1)); return "done"; },
  );
  await s.discord.send(`${s.discord.mention} which Plane projects can you reach?`);

  expect(results[0].error).toBe('planeProjects is not available on Plane account "old": it is set to Plane version "0.9", which this server does not know. Use one of: work.');
  // With no account named, the one whose Plane version has the tool is used, instead of asking which.
  expect(results[1].projects.map((p: any) => p.identifier)).toEqual(["ENG"]);
  // Both accounts are made in the same instant, so their order is not fixed.
  expect([...results[2].accounts].sort((a: any, b: any) => a.name.localeCompare(b.name))).toEqual([
    { name: "old", workspace: "legacy", planeUser: "pachibot (bot@acme.test)", planeVersion: 'unknown ("0.9")', error: 'Plane account "old" is set to Plane version "0.9", which this server does not know. An admin can choose a supported version in the console.' },
    { name: "work", workspace: "acme", planeUser: "pachibot (bot@acme.test)", planeVersion: "Plane 1.3.1", projects: [{ id: P1, identifier: "ENG", name: "Engineering" }] },
  ]);
  expect(s.http.requests.some((r) => r.url.includes("/workspaces/legacy/"))).toBe(false);
});
