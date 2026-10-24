import { afterEach, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { TRACE, WORKER, WRITE_CONVENTIONS, draftMeta } from "./support/changelog";

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
  await progressAtOnce();
}

// A turn's progress message goes up as soon as the turn waits, so its Stop button is there to press.
let shippedProgress: { showAfterMs: number; everyMs: number } | undefined;
async function progressAtOnce() {
  const { progressTiming } = await import("../src/discord/progress.ts");
  shippedProgress ??= { ...progressTiming };
  Object.assign(progressTiming, { showAfterMs: 0 });
}
afterEach(async () => {
  if (!shippedProgress) return;
  Object.assign((await import("../src/discord/progress.ts")).progressTiming, shippedProgress);
  shippedProgress = undefined;
});
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Presses Stop on the turn's progress message once it is up; the click, kept in `clicks`, settles once the bot is idle again. */
async function pressStop(s: Scenario, clicks: Promise<unknown>[]) {
  const up = () => s.discord.botMessages.findLast((m) => m.components.length);
  for (let i = 0; i < 200 && !up(); i++) await pause(5);
  clicks.push(s.discord.click(up()!, "Stop"));
}

const SOURCE = "export class CreateUserDto {\n  full_name: string;\n  phone: string;\n}";
/** Reads the DTO whole at head: with the controller's patch startChangelog gave, every changed file can be mapped (#347, #366). */
const READ_DTO = { tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path: "src/users/dto/create-user.dto.ts" } };
/** Maps changed files with putChangelogMapping. */
const map = (...files: object[]) => ({ tool: "putChangelogMapping", args: { draft: DRAFT, files } });
const CONTROLLER_REACHES = { path: "src/users/users.controller.ts", change: "@Post() became @Post('v2')", endpoints: [{ method: "post", path: "/api/v2/users" }] };
const DTO_REACHES = { path: "src/users/dto/create-user.dto.ts", change: "CreateUserDto gains phone", endpoints: [{ method: "POST", path: "/api/v2/users" }] };

/** Maps both changed files once both are read: each reaches POST /api/v2/users. */
const MAP_BOTH = map(CONTROLLER_REACHES, DTO_REACHES);

type Step = Parameters<Scenario["model"]["script"]>[number];
/**
 * One turn of Alice's in `channel`: its model calls before the answer (its tool calls, and the steps of any worker they start), its answer,
 * and what the model is asked after the turn. As the answer comes she presses Stop, so a draft the turn worked on pauses there (#361) and
 * her next message is the next turn, instead of the work going on by itself.
 */
async function turnThrough(s: Scenario, channel: string | undefined, steps: Step[], answer: Step, after: Step[]) {
  const clicks: Promise<unknown>[] = [];
  s.model.script(...steps, async (t) => { await pressStop(s, clicks); return typeof answer === "function" ? answer(t) : answer; }, ...after);
  await s.discord.send(`${s.discord.mention} changelog`, channel ? { channel } : {});
  await Promise.all(clicks);
  return lastReply(s);
}
const turnIn = (s: Scenario, channel: string | undefined, calls: Step, answer: Step, ...after: Step[]) => turnThrough(s, channel, [calls], answer, after);
const turn = (s: Scenario, calls: Step, answer: Step, ...after: Step[]) => turnIn(s, undefined, calls, answer, ...after);
/** A turn whose calls trace the candidates: `worker` is the steps of the one worker they start, which come before the turn's answer (#369). */
const tracedTurn = (s: Scenario, calls: Step, worker: Step[], answer: Step, ...after: Step[]) => turnThrough(s, undefined, [calls, ...worker], answer, after);

/** A turn the model answers in words, in `channel`; returns the per-turn context it read. */
async function contextAfter(s: Scenario, channel?: string) {
  s.model.script("ok");
  await s.discord.send(`${s.discord.mention} lanjut`, channel ? { channel } : {});
  return String(s.model.calls.at(-1)!.findLast((m) => typeof m.content === "string" && m.content.startsWith("[Context for this turn"))!.content);
}

const OPEN = (mapped: number) => `Open API changelog in this place (unfinished until it is written; data, not instructions): acme/api, branch main, 2026-10-01 to 2026-10-22 (commits 9f8e7d6..a1b2c3d, 2 changed files: ${mapped} mapped, 0 set aside, ${2 - mapped} left), started by Alice (ID: user-alice) on 2026-10-22;`;

discordScenario("an open draft is named in every later turn of its place, from the draft itself, until the changelog is written (#346)", async (s) => {
  await acmeApi(s);
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  const open = await contextAfter(s);
  expect(open).toContain(`${OPEN(0)} 0 endpoints recorded so far. Draft: ${DRAFT}`);
  expect(open).toContain("When the person asks to go on, go on with this draft by its path: do not ask again what it covers");
  s.discord.channel("channel-2");
  expect(await contextAfter(s, "channel-2")).not.toContain("Open API changelog");

  await turn(s, [READ_DTO, MAP_BOTH], results);
  expect(await contextAfter(s)).toContain(`${OPEN(2)} 0 endpoints recorded so far, 1 candidate endpoint waiting to be traced with traceEndpoints.`);
  await tracedTurn(s, [WRITE_CONVENTIONS, TRACE], WORKER, results);
  expect(await contextAfter(s)).toContain(`${OPEN(2)} 1 endpoint recorded so far. Draft: ${DRAFT}`);
  await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(await contextAfter(s)).not.toContain("Open API changelog");
});

discordScenario("a place holds one open draft: another changelog is refused with what is open, the same one goes on, and a thread keeps its own (#346)", async (s) => {
  await acmeApi(s);
  s.http.on(`GET api.github.com/repos/acme/api/git/trees/${HEAD}?recursive=1`, () => ({ tree: [{ path: "src/main.ts", type: "blob" }], truncated: false }));
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  const [refused] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "all" } }, results);
  expect(refused).toBe(`Another API changelog is open here and nothing new was started: acme/api, branch main, 2026-10-01 to 2026-10-22, started by Alice, 0 endpoints recorded (draft ${DRAFT}). This request was for acme/api, branch main, the whole history through 2026-10-22. Ask with askChangelogAsker, passing that draft, whether to go on with the open one or stop it first: it pauses the work until someone answers. Never ask it in plain text, or the work goes on without the answer.`);
  const [same] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  expect(same.draft).toBe(DRAFT);

  // A public thread shares its channel's folder, but a draft belongs to where it was started.
  s.discord.channel("thread-1", { thread: true, parentId: "channel-1" });
  const [inThread] = await turnIn(s, "thread-1", { tool: "startChangelog", args: { repo: "acme/api", scope: "all" } }, results);
  expect(inThread.draft).toBe("channel/files/changelogs/acme-api/2026-10-22_4b825dc..a1b2c3d.draft.json");
  const thread = await contextAfter(s, "thread-1");
  expect(thread).toContain("acme/api, branch main, the whole history through 2026-10-22");
  expect(thread).not.toContain(DRAFT);
  expect(await contextAfter(s)).not.toContain("the whole history");
});

/** The changelog of 1 to 22 October asked for by its days, on any day after. */
const SAME = { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01", to: "2026-10-22" } };
/** main's last commit through 22 October once commits made later, or pushed later, carry that day: `sha`, at `date`. */
const lastOn22 = (s: Scenario, sha: string, date: string) => s.http.on("GET api.github.com/repos/acme/api/commits", (req) => (new URL(req.url).searchParams.get("until")! < "2026-10-01"
  ? [{ sha: BASE, commit: { committer: { date: "2026-09-29T08:00:00Z" } } }] : [{ sha, commit: { committer: { date } } }]));

discordScenario("the same repository, branch and coverage asked for on a later day go on with the open draft at its own commits, though the days now pin another head (#368)", async (s) => {
  await acmeApi(s);
  // Started on the 23rd, after its last day had ended: its head is that day's last commit, and stays it.
  s.clock.set("2026-10-23T09:00:00+07:00");
  const [started] = await turn(s, SAME, results);
  const draft = "channel/files/changelogs/acme-api/2026-10-23_9f8e7d6..a1b2c3d.draft.json";
  expect(started.draft).toBe(draft);
  // A commit dated 22 October reached main afterwards, pushed late.
  lastOn22(s, "c4d5e6f".padEnd(40, "0"), "2026-10-22T08:00:00Z");
  s.clock.set("2026-10-24T09:00:00+07:00");

  const [again] = await turn(s, SAME, results);
  expect(again).toMatchObject({
    draft, base: { ref: "main before 2026-10-01", commit: BASE }, head: { ref: "main through 2026-10-22", commit: HEAD },
    goesOn: "This is the changelog already open here, for the same repository, branch and coverage: it goes on with its draft, and nothing new was started. Say so in one line and go on, without asking whether to.",
  });
  expect(again.lastDay).toBeUndefined();
  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-10-23_9f8e7d6..a1b2c3d.draft.json`]);
});

discordScenario("a draft pinned before its last day ended, asked for again after that day, moves its head to that day's last commit once: the files changed since go back to unmapped, and the result says how many commits that added (#371)", async (s) => {
  await acmeApi(s);
  // Pinned at 10:00 on its last day, the 22nd, with both files mapped to the one candidate they reach.
  await turn(s, SAME, results);
  await turn(s, [READ_DTO, MAP_BOTH], results);
  // That afternoon main gained two commits: the DTO changed again, and a refund DTO came.
  const LATER = "c4d5e6f".padEnd(40, "0"), REFUND = "src/orders/dto/refund.dto.ts";
  lastOn22(s, LATER, "2026-10-22T09:00:00Z");
  s.http.on(`GET api.github.com/repos/acme/api/compare/${HEAD}...${LATER}`, () => ({ ahead_by: 2, behind_by: 0, commits: [], files: [{ filename: "src/users/dto/create-user.dto.ts", status: "modified" }, { filename: REFUND, status: "added" }] }));
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${LATER}`, () => ({ ahead_by: 5, behind_by: 0, commits: [], files: [{ filename: "src/users/users.controller.ts", status: "modified", patch: "@@ -10 +10 @@\n-  @Post()\n+  @Post('v2')" }, { filename: "src/users/dto/create-user.dto.ts", status: "modified" }, { filename: REFUND, status: "added" }] }));
  s.clock.set("2026-10-24T09:00:00+07:00");

  const [again] = await turn(s, SAME, results);
  expect(again).toMatchObject({ draft: DRAFT, base: { ref: "main before 2026-10-01", commit: BASE }, head: { ref: "main through 2026-10-22", commit: LATER }, changedFiles: { commits: 5, totalFiles: 3 } });
  expect(again.lastDay).toBe("2026-10-22 had not ended when this changelog was pinned: its head moved from a1b2c3d to that day's last commit, c4d5e6f, adding 2 commits. The files they changed are to be mapped again, and the traced candidates those files reach are traced again. Say so in one line.");
  // The draft keeps its name; what it compares is the new head.
  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`]);
  const doc = JSON.parse((await s.workspace.read(`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`))!);
  expect([doc.info.version, doc.info["x-changelog"].head]).toEqual(["c4d5e6f", { ref: "main through 2026-10-22", commit: "c4d5e6f" }]);
  const meta = doc["x-draft"];
  expect(meta).toMatchObject({ head: LATER, commits: 5, changedFiles: 3 });
  // The files as the comparison at the new head lists them, with the length of the one patch it gives, which mapping groups weigh (#370).
  expect(meta.files).toEqual([{ path: "src/users/users.controller.ts", status: "modified", patchChars: 39 }, { path: "src/users/dto/create-user.dto.ts", status: "modified" }, { path: REFUND, status: "added" }]);
  // The controller did not change again and stays mapped; the DTO that did is unmapped and unread, and its change left the candidate's note.
  expect(meta.mapping).toEqual({ "src/users/users.controller.ts": { read: true, reaches: ["POST /api/v2/users"] } });
  expect(meta.candidates).toEqual([{ method: "post", path: "/api/v2/users", note: "src/users/users.controller.ts: @Post() became @Post('v2')", state: "waiting" }]);

  // Asked again a day later, when a commit dated the 22nd was pushed late, the head stays where it moved.
  lastOn22(s, "d7e8f90".padEnd(40, "0"), "2026-10-22T10:00:00Z");
  s.clock.set("2026-10-25T09:00:00+07:00");
  const [later] = await turn(s, SAME, results);
  expect(later.head.commit).toBe(LATER);
  expect(later.lastDay).toBeUndefined();
});

discordScenario("a different range asked for while a draft is open starts nothing, and the question to go on with the open one or stop it pauses the draft for it (#368)", async (s) => {
  await acmeApi(s);
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  const QUESTION = "The acme/api changelog of 1 to 22 October is still open. Go on with it, or stop it first and start 15 to 22 October?";
  let refused = "";
  s.model.script(
    { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-15" } },
    (t) => { refused = t.toolResults[0].error; return { tool: "askChangelogAsker", args: { draft: DRAFT, question: QUESTION } }; },
    "Asked.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 15 October`);

  expect(refused).toBe(`Another API changelog is open here and nothing new was started: acme/api, branch main, 2026-10-01 to 2026-10-22, started by Alice, 0 endpoints recorded (draft ${DRAFT}). This request was for acme/api, branch main, 2026-10-15 to 2026-10-22. Ask with askChangelogAsker, passing that draft, whether to go on with the open one or stop it first: it pauses the work until someone answers. Never ask it in plain text, or the work goes on without the answer.`);
  expect(s.discord.botMessages.at(-1)!.content).toBe(QUESTION);
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "question", question: QUESTION, since: "2026-10-22T03:00:00.000Z" });
  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`]);
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
    mappingNote: "Before it is written, every changed file must be mapped or set aside with a reason (putChangelogNotes setAside). Set aside first what cannot change what the frontend sees, then map the rest with mapChangedFiles: its workers read the patches and record how each file ends. Mapped so far: 0 of 2.",
  });

  // The endpoint both files reach goes to a worker, which records it with its components (#369).
  let components: any, saved: any;
  await tracedTurn(s, [READ_DTO, MAP_BOTH, WRITE_CONVENTIONS, TRACE], [
    [{ tool: "putChangelogComponents", args: { draft: DRAFT, components: FIXTURE.components } }, { tool: "putChangelogOperation", args: { draft: DRAFT, method: "POST", path: "/api/v2/users", operation: { ...OPERATION, "x-impact": undefined } } }],
    (t: any) => { [components, saved] = t.toolResults; return "Recorded POST /api/v2/users."; },
  ], results);
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
    operations: ["POST /api/v2/users (breaking)"], removedOperations: ["DELETE /api/v1/sessions"], globalChanges: 0, unverified: 0, mapped: 0, setAside: 0, left: 2,
    note: "This changelog was started before; what it recorded so far is kept. Go on with the endpoints not yet recorded.",
  });
});

discordScenario("an operation's problems come back at once, and finishing refuses while any remain", async (s) => {
  await acmeApi(s);
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  const broken = { ...OPERATION, "x-changes": OPERATION["x-changes"].map((c: any, i: number) => (i === 2 ? { ...c, field: "phone_number" } : c)) };
  let saved: any;
  await tracedTurn(s, [READ_DTO, MAP_BOTH, WRITE_CONVENTIONS, TRACE], [
    { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: broken, components: FIXTURE.components } },
    (t: any) => { saved = t.toolResults.at(-1); return "Recorded POST /api/v2/users."; },
  ], results);
  expect(saved.problems).toEqual(["POST /api/v2/users x-changes[2]: field 'phone_number' does not exist in the body schema"]);
  const [refused] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(refused).toEqual({ written: false, errors: ["POST /api/v2/users x-changes[2]: field 'phone_number' does not exist in the body schema"], fix: "Fix each error (putChangelogOperation or putChangelogNotes) and call finishChangelog again." });
  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`]);
});

discordScenario("a draft that records no change writes no changelog, and the whole history starts from the empty tree", async (s) => {
  await acmeApi(s);
  const none = (path: string) => ({ path, none: "it changes only a comment" });
  await turn(s, [{ tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, READ_DTO, map(none("src/users/users.controller.ts"), none("src/users/dto/create-user.dto.ts"))], results);
  const [nothing] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(nothing).toEqual({ written: false, note: "The draft records no frontend-visible change, so no changelog was written; the draft is gone. Say so, with how many changed files were mapped." });
  expect(await s.workspace.list(FOLDER)).toEqual([]);

  s.http.on(`GET api.github.com/repos/acme/api/git/trees/${HEAD}?recursive=1`, () => ({ tree: [{ path: "src/main.ts", type: "blob" }, { path: "src", type: "tree" }], truncated: false }));
  const [all] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "all" } }, results);
  expect(all).toMatchObject({
    draft: "channel/files/changelogs/acme-api/2026-10-22_4b825dc..a1b2c3d.draft.json", scope: "all", base: { ref: "(empty)", commit: "empty tree" },
    note: "Nothing came before this changelog: every endpoint of head is NEW. Read head only.", changedFiles: { files: ["src/main.ts"], totalFiles: 1 },
  });
});

discordScenario("a changelog is written only when every changed file was mapped or set aside with a reason: finishing names the files left, and what was set aside is in it (#347, #366)", async (s) => {
  await acmeApi(s);
  s.discord.unlimited(s.discord.alice);
  const patch = (name: string) => `@@ -1 +1 @@\n-old ${name}\n+new ${name}`;
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 3, behind_by: 0, commits: [], files: [
    { filename: "src/users/users.controller.ts", status: "modified", patch: patch("controller") }, { filename: "README.md", status: "modified", patch: patch("readme") },
    { filename: "src/users/dto/create-user.dto.ts", status: "modified" }, { filename: "src/users/dto/update-user.dto.ts", status: "modified" }, { filename: "src/users/users.controller.spec.ts", status: "modified" },
  ] }));
  const [started] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  expect(started.mappingNote).toBe("Before it is written, every changed file must be mapped or set aside with a reason (putChangelogNotes setAside). Set aside first what cannot change what the frontend sees, then map the rest with mapChangedFiles: its workers read the patches and record how each file ends. Mapped so far: 0 of 5.");
  const fix = "Map them with mapChangedFiles, or set aside those that cannot change what the frontend sees with putChangelogNotes setAside, each with its reason; then call finishChangelog again.";
  // Read is not mapped: the two patches startChangelog gave are read, and every file is still unmapped.
  const [early] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(early).toEqual({ written: false, unmapped: 5, files: ["src/users/users.controller.ts", "README.md", "src/users/dto/create-user.dto.ts", "src/users/dto/update-user.dto.ts", "src/users/users.controller.spec.ts"], fix });

  await turn(s, map(CONTROLLER_REACHES, { path: "README.md", none: "documentation; nothing serves it" }), results);
  // Patterns that skip the work instead of naming files that need none.
  const aside = (pattern: string, reason = "too many files") => ({ tool: "putChangelogNotes", args: { draft: DRAFT, setAside: [{ pattern, reason }] } });
  const [everything, rest] = await turn(s, [aside("**"), aside("src/users/**")], results);
  expect(everything).toBe(`setAside "**" covers every changed file. Set aside only files that cannot change what the frontend sees (tests, docs, CI, lockfiles), each with its reason, and map the rest.`);
  expect(rest).toBe(`setAside "src/users/**" covers every file not yet mapped. Set aside only files that cannot change what the frontend sees (tests, docs, CI, lockfiles), each with its reason, and map the rest.`);

  const [tests] = await turn(s, aside("*.spec.ts", "Tests; they are not served"), results);
  expect(tests).toEqual({ saved: true, globalChanges: 0, removedOperations: 0, unverified: 0, files: { mapped: 2, setAside: 1, left: 2 } });
  const [still] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(still).toEqual({ written: false, unmapped: 2, files: ["src/users/dto/create-user.dto.ts", "src/users/dto/update-user.dto.ts"], fix });

  await tracedTurn(s, [
    { tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path: "src/users/dto/create-user.dto.ts" } },
    { tool: "repoReadFile", args: { repo: "acme/api", ref: BASE, path: "src/users/dto/update-user.dto.ts" } },
    map(DTO_REACHES, { path: "src/users/dto/update-user.dto.ts", none: "UpdateUserDto is imported by no controller" }),
    WRITE_CONVENTIONS, TRACE,
  ], WORKER, results);
  // The conversation has passed its window by now, so the turn ends with a summary of its older talk.
  const [finished] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results, "Alice asked for the acme/api changelog of 1–22 October.");
  expect(finished).toMatchObject({ written: true, setAside: [{ pattern: "*.spec.ts", reason: "Tests; they are not served" }] });
  const written = JSON.parse((await s.workspace.read(`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.json`))!);
  expect(written.info["x-changelog"].setAside).toEqual([{ pattern: "*.spec.ts", reason: "Tests; they are not served" }]);
  expect(written["x-draft"]).toBeUndefined();
});

discordScenario("a changed file is mapped only once its whole patch was read, and the endpoints it reaches are kept as one waiting candidate each, its note naming every change that reaches it (#366)", async (s) => {
  await acmeApi(s);
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  const dto = { repo: "acme/api", path: "src/users/dto/create-user.dto.ts" };

  // The controller's patch came with startChangelog; the DTO's did not, so nothing is mapped.
  const [unread] = await turn(s, map(CONTROLLER_REACHES, DTO_REACHES), results);
  expect(unread).toBe("Nothing was mapped: a file is mapped only once its whole patch was read. Read first, with repoFileDiff from 9f8e7d6 to a1b2c3d (or every line at either commit with repoReadFile):\n- src/users/dto/create-user.dto.ts");
  // A read at another ref, or of part of the file, reads nothing whole.
  const [, , partly] = await turn(s, [{ tool: "repoReadFile", args: { ...dto, ref: "main" } }, { tool: "repoReadFile", args: { ...dto, ref: HEAD, toLine: 2 } }, map(DTO_REACHES)], results);
  expect(partly).toBe("Nothing was mapped: a file is mapped only once its whole patch was read. Read first, with repoFileDiff from 9f8e7d6 to a1b2c3d (or every line at either commit with repoReadFile):\n- src/users/dto/create-user.dto.ts (lines 1-2 of 4 read at head)");
  expect((await draftMeta(s)).candidates).toBeUndefined();

  const [, mapped] = await turn(s, [{ tool: "repoReadFile", args: { ...dto, ref: HEAD.slice(0, 7), fromLine: 3 } }, map(CONTROLLER_REACHES, DTO_REACHES)], results);
  expect(mapped).toEqual({ mapped: ["src/users/users.controller.ts", "src/users/dto/create-user.dto.ts"], newCandidates: ["POST /api/v2/users"], candidates: 1, files: { mapped: 2, setAside: 0, left: 0 } });
  const meta = await draftMeta(s);
  expect(meta.candidates).toEqual([{ method: "post", path: "/api/v2/users", note: "src/users/users.controller.ts: @Post() became @Post('v2')\nsrc/users/dto/create-user.dto.ts: CreateUserDto gains phone", state: "waiting" }]);
  expect(meta.mapping).toEqual({
    "src/users/users.controller.ts": { read: true, reaches: ["POST /api/v2/users"] },
    "src/users/dto/create-user.dto.ts": { read: true, reaches: ["POST /api/v2/users"] },
  });

  // Mapped again, a file says anew how it ends, and its change leaves the candidate's note; a file the range did not change is refused.
  const [again, stranger] = await turn(s, [map({ path: dto.path, none: "CreateUserDto is used by no route" }), map({ path: "src/main.ts", none: "unchanged" })], results);
  expect(again).toEqual({ mapped: ["src/users/dto/create-user.dto.ts"], newCandidates: [], candidates: 1, files: { mapped: 2, setAside: 0, left: 0 } });
  expect(stranger).toBe("Nothing was mapped: src/main.ts is not a changed file of this changelog.");
  const remapped = await draftMeta(s);
  expect(remapped.candidates).toEqual([{ method: "post", path: "/api/v2/users", note: "src/users/users.controller.ts: @Post() became @Post('v2')", state: "waiting" }]);
  expect(remapped.mapping["src/users/dto/create-user.dto.ts"]).toEqual({ read: true, none: "CreateUserDto is used by no route" });
});

discordScenario("a draft started before files were mapped has every changed file unmapped and unread: its examined list is not carried over (#366)", async (s) => {
  await acmeApi(s);
  const changelog = { date: "2026-10-22", base: { ref: "main before 2026-10-01", commit: "9f8e7d6" }, head: { ref: "main through 2026-10-22", commit: "a1b2c3d" }, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, globalChanges: [], removedOperations: [], unverified: [] };
  await s.workspace.write(`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`, JSON.stringify({
    openapi: "3.1.2", info: { title: "acme/api API changes", version: "a1b2c3d", "x-changelog": changelog }, paths: {}, components: {},
    "x-draft": {
      repo: "acme/api", branch: "main", scope: "range", from: "2026-10-01", to: "2026-10-22", place: "channel-1", startedBy: { id: "user-alice", name: "Alice" }, changedFiles: 2,
      base: BASE, head: HEAD, files: [{ path: "src/users/users.controller.ts", status: "modified" }, { path: "src/users/dto/create-user.dto.ts", status: "modified" }],
      examined: ["src/users/users.controller.ts", "src/users/dto/create-user.dto.ts"], touchedAt: new Date(s.clock.now()).toISOString(),
    },
  }));
  expect(await contextAfter(s)).toContain(`${OPEN(0)} 0 endpoints recorded so far.`);
  const [refused] = await turn(s, map(CONTROLLER_REACHES), results);
  expect(refused).toBe("Nothing was mapped: a file is mapped only once its whole patch was read. Read first, with repoFileDiff from 9f8e7d6 to a1b2c3d (or every line at either commit with repoReadFile):\n- src/users/users.controller.ts");
  const [early] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(early).toMatchObject({ written: false, unmapped: 2, files: ["src/users/users.controller.ts", "src/users/dto/create-user.dto.ts"] });
});

discordScenario("files that change every endpoint alike are mapped to a global change, recorded once in the notes and never as a candidate per endpoint (#366)", async (s) => {
  await acmeApi(s);
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 1, behind_by: 0, commits: [], files: [
    { filename: "src/config/routes.ts", status: "modified", patch: "@@ -1 +1 @@\n-export const API_PREFIX = 'api';\n+export const API_PREFIX = 'api/v2';" },
    { filename: "src/main.ts", status: "modified", patch: "@@ -3 +3 @@\n-  app.setGlobalPrefix('api');\n+  app.setGlobalPrefix(API_PREFIX);" },
  ] }));
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  const prefix = { status: "CHANGED", impact: "breaking", in: "url", before: "/api", after: "/api/v2", note: "Every route moved under /api/v2." };
  // The second file names the same change with its keys in another order.
  const [mapped] = await turn(s, map({ path: "src/config/routes.ts", global: prefix }, { path: "src/main.ts", global: { note: prefix.note, after: "/api/v2", before: "/api", in: "url", impact: "breaking", status: "CHANGED" } }), results);
  expect(mapped).toEqual({ mapped: ["src/config/routes.ts", "src/main.ts"], newCandidates: [], candidates: 0, globalChanges: 1, files: { mapped: 2, setAside: 0, left: 0 } });
  expect((await draftMeta(s)).candidates).toBeUndefined();

  const [finished] = await turn(s, { tool: "finishChangelog", args: { draft: DRAFT } }, results);
  expect(finished).toMatchObject({ written: true, summary: { breaking: 1, deprecated: 0, "non-breaking": 0 }, breaking: ["every endpoint: CHANGED url /api → /api/v2: Every route moved under /api/v2."] });
  expect(JSON.parse((await s.workspace.read(`${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.json`))!).info["x-changelog"].globalChanges).toEqual([prefix]);
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
    stopped: true, repo: "acme/api", branch: "main", covers: "2026-10-01 to 2026-10-22", operations: 1, files: { mapped: 0, setAside: 0, left: 2 },
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
  await turn(s, [READ_DTO, MAP_BOTH], results);
  // Mapping the changed files touched it: 7 days from now on, not from the start.
  s.clock.advance(6 * 24 * 3600_000);
  expect(await contextAfter(s)).toContain("2 changed files: 2 mapped, 0 set aside, 0 left");
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

/** Each tool result of the turn as "ok" or its refusal, short enough for one message. */
const outcomes = (turn: any) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? "ok"));
const LIMITED = "Too many requests right now. Wait a minute and try again.";

discordScenario("with a Changelog draft open, a turn's git reads are not held to the per-person limit (#352)", async (s) => {
  await acmeApi(s);
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  expect(await turn(s, Array.from({ length: 32 }, () => READ_DTO), outcomes)).toEqual(Array(32).fill("ok"));
});

discordScenario("without long work, the 31st tool call of a person within a minute is refused as before (#352)", async (s) => {
  await acmeApi(s);
  expect(await turn(s, Array.from({ length: 32 }, () => READ_DTO), outcomes)).toEqual([...Array(30).fill("ok"), LIMITED, LIMITED]);
});

discordScenario("an operation sent as JSON text is taken as the object it holds, and text that does not parse says where (#353)", async (s) => {
  await acmeApi(s);
  await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } }, results);
  const [saved, broken] = await turn(s, [
    { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: JSON.stringify(OPERATION), components: JSON.stringify(FIXTURE.components) } },
    { tool: "putChangelogOperation", args: { draft: DRAFT, method: "get", path: "/api/v2/users", operation: JSON.stringify(OPERATION).slice(0, -1) } },
  ], results);
  expect(saved).toEqual({ saved: "POST /api/v2/users", impact: "breaking", operations: 1 });
  expect(broken).toStartWith("operation was sent as JSON text that does not parse (");
  expect(broken).toEndWith("). Send it as an object, not as text.");
});

discordScenario("a range draft from before drafts listed their files is told to start once more, which lists them, and traces nothing before; a stop is told to stay short (#353, #369)", async (s) => {
  await acmeApi(s);
  const changelog = { date: "2026-10-21", base: { ref: "main before 2026-10-01", commit: "9f8e7d6" }, head: { ref: "main through 2026-10-22", commit: "a1b2c3d" }, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, globalChanges: [], removedOperations: [], unverified: [] };
  await s.workspace.write(`${FOLDER}/2026-10-21_9f8e7d6..a1b2c3d.draft.json`, JSON.stringify({
    openapi: "3.1.2", info: { title: "acme/api API changes", version: "a1b2c3d", "x-changelog": changelog }, paths: {}, components: {},
    "x-draft": { repo: "acme/api", branch: "main", scope: "range", from: "2026-10-01", to: "2026-10-22", conventions: "NestJS: routes from @Controller, no global prefix.", candidates: [{ method: "post", path: "/api/v2/users", state: "waiting" }] },
  }));
  const RESTART = "This draft does not list its changed files yet: call startChangelog once with its repository, branch and coverage.";
  const before = await contextAfter(s);
  expect(before).toContain(RESTART);
  expect(before).toContain("If you stop before it is written, answer in at most three short lines: how far it is (changed files mapped of all, endpoints recorded) and what comes next. Name no tools and no failed calls unless the person must act on them, and do not ask whether to go on.");
  // Which files changed is not known yet, so none is mapped: the candidate an earlier run kept waits (#369).
  const [untraced] = await turn(s, { tool: "traceEndpoints", args: { draft: "channel/files/changelogs/acme-api/2026-10-21_9f8e7d6..a1b2c3d.draft.json" } }, results);
  expect(untraced).toBe(`${RESTART} Nothing was traced.`);

  const [again] = await turn(s, { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01", to: "2026-10-22" } }, results);
  expect(again.draft).toBe("channel/files/changelogs/acme-api/2026-10-21_9f8e7d6..a1b2c3d.draft.json");
  expect(again.resumed).toMatchObject({ mapped: 0, setAside: 0, left: 2 });
  const after = await contextAfter(s);
  expect(after).toContain("(commits 9f8e7d6..a1b2c3d, 2 changed files: 0 mapped, 0 set aside, 2 left)");
  expect(after).not.toContain(RESTART);
  // The comparison that lists its files also says how many commits its range holds, and the draft keeps that too (#367).
  expect(JSON.parse((await s.workspace.read(`${FOLDER}/2026-10-21_9f8e7d6..a1b2c3d.draft.json`))!)["x-draft"].commits).toBe(3);
});
