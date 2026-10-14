import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { gitWrites } from "./support/docsRepo";

const turnOn = async (s: Scenario, ...names: string[]) => { for (const name of names) await s.availability({ level: "tenant" }, { kind: "playbook", name, value: "on" }); };
const startLine = (s: Scenario) => s.discord.botMessages.filter((m) => m.channelId === "channel-1").at(-1)!;
const confirmations = (s: Scenario) => s.discord.botMessages.filter((m) => m.components?.length);
const writes = (s: Scenario) => s.http.requests.filter((r) => r.method !== "GET").map((r) => [r.method, new URL(r.url).pathname, r.body]);

/** acme/api on GitHub numbers new issues from 101 in creation order; an issue's database id is 9000 + its number. */
function githubTracker(s: Scenario) {
  let next = 100;
  s.http.on("POST api.github.com/repos/acme/api/issues", () => { next++; return { number: next, id: 9000 + next, html_url: `https://github.com/acme/api/issues/${next}` }; });
  s.http.on(/GET https:\/\/api\.github\.com\/repos\/acme\/api\/issues\/\d+$/, (req) => { const n = Number(req.url.split("/").at(-1)); return { number: n, id: 9000 + n, title: "x", state: "open" }; });
  s.http.on(/POST https:\/\/api\.github\.com\/repos\/acme\/api\/issues\/\d+\/sub_issues/, () => ({}));
  s.http.on(/POST https:\/\/api\.github\.com\/repos\/acme\/api\/issues\/\d+\/dependencies\/blocked_by/, () => ({}));
}

discordScenario("to-tickets creates its tickets as sub-issues of the spec with their blocking links, behind one Confirm", async (s) => {
  await turnOn(s, "to-tickets");
  await s.git({ repos: ["acme/api"] });
  githubTracker(s);
  const tickets = [
    { ref: "export", title: "Stream the CSV export", body: "## Parent\n\n#42", labels: ["ready-for-agent"], parent: "#42", blockedBy: ["cursor"] },
    { ref: "cursor", title: "Page orders by cursor", body: "## Parent\n\n#42", labels: ["ready-for-agent"], parent: "#42" },
  ];
  s.model.script(
    { tool: "playbookRepositories" },
    { tool: "repoCreateIssues", args: { repo: "acme/api", issues: tickets } },
    "Two tickets are ready. Press Confirm to create them.",
  );

  await s.discord.slash("to-tickets", { text: "cut spec #42 into tickets" });

  expect(String(s.model.calls[0]![0]!.content)).toContain("### Playbook: to-tickets");
  const thread = startLine(s).thread!;
  expect(confirmations(s).map((m) => [m.channelId, m.embeds[0].description])).toEqual([[thread.id, [
    "Create 2 issues in acme/api:",
    "1. cursor: Page orders by cursor · labels: ready-for-agent · under #42",
    "2. export: Stream the CSV export · labels: ready-for-agent · under #42 · blocked by cursor",
  ].join("\n")]]);
  expect(gitWrites(s)).toEqual([]);

  const ask = confirmations(s)[0]!;
  await s.discord.click(ask, "Confirm");
  expect(writes(s)).toEqual([
    ["POST", "/repos/acme/api/issues", { title: "Page orders by cursor", body: "## Parent\n\n#42", labels: ["ready-for-agent"] }],
    ["POST", "/repos/acme/api/issues/42/sub_issues", { sub_issue_id: 9101 }],
    ["POST", "/repos/acme/api/issues", { title: "Stream the CSV export", body: "## Parent\n\n#42", labels: ["ready-for-agent"] }],
    ["POST", "/repos/acme/api/issues/42/sub_issues", { sub_issue_id: 9102 }],
    ["POST", "/repos/acme/api/issues/102/dependencies/blocked_by", { issue_id: 9101 }],
  ]);
  expect(ask.content).toContain("Created 2 issues in acme/api:");
});

discordScenario("triage relabels several issues and closes a wontfix behind one Confirm", async (s) => {
  await turnOn(s, "grilling", "domain-modeling", "triage");
  await s.git({ repos: ["acme/api"] });
  for (const n of [5, 6, 7]) s.http.on(`PUT api.github.com/repos/acme/api/issues/${n}/labels`, (req) => req.body.labels.map((name: string) => ({ name })));
  s.http.on("PATCH api.github.com/repos/acme/api/issues/7", () => ({ number: 7, state: "closed" }));
  const updates = [
    { number: 5, labels: ["bug", "ready-for-agent"] },
    { number: 6, labels: ["enhancement", "needs-info", "area: export"] },
    { number: 7, labels: ["enhancement", "wontfix"], state: "closed" },
  ];
  s.model.script(
    { tool: "playbookRepositories" },
    { tool: "repoUpdateIssues", args: { repo: "acme/api", updates } },
    "Three issues triaged. Press Confirm to apply the labels.",
  );

  await s.discord.slash("triage", { text: "move #5 to ready-for-agent, #6 to needs-info, and close #7 as wontfix" });

  const prompt = String(s.model.calls[0]![0]!.content);
  expect(prompt).toContain("### Playbook: triage");
  expect(prompt).toContain("#### Loaded playbook: grilling");
  expect(prompt).toContain("#### Loaded playbook: domain-modeling");
  expect(confirmations(s).map((m) => m.embeds[0].description)).toEqual([
    "Update 3 issues in acme/api:\n#5 · labels: bug, ready-for-agent\n#6 · labels: enhancement, needs-info, area: export\n#7 · labels: enhancement, wontfix · close",
  ]);
  expect(gitWrites(s)).toEqual([]);

  const ask = confirmations(s)[0]!;
  await s.discord.click(ask, "Confirm");
  expect(writes(s)).toEqual([
    ["PUT", "/repos/acme/api/issues/5/labels", { labels: ["bug", "ready-for-agent"] }],
    ["PUT", "/repos/acme/api/issues/6/labels", { labels: ["enhancement", "needs-info", "area: export"] }],
    ["PUT", "/repos/acme/api/issues/7/labels", { labels: ["enhancement", "wontfix"] }],
    ["PATCH", "/repos/acme/api/issues/7", { state: "closed" }],
  ]);
  expect(ask.content).toContain("Updated 3 issues in acme/api: #5, #6, #7");
});

discordScenario("wayfinder runs with grilling and domain-modeling loaded and opens a map with its first tickets behind one Confirm", async (s) => {
  await turnOn(s, "grilling", "domain-modeling", "wayfinder");
  await s.git({ repos: ["acme/api"] });
  githubTracker(s);
  const map = [
    { ref: "map", title: "Move billing to usage pricing", body: "## Destination\n\nA spec for usage pricing.", labels: ["wayfinder:map"] },
    { ref: "meter", title: "What do we meter?", body: "Map: Move billing to usage pricing\nBlocked by: nothing\n\n## Question\n\nWhich events count as usage?", labels: ["wayfinder:grilling"], parent: "map" },
    { ref: "rates", title: "How are rates stored?", body: "Map: Move billing to usage pricing\nBlocked by: What do we meter?\n\n## Question\n\nWhere do rates live?", labels: ["wayfinder:research"], parent: "map", blockedBy: ["meter"] },
  ];
  s.model.script(
    { tool: "playbookRepositories" },
    { tool: "repoCreateIssues", args: { repo: "acme/api", issues: map } },
    "The map and two tickets are ready. Press Confirm to create them.",
  );

  await s.discord.slash("wayfinder", { text: "move billing to usage pricing" });

  const prompt = String(s.model.calls[0]![0]!.content);
  expect(prompt).toContain("### Playbook: wayfinder");
  expect(prompt).toContain("#### Loaded playbook: grilling");
  expect(prompt).toContain("#### Loaded playbook: domain-modeling");
  expect(confirmations(s)).toHaveLength(1);
  expect(gitWrites(s)).toEqual([]);

  const ask = confirmations(s)[0]!;
  await s.discord.click(ask, "Confirm");
  expect(writes(s).map(([method, path, body]) => [method, path, (body as any).title ?? body])).toEqual([
    ["POST", "/repos/acme/api/issues", "Move billing to usage pricing"],
    ["POST", "/repos/acme/api/issues", "What do we meter?"],
    ["POST", "/repos/acme/api/issues/101/sub_issues", { sub_issue_id: 9102 }],
    ["POST", "/repos/acme/api/issues", "How are rates stored?"],
    ["POST", "/repos/acme/api/issues/101/sub_issues", { sub_issue_id: 9103 }],
    ["POST", "/repos/acme/api/issues/103/dependencies/blocked_by", { issue_id: 9102 }],
  ]);
  expect(ask.content).toContain("Created 3 issues in acme/api:\nmap: <https://github.com/acme/api/issues/101>");
});
