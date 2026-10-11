import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("one confirmation from the author creates every draft on GitHub, blockers first, even under a thread grant", async (s) => {
  const { draftedBrief, briefFields, embedsIn } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  process.env.GIT_OWNER_DISCORD_IDS = s.discord.alice.id;
  const { thread, record } = await draftedBrief(s);
  const drafts = embedsIn(s, thread.id);

  // Alice, an owner, confirms Git changes for the whole thread through an ordinary write.
  s.http.on("POST api.github.com/repos/acme/api/issues/3/comments", () => ({ html_url: "https://github.com/acme/api/issues/3#c1" }));
  s.model.script({ tool: "repoComment", args: { repo: "acme/api", number: 3, kind: "issue", body: "Drafting follow-ups" } }, "ok");
  await s.discord.send("comment on #3 that we're drafting follow-ups", { channel: thread });
  await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm Git changes in this thread");
  expect(s.http.requests.filter((r) => r.method === "POST").map((r) => r.url)).toEqual(["https://api.github.com/repos/acme/api/issues/3/comments"]);

  let issue = 100;
  s.http.on("POST api.github.com/repos/acme/api/issues", () => { issue++; return { number: issue, id: 9000 + issue, html_url: `https://github.com/acme/api/issues/${issue}` }; });
  s.http.on("POST api.github.com/repos/acme/api/issues/102/dependencies/blocked_by", () => ({ number: 101 }));
  s.model.script({ tool: "createBriefIssues" }, "ok");
  const before = s.http.requests.length;
  await s.discord.send("create them", { channel: thread });

  const confirmation = s.discord.botMessages.at(-1)!;
  expect(s.http.requests.length).toBe(before);
  const summary = confirmation.embeds[0].description as string;
  expect(summary).toContain("1. Stop the Safari login loop · acme/api · labels: bug, safari");
  expect(summary).toContain("2. Stream CSV exports · acme/api · labels: enhancement · blocked by draft 1");
  expect(confirmation.components[0].components.map((b: any) => b.label)).toEqual(["Confirm", "Cancel"]);

  const stranger = await s.discord.click(confirmation, "Confirm", { user: s.discord.bob });
  expect(stranger.responses).toMatchObject([{ kind: "reply", payload: { ephemeral: true } }]);
  expect(s.http.requests.length).toBe(before);

  await s.discord.click(confirmation, "Confirm");
  const writes = s.http.requests.slice(before).filter((r) => r.method === "POST");
  expect(writes.map((r) => new URL(r.url).pathname)).toEqual(["/repos/acme/api/issues", "/repos/acme/api/issues", "/repos/acme/api/issues/102/dependencies/blocked_by"]);
  expect(writes[0]!.body).toMatchObject({ title: "Stop the Safari login loop", labels: ["bug", "safari"] });
  expect(writes[0]!.body.body).toContain("- [ ] An expired session redirects to sign-in exactly once\n");
  expect(writes[0]!.body.body).not.toContain("*(added)*");
  expect(writes[1]!.body).toMatchObject({ title: "Stream CSV exports", labels: ["enhancement"] });
  expect(writes[1]!.body.body).toContain("## Blocked by\n- #101");
  expect(writes[2]!.body).toEqual({ issue_id: 9101 });

  expect(drafts.map((m: any) => m.embeds[0].description)).toEqual(["Created: https://github.com/acme/api/issues/101", "Created: https://github.com/acme/api/issues/102"]);
  const report = s.discord.botMessages.at(-1)!;
  expect(report.channelId).toBe(thread.id);
  expect(report.content).toContain("1. Stop the Safari login loop: <https://github.com/acme/api/issues/101>\n2. Stream CSV exports: <https://github.com/acme/api/issues/102>");
  expect(confirmation.content).toBe("Created 2 issues. The links are in the thread.");
  expect(confirmation.components).toEqual([]);

  const fields = await briefFields(s, record);
  expect(fields.status).toBe("done");
  expect(fields.drafts.map((d: any) => d.issue)).toEqual([{ number: 101, url: "https://github.com/acme/api/issues/101", id: 9101 }, { number: 102, url: "https://github.com/acme/api/issues/102", id: 9102 }]);
});

discordScenario("a failure stops the batch and reports both lists with drafts.md, and continuing creates only the drafts without a number", async (s) => {
  const { draftedBrief, briefFields, embedsIn } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { thread, record } = await draftedBrief(s);
  let down = true;
  s.http.on("POST api.github.com/repos/acme/api/issues", (req) => {
    if (req.body.title === "Stream CSV exports" && down) return new Response("Service Unavailable", { status: 503 });
    const n = req.body.title === "Stream CSV exports" ? 102 : 101;
    return { number: n, id: 9000 + n, html_url: `https://github.com/acme/api/issues/${n}` };
  });
  s.http.on("POST api.github.com/repos/acme/api/issues/102/dependencies/blocked_by", () => ({}));
  s.model.script({ tool: "createBriefIssues" }, "ok");
  await s.discord.send("create them", { channel: thread });
  const first = s.discord.botMessages.at(-1)!;
  await s.discord.click(first, "Confirm");

  const report = s.discord.botMessages.at(-1)!;
  expect(report.content).toContain("Stopped at draft 2, Stream CSV exports: github returned 503");
  expect(report.content).toContain("**Created**\n1. Stop the Safari login loop: <https://github.com/acme/api/issues/101>\n**Not created**\n2. Stream CSV exports");
  expect(report.files.map((f: any) => f.name)).toEqual(["drafts.md"]);
  expect(String(report.files[0].attachment)).toContain("# 2. Stream CSV exports");
  expect(String(report.files[0].attachment)).not.toContain("# 1. Stop the Safari login loop");
  expect(first.content).toBe("Stopped at draft 2 with 1 issue created. Details are in the thread.");
  const [one, two] = embedsIn(s, thread.id).map((m: any) => m.embeds[0].description);
  expect(one).toBe("Created: https://github.com/acme/api/issues/101");
  expect(two).toContain("## Summary");
  let fields = await briefFields(s, record);
  expect(fields.status).toBe("active");
  expect(fields.drafts.map((d: any) => d.issue?.number)).toEqual([101, undefined]);

  down = false;
  s.model.script({ tool: "createBriefIssues" }, "ok");
  await s.discord.send("continue the rest", { channel: thread });
  const again = s.discord.botMessages.at(-1)!;
  expect(again.embeds[0].description).toBe("Create 1 issue from this brief:\n2. Stream CSV exports · acme/api · labels: enhancement · blocked by #101");
  const before = s.http.requests.length;
  await s.discord.click(again, "Confirm");
  const writes = s.http.requests.slice(before).filter((r) => r.method === "POST");
  expect(writes.map((r) => [new URL(r.url).pathname, r.body.title ?? r.body.issue_id])).toEqual([["/repos/acme/api/issues", "Stream CSV exports"], ["/repos/acme/api/issues/102/dependencies/blocked_by", 9101]]);
  expect(writes[0]!.body.body).toContain("## Blocked by\n- #101");
  expect(s.discord.botMessages.at(-1)!.content).toContain("Created 2 issues from this brief:\n1. Stop the Safari login loop: <https://github.com/acme/api/issues/101>\n2. Stream CSV exports: <https://github.com/acme/api/issues/102>");
  fields = await briefFields(s, record);
  expect(fields.status).toBe("done");
});

discordScenario("a draft the author skips is never created, and its dependents name it as text", async (s) => {
  const { draftedBrief, briefFields } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { thread, record } = await draftedBrief(s);
  s.http.on("POST api.github.com/repos/acme/api/issues", () => ({ number: 102, id: 9102, html_url: "https://github.com/acme/api/issues/102" }));
  s.model.script({ tool: "createBriefIssues", args: { skip: [1] } }, "ok");
  await s.discord.send("skip draft 1 and create the rest", { channel: thread });
  const confirmation = s.discord.botMessages.at(-1)!;
  expect(confirmation.embeds[0].description).toBe("Create 1 issue from this brief:\n2. Stream CSV exports · acme/api · labels: enhancement · blocked by draft 1\nSkipped: 1. Stop the Safari login loop");
  const before = s.http.requests.length;
  await s.discord.click(confirmation, "Confirm");

  const writes = s.http.requests.slice(before).filter((r) => r.method === "POST");
  expect(writes.map((r) => r.body.title)).toEqual(["Stream CSV exports"]);
  expect(writes[0]!.body.body).toContain("## Blocked by\n- Stop the Safari login loop (not created)");
  expect(s.discord.botMessages.at(-1)!.content).toContain("Skipped: 1. Stop the Safari login loop");
  const fields = await briefFields(s, record);
  expect(fields.drafts.map((d: any) => [d.skipped, d.issue?.number])).toEqual([[true, undefined], [undefined, 102]]);
  expect(fields.status).toBe("done");
});

discordScenario("on GitLab the labels go in the create request and a refused blocks link leaves the Blocked by text standing", async (s) => {
  const { draftedBrief, briefFields, embedsIn } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { thread, record } = await draftedBrief(s, "gitlab");
  const project = "gitlab.com/api/v4/projects/acme%2Fapi";
  let iid = 40;
  s.http.on(`POST ${project}/issues`, () => { iid++; return { iid, id: 7000 + iid, web_url: `https://gitlab.com/acme/api/-/issues/${iid}` }; });
  s.http.on(`POST ${project}/issues/41/links`, () => new Response(JSON.stringify({ message: "403 Forbidden" }), { status: 403 }));
  s.model.script({ tool: "createBriefIssues" }, "ok");
  await s.discord.send("create the issues", { channel: thread });
  const before = s.http.requests.length;
  await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm");

  const writes = s.http.requests.slice(before).filter((r) => r.method === "POST");
  expect(writes.map((r) => new URL(r.url).pathname)).toEqual(["/api/v4/projects/acme%2Fapi/issues", "/api/v4/projects/acme%2Fapi/issues", "/api/v4/projects/acme%2Fapi/issues/41/links"]);
  expect(writes[0]!.body).toMatchObject({ title: "Stop the Safari login loop", labels: "bug,safari" });
  expect(writes[0]!.body.description).not.toContain("*(added)*");
  expect(writes[1]!.body.description).toContain("## Blocked by\n- #41");
  expect(writes[2]!.body).toEqual({ target_project_id: "acme/api", target_issue_iid: 42, link_type: "blocks" });

  expect(embedsIn(s, thread.id).map((m: any) => m.embeds[0].description)).toEqual(["Created: https://gitlab.com/acme/api/-/issues/41", "Created: https://gitlab.com/acme/api/-/issues/42"]);
  expect(s.discord.botMessages.at(-1)!.content).toContain("2. Stream CSV exports: <https://gitlab.com/acme/api/-/issues/42>");
  const fields = await briefFields(s, record);
  expect(fields.status).toBe("done");
  expect(fields.drafts.map((d: any) => d.issue)).toEqual([{ number: 41, url: "https://gitlab.com/acme/api/-/issues/41" }, { number: 42, url: "https://gitlab.com/acme/api/-/issues/42" }]);
});
