import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const writes = (s: Scenario, from = 0) => s.http.requests.slice(from).filter((r) => r.method !== "GET").map((r) => [r.method, new URL(r.url).pathname, r.body]);

/** GitHub numbers issues from 101 in creation order; the database id is 9000 + the number. */
function githubIssues(s: Scenario, fail?: (title: string) => boolean) {
  let next = 100;
  s.http.on("POST api.github.com/repos/acme/api/issues", (req) => {
    if (fail?.(req.body.title)) return new Response("Service Unavailable", { status: 503 });
    next++;
    return { number: next, id: 9000 + next, html_url: `https://github.com/acme/api/issues/${next}` };
  });
  s.http.on(/GET https:\/\/api\.github\.com\/repos\/acme\/api\/issues\/\d+$/, (req) => { const n = Number(req.url.split("/").at(-1)); return { number: n, id: 9000 + n, title: "x", state: "open" }; });
  s.http.on(/POST https:\/\/api\.github\.com\/repos\/acme\/api\/issues\/\d+\/sub_issues/, () => ({}));
  s.http.on(/POST https:\/\/api\.github\.com\/repos\/acme\/api\/issues\/\d+\/dependencies\/blocked_by/, () => ({}));
}

const MAP = [
  { ref: "map", title: "Map", labels: ["wayfinder"] },
  { ref: "api", title: "Build the API", body: "Endpoints.", labels: ["ready-for-agent"], parent: "map", blockedBy: ["schema"] },
  { ref: "schema", title: "Design the schema", parent: "map" },
];

discordScenario("one Confirm creates a whole batch on GitHub with labels, parents and blocked-by links, blockers first", async (s) => {
  await s.git({ provider: "github", repos: ["acme/*"] });
  githubIssues(s);
  s.model.script({ tool: "repoCreateIssues", args: { repo: "acme/api", issues: MAP } }, "Queued the batch for your confirmation.");
  await s.discord.send(`${s.discord.mention} cut the map into tickets`);
  expect(s.http.requests).toEqual([]);

  const confirmation = s.discord.botMessages.at(-1)!;
  expect(confirmation.embeds[0].description).toBe([
    "Create 3 issues in acme/api:",
    "1. map: Map · labels: wayfinder",
    "2. schema: Design the schema · under map",
    "3. api: Build the API · labels: ready-for-agent · under map · blocked by schema",
  ].join("\n"));
  expect(confirmation.components[0].components.map((b: any) => b.label)).toEqual(["Confirm", "Cancel"]);

  await s.discord.click(confirmation, "Confirm");
  expect(writes(s)).toEqual([
    ["POST", "/repos/acme/api/issues", { title: "Map", labels: ["wayfinder"] }],
    ["POST", "/repos/acme/api/issues", { title: "Design the schema" }],
    ["POST", "/repos/acme/api/issues/101/sub_issues", { sub_issue_id: 9102 }],
    ["POST", "/repos/acme/api/issues", { title: "Build the API", body: "Endpoints.", labels: ["ready-for-agent"] }],
    ["POST", "/repos/acme/api/issues/101/sub_issues", { sub_issue_id: 9103 }],
    ["POST", "/repos/acme/api/issues/103/dependencies/blocked_by", { issue_id: 9102 }],
  ]);
  expect(confirmation.content).toContain("Created 3 issues in acme/api:\nmap: <https://github.com/acme/api/issues/101>\nschema: <https://github.com/acme/api/issues/102>\napi: <https://github.com/acme/api/issues/103>");
  expect(confirmation.components).toEqual([]);
});

discordScenario("a failure stops the batch, and running the same batch again after a restart creates only what is missing", async (s) => {
  await s.git({ provider: "github", repos: ["acme/*"] });
  let down = true;
  githubIssues(s, (title) => title === "Design the schema" && down);
  s.model.script({ tool: "repoCreateIssues", args: { repo: "acme/api", issues: MAP } }, "Queued.");
  await s.discord.send(`${s.discord.mention} cut the map into tickets`);
  const first = s.discord.botMessages.at(-1)!;
  await s.discord.click(first, "Confirm");
  expect(writes(s).map(([, path, body]) => [path, body.title])).toEqual([["/repos/acme/api/issues", "Map"], ["/repos/acme/api/issues", "Design the schema"]]);
  expect(first.content).toContain("Stopped at schema (Design the schema): github returned 503");
  expect(first.content).toContain("Created:\nmap: <https://github.com/acme/api/issues/101>\nNot created: schema, api\nRun the same batch again to do only what is missing.");

  await s.restart();
  down = false;
  s.model.script({ tool: "repoCreateIssues", args: { repo: "acme/api", issues: MAP } }, "Queued.");
  await s.discord.send(`${s.discord.mention} try the tickets again`);
  const again = s.discord.botMessages.at(-1)!;
  expect(again.embeds[0].description).toBe([
    "Create 2 issues in acme/api:",
    "1. schema: Design the schema · under map",
    "2. api: Build the API · labels: ready-for-agent · under map · blocked by schema",
  ].join("\n"));
  const before = s.http.requests.length;
  await s.discord.click(again, "Confirm");
  expect(writes(s, before)).toEqual([
    ["POST", "/repos/acme/api/issues", { title: "Design the schema" }],
    ["POST", "/repos/acme/api/issues/101/sub_issues", { sub_issue_id: 9102 }],
    ["POST", "/repos/acme/api/issues", { title: "Build the API", body: "Endpoints.", labels: ["ready-for-agent"] }],
    ["POST", "/repos/acme/api/issues/101/sub_issues", { sub_issue_id: 9103 }],
    ["POST", "/repos/acme/api/issues/103/dependencies/blocked_by", { issue_id: 9102 }],
  ]);
  expect(again.content).toContain("Created 3 issues in acme/api:\nmap: <https://github.com/acme/api/issues/101>\nschema: <https://github.com/acme/api/issues/102>\napi: <https://github.com/acme/api/issues/103>");

  s.model.script({ tool: "repoCreateIssues", args: { repo: "acme/api", issues: MAP } }, (turn) => `tool said: ${JSON.stringify(turn.toolResults[0])}`);
  await s.discord.send(`${s.discord.mention} once more`);
  expect(s.discord.botMessages.at(-1)!.content).toContain("Every issue of this batch already exists: map #101, schema #102, api #103");
  expect(writes(s, before).length).toBe(5);
});

discordScenario("a batch of more than 25 issues is refused before any Confirm", async (s) => {
  await s.git({ provider: "github", repos: ["acme/*"] });
  const issues = Array.from({ length: 26 }, (_, i) => ({ ref: `t${i + 1}`, title: `Ticket ${i + 1}` }));
  s.model.script({ tool: "repoCreateIssues", args: { repo: "acme/api", issues } }, (turn) => `tool said: ${JSON.stringify(turn.toolResults[0])}`);
  await s.discord.send(`${s.discord.mention} file all 26 tickets`);
  const reply = s.discord.botMessages.at(-1)!;
  expect(reply.content).toContain("A batch holds at most 25 items; this one has 26.");
  expect(s.discord.botMessages.some((m) => m.components.length)).toBe(false);
  expect(s.http.requests).toEqual([]);
});

discordScenario("an owner's thread grant does not confirm a batch; only the person who asked can", async (s) => {
  process.env.GIT_OWNER_DISCORD_IDS = s.discord.alice.id;
  await s.git({ provider: "github", repos: ["acme/*"] });
  githubIssues(s);
  s.http.on("POST api.github.com/repos/acme/api/issues/3/comments", () => ({ html_url: "https://github.com/acme/api/issues/3#c1" }));
  s.model.script({ tool: "repoComment", args: { repo: "acme/api", number: 3, kind: "issue", body: "Cutting tickets" } }, "ok");
  await s.discord.send(`${s.discord.mention} comment on #3 that we're cutting tickets`);
  await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm changes in this thread");
  const before = s.http.requests.length;

  s.model.script({ tool: "repoCreateIssues", args: { repo: "acme/api", issues: MAP.slice(0, 1) } }, "Queued.");
  await s.discord.send(`${s.discord.mention} create the map issue`);
  const confirmation = s.discord.botMessages.at(-1)!;
  expect(s.http.requests.length).toBe(before);
  expect(confirmation.components[0].components.map((b: any) => b.label)).toEqual(["Confirm", "Cancel"]);
  expect(confirmation.embeds[0].footer.text).toContain("Confirming changes for the thread does not cover it.");

  const stranger = await s.discord.click(confirmation, "Confirm", { user: s.discord.bob });
  expect(stranger.responses).toMatchObject([{ kind: "reply", payload: { content: "Only the person who asked for this can confirm or cancel it.", ephemeral: true } }]);
  expect(s.http.requests.length).toBe(before);

  await s.discord.click(confirmation, "Confirm");
  expect(writes(s, before)).toEqual([["POST", "/repos/acme/api/issues", { title: "Map", labels: ["wayfinder"] }]]);
});

discordScenario("a GitLab batch keeps going when the blocked-by link needs Premium, and says which links are missing", async (s) => {
  await s.git({ provider: "gitlab", repos: ["acme/*"] });
  const project = "gitlab.com/api/v4/projects/acme%2Fapi";
  let next = 10;
  s.http.on(`POST ${project}/issues`, () => { next++; return { iid: next, web_url: `https://gitlab.com/acme/api/-/issues/${next}` }; });
  s.http.on(`POST ${project}/issues/11/links`, () => new Response("Forbidden", { status: 403 }));
  s.model.script({ tool: "repoCreateIssues", args: { repo: "acme/api", issues: [
    { ref: "api", title: "Build the API", labels: ["bug", "p1"], blockedBy: ["schema"] },
    { ref: "schema", title: "Design the schema" },
  ] } }, "Queued.");
  await s.discord.send(`${s.discord.mention} file the two tickets`);
  const confirmation = s.discord.botMessages.at(-1)!;
  await s.discord.click(confirmation, "Confirm");
  expect(s.http.requests.map((r) => [r.method, r.url, r.body])).toEqual([
    ["POST", `https://${project}/issues`, { title: "Design the schema" }],
    ["POST", `https://${project}/issues`, { title: "Build the API", labels: "bug,p1" }],
    ["POST", `https://${project}/issues/11/links`, { target_project_id: "acme/api", target_issue_iid: 12, link_type: "blocks" }],
  ]);
  expect(confirmation.content).toContain("Created 2 issues in acme/api:\nschema: <https://gitlab.com/acme/api/-/issues/11>\napi: <https://gitlab.com/acme/api/-/issues/12>\nCould not record these blocked-by links: api by schema.");
});

discordScenario("a blocked-by link that failed is retried, alone, when the same batch runs again", async (s) => {
  await s.git({ provider: "github", repos: ["acme/*"] });
  let down = true;
  githubIssues(s);
  s.http.on(/POST https:\/\/api\.github\.com\/repos\/acme\/api\/issues\/102\/dependencies\/blocked_by/, () => (down ? new Response("Service Unavailable", { status: 503 }) : {}));
  const batch = [{ ref: "schema", title: "Design the schema" }, { ref: "api", title: "Build the API", blockedBy: ["schema"] }];
  s.model.script({ tool: "repoCreateIssues", args: { repo: "acme/api", issues: batch } }, "Queued.");
  await s.discord.send(`${s.discord.mention} file the two tickets`);
  const first = s.discord.botMessages.at(-1)!;
  await s.discord.click(first, "Confirm");
  expect(first.content).toContain("Could not record these blocked-by links: api by schema.\nRun the same batch again to retry them.");

  down = false;
  s.model.script({ tool: "repoCreateIssues", args: { repo: "acme/api", issues: batch } }, "Queued.");
  await s.discord.send(`${s.discord.mention} try the link again`);
  const again = s.discord.botMessages.at(-1)!;
  expect(again.embeds[0].description).toBe("Finish linking issues in acme/api:\n1. api: Build the API · blocked by schema · exists as #102");
  const before = s.http.requests.length;
  await s.discord.click(again, "Confirm");
  expect(writes(s, before)).toEqual([["POST", "/repos/acme/api/issues/102/dependencies/blocked_by", { issue_id: 9101 }]]);
  expect(again.content).toContain("Created 2 issues in acme/api:");
  expect(again.content).not.toContain("Could not record");
});

discordScenario("repoUpdateIssues applies label, state and assignee changes behind one Confirm, and a rerun after a failure touches only what is left", async (s) => {
  await s.git({ provider: "github", repos: ["acme/*"] });
  let down = true;
  s.http.on("PUT api.github.com/repos/acme/api/issues/5/labels", () => [{ name: "ready-for-agent" }]);
  s.http.on("PATCH api.github.com/repos/acme/api/issues/5", () => ({ number: 5, assignees: [{ login: "octo" }] }));
  s.http.on("PATCH api.github.com/repos/acme/api/issues/6", () => (down ? new Response("Service Unavailable", { status: 503 }) : { number: 6, state: "closed" }));
  const updates = [
    { number: 5, labels: ["ready-for-agent"], assignees: ["octo"] },
    { number: 6, state: "closed" },
  ];
  s.model.script({ tool: "repoUpdateIssues", args: { repo: "acme/api", updates } }, "Queued.");
  await s.discord.send(`${s.discord.mention} triage #5 and close #6`);
  const first = s.discord.botMessages.at(-1)!;
  expect(first.embeds[0].description).toBe("Update 2 issues in acme/api:\n#5 · labels: ready-for-agent · assignees: octo\n#6 · close");
  expect(first.components[0].components.map((b: any) => b.label)).toEqual(["Confirm", "Cancel"]);
  expect(s.http.requests).toEqual([]);

  await s.discord.click(first, "Confirm");
  expect(writes(s)).toEqual([
    ["PUT", "/repos/acme/api/issues/5/labels", { labels: ["ready-for-agent"] }],
    ["PATCH", "/repos/acme/api/issues/5", { assignees: ["octo"] }],
    ["PATCH", "/repos/acme/api/issues/6", { state: "closed" }],
  ]);
  expect(first.content).toContain("Stopped at #6: github returned 503");
  expect(first.content).toContain("Updated: #5\nNot updated: #6\nRun the same batch again to do only what is missing.");

  down = false;
  s.model.script({ tool: "repoUpdateIssues", args: { repo: "acme/api", updates } }, "Queued.");
  await s.discord.send(`${s.discord.mention} try again`);
  const again = s.discord.botMessages.at(-1)!;
  expect(again.embeds[0].description).toBe("Update 1 issue in acme/api:\n#6 · close");
  const before = s.http.requests.length;
  await s.discord.click(again, "Confirm");
  expect(writes(s, before)).toEqual([["PATCH", "/repos/acme/api/issues/6", { state: "closed" }]]);
  expect(again.content).toContain("Updated 2 issues in acme/api: #5, #6");
});
