import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("with one allowed repository every draft of the breakdown targets it, and no question asks which", async (s) => {
  const { briefFields, ROUND_1 } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  await s.git({ repos: ["acme/api"] });
  s.model.script(
    { tool: "briefRepositories" },
    (turn) => {
      expect(turn.toolResults[0]).toMatchObject({ single: "acme/api", repositories: [{ repo: "acme/api" }] });
      return { tool: "postBriefRound", args: ROUND_1 };
    },
    "ok",
  );
  const brief = await s.discord.send(ROUND_1.points.map((p: string) => `- ${p}`).join("\n"));
  await s.discord.contextMenu("Draft issues", brief);

  const round = s.discord.botMessages.find((m) => m.channelId === brief.thread!.id)!.content;
  expect(round).toContain("**1. Stop the Safari login loop** · point 1 · acme/api");
  expect(round).toContain("**2. Stream CSV exports** · point 2 · acme/api · blocked by draft 1");
  const fields = await briefFields(s, `guilds/guild-1/channels/channel-1/threads/${brief.thread!.id}.md`);
  expect(fields.drafts.map((d: any) => d.repo)).toEqual(["acme/api", "acme/api"]);
});

discordScenario("in a brief thread the plain repository reads are closed, so every read goes through the budget", async (s) => {
  const { ROUND_1 } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  await s.git({ repos: ["acme/api"] });
  s.model.script(
    [{ tool: "repoReadFile", args: { repo: "acme/api", path: "README.md" } }, { tool: "repoSearchCode", args: { repo: "acme/api", query: "session" } }],
    (turn) => {
      expect(turn.toolResults.map((r: any) => r.error)).toEqual([
        "This thread follows the issue-draft playbook, which closes repoReadFile: follow the playbook's steps instead.",
        "This thread follows the issue-draft playbook, which closes repoSearchCode: follow the playbook's steps instead.",
      ]);
      return { tool: "postBriefRound", args: ROUND_1 };
    },
    "ok",
  );
  const brief = await s.discord.send(ROUND_1.points.map((p: string) => `- ${p}`).join("\n"));
  await s.discord.contextMenu("Draft issues", brief);
  expect(s.http.requests.filter((r) => r.url.includes("api.github.com"))).toEqual([]);
});

discordScenario("a likely duplicate becomes a skip-or-create question, and the drafts carry existing labels and Context used pinned to HEAD", async (s) => {
  const { briefFields, embedsIn, draft, stubRepo, HEAD, ROUND_1 } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { checkDraft } = await import(process.cwd() + "/packages/skills/src/draftChecker.ts");
  await s.git({ repos: ["acme/api"] });
  stubRepo(s, {
    files: { "README.md": "# API\nSessions live in the SessionStore.", "docs/adr": ["0001-sessions.md"], "src/session.ts": "export class SessionStore {}" },
    labels: ["bug", "enhancement", "safari"], issues: [{ number: 12, title: "Login loops on Safari" }], code: ["src/session.ts"],
  });
  const read = (args: Record<string, unknown>) => ({ tool: "briefRead", args: { repo: "acme/api", ...args } });
  const round = { ...ROUND_1, questions: [{ point: 1, question: "Point 1 looks like #12 *Login loops on Safari*. Skip it, or create a new issue anyway?", recommendation: "Create it anyway: #12 is about Safari 16.", options: ["Skip it", "Create anyway"] }] };
  s.model.script(
    [{ tool: "briefRepositories" }, read({ step: "repository" }), read({ step: "code", point: 1, query: "session" })],
    (turn) => {
      expect(turn.toolResults[1]).toMatchObject({ commit: HEAD, branch: "main", labels: ["bug", "enhancement", "safari"], adrs: ["0001-sessions.md"], readme: "# API\nSessions live in the SessionStore." });
      expect(JSON.stringify(turn.toolResults[2])).toContain('Run step \\"duplicates\\" for point 1 in acme/api first');
      return [read({ step: "duplicates", point: 1, query: "safari login" }), read({ step: "issue", point: 1, number: 12 }), read({ step: "code", point: 1, query: "session" }), read({ step: "files", point: 1, paths: ["src/session.ts"] })];
    },
    (turn) => {
      expect(turn.toolResults[3].issues).toEqual([{ number: 12, title: "Login loops on Safari", state: "open", url: "https://github.com/acme/api/issues/12" }]);
      expect(turn.toolResults[6].files).toEqual([{ path: "src/session.ts", content: "export class SessionStore {}" }]);
      expect(turn.toolResults[6].readsLeft).toEqual({ point: 2, brief: 26 });
      return { tool: "postBriefRound", args: round };
    },
    "ok",
  );
  const brief = await s.discord.send(ROUND_1.points.map((p: string) => `- ${p}`).join("\n"));
  await s.discord.contextMenu("Draft issues", brief);
  const thread = brief.thread!;
  expect(s.discord.botMessages.find((m) => m.channelId === thread.id)!.content).toContain("Point 1 looks like #12 *Login loops on Safari*. Skip it, or create a new issue anyway?");

  s.model.script(
    [{ tool: "recordBriefAnswers", args: { round: 1, acceptRest: true } }, { tool: "writeIssueDraft", args: draft(1, { labels: ["Safari"] }) }, { tool: "writeIssueDraft", args: draft(2, { labels: ["performance"] }) }],
    (turn) => {
      expect(JSON.stringify(turn.toolResults[2])).toContain("performance is not a label of acme/api. Propose only labels it has: bug, enhancement, safari.");
      return { tool: "writeIssueDraft", args: draft(2) };
    },
    "ok",
  );
  await s.discord.send("yes", { channel: thread });

  const [one, two] = embedsIn(s, thread.id).map((m: any) => m.embeds[0]);
  expect(one.fields).toEqual([{ name: "Repository", value: "acme/api", inline: true }, { name: "Category", value: "bug", inline: true }, { name: "Proposed labels", value: "bug, safari", inline: true }]);
  expect(two.fields).toContainEqual({ name: "Proposed labels", value: "enhancement", inline: true });
  expect(one.description).not.toContain("without repository context");
  expect(one.description).not.toContain("safari,");
  expect(one.description).toContain(`**Context used** (acme/api at \`c0ffee1\`):\n- [README.md](https://github.com/acme/api/blob/${HEAD}/README.md)\n- [#12 Login loops on Safari](https://github.com/acme/api/issues/12)\n- [src/session.ts](https://github.com/acme/api/blob/${HEAD}/src/session.ts)`);
  expect(two.description).toContain(`**Context used** (acme/api at \`c0ffee1\`):\n- [README.md](https://github.com/acme/api/blob/${HEAD}/README.md)`);
  expect(two.description).not.toContain("session.ts");
  for (const e of [one, two]) expect(checkDraft({ title: e.title.replace(/^\d+\. /, ""), body: e.description })).toEqual([]);
  expect(s.discord.botMessages.some((m) => m.files.length)).toBe(false);
  const fields = await briefFields(s, `guilds/guild-1/channels/channel-1/threads/${thread.id}.md`);
  expect(fields.drafts.map((d: any) => [d.repo, d.labels])).toEqual([["acme/api", ["safari"]], ["acme/api", undefined]]);
});

discordScenario("with several repositories round 1 recommends the one earlier briefs in the channel went to, and drafts may target different ones", async (s) => {
  const { briefFields, ROUND_1 } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  const { renderFrontmatter } = await import(process.cwd() + "/packages/skills/src/playbooks.ts");
  await s.git({ repos: ["acme/*"] });
  s.http.on("GET api.github.com/user/repos", () => ["acme/api", "acme/web", "other/x"].map((full_name) => ({ full_name, default_branch: "main" })));
  await s.workspace.write("guilds/guild-1/channels/channel-1/threads/old-thread.md", renderFrontmatter({ playbook: "issue-draft", status: "done", drafts: [{ n: 1, repo: "acme/web" }, { n: 2, repo: "acme/web" }] }, "an older brief\n"));
  const round = { ...ROUND_1, drafts: [{ ...ROUND_1.drafts[0], repo: "acme/web" }, { ...ROUND_1.drafts[1], repo: "acme/api" }], questions: [{ point: 0, question: "Should these go to acme/web?", recommendation: "Yes, earlier briefs here went there.", options: ["acme/web", "acme/api"] }] };
  s.model.script(
    { tool: "briefRepositories" },
    (turn) => {
      expect(turn.toolResults[0].single).toBeUndefined();
      expect(turn.toolResults[0].recommended).toBe("acme/web");
      expect(turn.toolResults[0].repositories.map((r: any) => [r.repo, r.earlierBriefs])).toEqual([["acme/web", 1], ["acme/api", 0]]);
      return { tool: "postBriefRound", args: { ...round, drafts: [{ ...round.drafts[0], repo: "other/x" }, round.drafts[1]] } };
    },
    (turn) => {
      expect(JSON.stringify(turn.toolResults)).toContain("Draft 1's repo must be one of acme/web, acme/api.");
      return { tool: "postBriefRound", args: round };
    },
    "ok",
  );
  const brief = await s.discord.send(ROUND_1.points.map((p: string) => `- ${p}`).join("\n"));
  await s.discord.contextMenu("Draft issues", brief);

  const posted = s.discord.botMessages.find((m) => m.channelId === brief.thread!.id)!.content;
  expect(posted).toContain("**1. Stop the Safari login loop** · point 1 · acme/web");
  expect(posted).toContain("**2. Stream CSV exports** · point 2 · acme/api · blocked by draft 1");
  expect(posted).toContain("Should these go to acme/web?");
  const fields = await briefFields(s, `guilds/guild-1/channels/channel-1/threads/${brief.thread!.id}.md`);
  expect(fields.drafts.map((d: any) => d.repo)).toEqual(["acme/web", "acme/api"]);
});

discordScenario("the runner caps reads at 6 per point and 30 per brief before any rate limit, and points left unchecked get an open question", async (s) => {
  const { embedsIn, draft, stubRepo } = await import(process.cwd() + "/apps/agent/test/support/briefs.ts");
  await s.git({ repos: ["acme/api"] });
  const files = ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"];
  stubRepo(s, { files: Object.fromEntries(files.map((f) => [f, "export {}"])), code: ["src/a.ts"] });
  const points = [1, 2, 3, 4, 5, 6].map((p) => `point number ${p}`);
  const read = (args: Record<string, unknown>) => ({ tool: "briefRead", args: { repo: "acme/api", ...args } });
  // One file per call, so a point's six reads are six tool calls: 30 reads are more calls than the per-user limit allows in a minute.
  const pointReads = (point: number) => [read({ step: "duplicates", point, query: "q" }), read({ step: "code", point, query: "q" }), ...files.slice(0, 4).map((f) => read({ step: "files", point, paths: [f] }))];
  s.model.script(
    [{ tool: "briefRepositories" }, read({ step: "repository" })],
    [...pointReads(1), read({ step: "files", point: 1, paths: ["src/e.ts"] }), ...pointReads(2)],
    [...pointReads(3), ...pointReads(4)],
    [...pointReads(5), read({ step: "duplicates", point: 6, query: "q" })],
    (turn) => {
      const said = JSON.stringify(turn.toolResults);
      expect(said).not.toContain("Too many requests");
      expect(JSON.stringify(turn.toolResults[8])).toContain("Point 1's reading budget (6 reads) is spent.");
      expect(JSON.stringify(turn.toolResults.at(-1))).toContain("The brief's reading budget (30 reads) is spent. Draft with what you have, and list what you could not check under Open questions.");
      return { tool: "postBriefRound", args: { points, drafts: points.map((_, i) => ({ point: i + 1, title: `Fix point ${i + 1}`, summary: "One line." })), questions: [] } };
    },
    "ok",
  );
  const brief = await s.discord.send(points.map((p) => `- ${p}`).join("\n"));
  await s.discord.contextMenu("Draft issues", brief);
  const thread = brief.thread!;

  s.model.script([{ tool: "recordBriefAnswers", args: { round: 1, acceptRest: true } }, { tool: "writeIssueDraft", args: draft(2, { n: 1 }) }, { tool: "writeIssueDraft", args: draft(2, { n: 6 }) }], "ok");
  await s.discord.send("yes", { channel: thread });
  const [one, six] = embedsIn(s, thread.id).map((m: any) => m.embeds[0].description as string);
  expect(one).not.toContain("reading budget");
  expect(six).toContain("**Still need from @Alice:**\n- The reading budget ran out before I checked acme/api for an existing issue or the code it touches. Should someone check before this is picked up? ➡️ Yes, check before starting the work.");
});
