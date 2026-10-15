import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { stubDocsRepo, gitWrites } from "./support/docsRepo";

const turnOn = async (s: Scenario, ...names: string[]) => { for (const name of names) await s.availability({ level: "tenant" }, { kind: "playbook", name, value: "on" }); };
const startLine = (s: Scenario) => s.discord.botMessages.filter((m) => m.channelId === "channel-1").at(-1)!;
const confirmation = (s: Scenario) => s.discord.botMessages.findLast((m) => m.components?.length)!;

discordScenario("grill-with-docs runs with grilling and domain-modeling loaded and writes the glossary through the thread's pull request after Confirm", async (s) => {
  await turnOn(s, "grilling", "domain-modeling", "grill-with-docs");
  await s.git({ repos: ["acme/api"] });
  stubDocsRepo(s);
  s.model.script(
    { tool: "playbookRepositories" },
    { tool: "writePlaybookDocument", args: { kind: "glossary", path: "GLOSSARY.md", title: "Add Invoice", content: "# Billing\n\n## Language\n\n**Invoice**:\nA request for payment sent after delivery.\n" } },
    "❓ **Q1** · **Partial refunds**: can one Invoice be refunded in part?\n➡️ yes\n\nPress Confirm to commit the glossary.",
  );

  await s.discord.slash("grill-with-docs", { text: "we bill customers after delivery" });

  const prompt = String(s.model.calls[0]![0]!.content);
  expect(prompt).toContain("### Playbook: grill-with-docs");
  expect(prompt).toContain("#### Loaded playbook: grilling");
  expect(prompt).toContain("#### Loaded playbook: domain-modeling");
  const thread = startLine(s).thread!;
  expect(gitWrites(s)).toEqual([]);

  await s.discord.click(confirmation(s), "Confirm");
  const branch = `playbook/grill-with-docs-${thread.id}`;
  expect(gitWrites(s)).toEqual(["POST /repos/acme/api/git/refs", "PUT /repos/acme/api/contents/GLOSSARY.md", "POST /repos/acme/api/pulls"]);
  expect(s.http.requests.findLast((r) => r.method === "PUT")!.body).toMatchObject({ branch, message: "Add Invoice" });
  expect(s.http.requests.at(-1)!.body).toMatchObject({ head: branch, base: "main" });
});

discordScenario("the playbooks that act on a repository are refused privately where git scope allows none, while grill-with-docs starts and keeps its glossary in the channel", async (s) => {
  await turnOn(s, "to-spec", "code-review", "pr", "grilling", "domain-modeling", "grill-with-docs");
  await s.git({ repos: ["acme/api"] });
  const { repositories } = await import(process.cwd() + "/packages/db/src/index.ts");
  await repositories().git.setBotAccounts(s.tenant.id, s.bot.id, []);
  s.discord.unlimited(s.discord.alice);

  for (const name of ["to-spec", "code-review", "pr"]) {
    const run = await s.discord.slash(name, { text: "the CSV export" });
    expect(run.responses.at(-1)).toEqual({ kind: "editReply", payload: expect.objectContaining({ content: `The ${name} playbook needs a repository, and git scope allows none here. An admin can open one in the console under the server's git access.` }) });
  }
  expect(s.discord.botMessages).toEqual([]);
  expect(s.model.calls).toEqual([]);

  s.model.script(
    { tool: "writePlaybookDocument", args: { kind: "glossary", path: "GLOSSARY.md", title: "Add Export", content: "**Export**: a CSV of one tenant's orders.\n" } },
    "Q1: does an Export include refunded orders?",
  );
  await s.discord.slash("grill-with-docs", { text: "the CSV export" });
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/glossary.md")).toBe("**Export**: a CSV of one tenant's orders.\n");
  expect(gitWrites(s)).toEqual([]);
});

discordScenario("with the git skill off, grill-with-docs and domain-modeling still start and keep the glossary and Decisions in the channel's Workspace folder", async (s) => {
  await turnOn(s, "grilling", "domain-modeling", "grill-with-docs");
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "skill", name: "git_repositories", value: "off" });
  s.discord.unlimited(s.discord.alice);
  s.clock.set("2026-10-14T09:00:00Z");
  const ok = (turn: any) => (turn.toolResults.every((r: any) => r.success !== false && !r.error) ? "Q1: does an Export include refunded orders?" : `failed: ${JSON.stringify(turn.toolResults)}`);

  s.model.script(
    [{ tool: "writeFile", args: { path: "channel/glossary.md", content: "**Export**: a CSV of one tenant's orders.\n" } },
      { tool: "writeFile", args: { path: "channel/decisions/2026-10-14-stream-exports.md", content: "# Stream exports\n" } }],
    ok,
  );
  await s.discord.slash("grill-with-docs", { text: "the CSV export" });
  expect(s.model.tools[0]).not.toContain("writePlaybookDocument");
  expect(s.discord.botMessages.at(-1)!.content).toBe("Q1: does an Export include refunded orders?");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/glossary.md")).toBe("**Export**: a CSV of one tenant's orders.\n");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/decisions/2026-10-14-stream-exports.md")).toBe("# Stream exports\n");

  s.model.script("Which term first?");
  await s.discord.slash("domain-modeling", { text: "billing terms" });
  expect(String(s.model.calls.at(-1)![0]!.content)).toContain("### Playbook: domain-modeling");
});

discordScenario("to-spec publishes the spec as an issue in the thread's repository only after Confirm", async (s) => {
  await turnOn(s, "to-spec");
  await s.git({ repos: ["acme/api"] });
  s.http.on("POST api.github.com/repos/acme/api/issues", () => ({ number: 42, id: 9042, html_url: "https://github.com/acme/api/issues/42" }));
  const body = "## Problem Statement\n\nExports time out.\n\n## Solution\n\nStream the CSV.";
  s.model.script(
    { tool: "playbookRepositories" },
    { tool: "repoCreateIssue", args: { repo: "acme/api", title: "Spec: Streamed CSV export", body, labels: ["ready-for-agent"] } },
    "Spec preview: Streamed CSV export. Press Confirm to publish it.",
  );

  await s.discord.slash("to-spec", { text: "turn our export discussion into a spec" });

  expect(String(s.model.calls[0]![0]!.content)).toContain("### Playbook: to-spec");
  const thread = startLine(s).thread!;
  const ask = confirmation(s);
  expect(ask.channelId).toBe(thread.id);
  expect(gitWrites(s)).toEqual([]);

  await s.discord.click(ask, "Confirm");
  expect(s.http.requests.filter((r) => r.method !== "GET").map((r) => [r.method, new URL(r.url).pathname, r.body])).toEqual([
    ["POST", "/repos/acme/api/issues", { title: "Spec: Streamed CSV export", body, labels: ["ready-for-agent"] }],
  ]);
});
