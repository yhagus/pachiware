import { afterEach, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { discordScenario, type Scenario } from "./support/discordScenario";
import {
  BASE, CONTROLLER, DRAFT, DRAFT_FILE, FINISH, FIXTURE, FOLDER, HEAD, OPERATION, PROVIDER_DOWN, START, WRITTEN, WRITTEN_FILE,
  contractDiffOn, draftMeta, fastProgress, pause, pauses, written,
} from "./support/changelog";

const PLAYBOOK = new URL("../../../packages/skills/playbooks/contract-diff/", import.meta.url);
/** What every file of acme/api reads as, at any commit: what a worker reads, and the main loop never should. */
const SOURCE = "@Controller('api/v2/users')\nexport class UsersController {\n  @Post() create(@Body() dto: CreateUserDto) {}\n}";
const CONVENTIONS = "Routes: @Controller prefixes, no global prefix. Envelope: { data } from TransformInterceptor. Errors: HttpExceptionFilter gives { code, message }.";

/**
 * acme/api on GitHub, open in this channel (no threads), at 10:00 on 22 October in Jakarta: main's last commit through that day is HEAD,
 * its last before 1 October BASE, and between them two commits changed only the users controller, its patch given. Workers trace one at a time.
 */
async function acmeApi(s: Scenario) {
  await s.guildSettings({ language: "en", useThreads: false });
  s.clock.set("2026-10-22T10:00:00+07:00");
  await s.git({ repos: ["acme/*"] });
  await contractDiffOn(s);
  expect((await s.admin("PUT", `/api/admin/tenants/${s.tenant.id}/settings`, { playbookWorkers: 1 })).status).toBe(200);
  s.http.on("GET api.github.com/repos/acme/api", () => ({ default_branch: "main" }));
  s.http.on("GET api.github.com/repos/acme/api/commits", (req) => (new URL(req.url).searchParams.get("until")! < "2026-10-01"
    ? [{ sha: BASE, commit: { committer: { date: "2026-09-29T08:00:00Z" } } }] : [{ sha: HEAD, commit: { committer: { date: "2026-10-21T08:00:00Z" } } }]));
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 2, behind_by: 0, commits: [], files: [
    { filename: CONTROLLER, status: "modified", patch: "@@ -1 +1 @@\n-@Controller('api/v1/users')\n+@Controller('api/v2/users')" },
  ] }));
  s.http.on("GET api.github.com/repos/acme/api/contents/", (req) => ({ type: "file", path: new URL(req.url).pathname.split("/contents/")[1], encoding: "base64", content: Buffer.from(SOURCE).toString("base64") }));
}
const NOTE_CONVENTIONS = { tool: "putChangelogNotes", args: { draft: DRAFT, conventions: CONVENTIONS } };
const candidate = (method: string, path: string, note?: string) => ({ method, path, ...(note ? { note } : {}) });
/** Maps the changed controller, whose patch came with startChangelog, to the endpoints it reaches (POST /api/v2/users unless named), so the changelog can be finished (#366). */
const mapController = (...endpoints: ReturnType<typeof candidate>[]) => ({ tool: "putChangelogMapping", args: { draft: DRAFT, files: [{ path: CONTROLLER, change: "the controller moved to api/v2", endpoints: endpoints.length ? endpoints : [candidate("post", "/api/v2/users")] }] } });
const trace = (...candidates: ReturnType<typeof candidate>[]) => ({ tool: "traceEndpoints", args: { draft: DRAFT, ...(candidates.length ? { candidates } : {}) } });
/** A worker's step that records `method path` as the example operation. */
const record = (method: string, path: string) => [
  { tool: "putChangelogComponents", args: { draft: DRAFT, components: FIXTURE.components } },
  { tool: "putChangelogOperation", args: { draft: DRAFT, method, path, operation: OPERATION } },
];
const readController = { tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path: CONTROLLER } };
/** The six tools a worker is offered, whatever the place offers (ADR 0024). */
const WORKER_TOOLS = ["putChangelogComponents", "putChangelogOperation", "repoFileDiff", "repoReadFile", "repoSearchCode", "repoTree"];
const text = (message: any) => (typeof message?.content === "string" ? message.content : JSON.stringify(message?.content));
/** The first message after the system prompt: a worker's brief, or the turn's message. */
const briefOf = (call: any[]) => text(call[1]);
const isWorker = (call: any[]) => briefOf(call).startsWith("Trace one endpoint");
/** The first model call of each worker, in the order they started. */
const workerStarts = (s: Scenario) => s.model.calls.filter((call) => isWorker(call) && !call.some((m: any) => m.role === "assistant"));

discordScenario("traceEndpoints hands each candidate to a worker of its own, which starts from a brief and six tools and records its endpoint in the draft; what the worker read never reaches the main loop (#343)", async (s) => {
  await acmeApi(s);
  let traced: any, candidates: any;
  s.model.script(
    START, [NOTE_CONVENTIONS, mapController()],
    // The candidate mapping kept, passed again: it keeps its note.
    trace(candidate("post", "/api/v2/users")),
    // The worker.
    readController, record("post", "/api/v2/users"), "Recorded POST /api/v2/users.",
    async (turn) => { traced = turn.toolResults.at(-1); candidates = (await draftMeta(s)).candidates; return FINISH; },
    written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(s.model.calls).toHaveLength(8);
  const worker = s.model.calls[3]!;
  expect(s.model.calls.map(isWorker)).toEqual([false, false, false, true, true, true, false, false]);
  expect([...s.model.tools[3]!].sort()).toEqual(WORKER_TOOLS);
  // Its brief: the repository, both commits, the draft, the conventions the main loop kept, the extension reference, and its endpoint.
  const brief = briefOf(worker);
  for (const part of ["acme/api", "branch main", BASE, HEAD, DRAFT, CONVENTIONS, readFileSync(new URL("extensions.md", PLAYBOOK), "utf8").trim(), "POST /api/v2/users", "the controller moved to api/v2"]) expect([part, brief.includes(part)]).toEqual([part, true]);
  // It follows the tracing rules alone: not the main loop's steps, and not checklist.md.
  const rules = text(worker[0]);
  expect(rules).toContain("**Presence versus null.**");
  expect(rules).not.toContain("## 1. Pin what the changelog covers");
  expect(rules + brief).not.toContain("# Hidden-rules checklist");
  // The main loop learns what the worker recorded, never what it read.
  expect(traced).toEqual({ traced: [{ endpoint: "POST /api/v2/users", recorded: ["POST /api/v2/users"], impact: "breaking", changes: 4 }], failed: [], waiting: 0, note: expect.any(String) });
  for (const call of s.model.calls.slice(6)) expect(call.map(text).join("\n")).not.toContain(SOURCE);
  expect(candidates).toEqual([{ method: "post", path: "/api/v2/users", note: `${CONTROLLER}: the controller moved to api/v2`, state: "traced", recorded: ["POST /api/v2/users"], at: "2026-10-22T03:00:00.000Z" }]);
  // All in Alice's own turn: the answer replies to her, mentioning her as its reply and pinging no one (#361).
  expect(s.discord.botMessages.map((m) => ({ content: m.content, allowedMentions: m.allowedMentions }))).toEqual([{ content: `The acme/api changelog is written: ${WRITTEN}`, allowedMentions: { parse: [], repliedUser: true } }]);
  expect(JSON.parse((await s.workspace.read(WRITTEN_FILE))!).paths["/api/v2/users"].post["x-impact"]).toBe("breaking");
});

/** traceEndpoints' answer on a draft that holds no conventions summary yet (#365). */
const NO_CONVENTIONS = "This changelog's draft holds no conventions summary yet, so every worker would have to find the repository's conventions in the code again. Write it first, as step 2 says: read checklist.md with readPlaybookFile, work through it at head, and keep what you learned with putChangelogNotes conventions; then call traceEndpoints again. Nothing was traced.";

discordScenario("traceEndpoints on a draft with no conventions summary traces nothing and says to write it first; once it is written, the same call traces with the summary in each worker's brief (#365)", async (s) => {
  await acmeApi(s);
  let refusal = "", kept: unknown = "not read";
  s.model.script(
    START,
    trace(candidate("post", "/api/v2/users")),
    async (turn) => { refusal = turn.toolResults.at(-1).error; kept = (await draftMeta(s)).candidates; return [NOTE_CONVENTIONS, mapController()]; },
    trace(candidate("post", "/api/v2/users")),
    // The worker.
    record("post", "/api/v2/users"), "Recorded POST /api/v2/users.",
    FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(refusal).toBe(NO_CONVENTIONS);
  // The refused call kept no candidate and started no worker; the one after the summary started the only worker.
  expect(kept).toBeUndefined();
  expect(s.model.calls.map(isWorker)).toEqual([false, false, false, false, true, true, false, false]);
  expect(briefOf(s.model.calls[4]!)).toContain(`<untrusted_data source="conventions summary">\n${CONVENTIONS}\n</untrusted_data>`);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([`The acme/api changelog is written: ${WRITTEN}`]);
});

discordScenario("a turn that goes on by itself from a draft with no conventions summary is told to write it first, and a refused traceEndpoints adds nothing: two such turns in a row pause the draft (#365, #357)", async (s) => {
  await acmeApi(s);
  let state = "";
  s.model.script(
    START, "Started the acme/api changelog.",
    // Both turns that go on by themselves hand the candidate over without writing the summary.
    (turn) => { state = text(turn.messages[1]); return trace(candidate("post", "/api/v2/users")); }, "The endpoint waits for the conventions.",
    trace(candidate("post", "/api/v2/users")), "It still waits.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(state).toEndWith("\n</untrusted_data>\nThe draft holds no conventions summary yet: write it before any endpoint is traced, as step 2 says (checklist.md, then putChangelogNotes conventions). traceEndpoints refuses until it is written.");
  expect(s.model.calls).toHaveLength(6);
  expect(workerStarts(s)).toEqual([]);
  const meta = await draftMeta(s);
  expect(meta.candidates).toBeUndefined();
  expect(meta.work).toEqual({ state: "paused", reason: "no-progress", since: "2026-10-22T03:00:00.000Z" });
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(['<@user-alice> The changelog made no progress, so I paused it; type "go on" to continue.']);
});

/** A new endpoint's operation, valid as it stands, with one change: what a worker records for any endpoint but the example's. */
const newOperation = (id: string) => ({
  operationId: id, summary: id, security: [],
  responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { data: { type: "string" } }, required: ["data"] }, example: { data: "x" } } } } },
  "x-changes": [{ status: "NEW", impact: "non-breaking", in: "operation" }],
});
const recordNew = (method: string, path: string, id: string) => ({ tool: "putChangelogOperation", args: { draft: DRAFT, method, path, operation: newOperation(id) } });
const EXPORT = candidate("get", "/api/v2/users/export"), SESSIONS = candidate("delete", "/api/v2/sessions");
/** The endpoint a worker's brief names. */
const endpointOf = (call: any[]) => briefOf(call).match(/^Your endpoint: (.+)$/m)?.[1];

// Budgets are shortened for a scenario and put back after it.
let shipped: { turn: number; worker: { steps: number; ms: number; leastMs: number } } | undefined;
async function budgets(turnMs: number, worker: Partial<{ steps: number; ms: number; leastMs: number }>) {
  const { turnDeadline } = await import("../src/loop/react.ts");
  const { workerBudget } = await import("../../../packages/skills/src/openapi/trace.ts");
  shipped ??= { turn: turnDeadline.ms, worker: { ...workerBudget } };
  turnDeadline.ms = turnMs;
  Object.assign(workerBudget, worker);
}
afterEach(async () => {
  if (!shipped) return;
  (await import("../src/loop/react.ts")).turnDeadline.ms = shipped.turn;
  Object.assign((await import("../../../packages/skills/src/openapi/trace.ts")).workerBudget, shipped.worker);
  shipped = undefined;
});

discordScenario("a turn cut while its workers trace goes on by itself with the candidates still waiting, and never traces one again (#343)", async (s) => {
  await acmeApi(s);
  // A turn has 3 seconds here, and a worker starts only with at least 1 second left.
  await budgets(3000, { leastMs: 1000 });
  let state = "";
  s.model.script(
    START, [NOTE_CONVENTIONS, mapController()],
    trace(candidate("post", "/api/v2/users"), EXPORT, SESSIONS),
    // The first worker records its endpoint and answers once the turn's time is gone.
    record("post", "/api/v2/users"), async () => { await pause(3200); return "Recorded POST /api/v2/users."; },
    "One of three endpoints is traced; two wait.",
    // The turn that goes on by itself starts from the draft, which says which candidates wait.
    (turn) => { state = text(turn.messages[1]); return trace(); },
    recordNew("get", "/api/v2/users/export", "exportUsers"), "Recorded GET /api/v2/users/export.",
    recordNew("delete", "/api/v2/sessions", "endSession"), "Recorded DELETE /api/v2/sessions.",
    FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(workerStarts(s).map(endpointOf)).toEqual(["POST /api/v2/users", "GET /api/v2/users/export", "DELETE /api/v2/sessions"]);
  expect(state).toContain("Candidate endpoints: 3: 1 traced, 0 failed, 2 waiting.\nWaiting to be traced: GET /api/v2/users/export, DELETE /api/v2/sessions\n");
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([{ content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, pinged: ["user-alice"] }]);
  expect(Object.keys(JSON.parse((await s.workspace.read(WRITTEN_FILE))!).paths).sort()).toEqual(["/api/v2/sessions", "/api/v2/users", "/api/v2/users/export"]);
}, 30000);

const states = async (s: Scenario) => (await draftMeta(s)).candidates.map((c: any) => `${c.method.toUpperCase()} ${c.path}: ${c.state}`);

discordScenario("a worker that cannot reach the model leaves its endpoint waiting, and the draft goes through the model's rule: one retry after the tenant's wait, then a pause (#343)", async (s) => {
  await acmeApi(s);
  s.model.script(
    START, NOTE_CONVENTIONS, "Started the acme/api changelog.",
    trace(candidate("post", "/api/v2/users"), EXPORT), PROVIDER_DOWN,
    trace(), PROVIDER_DOWN,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  // The worker's failure ends the turn that went on by itself, which then waits the tenant's 60 seconds; no other worker started.
  expect(s.model.calls).toHaveLength(5);
  expect(await states(s)).toEqual(["POST /api/v2/users: waiting", "GET /api/v2/users/export: waiting"]);
  expect((await draftMeta(s)).work).toEqual({ state: "worked-on", retryAt: "2026-10-22T03:01:00.000Z" });
  expect(s.discord.botMessages).toEqual([]);

  s.clock.advance(60_000);
  await s.scheduler.tick();

  // The retry goes on with the same endpoint, whose worker fails again: the draft pauses, and the endpoints still wait.
  expect(workerStarts(s).map(endpointOf)).toEqual(["POST /api/v2/users", "POST /api/v2/users"]);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: "<@user-alice> The AI model can't be reached; say go on to carry on.", pinged: ["user-alice"] },
  ]);
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "model", since: "2026-10-22T03:01:00.000Z" });
  expect(await states(s)).toEqual(["POST /api/v2/users: waiting", "GET /api/v2/users/export: waiting"]);
  expect(await pauses(s)).toEqual([expect.objectContaining({ reason: "model", repo: "acme/api", draft: "2026-10-22_9f8e7d6..a1b2c3d" })]);
  expect(JSON.parse((await s.workspace.read(DRAFT_FILE))!).info["x-changelog"].unverified).toEqual([]);
});

discordScenario("a worker that fails otherwise has its endpoint listed as unverified in the changelog, and it is not traced again by itself (#343)", async (s) => {
  await acmeApi(s);
  let failed: any;
  s.model.script(
    START, [NOTE_CONVENTIONS, mapController()],
    trace(candidate("post", "/api/v2/users"), EXPORT),
    "Its route is registered from config at runtime, so its path cannot be read from the code.",
    recordNew("get", "/api/v2/users/export", "exportUsers"), "Recorded GET /api/v2/users/export.",
    (turn) => { failed = turn.toolResults.at(-1).failed; return trace(); },
    // Notes set again later do not drop it.
    { tool: "putChangelogNotes", args: { draft: DRAFT, unverified: [] } },
    FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  const reason = "Its route is registered from config at runtime, so its path cannot be read from the code.";
  expect(failed).toEqual([{ endpoint: "POST /api/v2/users", failed: reason }]);
  expect(workerStarts(s).map(endpointOf)).toEqual(["POST /api/v2/users", "GET /api/v2/users/export"]);
  const changelog = JSON.parse((await s.workspace.read(WRITTEN_FILE))!);
  expect(changelog.info["x-changelog"].unverified).toEqual([{ in: "operation", reason: `POST /api/v2/users could not be traced: ${reason}` }]);
  expect(Object.keys(changelog.paths)).toEqual(["/api/v2/users/export"]);
});


discordScenario("the progress message names the range's commits and changed files, and shows each endpoint's result as its worker records it: the impact and how many changes, or unverified with why (#343, #367)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  const slowly = (step: unknown) => async () => { await pause(250); return step as any; };
  s.model.script(
    slowly(START), [NOTE_CONVENTIONS, mapController()],
    trace(candidate("post", "/api/v2/users"), EXPORT, SESSIONS),
    record("post", "/api/v2/users"), slowly("Recorded POST /api/v2/users."),
    recordNew("get", "/api/v2/users/export", "exportUsers"), slowly("Recorded GET /api/v2/users/export."),
    slowly("Its route is registered from config at runtime."),
    slowly(FINISH), written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  const [progress, answer, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(answer!.content).toBe(`The acme/api changelog is written: ${WRITTEN}`);
  const shown = progress!.edits.map((e) => e.content ?? "");
  // The comparison that pinned the range said it holds two commits; its one changed file came whole with startChangelog and was mapped.
  expect(shown.find((t) => t.includes("\n2 commits · 1 changed file, all mapped\n1 of 3 candidates traced: 1 changed\n"))).toContain("\n-# POST /api/v2/users · breaking, 4 changes");
  expect(shown.find((t) => t.includes("2 of 3 candidates traced: 2 changed\n"))).toContain("\n-# POST /api/v2/users · breaking, 4 changes\n-# GET /api/v2/users/export · non-breaking, 1 change");
  expect(shown.find((t) => t.includes("3 of 3 candidates traced: 2 changed, 1 unverified\n"))).toContain("\n-# DELETE /api/v2/sessions · unverified: Its route is registered from config at runtime.");
  expect(shown.at(-1)).toMatch(/^-# 🧠 Done in /);
});

discordScenario("with the tenant's playbookWorkers at 2, two workers trace at once and the third starts when one of them ends (#343)", async (s) => {
  await acmeApi(s);
  await s.admin("PUT", `/api/admin/tenants/${s.tenant.id}/settings`, { playbookWorkers: 2 });
  const ids: Record<string, string> = { "GET /api/v2/users/export": "exportUsers", "DELETE /api/v2/sessions": "endSession", "GET /api/v2/health": "health" };
  const started: string[] = [];
  let inFlight = 0, most = 0, release!: () => void;
  const together = new Promise<void>((resolve) => { release = resolve; });
  // Each worker's first call waits until two are in flight (or 3 seconds pass); its second call answers.
  const workerStep = async (turn: any) => {
    const endpoint = endpointOf(turn.messages)!;
    if (turn.messages.some((m: any) => m.role === "assistant")) { inFlight--; return `Recorded ${endpoint}.`; }
    started.push(endpoint);
    most = Math.max(most, ++inFlight);
    if (inFlight === 2) release();
    await Promise.race([together, pause(3000)]);
    const [method, path] = endpoint.split(" ");
    return recordNew(method!.toLowerCase(), path!, ids[endpoint]!);
  };
  s.model.script(
    START, [NOTE_CONVENTIONS, mapController(EXPORT, SESSIONS, candidate("get", "/api/v2/health"))],
    trace(),
    ...Array(6).fill(workerStep),
    FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(most).toBe(2);
  expect(started.slice(0, 2).sort()).toEqual(["DELETE /api/v2/sessions", "GET /api/v2/users/export"]);
  expect(started[2]).toBe("GET /api/v2/health");
  expect(Object.keys(JSON.parse((await s.workspace.read(WRITTEN_FILE))!).paths).sort()).toEqual(["/api/v2/health", "/api/v2/sessions", "/api/v2/users/export"]);
});

discordScenario("a turn that goes on by itself and only settles candidates made progress: two such turns in a row do not pause the draft (#343)", async (s) => {
  await acmeApi(s);
  s.model.script(
    START, [NOTE_CONVENTIONS, mapController()], "Started the acme/api changelog.",
    trace(candidate("post", "/api/v2/users")), "Its route is built at runtime.", "One endpoint could not be traced.",
    trace(EXPORT), "Its handler comes from another service.", "Another endpoint could not be traced.",
    FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(await pauses(s)).toEqual([]);
  expect(s.model.calls).toHaveLength(11);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([`<@user-alice> The acme/api changelog is written: ${WRITTEN}`]);
});

discordScenario("a worker that GitHub refuses leaves its endpoint waiting and pauses the draft, naming only GitHub, as the turn's own read would (#343, #359)", async (s) => {
  await acmeApi(s);
  s.model.script(
    START, NOTE_CONVENTIONS, "Started the acme/api changelog.",
    trace(candidate("post", "/api/v2/users"), EXPORT),
    () => { s.http.on("GET api.github.com/repos/acme/api/contents/", () => Response.json({ message: "Bad credentials" }, { status: 401 })); return readController; },
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  // The refusal ends the worker and the turn: the model is asked nothing more, and no other worker starts.
  expect(s.model.calls).toHaveLength(5);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: '<@user-alice> Changelog paused: GitHub could not be reached. Type "go on" to continue.', pinged: ["user-alice"] },
  ]);
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "service", service: "GitHub", since: "2026-10-22T03:00:00.000Z" });
  expect(await states(s)).toEqual(["POST /api/v2/users: waiting", "GET /api/v2/users/export: waiting"]);
  expect(await pauses(s)).toEqual([expect.objectContaining({ reason: "service", service: "GitHub", host: "api.github.com", status: 401, tool: "repoReadFile", file: CONTROLLER })]);
  expect(JSON.parse((await s.workspace.read(DRAFT_FILE))!).info["x-changelog"].unverified).toEqual([]);
});

discordScenario("the open-draft line of a person's turn says how many candidate endpoints wait to be traced (#343)", async (s) => {
  await acmeApi(s);
  const changelog = { date: "2026-10-22", base: { ref: "main before 2026-10-01", commit: "9f8e7d6" }, head: { ref: "main through 2026-10-22", commit: "a1b2c3d" }, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, globalChanges: [], removedOperations: [], unverified: [] };
  await s.workspace.write(DRAFT_FILE, JSON.stringify({
    openapi: "3.1.2", info: { title: "acme/api API changes", version: "a1b2c3d", "x-changelog": changelog }, paths: {}, components: {},
    "x-draft": {
      repo: "acme/api", branch: "main", scope: "range", from: "2026-10-01", to: "2026-10-22", place: "channel-1", startedBy: { id: "user-alice", name: "Alice" }, changedFiles: 1,
      base: BASE, head: HEAD, files: [{ path: CONTROLLER, status: "modified" }], mapping: { [CONTROLLER]: { read: true, reaches: ["POST /api/v2/users"] } }, touchedAt: new Date(s.clock.now()).toISOString(),
      work: { state: "paused", reason: "stopped", since: "2026-10-22T02:00:00.000Z" },
      candidates: [{ method: "post", path: "/api/v2/users", state: "failed", reason: "dynamic route", at: "2026-10-22T01:00:00.000Z" }, { ...EXPORT, state: "waiting" }, { ...SESSIONS, state: "waiting" }],
    },
  }));
  let line = "";
  s.model.script((turn) => { line = String(turn.messages.at(-1)!.content).match(/^Open API changelog in this place.*$/m)?.[0] ?? ""; return "It is paused with two endpoints left to trace."; });
  await s.discord.send(`${s.discord.mention} how far is the changelog?`);

  expect(line).toContain("; 0 endpoints recorded so far, 2 candidate endpoints waiting to be traced with traceEndpoints. Draft: ");
});

discordScenario("a changelog whose every candidate endpoint failed is written with those endpoints listed as unverified, never finished as one that changed nothing (#343)", async (s) => {
  await acmeApi(s);
  let finished: any;
  s.model.script(
    START, [NOTE_CONVENTIONS, mapController()],
    trace(candidate("post", "/api/v2/users"), EXPORT),
    // Neither worker records its endpoint.
    "Its route is registered from config at runtime.",
    "Its handler comes from another service.",
    FINISH,
    (turn) => { finished = turn.toolResults.at(-1); return written(turn); },
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  const unverified = [
    { in: "operation", reason: "POST /api/v2/users could not be traced: Its route is registered from config at runtime." },
    { in: "operation", reason: "GET /api/v2/users/export could not be traced: Its handler comes from another service." },
  ];
  expect(finished).toMatchObject({ written: true, path: WRITTEN, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, unverified });
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([`The acme/api changelog is written: ${WRITTEN}`]);
  const changelog = JSON.parse((await s.workspace.read(WRITTEN_FILE))!);
  expect(changelog.paths).toEqual({});
  expect(changelog.info["x-changelog"].unverified).toEqual(unverified);
  expect(await s.workspace.list(FOLDER)).toEqual([WRITTEN_FILE]);
});
