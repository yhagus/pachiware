import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("an issue created with labels reaches GitHub with them after Confirm", async (s) => {
  await s.git({ provider: "github", repos: ["acme/*"] });
  s.http.on("POST api.github.com/repos/acme/api/issues", () => ({ number: 12, id: 9012, html_url: "https://github.com/acme/api/issues/12" }));
  s.model.script({ tool: "repoCreateIssue", args: { repo: "acme/api", title: "Login loops on Safari", labels: ["bug", "needs-triage"] } }, "Queued the issue for your confirmation.");
  await s.discord.send(`${s.discord.mention} file a bug: login loops on Safari`);
  expect(s.http.requests).toEqual([]);

  await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm");
  expect(s.http.requests.map((r) => [r.method, new URL(r.url).pathname, r.body])).toEqual([["POST", "/repos/acme/api/issues", { title: "Login loops on Safari", labels: ["bug", "needs-triage"] }]]);
});

discordScenario("an issue created with labels reaches GitLab with them as one comma-separated list after Confirm", async (s) => {
  await s.git({ provider: "gitlab", repos: ["acme/*"] });
  s.http.on("POST gitlab.com/api/v4/projects/acme%2Fapi/issues", () => ({ iid: 12, web_url: "https://gitlab.com/acme/api/-/issues/12" }));
  s.model.script({ tool: "repoCreateIssue", args: { repo: "acme/api", title: "Login loops on Safari", labels: ["bug", "needs-triage"] } }, "Queued the issue for your confirmation.");
  await s.discord.send(`${s.discord.mention} file a bug: login loops on Safari`);
  expect(s.http.requests).toEqual([]);

  await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm");
  expect(s.http.requests.map((r) => [r.method, r.url, r.body])).toEqual([["POST", "https://gitlab.com/api/v4/projects/acme%2Fapi/issues", { title: "Login loops on Safari", labels: "bug,needs-triage" }]]);
});

discordScenario("listing issues by label sends the filter to GitHub", async (s) => {
  await s.git({ provider: "github", repos: ["acme/*"] });
  s.http.on("GET api.github.com/repos/acme/api/issues", () => [{ number: 4, title: "Map", state: "open", user: { login: "octo" }, labels: [{ name: "wayfinder" }], html_url: "u", created_at: "x" }]);
  s.model.script({ tool: "repoIssues", args: { repo: "acme/api", labels: ["wayfinder", "map"] } }, (turn) => `found ${turn.toolResults[0].items.map((i: any) => i.number).join(",")}`);
  await s.discord.send(`${s.discord.mention} list the wayfinder maps`);
  const url = new URL(s.http.requests.at(-1)!.url);
  expect([url.pathname, url.searchParams.get("labels"), url.searchParams.get("state")]).toEqual(["/repos/acme/api/issues", "wayfinder,map", "open"]);
  expect(s.discord.botMessages.at(-1)!.content).toContain("found 4");
});

discordScenario("listing issues by label sends the filter to GitLab", async (s) => {
  await s.git({ provider: "gitlab", repos: ["acme/*"] });
  s.http.on("GET gitlab.com/api/v4/projects/acme%2Fapi/issues", () => [{ iid: 4, title: "Map", state: "opened", author: { username: "octo" }, labels: ["wayfinder"], web_url: "u", created_at: "x" }]);
  s.model.script({ tool: "repoIssues", args: { repo: "acme/api", labels: ["wayfinder", "map"] } }, (turn) => `found ${turn.toolResults[0].items.map((i: any) => i.number).join(",")}`);
  await s.discord.send(`${s.discord.mention} list the wayfinder maps`);
  const url = new URL(s.http.requests.at(-1)!.url);
  expect([url.searchParams.get("labels"), url.searchParams.get("state")]).toEqual(["wayfinder,map", "opened"]);
  expect(s.discord.botMessages.at(-1)!.content).toContain("found 4");
});

discordScenario("repoLinkIssues records on GitHub that one issue is blocked by another, after Confirm", async (s) => {
  await s.git({ provider: "github", repos: ["acme/*"] });
  s.http.on("GET api.github.com/repos/acme/api/issues/3", () => ({ number: 3, id: 9003, title: "Schema", state: "open" }));
  s.http.on("POST api.github.com/repos/acme/api/issues/5/dependencies/blocked_by", () => ({ number: 5 }));
  s.model.script({ tool: "repoLinkIssues", args: { repo: "acme/api", issue: 5, blockedBy: 3 } }, "Queued the link for your confirmation.");
  await s.discord.send(`${s.discord.mention} mark acme/api#5 as blocked by #3`);
  expect(s.http.requests).toEqual([]);

  await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm");
  expect(s.http.requests.map((r) => [r.method, new URL(r.url).pathname, r.body])).toEqual([
    ["GET", "/repos/acme/api/issues/3", null],
    ["POST", "/repos/acme/api/issues/5/dependencies/blocked_by", { issue_id: 9003 }],
  ]);
});

discordScenario("repoLinkIssues records on GitLab that one issue is blocked by another, after Confirm", async (s) => {
  await s.git({ provider: "gitlab", repos: ["acme/*"] });
  s.http.on("POST gitlab.com/api/v4/projects/acme%2Fapi/issues/3/links", () => ({ id: 1 }));
  s.model.script({ tool: "repoLinkIssues", args: { repo: "acme/api", issue: 5, blockedBy: 3 } }, "Queued the link for your confirmation.");
  await s.discord.send(`${s.discord.mention} mark acme/api#5 as blocked by #3`);
  expect(s.http.requests).toEqual([]);

  await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm");
  expect(s.http.requests.map((r) => [r.method, r.url, r.body])).toEqual([
    ["POST", "https://gitlab.com/api/v4/projects/acme%2Fapi/issues/3/links", { target_project_id: "acme/api", target_issue_iid: 5, link_type: "blocks" }],
  ]);
});

discordScenario("repoSubIssue attaches and detaches a GitHub sub-issue after each Confirm", async (s) => {
  await s.git({ provider: "github", repos: ["acme/*"] });
  s.http.on("GET api.github.com/repos/acme/api/issues/7", () => ({ number: 7, id: 9007, title: "Ticket", state: "open" }));
  s.http.on("POST api.github.com/repos/acme/api/issues/4/sub_issues", () => ({ number: 7 }));
  s.http.on("DELETE api.github.com/repos/acme/api/issues/4/sub_issue", () => ({ number: 7 }));
  s.model.script({ tool: "repoSubIssue", args: { repo: "acme/api", parent: 4, child: 7, action: "attach" } }, "Queued.");
  await s.discord.send(`${s.discord.mention} put acme/api#7 under the map #4`);
  expect(s.http.requests).toEqual([]);
  await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm");

  s.model.script({ tool: "repoSubIssue", args: { repo: "acme/api", parent: 4, child: 7, action: "detach" } }, "Queued.");
  await s.discord.send(`${s.discord.mention} take #7 out of the map #4 again`);
  await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm");
  expect(s.http.requests.filter((r) => r.method !== "GET").map((r) => [r.method, new URL(r.url).pathname, r.body])).toEqual([
    ["POST", "/repos/acme/api/issues/4/sub_issues", { sub_issue_id: 9007 }],
    ["DELETE", "/repos/acme/api/issues/4/sub_issue", { sub_issue_id: 9007 }],
  ]);
});

discordScenario("repoSubIssue on GitLab links the child to the parent and keeps a task list line in the parent's description", async (s) => {
  await s.git({ provider: "gitlab", repos: ["acme/*"] });
  const issue4 = "gitlab.com/api/v4/projects/acme%2Fapi/issues/4";
  let description = "The map.\n\n- [ ] #6";
  s.http.on(`GET ${issue4}`, () => ({ iid: 4, title: "Map", state: "opened", description }));
  s.http.on(`PUT ${issue4}`, (req) => { description = req.body.description; return { iid: 4, title: "Map", web_url: "u" }; });
  s.http.on(`POST ${issue4}/links`, () => ({ id: 31 }));
  s.http.on(`GET ${issue4}/links`, () => [{ iid: 6, issue_link_id: 30, link_type: "relates_to" }, { iid: 7, issue_link_id: 31, link_type: "relates_to" }]);
  s.http.on(`DELETE ${issue4}/links/31`, () => ({ id: 31 }));

  s.model.script({ tool: "repoSubIssue", args: { repo: "acme/api", parent: 4, child: 7, action: "attach" } }, "Queued.");
  await s.discord.send(`${s.discord.mention} put acme/api#7 under the map #4`);
  expect(s.http.requests).toEqual([]);
  await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm");
  const attached = s.http.requests.filter((r) => r.method !== "GET").map((r) => [r.method, r.url, r.body]);
  expect(attached).toEqual([
    ["POST", `https://${issue4}/links`, { target_project_id: "acme/api", target_issue_iid: 7, link_type: "relates_to" }],
    ["PUT", `https://${issue4}`, { description: "The map.\n\n- [ ] #6\n- [ ] #7" }],
  ]);

  s.model.script({ tool: "repoSubIssue", args: { repo: "acme/api", parent: 4, child: 7, action: "detach" } }, "Queued.");
  await s.discord.send(`${s.discord.mention} take #7 out of the map #4 again`);
  await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm");
  expect(s.http.requests.filter((r) => r.method !== "GET").map((r) => [r.method, r.url, r.body]).slice(attached.length)).toEqual([
    ["DELETE", `https://${issue4}/links/31`, null],
    ["PUT", `https://${issue4}`, { description: "The map.\n\n- [ ] #6" }],
  ]);
});
