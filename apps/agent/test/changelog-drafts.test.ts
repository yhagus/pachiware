import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { discordScenario, type Scenario } from "./support/discordScenario";

/** The skill's example operation, completed into a valid document (packages/skills/test/openapi-validate.test.ts checks it). */
const FIXTURE = JSON.parse(readFileSync(new URL("../../../packages/skills/test/fixtures/contract-diff/create-user.json", import.meta.url), "utf8"));
const OPERATION = FIXTURE.paths["/api/v2/users"].post;
const BASE = "9f8e7d6".padEnd(40, "0"), HEAD = "a1b2c3d".padEnd(40, "0");
const FOLDER = "guilds/guild-1/channels/channel-1/files/changelogs/acme-api";
const DRAFT = "channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.draft.json";
/** Every tool result of the turn as the model read it: the refusal text, or the result itself. */
const results = (turn: any) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? r));
const lastReply = (s: Scenario) => JSON.parse(s.discord.botMessages.at(-1)!.content);

/** acme/api on GitHub: main's last commit through 22 October is HEAD, its last before 1 October is BASE, and two files changed between them. */
async function acmeApi(s: Scenario) {
  await s.guildSettings({ language: "en", useThreads: false });
  s.clock.set("2026-10-22T10:00:00+07:00");
  await s.git({ repos: ["acme/*"] });
  // Until the built-in arrives, the playbook the changelog tools follow is the tenant's own.
  await s.workspace.write("shared/playbooks/contract-diff/PLAYBOOK.md", `---\ndescription: API changelog\nrequires: ["git_repositories", "openapi"]\ntrigger: {"word": "changelog"}\n---\nWrite the changelog.\n`);
  s.http.on("GET api.github.com/repos/acme/api", () => ({ default_branch: "main" }));
  s.http.on("GET api.github.com/repos/acme/api/commits", (req) => {
    const until = new URL(req.url).searchParams.get("until")!;
    return until < "2026-10-01" ? [{ sha: BASE, commit: { committer: { date: "2026-09-29T08:00:00Z" } } }] : [{ sha: HEAD, commit: { committer: { date: "2026-10-21T08:00:00Z" } } }];
  });
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 3, behind_by: 0, commits: [], files: [{ filename: "src/users/users.controller.ts", status: "modified" }, { filename: "src/users/dto/create-user.dto.ts", status: "modified" }] }));
}

async function turn(s: Scenario, ...steps: Parameters<Scenario["model"]["script"]>) {
  s.model.script(...steps);
  await s.discord.send(`${s.discord.mention} changelog`);
  return lastReply(s);
}

discordScenario("a range becomes two commits, the operation and components go into a draft, and finishing writes the validated changelog", async (s) => {
  await acmeApi(s);
  const [started] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  expect(started).toEqual({
    draft: DRAFT, repo: "acme/api", branch: "main", scope: "range", from: "2026-10-01", to: "2026-10-22",
    base: { ref: "main before 2026-10-01", commit: BASE }, head: { ref: "main through 2026-10-22", commit: HEAD, date: "2026-10-21T08:00:00Z" },
    changedFiles: { commits: 3, files: [{ path: "src/users/users.controller.ts", status: "modified" }, { path: "src/users/dto/create-user.dto.ts", status: "modified" }], totalFiles: 2 },
  });

  const [components, saved] = await turn(s,
    [{ tool: "putChangelogComponents", args: { draft: DRAFT, components: FIXTURE.components } }, { tool: "putChangelogOperation", args: { draft: DRAFT, method: "POST", path: "/api/v2/users", operation: { ...OPERATION, "x-impact": undefined } } }],
    results);
  expect(components.saved).toEqual(["#/components/securitySchemes/bearerAuth", "#/components/schemas/NewUser", "#/components/schemas/User", "#/components/schemas/UserEnvelope", "#/components/schemas/Error"]);
  expect(saved).toEqual({ saved: "POST /api/v2/users", impact: "breaking", operations: 1 });

  const [finished] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(finished).toEqual({
    written: true, path: "channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.json", summary: { breaking: 3, deprecated: 0, "non-breaking": 1 },
    breaking: ["POST /api/v2/users: CHANGED url POST /api/v1/users → POST /api/v2/users", "POST /api/v2/users: RENAMED body full_name (was name)", "POST /api/v2/users: CHANGED body phone"],
    unverified: [], validation: "0 errors: the contract-diff checks and the OpenAPI 3.1 schema.",
  });
  const written = JSON.parse((await s.workspace.read(`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.json`))!);
  expect(written).toEqual({
    ...FIXTURE,
    info: { title: "acme/api API changes", version: "a1b2c3d", "x-changelog": { date: "2026-10-22", base: { ref: "main before 2026-10-01", commit: "9f8e7d6" }, head: { ref: "main through 2026-10-22", commit: "a1b2c3d" }, summary: { breaking: 3, deprecated: 0, "non-breaking": 1 }, globalChanges: [], removedOperations: [], unverified: [] } },
  });
  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.json`]);
});

discordScenario("without the person's answer to all or part, nothing starts and nothing is written", async (s) => {
  await acmeApi(s);
  const [refused] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api" } }, results);
  expect(refused).toBe("Ask the person first whether the changelog covers the whole history (scope all) or part of it (scope range, from one date to another), and wait for the answer. Never choose for them.");
  expect(await s.workspace.list(FOLDER)).toEqual([]);
});

discordScenario("a run cut midway is picked up by the next start of the same changelog, with what it recorded", async (s) => {
  await acmeApi(s);
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01", to: "2026-10-22" } }, results);
  await turn(s, { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: OPERATION, components: FIXTURE.components } }, results);
  s.clock.set("2026-10-23T09:00:00+07:00");
  const [again] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01", to: "2026-10-22" } }, results);
  expect(again.draft).toBe(DRAFT);
  expect(again.resumed).toEqual({ operations: ["POST /api/v2/users (breaking)"], note: "This changelog was started before; its operations so far are kept. Go on with the endpoints not yet recorded." });
});

discordScenario("an operation's problems come back at once, and finishing refuses while any remain", async (s) => {
  await acmeApi(s);
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  const broken = { ...OPERATION, "x-changes": OPERATION["x-changes"].map((c: any, i: number) => (i === 2 ? { ...c, field: "phone_number" } : c)) };
  const [saved] = await turn(s, { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: broken, components: FIXTURE.components } }, results);
  expect(saved.problems).toEqual(["POST /api/v2/users x-changes[2]: field 'phone_number' does not exist in the body schema"]);
  const [refused] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(refused).toEqual({ written: false, errors: ["POST /api/v2/users x-changes[2]: field 'phone_number' does not exist in the body schema"], fix: "Fix each error (putChangelogOperation or putChangelogNotes) and call finishChangelog again." });
  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`]);
});

discordScenario("a draft that records no change writes no changelog, and the whole history starts from the empty tree", async (s) => {
  await acmeApi(s);
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  const [nothing] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(nothing).toEqual({ written: false, note: "The draft records no frontend-visible change, so no changelog was written; the draft is gone. Say so, with what was examined." });
  expect(await s.workspace.list(FOLDER)).toEqual([]);

  s.http.on(`GET api.github.com/repos/acme/api/git/trees/${HEAD}?recursive=1`, () => ({ tree: [{ path: "src/main.ts", type: "blob" }, { path: "src", type: "tree" }], truncated: false }));
  const [all] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "all" } }, results);
  expect(all).toMatchObject({
    draft: "channel/files/changelogs/acme-api/2026-10-22_4b825dc..a1b2c3d.draft.json", scope: "all", base: { ref: "(empty)", commit: "empty tree" },
    note: "Nothing came before this changelog: every endpoint of head is NEW. Read head only.", changedFiles: { files: ["src/main.ts"], totalFiles: 1 },
  });
});
