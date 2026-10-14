import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

/** A tenant playbook that writes documents, started by "@bot docs: ...". */
async function addDocs(s: Scenario) {
  await s.workspace.write("shared/playbooks/docs/PLAYBOOK.md", `---\ndescription: Keeps the glossary and decisions\ntrigger: {"word": "docs"}\nrequires: ["workspace", "git_repositories"]\n---\nWrite the glossary and decision records with writePlaybookDocument.\n`);
}

/** acme/api on GitHub with default branch "main": branches exist once created, files never exist before. */
function stubDocsRepo(s: Scenario) {
  const api = "api.github.com/repos/acme/api", branches = new Set<string>(["main"]);
  s.http.on(`GET ${api}`, () => ({ full_name: "acme/api", default_branch: "main" }));
  s.http.on(`GET ${api}/branches/`, (req) => (branches.has(decodeURIComponent(req.url.split("/branches/")[1]!)) ? { name: "x" } : new Response("", { status: 404 })));
  s.http.on(`GET ${api}/git/ref/heads/main`, () => ({ object: { sha: "c0ffee" } }));
  s.http.on(`POST ${api}/git/refs`, (req) => { branches.add(req.body.ref.replace("refs/heads/", "")); return {}; });
  s.http.on(`GET ${api}/contents/`, () => new Response("", { status: 404 }));
  s.http.on(`PUT ${api}/contents/`, () => ({}));
  s.http.on(`POST ${api}/pulls`, () => ({ number: 7, html_url: "https://github.com/acme/api/pull/7" }));
}

const writes = (s: Scenario, from = 0) => s.http.requests.slice(from).filter((r) => r.method !== "GET").map((r) => `${r.method} ${new URL(r.url).pathname}`);
const confirmation = (s: Scenario) => s.discord.botMessages.findLast((m) => m.components?.length)!;
const textOf = (m: any) => [m.content, ...(m.embeds ?? []).map((e: any) => e.description)].join("\n");

discordScenario("the first document write in a playbook thread commits to a new branch and opens one pull request after Confirm; a later write only commits to that branch", async (s) => {
  await addDocs(s);
  await s.git({ repos: ["acme/api"] });
  stubDocsRepo(s);
  s.model.script(
    { tool: "playbookRepositories" },
    { tool: "writePlaybookDocument", args: { kind: "glossary", path: "CONTEXT.md", title: "Add the Order term", content: "# Glossary\n\n**Order**: what a customer pays for.\n" } },
    "Press Confirm to commit the glossary.",
  );
  const start = await s.discord.send(`${s.discord.mention} docs: name our terms`);
  const thread = start.thread!, branch = `playbook/docs-${thread.id}`;
  const first = confirmation(s);
  expect(first.channelId).toBe(thread.id);
  expect(writes(s)).toEqual([]);
  expect(textOf(first)).toContain(`branch ${branch}`);
  expect(textOf(first)).toContain("open a pull request");

  await s.discord.click(first, "Confirm");
  expect(writes(s)).toEqual(["POST /repos/acme/api/git/refs", "PUT /repos/acme/api/contents/CONTEXT.md", "POST /repos/acme/api/pulls"]);
  const [ref, file, pull] = s.http.requests.filter((r) => r.method !== "GET");
  expect(ref!.body.ref).toBe(`refs/heads/${branch}`);
  expect(file!.body).toMatchObject({ branch, message: "Add the Order term" });
  expect(Buffer.from(file!.body.content, "base64").toString()).toBe("# Glossary\n\n**Order**: what a customer pays for.\n");
  expect(pull!.body).toMatchObject({ head: branch, base: "main" });

  const before = s.http.requests.length;
  s.model.script(
    { tool: "writePlaybookDocument", args: { kind: "decision", path: "docs/adr/0001-use-postgres.md", title: "Use Postgres", content: "# Use Postgres\n" } },
    "Press Confirm to commit the decision.",
  );
  await s.discord.send("record that we use Postgres", { channel: thread });
  expect(String(s.model.calls.at(-1)![0]!.content)).toContain(`This thread's documents: branch ${branch} in acme/api, pull request #7 (https://github.com/acme/api/pull/7). Read them from that branch.`);
  const second = confirmation(s);
  expect(second).not.toBe(first);
  expect(textOf(second)).toContain("pull request #7");
  await s.discord.click(second, "Confirm");
  expect(writes(s, before)).toEqual(["PUT /repos/acme/api/contents/docs/adr/0001-use-postgres.md"]);
  expect(s.http.requests.at(-1)!.body).toMatchObject({ branch, message: "Use Postgres" });
});

discordScenario("without a repository the glossary is the channel folder's glossary.md and a decision record is a Decision, with nothing sent to git", async (s) => {
  await addDocs(s);
  // The git skill is on, but the bot has no git account, so git scope allows no repository.
  await s.git({ repos: ["acme/api"] });
  const { setBotGitAccounts } = await import(process.cwd() + "/packages/db/src/tenancy.ts");
  await setBotGitAccounts(s.tenant.id, s.bot.id, []);
  s.clock.set("2026-10-14T09:00:00Z");
  const ok = (turn: any) => (turn.toolResults.every((r: any) => r.success !== false && !r.error) ? "Written." : `failed: ${JSON.stringify(turn.toolResults)}`);
  s.model.script(
    { tool: "writePlaybookDocument", args: { kind: "glossary", path: "CONTEXT.md", title: "Add Order", content: "**Order**: what a customer pays for.\n" } },
    { tool: "writePlaybookDocument", args: { kind: "glossary", path: "CONTEXT.md", title: "Add Invoice", content: "**Order**: what a customer pays for.\n**Invoice**: the bill for an Order.\n" } },
    { tool: "writePlaybookDocument", args: { kind: "decision", path: "docs/adr/0001-use-postgres.md", title: "Use Postgres", content: "# Use Postgres\n\nContext: one database. Reason: already in docker-compose.\n" } },
    ok,
  );
  await s.discord.send(`${s.discord.mention} docs: name our terms`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("Written.");
  const channel = "guilds/guild-1/channels/channel-1";
  expect(await s.workspace.read(`${channel}/glossary.md`)).toBe("**Order**: what a customer pays for.\n**Invoice**: the bill for an Order.\n");
  expect(await s.workspace.read(`${channel}/decisions/2026-10-14-use-postgres.md`)).toBe("# Use Postgres\n\nContext: one database. Reason: already in docker-compose.\n");
  expect(writes(s)).toEqual([]);
});

discordScenario("while several repositories are allowed and none is chosen, a document write is refused and nothing lands in the Workspace", async (s) => {
  const { acmeRepos } = await import(process.cwd() + "/apps/agent/test/support/trackerPlaybook.ts");
  await addDocs(s);
  await acmeRepos(s, ["acme/api", "acme/web"]);
  s.model.script(
    { tool: "writePlaybookDocument", args: { kind: "glossary", path: "CONTEXT.md", title: "Add Order", content: "**Order**: what a customer pays for.\n" } },
    (turn) => { expect(turn.toolResults[0].error).toContain("playbookRepositories"); return "Which repository: acme/api or acme/web?"; },
  );
  await s.discord.send(`${s.discord.mention} docs: name our terms`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("Which repository: acme/api or acme/web?");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/glossary.md")).toBeNull();
  expect(writes(s)).toEqual([]);
});
