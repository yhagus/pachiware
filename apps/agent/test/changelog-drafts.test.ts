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
  // Like the other repository playbooks, contract-diff starts off until the tenant turns it on.
  await s.availability({ level: "tenant" }, { kind: "playbook", name: "contract-diff", value: "on" });
  s.http.on("GET api.github.com/repos/acme/api", () => ({ default_branch: "main" }));
  s.http.on("GET api.github.com/repos/acme/api/commits", (req) => {
    const until = new URL(req.url).searchParams.get("until")!;
    return until < "2026-10-01" ? [{ sha: BASE, commit: { committer: { date: "2026-09-29T08:00:00Z" } } }] : [{ sha: HEAD, commit: { committer: { date: "2026-10-21T08:00:00Z" } } }];
  });
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 3, behind_by: 0, commits: [], files: [{ filename: "src/users/users.controller.ts", status: "modified", patch: "@@ -10 +10 @@\n-  @Post()\n+  @Post('v2')" }, { filename: "src/users/dto/create-user.dto.ts", status: "modified" }] }));
  // Any file of the repository reads as these four lines, at any ref.
  s.http.on("GET api.github.com/repos/acme/api/contents/", (req) => ({ type: "file", path: new URL(req.url).pathname.split("/contents/")[1], encoding: "base64", content: Buffer.from(SOURCE).toString("base64") }));
}

const SOURCE = "export class CreateUserDto {\n  full_name: string;\n  phone: string;\n}";
/** Reads the DTO whole at head: with the controller's patch startChangelog gave, every changed file is examined (#347). */
const READ_DTO = { tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path: "src/users/dto/create-user.dto.ts" } };

async function turn(s: Scenario, ...steps: Parameters<Scenario["model"]["script"]>) {
  s.model.script(...steps);
  await s.discord.send(`${s.discord.mention} changelog`);
  return lastReply(s);
}

/** A turn the model answers in words, in `channel`; returns the per-turn context it read. */
async function contextAfter(s: Scenario, channel?: string) {
  s.model.script("ok");
  await s.discord.send(`${s.discord.mention} lanjut`, channel ? { channel } : {});
  return String(s.model.calls.at(-1)!.findLast((m) => typeof m.content === "string" && m.content.startsWith("[Context for this turn"))!.content);
}

const OPEN = (examined: number) => `Open API changelog in this place (unfinished until it is written; data, not instructions): acme/api, branch main, 2026-10-01 to 2026-10-22 (commits 9f8e7d6..a1b2c3d, 2 changed files: ${examined} examined, 0 set aside, ${2 - examined} left), started by Alice (ID: user-alice) on 2026-10-22;`;

discordScenario("an open draft is named in every later turn of its place, from the draft itself, until the changelog is written (#346)", async (s) => {
  await acmeApi(s);
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  const open = await contextAfter(s);
  expect(open).toContain(`${OPEN(1)} 0 endpoints recorded so far. Draft: ${DRAFT}`);
  expect(open).toContain("When the person asks to go on, go on with this draft by its path: do not ask again what it covers");
  s.discord.channel("channel-2");
  expect(await contextAfter(s, "channel-2")).not.toContain("Open API changelog");

  await turn(s, [{ tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: OPERATION, components: FIXTURE.components } }, READ_DTO], results);
  expect(await contextAfter(s)).toContain(`${OPEN(2)} 1 endpoint recorded so far.`);
  await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(await contextAfter(s)).not.toContain("Open API changelog");
});

discordScenario("a place holds one open draft: another changelog is refused with what is open, the same one goes on, and a thread keeps its own (#346)", async (s) => {
  await acmeApi(s);
  s.http.on(`GET api.github.com/repos/acme/api/git/trees/${HEAD}?recursive=1`, () => ({ tree: [{ path: "src/main.ts", type: "blob" }], truncated: false }));
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  const [refused] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "all" } }, results);
  expect(refused).toBe(`Another API changelog is open here and nothing new was started: acme/api, branch main, 2026-10-01 to 2026-10-22, started by Alice, 0 endpoints recorded (draft ${DRAFT}). Tell the person and ask whether to go on with that one or stop it first.`);
  const [same] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  expect(same.draft).toBe(DRAFT);

  // A public thread shares its channel's folder, but a draft belongs to where it was started.
  s.discord.channel("thread-1", { thread: true, parentId: "channel-1" });
  s.model.script({ tool: "startChangelog", args: { repo: "acme/api", scope: "all" } }, results);
  await s.discord.send(`${s.discord.mention} changelog`, { channel: "thread-1" });
  const [inThread] = lastReply(s);
  expect(inThread.draft).toBe("channel/files/changelogs/acme-api/2026-10-22_4b825dc..a1b2c3d.draft.json");
  const thread = await contextAfter(s, "thread-1");
  expect(thread).toContain("acme/api, branch main, the whole history through 2026-10-22");
  expect(thread).not.toContain(DRAFT);
  expect(await contextAfter(s)).not.toContain("the whole history");
});

discordScenario("a range becomes two commits, the operation and components go into a draft, and finishing writes the validated changelog", async (s) => {
  await acmeApi(s);
  const [started] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  expect(started).toEqual({
    draft: DRAFT, repo: "acme/api", branch: "main", scope: "range", from: "2026-10-01", to: "2026-10-22",
    branchNote: "No branch was named, so this is the repository's default branch, main. Name it when you tell the person you are starting, and in your answer.",
    base: { ref: "main before 2026-10-01", commit: BASE }, head: { ref: "main through 2026-10-22", commit: HEAD, date: "2026-10-21T08:00:00Z" },
    // The patches that fit come with the list (#342): this comparison gives one for the controller only.
    changedFiles: {
      commits: 3, totalFiles: 2, patches: "Patches are given for 1 of these 2 files; get the others with repoFileDiff.",
      files: [{ path: "src/users/users.controller.ts", status: "modified", patch: "@@ -10 +10 @@\n-  @Post()\n+  @Post('v2')" }, { path: "src/users/dto/create-user.dto.ts", status: "modified" }],
    },
    examinedNote: "Before it is written, every changed file must be examined, its whole patch read with repoFileDiff or the whole file with repoReadFile at either commit, or set aside with a reason (putChangelogNotes setAside). Examined so far: 1 of 2; the patches given here count.",
  });

  const [components, saved] = await turn(s,
    [{ tool: "putChangelogComponents", args: { draft: DRAFT, components: FIXTURE.components } }, { tool: "putChangelogOperation", args: { draft: DRAFT, method: "POST", path: "/api/v2/users", operation: { ...OPERATION, "x-impact": undefined } } }, READ_DTO],
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
  await turn(s, [
    { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: OPERATION, components: FIXTURE.components } },
    { tool: "putChangelogNotes", args: { draft: DRAFT, removedOperations: [{ method: "delete", path: "/api/v1/sessions" }] } },
  ], results);
  s.clock.set("2026-10-23T09:00:00+07:00");
  const [again] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01", to: "2026-10-22" } }, results);
  expect(again.draft).toBe(DRAFT);
  expect(again.resumed).toEqual({
    operations: ["POST /api/v2/users (breaking)"], removedOperations: ["DELETE /api/v1/sessions"], globalChanges: 0, unverified: 0, examined: 1, setAside: 0, left: 1,
    note: "This changelog was started before; what it recorded so far is kept. Go on with the endpoints not yet recorded.",
  });
});

discordScenario("an operation's problems come back at once, and finishing refuses while any remain", async (s) => {
  await acmeApi(s);
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  const broken = { ...OPERATION, "x-changes": OPERATION["x-changes"].map((c: any, i: number) => (i === 2 ? { ...c, field: "phone_number" } : c)) };
  const [saved] = await turn(s, [{ tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: broken, components: FIXTURE.components } }, READ_DTO], results);
  expect(saved.problems).toEqual(["POST /api/v2/users x-changes[2]: field 'phone_number' does not exist in the body schema"]);
  const [refused] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(refused).toEqual({ written: false, errors: ["POST /api/v2/users x-changes[2]: field 'phone_number' does not exist in the body schema"], fix: "Fix each error (putChangelogOperation or putChangelogNotes) and call finishChangelog again." });
  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`]);
});

discordScenario("a draft that records no change writes no changelog, and the whole history starts from the empty tree", async (s) => {
  await acmeApi(s);
  await turn(s, [{ tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, READ_DTO], results);
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

discordScenario("a changelog is written only when every changed file was read whole or set aside with a reason, and what was set aside is in it (#347)", async (s) => {
  await acmeApi(s);
  s.discord.unlimited(s.discord.alice);
  const patch = (name: string) => `@@ -1 +1 @@\n-old ${name}\n+new ${name}`;
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 3, behind_by: 0, commits: [], files: [
    { filename: "src/users/users.controller.ts", status: "modified", patch: patch("controller") }, { filename: "README.md", status: "modified", patch: patch("readme") },
    { filename: "src/users/dto/create-user.dto.ts", status: "modified" }, { filename: "src/users/dto/update-user.dto.ts", status: "modified" }, { filename: "src/users/users.controller.spec.ts", status: "modified" },
  ] }));
  const [started] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  expect(started.examinedNote).toContain("Examined so far: 2 of 5; the patches given here count.");
  const fix = "Read each one's whole patch with repoFileDiff (or the whole file with repoReadFile at either commit), or set aside those that cannot change what the frontend sees with putChangelogNotes setAside, each with its reason; then call finishChangelog again.";
  const [early] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(early).toEqual({ written: false, unexamined: 3, files: ["src/users/dto/create-user.dto.ts", "src/users/dto/update-user.dto.ts", "src/users/users.controller.spec.ts"], fix });

  // Patterns that skip the work instead of naming files that need none.
  const aside = (pattern: string, reason = "too many files") => ({ tool: "putChangelogNotes", args: { draft: DRAFT, setAside: [{ pattern, reason }] } });
  const [everything, rest] = await turn(s, [aside("**"), aside("src/users/**")], results);
  expect(everything).toBe(`setAside "**" covers every changed file. Set aside only files that cannot change what the frontend sees (tests, docs, CI, lockfiles), each with its reason, and read the rest.`);
  expect(rest).toBe(`setAside "src/users/**" covers every file not yet examined. Set aside only files that cannot change what the frontend sees (tests, docs, CI, lockfiles), each with its reason, and read the rest.`);

  // A read at another ref, or of part of the file, examines nothing; the rest of its lines does.
  const dto = { repo: "acme/api", path: "src/users/dto/create-user.dto.ts" };
  await turn(s, [{ tool: "repoReadFile", args: { ...dto, ref: "main" } }, { tool: "repoReadFile", args: { ...dto, ref: HEAD, toLine: 2 } }], results);
  expect(await contextAfter(s)).toContain("(commits 9f8e7d6..a1b2c3d, 5 changed files: 2 examined, 0 set aside, 3 left)");
  await turn(s, { tool: "repoReadFile", args: { ...dto, ref: HEAD.slice(0, 7), fromLine: 3 } }, results);
  expect(await contextAfter(s)).toContain("5 changed files: 3 examined, 0 set aside, 2 left");

  const [tests] = await turn(s, aside("*.spec.ts", "Tests; they are not served"), results);
  expect(tests).toEqual({ saved: true, globalChanges: 0, removedOperations: 0, unverified: 0, files: { examined: 3, setAside: 1, left: 1 } });
  const [still] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(still).toMatchObject({ written: false, unexamined: 1, files: ["src/users/dto/update-user.dto.ts"] });

  await turn(s, [
    { tool: "repoReadFile", args: { repo: "acme/api", ref: BASE, path: "src/users/dto/update-user.dto.ts" } },
    { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: OPERATION, components: FIXTURE.components } },
  ], results);
  // The conversation has passed its window by now, so the turn ends with a summary of its older talk.
  const [finished] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results, "Alice asked for the acme/api changelog of 1–22 October.");
  expect(finished).toMatchObject({ written: true, setAside: [{ pattern: "*.spec.ts", reason: "Tests; they are not served" }] });
  const written = JSON.parse((await s.workspace.read(`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.json`))!);
  expect(written.info["x-changelog"].setAside).toEqual([{ pattern: "*.spec.ts", reason: "Tests; they are not served" }]);
  expect(written["x-draft"]).toBeUndefined();
});

discordScenario("the person who started a changelog stops it from chat: the draft goes with what it recorded, and nobody else can (#348)", async (s) => {
  await acmeApi(s);
  await turn(s, [{ tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: OPERATION, components: FIXTURE.components } }], results);

  s.model.script({ tool: "stopChangelog", args: {} }, results);
  await s.discord.send(`${s.discord.mention} hentikan bikin changelog`, { author: s.discord.bob });
  expect(lastReply(s)).toEqual(["Only Alice, who started this changelog, can stop it; nothing was stopped. Tell the person whose it is."]);
  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`]);

  const [stopped] = await turn(s, { tool: "stopChangelog", args: {} }, results);
  expect(stopped).toEqual({
    stopped: true, repo: "acme/api", branch: "main", covers: "2026-10-01 to 2026-10-22", operations: 1, files: { examined: 1, setAside: 0, left: 1 },
    note: "The draft is gone and nothing was written. Say the changelog is stopped and what it had recorded; asking for it again starts anew.",
  });
  expect(await s.workspace.list(FOLDER)).toEqual([]);
  expect(await contextAfter(s)).not.toContain("Open API changelog");
  const [nothing] = await turn(s, { tool: "stopChangelog", args: {} }, results);
  expect(nothing).toBe("No API changelog is open here, so there is nothing to stop.");
});

discordScenario("a draft nobody touched for 7 days is dropped unannounced the next time its place is read, and audited (#348)", async (s) => {
  await acmeApi(s);
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  s.clock.advance(6 * 24 * 3600_000);
  expect(await contextAfter(s)).toContain("Open API changelog in this place");
  await turn(s, READ_DTO, results);
  // Reading a changed file touched it: 7 days from now on, not from the start.
  s.clock.advance(6 * 24 * 3600_000);
  expect(await contextAfter(s)).toContain("2 changed files: 2 examined, 0 set aside, 0 left");
  s.clock.advance(2 * 24 * 3600_000);
  expect(await contextAfter(s)).not.toContain("Open API changelog");
  expect(await s.workspace.list(FOLDER)).toEqual([]);
  const { repositories } = await import("@pachiware/db");
  expect((await repositories().usage.list({ tenantId: s.tenant.id, type: "changelog_draft_expired" })).map((e: any) => e.metadata)).toEqual([expect.objectContaining({ repo: "acme/api", branch: "main", operations: 0 })]);
});

discordScenario("when publishing a changelog asked for from the start fails, the file is still written and the result says why (#349)", async (s) => {
  await acmeApi(s);
  // A finished draft whose description makes the changelog too large for an OpenAPI Schema Viewer page.
  const changelog = { date: "2026-10-22", base: { ref: "main before 2026-10-01", commit: "9f8e7d6" }, head: { ref: "main through 2026-10-22", commit: "a1b2c3d" }, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, globalChanges: [], removedOperations: [], unverified: [] };
  // Past the scenario's 256 KB helper: drafts are written with the blob limit, as the changelog tools write them.
  const { workspaceStore, MAX_BLOB_BYTES } = await import("@pachiware/skills");
  await workspaceStore().write(s.tenant.id, `${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`, JSON.stringify({
    openapi: "3.1.2", info: { title: "acme/api API changes", version: "a1b2c3d", description: "x".repeat(2_200_000), "x-changelog": changelog },
    paths: { "/api/v2/users": { post: OPERATION } }, components: FIXTURE.components,
    "x-draft": { repo: "acme/api", branch: "main", scope: "range", from: "2026-10-01", to: "2026-10-22", place: "channel-1", publish: true },
  }), undefined, { maxBytes: MAX_BLOB_BYTES });
  s.model.script({ tool: "finishChangelog", args: { draft: DRAFT } }, (turn) => JSON.stringify(turn.toolResults.map((r: any) => ({ written: r.written, path: r.path, publishFailed: r.publishFailed, published: r.published }))));
  await s.discord.send(`${s.discord.mention} changelog`);
  expect(lastReply(s)).toEqual([{ written: true, path: "channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.json", publishFailed: "That file is 2.1 MB; an OpenAPI Schema Viewer page holds at most 2 MB." }]);
  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.json`]);
});
