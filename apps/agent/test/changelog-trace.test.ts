import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { discordScenario, type Scenario } from "./support/discordScenario";
import {
  BASE, CONTROLLER, DRAFT, DRAFT_FILE, DTOS, FINISH, FIXTURE, FOLDER, HEAD, MAP_CHANGED, OPERATION, PROVIDER_DOWN, READ_REST, START, TRACE, TRACER_TOOLS, WRITTEN, WRITTEN_FILE,
  acmeApi as acmeWithDtos, acmeOnGitHub, briefOf, budgets, draftMeta, endpointOf, fastProgress, isTracer, mapper, mappers, oneWorkerATurn, outlasting, pause, pauses, progressShown, progressShows, reaches, read,
  text, tracerStarts, written,
} from "./support/changelog";
import { missingFacts } from "./support/facts";

const PLAYBOOK = new URL("../../../packages/skills/playbooks/contract-diff/", import.meta.url);
/** What every file of acme/api reads as, at any commit: what a worker reads, and the main loop never should. */
const SOURCE = "@Controller('api/v2/users')\nexport class UsersController {\n  @Post() create(@Body() dto: CreateUserDto) {}\n}";
const CONVENTIONS = "Routes: @Controller prefixes, no global prefix. Envelope: { data } from TransformInterceptor. Errors: HttpExceptionFilter gives { code, message }.";

/**
 * acme/api on GitHub at 10:00 on 22 October in Jakarta, as acmeOnGitHub has it: between BASE and HEAD two commits changed only the users
 * controller, its patch given. Workers trace one at a time.
 */
async function acmeApi(s: Scenario) {
  await acmeOnGitHub(s, { source: SOURCE });
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 2, behind_by: 0, commits: [], files: [
    { filename: CONTROLLER, status: "modified", patch: "@@ -1 +1 @@\n-@Controller('api/v1/users')\n+@Controller('api/v2/users')" },
  ] }));
}
const NOTE_CONVENTIONS = { tool: "putChangelogNotes", args: { draft: DRAFT, conventions: CONVENTIONS } };
const candidate = (method: string, path: string, note?: string) => ({ method, path, ...(note ? { note } : {}) });
/**
 * The mapping worker's steps for the changed controller, whose patch came with startChangelog: it reaches the endpoints named (POST
 * /api/v2/users unless named), each kept as a candidate, so the changelog can be traced and finished (#366, #370).
 */
const mapController = (...endpoints: ReturnType<typeof candidate>[]) => mapper({ path: CONTROLLER, change: "the controller moved to api/v2", endpoints: endpoints.length ? endpoints : [candidate("post", "/api/v2/users")] });
/** A worker's step that records `method path` as the example operation. */
const record = (method: string, path: string) => [
  { tool: "putChangelogComponents", args: { draft: DRAFT, components: FIXTURE.components } },
  { tool: "putChangelogOperation", args: { draft: DRAFT, method, path, operation: OPERATION } },
];
const readController = { tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path: CONTROLLER } };

discordScenario("traceEndpoints hands each candidate to a worker of its own, which starts from a brief and six tools and records its endpoint in the draft; what the worker read never reaches the main loop (#343)", async (s) => {
  await acmeApi(s);
  let traced: any, candidates: any;
  s.model.script(
    START, [NOTE_CONVENTIONS, MAP_CHANGED], ...mapController(),
    // The candidate mapping kept, with its note.
    TRACE,
    // The worker.
    readController, record("post", "/api/v2/users"), "Recorded POST /api/v2/users.",
    async (turn) => { traced = turn.toolResults.at(-1); candidates = (await draftMeta(s)).candidates; return FINISH; },
    written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(s.model.calls).toHaveLength(10);
  const worker = s.model.calls[5]!;
  expect(s.model.calls.map(isTracer)).toEqual([false, false, false, false, false, true, true, true, false, false]);
  expect([...s.model.tools[5]!].sort()).toEqual(TRACER_TOOLS);
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
  for (const call of s.model.calls.slice(8)) expect(call.map(text).join("\n")).not.toContain(SOURCE);
  expect(candidates).toEqual([{ method: "post", path: "/api/v2/users", note: `${CONTROLLER}: the controller moved to api/v2`, state: "traced", recorded: ["POST /api/v2/users"], at: "2026-10-22T03:00:00.000Z" }]);
  // All in Alice's own turn: the answer replies to her, mentioning her as its reply and pinging no one (#361).
  expect(s.discord.botMessages.map((m) => ({ content: m.content, allowedMentions: m.allowedMentions }))).toEqual([{ content: `The acme/api changelog is written: ${WRITTEN}`, allowedMentions: { parse: [], repliedUser: true } }]);
  expect(JSON.parse((await s.workspace.read(WRITTEN_FILE))!).paths["/api/v2/users"].post["x-impact"]).toBe("breaking");
});

/** What traceEndpoints' answer on a draft that holds no conventions summary yet says: write it first, and how, then trace again (#365). */
const NO_CONVENTIONS = [/no conventions summary/, "checklist.md", "readPlaybookFile", "putChangelogNotes conventions", "traceEndpoints", /nothing was traced/i];

discordScenario("traceEndpoints on a draft with no conventions summary traces nothing and says to write it first; once it is written, the same call traces with the summary in each worker's brief (#365)", async (s) => {
  await acmeApi(s);
  let refusal = "", kept: unknown = "not read";
  s.model.script(
    START,
    TRACE,
    async (turn) => { refusal = turn.toolResults.at(-1).error; kept = (await draftMeta(s)).candidates; return [NOTE_CONVENTIONS, MAP_CHANGED]; }, ...mapController(),
    TRACE,
    // The worker.
    record("post", "/api/v2/users"), "Recorded POST /api/v2/users.",
    FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(missingFacts(refusal, ...NO_CONVENTIONS)).toEqual([]);
  // The refused call kept no candidate and started no worker; the one after the summary started the only worker.
  expect(kept).toBeUndefined();
  expect(s.model.calls.map(isTracer)).toEqual([false, false, false, false, false, false, true, true, false, false]);
  expect(briefOf(s.model.calls[6]!)).toContain(`<untrusted_data source="conventions summary">\n${CONVENTIONS}\n</untrusted_data>`);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([`The acme/api changelog is written: ${WRITTEN}`]);
});

discordScenario("a turn that goes on by itself from a draft with no conventions summary is told to write it first, and a refused traceEndpoints adds nothing: two such turns in a row pause the draft (#365, #357)", async (s) => {
  await acmeApi(s);
  let state = "";
  s.model.script(
    START, "Started the acme/api changelog.",
    // Both turns that go on by themselves hand the candidate over without writing the summary.
    (turn) => { state = text(turn.messages[1]); return TRACE; }, "The endpoint waits for the conventions.",
    TRACE, "It still waits.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  // After the draft's state, outside its data, the turn is told to write the summary first, and how; traceEndpoints refuses until then.
  const told = state.slice(state.lastIndexOf("</untrusted_data>"));
  expect(missingFacts(told, /no conventions summary/, "checklist.md", "putChangelogNotes conventions", "traceEndpoints")).toEqual([]);
  expect(s.model.calls).toHaveLength(6);
  expect(tracerStarts(s)).toEqual([]);
  const meta = await draftMeta(s);
  expect(meta.candidates).toBeUndefined();
  expect(meta.work).toEqual({ state: "paused", reason: "no-progress", since: "2026-10-22T03:00:00.000Z" });
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(['<@user-alice> The changelog made no progress, so I paused it; type "go on" to continue.']);
});

/** What traceEndpoints' answer says when the main loop passes candidates of its own: it takes the draft alone, after mapping (#369). */
const CANDIDATES_PASSED = [/draft alone/, "mapChangedFiles", "traceEndpoints", /nothing was traced/i];

discordScenario("traceEndpoints takes the draft alone: candidates the main loop passes are refused with a pointer to mapping and kept nowhere, and the draft alone traces those mapping kept (#369)", async (s) => {
  await acmeApi(s);
  let refusal = "", kept: unknown;
  s.model.script(
    START, [NOTE_CONVENTIONS, MAP_CHANGED], ...mapController(),
    { tool: "traceEndpoints", args: { draft: DRAFT, candidates: [candidate("get", "/api/v2/users/export", "users.controller.ts")] } },
    async (turn) => { refusal = turn.toolResults.at(-1).error; kept = (await draftMeta(s)).candidates.map((c: any) => `${c.method.toUpperCase()} ${c.path}: ${c.state}`); return TRACE; },
    record("post", "/api/v2/users"), "Recorded POST /api/v2/users.",
    FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(missingFacts(refusal, ...CANDIDATES_PASSED)).toEqual([]);
  expect(kept).toEqual(["POST /api/v2/users: waiting"]);
  expect(tracerStarts(s).map(endpointOf)).toEqual(["POST /api/v2/users"]);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([`The acme/api changelog is written: ${WRITTEN}`]);
});

discordScenario("traceEndpoints traces nothing while a changed file is unmapped, answering how many are left and which; once every file is mapped it traces the candidates mapping kept (#369)", async (s) => {
  // The controller, its patch given, and six DTOs, each read whole before it is mapped.
  await acmeWithDtos(s);
  await oneWorkerATurn();
  let refusal = "", kept: unknown;
  s.model.script(
    START, [NOTE_CONVENTIONS, MAP_CHANGED],
    // The first DTO's mapping worker reads and maps it, and leaves no time for another.
    read(0), mapper(reaches(DTOS[0]!, "a body field changed"))[0]!, outlasting(s, "Mapped."),
    TRACE,
    async (turn) => { refusal = turn.toolResults.at(-1).error; kept = (await draftMeta(s)).candidates.map((c: any) => `${c.method.toUpperCase()} ${c.path}: ${c.state}`); return "Six changed files wait to be mapped."; },
    // The turn that goes on by itself has the rest mapped, then traces.
    [...READ_REST, MAP_CHANGED], ...mappers([1, 2, 3, 4, 5]), TRACE,
    record("post", "/api/v2/users"), "Recorded POST /api/v2/users.",
    FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  // It counts and names the files left, not the one mapped, and says to map them or set them aside, then trace again.
  expect(missingFacts(refusal, "6 of 7 changed files", /nothing was traced/i, "mapChangedFiles", "putChangelogNotes setAside", "traceEndpoints", CONTROLLER, ...DTOS.slice(1))).toEqual([]);
  expect(refusal).not.toContain(DTOS[0]);
  expect(kept).toEqual(["POST /api/v2/users: waiting"]);
  // One worker, started once every file was mapped, for the one candidate the seven changes reach.
  expect(tracerStarts(s).map(endpointOf)).toEqual(["POST /api/v2/users"]);
  expect(briefOf(tracerStarts(s)[0]!)).toContain("src/users/dto/f.dto.ts: a body field changed");
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([`<@user-alice> The acme/api changelog is written: ${WRITTEN}`]);
});

discordScenario("traceEndpoints on a draft whose every changed file reaches no endpoint has nothing to trace and points to finishing (#369)", async (s) => {
  await acmeApi(s);
  let refusal = "", finished: any;
  s.model.script(
    START, [NOTE_CONVENTIONS, MAP_CHANGED], ...mapper({ path: CONTROLLER, none: "a comment changed" }),
    TRACE,
    (turn) => { refusal = turn.toolResults.at(-1).error; return FINISH; },
    (turn) => { finished = turn.toolResults.at(-1); return "Nothing the frontend sees changed."; },
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(missingFacts(refusal, /no candidate endpoint/, "putChangelogNotes", "finishChangelog", /nothing was traced/i)).toEqual([]);
  expect(tracerStarts(s)).toEqual([]);
  expect(finished).toMatchObject({ written: false });
});

discordScenario("finishChangelog writes nothing while a candidate endpoint waits to be traced and points to traceEndpoints, so a draft mapped but not traced is never finished as one that changed nothing (#369)", async (s) => {
  await acmeApi(s);
  let refused: any, kept: unknown;
  s.model.script(
    START, [NOTE_CONVENTIONS, MAP_CHANGED], ...mapController(),
    FINISH,
    async (turn) => { refused = turn.toolResults.at(-1); kept = await states(s); return TRACE; },
    record("post", "/api/v2/users"), "Recorded POST /api/v2/users.",
    FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(refused).toEqual({ written: false, waiting: 1, endpoints: ["POST /api/v2/users"], fix: expect.any(String) });
  expect(missingFacts(refused.fix, "traceEndpoints", "finishChangelog")).toEqual([]);
  expect(kept).toEqual(["POST /api/v2/users: waiting"]);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([`The acme/api changelog is written: ${WRITTEN}`]);
  expect(Object.keys(JSON.parse((await s.workspace.read(WRITTEN_FILE))!).paths)).toEqual(["/api/v2/users"]);
});

/** A new endpoint's operation, valid as it stands, with one change: what a worker records for any endpoint but the example's. */
const newOperation = (id: string) => ({
  operationId: id, summary: id, security: [],
  responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { data: { type: "string" } }, required: ["data"] }, example: { data: "x" } } } } },
  "x-changes": [{ status: "NEW", impact: "non-breaking", in: "operation" }],
});
const recordNew = (method: string, path: string, id: string) => ({ tool: "putChangelogOperation", args: { draft: DRAFT, method, path, operation: newOperation(id) } });
const EXPORT = candidate("get", "/api/v2/users/export"), SESSIONS = candidate("delete", "/api/v2/sessions");

discordScenario("a turn cut while its workers trace goes on by itself with the candidates still waiting, and never traces one again (#343)", async (s) => {
  await acmeApi(s);
  // A turn has 3 seconds here, and a worker starts only with at least 1 second left.
  await budgets(3000, { leastMs: 1000 });
  let state = "";
  s.model.script(
    START, [NOTE_CONVENTIONS, MAP_CHANGED], ...mapController(candidate("post", "/api/v2/users"), EXPORT, SESSIONS),
    TRACE,
    // The first worker records its endpoint and answers once the turn's time is gone.
    record("post", "/api/v2/users"), () => { s.clock.advance(3200); return "Recorded POST /api/v2/users."; },
    "One of three endpoints is traced; two wait.",
    // The turn that goes on by itself starts from the draft, which says which candidates wait.
    (turn) => { state = text(turn.messages[1]); return TRACE; },
    recordNew("get", "/api/v2/users/export", "exportUsers"), "Recorded GET /api/v2/users/export.",
    recordNew("delete", "/api/v2/sessions", "endSession"), "Recorded DELETE /api/v2/sessions.",
    FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(tracerStarts(s).map(endpointOf)).toEqual(["POST /api/v2/users", "GET /api/v2/users/export", "DELETE /api/v2/sessions"]);
  expect(state).toContain("Candidate endpoints: 3: 1 traced, 0 failed, 2 waiting.\nWaiting to be traced: GET /api/v2/users/export, DELETE /api/v2/sessions\n");
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([{ content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, pinged: ["user-alice"] }]);
  expect(Object.keys(JSON.parse((await s.workspace.read(WRITTEN_FILE))!).paths).sort()).toEqual(["/api/v2/sessions", "/api/v2/users", "/api/v2/users/export"]);
}, 30000);

const states = async (s: Scenario) => (await draftMeta(s)).candidates.map((c: any) => `${c.method.toUpperCase()} ${c.path}: ${c.state}`);

discordScenario("a worker that cannot reach the model leaves its endpoint waiting, and the draft goes through the model's rule: one retry after the tenant's wait, then a pause (#343)", async (s) => {
  await acmeApi(s);
  s.model.script(
    START, [NOTE_CONVENTIONS, MAP_CHANGED], ...mapController(candidate("post", "/api/v2/users"), EXPORT), "Started the acme/api changelog.",
    TRACE, PROVIDER_DOWN,
    TRACE, PROVIDER_DOWN,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  // The worker's failure ends the turn that went on by itself, which then waits the tenant's 60 seconds; no other worker started.
  expect(s.model.calls).toHaveLength(7);
  expect(await states(s)).toEqual(["POST /api/v2/users: waiting", "GET /api/v2/users/export: waiting"]);
  expect((await draftMeta(s)).work).toEqual({ state: "worked-on", retryAt: "2026-10-22T03:01:00.000Z" });
  expect(s.discord.botMessages).toEqual([]);

  s.clock.advance(60_000);
  await s.scheduler.tick();

  // The retry goes on with the same endpoint, whose worker fails again: the draft pauses, and the endpoints still wait.
  expect(tracerStarts(s).map(endpointOf)).toEqual(["POST /api/v2/users", "POST /api/v2/users"]);
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
    START, [NOTE_CONVENTIONS, MAP_CHANGED], ...mapController(candidate("post", "/api/v2/users"), EXPORT),
    TRACE,
    "Its route is registered from config at runtime, so its path cannot be read from the code.",
    recordNew("get", "/api/v2/users/export", "exportUsers"), "Recorded GET /api/v2/users/export.",
    (turn) => { failed = turn.toolResults.at(-1).failed; return TRACE; },
    // Notes set again later do not drop it.
    { tool: "putChangelogNotes", args: { draft: DRAFT, unverified: [] } },
    FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  const reason = "Its route is registered from config at runtime, so its path cannot be read from the code.";
  expect(failed).toEqual([{ endpoint: "POST /api/v2/users", failed: reason }]);
  expect(tracerStarts(s).map(endpointOf)).toEqual(["POST /api/v2/users", "GET /api/v2/users/export"]);
  const changelog = JSON.parse((await s.workspace.read(WRITTEN_FILE))!);
  expect(changelog.info["x-changelog"].unverified).toEqual([{ in: "operation", reason: `POST /api/v2/users could not be traced: ${reason}` }]);
  expect(Object.keys(changelog.paths)).toEqual(["/api/v2/users/export"]);
});


discordScenario("the progress message names the range's commits and changed files, and shows each endpoint's result as its worker records it: the impact and how many changes, or unverified with why (#343, #367)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  // A step that waits until the progress message is up, or shows what the workers before it recorded.
  const once = (shown: () => Promise<void>, step: unknown) => async () => { await shown(); return step as any; };
  s.model.script(
    once(() => progressShown(s), START), [NOTE_CONVENTIONS, MAP_CHANGED], ...mapController(candidate("post", "/api/v2/users"), EXPORT, SESSIONS),
    TRACE,
    // A worker's result shows once it has ended, before the next worker's first step.
    record("post", "/api/v2/users"), "Recorded POST /api/v2/users.",
    once(() => progressShows(s, "1 of 3 candidates traced: 1 changed\n", "\n-# POST /api/v2/users · breaking, 4 changes"), recordNew("get", "/api/v2/users/export", "exportUsers")), "Recorded GET /api/v2/users/export.",
    once(() => progressShows(s, "2 of 3 candidates traced: 2 changed\n", "\n-# GET /api/v2/users/export · non-breaking, 1 change"), "Its route is registered from config at runtime."),
    once(() => progressShows(s, "3 of 3 candidates traced: 2 changed, 1 unverified\n", "\n-# DELETE /api/v2/sessions · unverified: Its route is registered from config at runtime."), FINISH), written,
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
    START, [NOTE_CONVENTIONS, MAP_CHANGED], ...mapController(EXPORT, SESSIONS, candidate("get", "/api/v2/health")),
    TRACE,
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
  // A turn has 3 seconds here, and a worker starts only with at least 2 left: the turn of the first worker has no time for the second.
  await budgets(3000, { leastMs: 2000 });
  s.model.script(
    START, [NOTE_CONVENTIONS, MAP_CHANGED], ...mapController(candidate("post", "/api/v2/users"), EXPORT), "Started the acme/api changelog.",
    TRACE, () => { s.clock.advance(1200); return "Its route is built at runtime."; }, "One endpoint could not be traced.",
    TRACE, "Its handler comes from another service.", "Another endpoint could not be traced.",
    FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(tracerStarts(s).map(endpointOf)).toEqual(["POST /api/v2/users", "GET /api/v2/users/export"]);
  expect(await pauses(s)).toEqual([]);
  expect(s.model.calls).toHaveLength(13);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([`<@user-alice> The acme/api changelog is written: ${WRITTEN}`]);
});

discordScenario("a worker that GitHub refuses leaves its endpoint waiting and pauses the draft, naming only GitHub, as the turn's own read would (#343, #359)", async (s) => {
  await acmeApi(s);
  s.model.script(
    START, [NOTE_CONVENTIONS, MAP_CHANGED], ...mapController(candidate("post", "/api/v2/users"), EXPORT), "Started the acme/api changelog.",
    TRACE,
    () => { s.http.on("GET api.github.com/repos/acme/api/contents/", () => Response.json({ message: "Bad credentials" }, { status: 401 })); return readController; },
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  // The refusal ends the worker and the turn: the model is asked nothing more, and no other worker starts.
  expect(s.model.calls).toHaveLength(7);
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

  expect(missingFacts(line, "0 endpoints recorded", "2 candidate endpoints", "traceEndpoints", DRAFT)).toEqual([]);
});

discordScenario("a changelog whose every candidate endpoint failed is written with those endpoints listed as unverified, never finished as one that changed nothing (#343)", async (s) => {
  await acmeApi(s);
  let finished: any;
  s.model.script(
    START, [NOTE_CONVENTIONS, MAP_CHANGED], ...mapController(candidate("post", "/api/v2/users"), EXPORT),
    TRACE,
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
