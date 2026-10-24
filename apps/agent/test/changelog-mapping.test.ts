import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { discordScenario, type Scenario } from "./support/discordScenario";
import {
  BASE, DRAFT, DRAFT_FILE, FINISH, HEAD, MAPPER_TOOLS, MAP_CHANGED, PROVIDER_DOWN, START, TRACE, WRITTEN_FILE,
  acmeOnGitHub, briefOf, budgets, draftMeta, fastProgress, filesOf, isMapper, mapperStarts, pause, pauses, text, written,
} from "./support/changelog";

const PLAYBOOK = new URL("../../../packages/skills/playbooks/contract-diff/", import.meta.url);
/** What every file of acme/api reads as, at any commit: what a worker reads, and the main loop never should. */
const SOURCE = "export class CreateUserDto {\n  full_name: string;\n  phone: string;\n}";
const CONVENTIONS = "Routes: @Controller prefixes under the global prefix api/v2. Envelope: { data } from TransformInterceptor. Errors: HttpExceptionFilter gives { code, message }.";
const CREATE = "src/users/dto/create-user.dto.ts", UPDATE = "src/users/dto/update-user.dto.ts", CONTROLLER = "src/users/users.controller.ts", SERVICE = "src/users/users.service.ts";
/** A patch of exactly `chars` characters. */
const patchOf = (chars: number) => "@@ -1,9 +1,9 @@\n".padEnd(chars, "+");

/**
 * acme/api on GitHub at 10:00 on 22 October in Jakarta, as acmeOnGitHub has it: between BASE and HEAD four files of the users module
 * changed, listed out of path order, with patches of 45,000, 12,000, 1,000 and 30,000 characters; only the controller's fits
 * startChangelog's result. Workers map one group at a time.
 */
async function acmeApi(s: Scenario) {
  await acmeOnGitHub(s, { source: SOURCE });
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 3, behind_by: 0, commits: [], files: [
    { filename: SERVICE, status: "modified", patch: patchOf(45_000) }, { filename: CREATE, status: "modified", patch: patchOf(12_000) },
    { filename: CONTROLLER, status: "modified", patch: patchOf(1_000) }, { filename: UPDATE, status: "modified", patch: patchOf(30_000) },
  ] }));
}
const NOTE_CONVENTIONS = { tool: "putChangelogNotes", args: { draft: DRAFT, conventions: CONVENTIONS } };
/** A worker's read of a changed file whole at head, which lets it map the file. */
const read = (path: string) => ({ tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path } });
/** A worker's step that maps each file given as reaching no endpoint. */
const mapNone = (...paths: string[]) => ({ tool: "putChangelogMapping", args: { draft: DRAFT, files: paths.map((path) => ({ path, none: "only a log line changed" })) } });

discordScenario("mapChangedFiles hands the changed files to workers in groups by path within the patch bound, an oversized file alone; each worker starts from a brief and five tools, and the main loop hears only counts (#370)", async (s) => {
  await acmeApi(s);
  let mapped: any;
  s.model.script(
    START, NOTE_CONVENTIONS, MAP_CHANGED,
    // 12,000 characters; the next file's 30,000 would pass 40,000.
    read(CREATE), mapNone(CREATE), "Mapped.",
    // 30,000 and 1,000; the controller's patch came with startChangelog, so it is read already.
    read(UPDATE), mapNone(UPDATE, CONTROLLER), "Mapped.",
    // 45,000, over the bound: a group of its own.
    read(SERVICE), mapNone(SERVICE), "Mapped.",
    (turn) => { mapped = turn.toolResults.at(-1); return FINISH; },
    "Nothing the frontend sees changed.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(s.model.calls.map(isMapper)).toEqual([false, false, false, true, true, true, true, true, true, true, true, true, false, false]);
  expect(mapperStarts(s).map(filesOf)).toEqual([[CREATE], [UPDATE, CONTROLLER], [SERVICE]]);
  for (const call of mapperStarts(s)) expect([...s.model.tools[s.model.calls.indexOf(call)]!].sort()).toEqual(MAPPER_TOOLS);
  // Its brief: the repository, both commits, the draft, the conventions the main loop kept, and its files.
  const brief = briefOf(mapperStarts(s)[1]!);
  for (const part of ["acme/api", "branch main", BASE, HEAD, DRAFT, `<untrusted_data source="conventions summary">\n${CONVENTIONS}\n</untrusted_data>`]) expect([part, brief.includes(part)]).toEqual([part, true]);
  // It follows the mapping rules alone: not the main loop's steps, and not the tracing rules.
  const rules = text(mapperStarts(s)[0]![0]);
  expect(rules).toContain(readFileSync(new URL("mapping.md", PLAYBOOK), "utf8").trim());
  expect(rules).not.toContain("## 1. Pin what the changelog covers");
  expect(rules).not.toContain("**Presence versus null.**");
  // The main loop hears counts, and never reads what the workers read.
  expect(mapped).toEqual({ mapped: 4, unverified: 0, files: { mapped: 4, setAside: 0, left: 0 }, candidates: 0, note: "Every changed file is mapped or set aside, and no change reaches an endpoint: call finishChangelog." });
  for (const call of s.model.calls.slice(12)) expect(call.map(text).join("\n")).not.toContain(SOURCE);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["Nothing the frontend sees changed."]);
});


discordScenario("a turn cut while its workers map goes on by itself with the files still unmapped only, and never maps one again (#370)", async (s) => {
  await acmeApi(s);
  // A turn has 3 seconds here, and a worker starts only with at least 1 second left.
  await budgets(3000, { leastMs: 1000 });
  let cut: any, state = "";
  s.model.script(
    START, NOTE_CONVENTIONS, MAP_CHANGED,
    // The first worker maps its file and answers once the turn's time is gone, so no other worker starts.
    read(CREATE), mapNone(CREATE), () => { s.clock.advance(3200); return "Mapped."; },
    // Out of time, the main loop is asked for its answer after the tool's result.
    (turn) => { cut = JSON.parse(text(turn.messages.findLast((m: any) => m.role === "tool")).replace(/<\/?untrusted_data[^>]*>/g, "")); return "One of four changed files is mapped; three wait."; },
    // The turn that goes on by itself starts from the draft, which lists the files left.
    (turn) => { state = text(turn.messages[1]); return MAP_CHANGED; },
    read(UPDATE), mapNone(UPDATE, CONTROLLER), "Mapped.",
    read(SERVICE), mapNone(SERVICE), "Mapped.",
    FINISH, "Nothing the frontend sees changed.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(cut).toEqual({ mapped: 1, unverified: 0, files: { mapped: 1, setAside: 0, left: 3 }, candidates: 0, note: "This turn's time is nearly out: 3 changed files wait to be mapped, and the next turn goes on with them through mapChangedFiles." });
  expect(state).toContain(`Changed files: 4: 1 mapped, 0 set aside, 3 left.\nMapped:\n- ${CREATE} → no endpoint (only a log line changed)\nLeft:\n- ${SERVICE} (modified)\n- ${CONTROLLER} (modified, read whole)\n- ${UPDATE} (modified)\n`);
  expect(mapperStarts(s).map(filesOf)).toEqual([[CREATE], [UPDATE, CONTROLLER], [SERVICE]]);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["<@user-alice> Nothing the frontend sees changed."]);
}, 30000);

discordScenario("a file two workers could not map is listed as unverified with why, counts as mapped, and does not keep the changelog from being written (#370)", async (s) => {
  await acmeApi(s);
  let mapped: any, entry: any, finished: any;
  s.model.script(
    START, NOTE_CONVENTIONS, MAP_CHANGED,
    // Neither worker given the DTO maps it; the second's line for it says why.
    "Its class is generated at build time.",
    `${CREATE}: its class is generated from a schema at build time, and the generator is not in the repository`,
    read(UPDATE), mapNone(UPDATE, CONTROLLER), "Mapped.",
    read(SERVICE), mapNone(SERVICE), "Mapped.",
    async (turn) => { mapped = turn.toolResults.at(-1); entry = (await draftMeta(s)).mapping[CREATE]; return { tool: "putChangelogNotes", args: { draft: DRAFT, unverified: [] } }; },
    // Notes set again do not drop it.
    FINISH,
    (turn) => { finished = turn.toolResults.at(-1); return "The changelog is written: one file could not be confirmed."; },
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  // The DTO left unmapped joins the next group formed, again alone by its patch's size.
  expect(mapperStarts(s).map(filesOf)).toEqual([[CREATE], [CREATE], [UPDATE, CONTROLLER], [SERVICE]]);
  expect(mapped).toEqual({ mapped: 3, unverified: 1, files: { mapped: 4, setAside: 0, left: 0 }, candidates: 0, note: "Every changed file is mapped or set aside; 1 could not be mapped and is listed as unverified, and no change reaches an endpoint: call finishChangelog." });
  const why = "its class is generated from a schema at build time, and the generator is not in the repository";
  expect(entry).toEqual({ attempts: 2, unverified: why });
  const unverified = [{ in: "operation", reason: `${CREATE} could not be mapped: ${why}` }];
  expect(finished).toMatchObject({ written: true, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, unverified });
  expect(JSON.parse((await s.workspace.read(WRITTEN_FILE))!).info["x-changelog"].unverified).toEqual(unverified);
});

discordScenario("a worker that cannot reach the model leaves its files unmapped, and the draft goes through the model's rule: one retry after the tenant's wait, then a pause (#370, #358)", async (s) => {
  await acmeApi(s);
  s.model.script(
    START, NOTE_CONVENTIONS, "Started the acme/api changelog.",
    MAP_CHANGED, PROVIDER_DOWN,
    MAP_CHANGED, PROVIDER_DOWN,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  // The worker's failure ends the turn that went on by itself, which then waits the tenant's 60 seconds; no other worker started.
  expect(s.model.calls).toHaveLength(5);
  // Only the controller's patch, given with startChangelog, is read; no file counts a worker's attempt.
  const untouched = { [CONTROLLER]: { read: true } };
  expect((await draftMeta(s)).mapping).toEqual(untouched);
  expect((await draftMeta(s)).work).toEqual({ state: "worked-on", retryAt: "2026-10-22T03:01:00.000Z" });
  expect(s.discord.botMessages).toEqual([]);

  s.clock.advance(60_000);
  await s.scheduler.tick();

  // The retry gives the same file to a worker, which fails again: the draft pauses, and every file is still unmapped.
  expect(mapperStarts(s).map(filesOf)).toEqual([[CREATE], [CREATE]]);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: "<@user-alice> The AI model can't be reached; say go on to carry on.", pinged: ["user-alice"] },
  ]);
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "model", since: "2026-10-22T03:01:00.000Z" });
  expect((await draftMeta(s)).mapping).toEqual(untouched);
  expect(await pauses(s)).toEqual([expect.objectContaining({ reason: "model", repo: "acme/api", draft: "2026-10-22_9f8e7d6..a1b2c3d" })]);
  expect(JSON.parse((await s.workspace.read(DRAFT_FILE))!).info["x-changelog"].unverified).toEqual([]);
});

discordScenario("a worker that GitHub refuses leaves its files unmapped and pauses the draft, naming only GitHub, as the turn's own read would (#370, #359)", async (s) => {
  await acmeApi(s);
  s.model.script(
    START, NOTE_CONVENTIONS, "Started the acme/api changelog.",
    MAP_CHANGED,
    () => { s.http.on("GET api.github.com/repos/acme/api/contents/", () => Response.json({ message: "Bad credentials" }, { status: 401 })); return read(CREATE); },
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  // The refusal ends the worker and the turn: the model is asked nothing more, and no other worker starts.
  expect(s.model.calls).toHaveLength(5);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: '<@user-alice> Changelog paused: GitHub could not be reached. Type "go on" to continue.', pinged: ["user-alice"] },
  ]);
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "service", service: "GitHub", since: "2026-10-22T03:00:00.000Z" });
  expect((await draftMeta(s)).mapping).toEqual({ [CONTROLLER]: { read: true } });
  expect(await pauses(s)).toEqual([expect.objectContaining({ reason: "service", service: "GitHub", host: "api.github.com", status: 401, tool: "repoReadFile", file: CREATE })]);
});

discordScenario("the progress message counts the changed files mapped and the candidates found as the workers record them (#370)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  const slowly = (step: unknown) => async () => { await pause(250); return step as any; };
  const reaches = { tool: "putChangelogMapping", args: { draft: DRAFT, files: [{ path: CREATE, change: "CreateUserDto gains phone", endpoints: [{ method: "post", path: "/api/v2/users" }] }] } };
  s.model.script(
    slowly(START), NOTE_CONVENTIONS, MAP_CHANGED,
    read(CREATE), reaches, slowly("Mapped."),
    read(UPDATE), mapNone(UPDATE, CONTROLLER), slowly("Mapped."),
    read(SERVICE), mapNone(SERVICE), slowly("Mapped."),
    // The asker's own turn may stop it, so this one ends here.
    { tool: "stopChangelog", args: {} }, "Stopped the changelog.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  const [progress, answer, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(answer!.content).toBe("Stopped the changelog.");
  const shown = progress!.edits.map((e) => e.content ?? "");
  // One message, edited in place as each worker records its files.
  for (const detail of ["3 commits · 1 of 4 changed files mapped · 1 candidate so far", "3 commits · 3 of 4 changed files mapped · 1 candidate so far", "3 commits · 4 changed files, all mapped\n0 of 1 candidate traced"]) {
    expect([detail, shown.includes(`🧠 Working…\n${detail}\n-# ✓ Checking what changed in acme/api`)]).toEqual([detail, true]);
  }
});

discordScenario("a draft from before changed files kept their patches' lengths has them weighed from the comparison once, so its files are grouped by size and not one a worker (#370)", async (s) => {
  await acmeApi(s);
  // Started before mapping groups: its files keep no patch length, and every one is read whole already.
  const changelog = { date: "2026-10-22", base: { ref: "main before 2026-10-01", commit: "9f8e7d6" }, head: { ref: "main through 2026-10-22", commit: "a1b2c3d" }, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, globalChanges: [], removedOperations: [], unverified: [] };
  const files = [SERVICE, CREATE, CONTROLLER, UPDATE];
  await s.workspace.write(DRAFT_FILE, JSON.stringify({
    openapi: "3.1.2", info: { title: "acme/api API changes", version: "a1b2c3d", "x-changelog": changelog }, paths: {}, components: {},
    "x-draft": {
      repo: "acme/api", branch: "main", scope: "range", from: "2026-10-01", to: "2026-10-22", place: "channel-1", startedBy: { id: "user-alice", name: "Alice" }, changedFiles: 4,
      base: BASE, head: HEAD, files: files.map((path) => ({ path, status: "modified" })), mapping: Object.fromEntries(files.map((path) => [path, { read: true }])),
      conventions: CONVENTIONS, touchedAt: new Date(s.clock.now()).toISOString(), work: { state: "paused", reason: "stopped", since: "2026-10-22T02:00:00.000Z" },
    },
  }));
  let weighed: unknown;
  s.model.script(
    MAP_CHANGED,
    mapNone(CREATE), "Mapped.",
    mapNone(UPDATE, CONTROLLER), "Mapped.",
    mapNone(SERVICE), "Mapped.",
    async () => { weighed = (await draftMeta(s)).files; return FINISH; },
    "Nothing the frontend sees changed.",
  );
  await s.discord.send(`${s.discord.mention} lanjut`);

  // As the first scenario groups them: 12,000; then 30,000 and 1,000; then 45,000 alone.
  expect(mapperStarts(s).map(filesOf)).toEqual([[CREATE], [UPDATE, CONTROLLER], [SERVICE]]);
  expect(weighed).toEqual([
    { path: SERVICE, status: "modified", patchChars: 45_000 }, { path: CREATE, status: "modified", patchChars: 12_000 },
    { path: CONTROLLER, status: "modified", patchChars: 1_000 }, { path: UPDATE, status: "modified", patchChars: 30_000 },
  ]);
});

discordScenario("the main loop's own putChangelogMapping is refused and maps nothing: only mapping workers record how a file ends (ADR 0026)", async (s) => {
  await acmeApi(s);
  let refusal = "", mapping: unknown;
  s.model.script(
    START, NOTE_CONVENTIONS,
    // The controller's patch came with startChangelog, so only who calls it stands in the way.
    { tool: "putChangelogMapping", args: { draft: DRAFT, files: [{ path: CONTROLLER, none: "only a log line changed" }] } },
    async (turn) => { refusal = turn.toolResults.at(-1).error; mapping = (await draftMeta(s)).mapping; return { tool: "stopChangelog", args: {} }; },
    "Stopped the changelog.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(refusal).toBe("Only mapping workers record how changed files end: call mapChangedFiles with the draft, and its workers read the patches and map the files. Nothing was mapped.");
  expect(mapping).toEqual({ [CONTROLLER]: { read: true } });
});

discordScenario("mapChangedFiles on a draft with no conventions summary maps nothing, starts no worker, and says to write it first (#370)", async (s) => {
  await acmeApi(s);
  let refusal = "";
  s.model.script(
    START, MAP_CHANGED,
    (turn) => { refusal = turn.toolResults.at(-1).error; return { tool: "stopChangelog", args: {} }; },
    "Stopped the changelog.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(refusal).toBe("This changelog's draft holds no conventions summary yet, so every worker would have to find the repository's conventions in the code again. Write it first, as step 2 says: read checklist.md with readPlaybookFile, work through it at head, and keep what you learned with putChangelogNotes conventions; then call mapChangedFiles again. Nothing was mapped.");
  expect(mapperStarts(s)).toEqual([]);
  expect(s.model.calls).toHaveLength(4);
});

const APP_MODULE = "src/app.module.ts", BILLING = "src/billing/billing.controller.ts", SESSIONS = "src/sessions/sessions.controller.ts";
/** acme/api's changed files between BASE and HEAD instead of the users module's, each with its patch, which startChangelog gives and so reads. */
const changed = (s: Scenario, files: { filename: string; status: string; patch: string }[]) =>
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 1, behind_by: 0, commits: [], files }));
/** A new endpoint's operation, valid as it stands: what a tracing worker records for a route only in head. */
const recordNew = (method: string, path: string, id: string) => ({ tool: "putChangelogOperation", args: { draft: DRAFT, method, path, operation: {
  operationId: id, summary: id, security: [],
  responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { data: { type: "string" } }, required: ["data"] }, example: { data: "x" } } } } },
  "x-changes": [{ status: "NEW", impact: "non-breaking", in: "operation" }],
} } });

discordScenario("a mapping worker comparing the route tables records a route only in base in the removed operations, once however many files name it, and a route only in head as a candidate traced as NEW (#372)", async (s) => {
  await acmeApi(s);
  // SessionsModule leaves the app and its controller goes; BillingModule comes in with a new controller.
  changed(s, [
    { filename: APP_MODULE, status: "modified", patch: "@@ -9,2 +9,2 @@\n-    SessionsModule,\n+    BillingModule," },
    { filename: BILLING, status: "added", patch: "@@ -0,0 +1,5 @@\n+@Controller('billing')\n+export class BillingController {\n+  @Get('invoices')\n+  list() {}\n+}" },
    { filename: SESSIONS, status: "removed", patch: "@@ -1,5 +0,0 @@\n-@Controller('sessions')\n-export class SessionsController {\n-  @Delete(':id')\n-  revoke() {}\n-}" },
  ]);
  const INVOICES = { method: "get", path: "/api/v2/billing/invoices" }, REVOKED = { method: "delete", path: "/api/v2/sessions/{id}", note: "SessionsModule is no longer mounted." };
  let mapped: any, state = "", candidates: any;
  s.model.script(
    START, NOTE_CONVENTIONS, MAP_CHANGED,
    // One worker has all three files, whose patches startChangelog gave: the route table at head lacks DELETE /api/v2/sessions/{id} and gains GET /api/v2/billing/invoices.
    { tool: "putChangelogMapping", args: { draft: DRAFT, files: [
      { path: APP_MODULE, change: "BillingModule is mounted in place of SessionsModule", endpoints: [INVOICES], removed: [{ ...REVOKED, method: "DELETE" }] },
      { path: BILLING, change: "a new controller", endpoints: [INVOICES] },
      { path: SESSIONS, removed: [{ method: "delete", path: "/api/v2/sessions/{id}" }] },
    ] } },
    "Mapped.",
    (turn) => { mapped = turn.toolResults.at(-1); return "Every changed file is mapped; one endpoint waits to be traced."; },
    // The turn that goes on by itself starts from the draft.
    async (turn) => { state = text(turn.messages[1]); candidates = (await draftMeta(s)).candidates; return TRACE; },
    recordNew("get", "/api/v2/billing/invoices", "listInvoices"), "Recorded GET /api/v2/billing/invoices.",
    FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(mapped).toEqual({ mapped: 3, unverified: 0, files: { mapped: 3, setAside: 0, left: 0 }, candidates: 1, removedOperations: 1, note: "Every changed file is mapped or set aside. Trace the 1 candidate endpoint with traceEndpoints." });
  expect(candidates).toEqual([{ method: "get", path: "/api/v2/billing/invoices", state: "waiting", note: `${APP_MODULE}: BillingModule is mounted in place of SessionsModule\n${BILLING}: a new controller` }]);
  expect(state).toContain(`Mapped:\n- ${APP_MODULE} → GET /api/v2/billing/invoices; removes DELETE /api/v2/sessions/{id}\n- ${BILLING} → GET /api/v2/billing/invoices\n- ${SESSIONS} → removes DELETE /api/v2/sessions/{id}\n`);
  expect(state).toContain('Removed endpoints: [{"method":"delete","path":"/api/v2/sessions/{id}","note":"SessionsModule is no longer mounted."}]');
  const changelog = JSON.parse((await s.workspace.read(WRITTEN_FILE))!);
  expect(changelog.info["x-changelog"]).toMatchObject({ summary: { breaking: 1, deprecated: 0, "non-breaking": 1 }, removedOperations: [REVOKED] });
  expect(Object.keys(changelog.paths)).toEqual(["/api/v2/billing/invoices"]);
});

discordScenario("a file mapped again takes out of the notes the global change and the removed endpoints only it recorded; those another file still records stay (#372)", async (s) => {
  await acmeApi(s);
  const INTERCEPTOR = "src/common/transform.interceptor.ts", MAIN = "src/main.ts";
  changed(s, [APP_MODULE, SESSIONS, INTERCEPTOR, MAIN].map((filename) => ({ filename, status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" })));
  const ENVELOPE = { status: "CHANGED", impact: "breaking", in: "envelope", before: "body", after: "{ data: body }" };
  const REQUEST_ID = { status: "NEW", impact: "non-breaking", in: "header", field: "X-Request-Id" };
  const REVOKE = { method: "delete", path: "/api/v2/sessions/{id}" }, TOKENS = { method: "delete", path: "/api/v2/tokens" };
  let notes: any;
  s.model.script(
    START, NOTE_CONVENTIONS, MAP_CHANGED,
    { tool: "putChangelogMapping", args: { draft: DRAFT, files: [
      { path: APP_MODULE, removed: [REVOKE, TOKENS] }, { path: SESSIONS, removed: [REVOKE] }, { path: INTERCEPTOR, global: ENVELOPE }, { path: MAIN, global: ENVELOPE },
    ] } },
    // On a second look the app module only reorders its imports, and the bootstrap adds the request id header.
    { tool: "putChangelogMapping", args: { draft: DRAFT, files: [{ path: APP_MODULE, none: "its imports were only reordered" }, { path: MAIN, global: REQUEST_ID }] } },
    { tool: "putChangelogMapping", args: { draft: DRAFT, files: [{ path: MAIN, none: "the header is set only in tests" }] } },
    "Mapped.",
    async () => { notes = JSON.parse((await s.workspace.read(DRAFT_FILE))!).info["x-changelog"]; return { tool: "stopChangelog", args: {} }; },
    "Stopped the changelog.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(notes).toMatchObject({ globalChanges: [ENVELOPE], removedOperations: [REVOKE] });
});

discordScenario("a mapping worker's brief lists the global changes other workers recorded, so a file making the same change is given that entry (#372)", async (s) => {
  await acmeApi(s);
  const INTERCEPTOR = "src/common/transform.interceptor.ts", MAIN = "src/main.ts";
  // The bootstrap's patch is too long to come with startChangelog, and too long to share a worker with the interceptor's.
  changed(s, [{ filename: INTERCEPTOR, status: "added", patch: "@@ -0,0 +1 @@\n+export class TransformInterceptor {}" }, { filename: MAIN, status: "modified", patch: patchOf(45_000) }]);
  const ENVELOPE = { status: "CHANGED", impact: "breaking", in: "envelope", before: "body", after: "{ data: body }", note: "Every success response is wrapped in data." };
  let globals: unknown;
  s.model.script(
    START, NOTE_CONVENTIONS, MAP_CHANGED,
    { tool: "putChangelogMapping", args: { draft: DRAFT, files: [{ path: INTERCEPTOR, global: ENVELOPE }] } }, "Mapped.",
    read(MAIN), { tool: "putChangelogMapping", args: { draft: DRAFT, files: [{ path: MAIN, global: ENVELOPE }] } }, "Mapped.",
    async () => { globals = JSON.parse((await s.workspace.read(DRAFT_FILE))!).info["x-changelog"].globalChanges; return { tool: "stopChangelog", args: {} }; },
    "Stopped the changelog.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  const [first, second] = mapperStarts(s).map(briefOf);
  expect(first).not.toContain("global changes");
  expect(second).toContain(`\nThe global changes other workers recorded, each a change to every endpoint alike: when one of your files makes one of them, give it that entry exactly.\n<untrusted_data source="global changes">\n${JSON.stringify(ENVELOPE)}\n</untrusted_data>\n`);
  expect(globals).toEqual([ENVELOPE]);
});

discordScenario("a mapping worker records a global interceptor change once in the notes and no candidate for it, its files count as mapped, and the main loop hears to finish (#372)", async (s) => {
  await acmeApi(s);
  const INTERCEPTOR = "src/common/transform.interceptor.ts", MAIN = "src/main.ts";
  // TransformInterceptor comes in, registered for the whole app in the bootstrap.
  changed(s, [
    { filename: INTERCEPTOR, status: "added", patch: "@@ -0,0 +1,6 @@\n+@Injectable()\n+export class TransformInterceptor implements NestInterceptor {\n+  intercept(context, next) {\n+    return next.handle().pipe(map((data) => ({ data })));\n+  }\n+}" },
    { filename: MAIN, status: "modified", patch: "@@ -7,0 +8 @@\n+  app.useGlobalInterceptors(new TransformInterceptor());" },
  ]);
  const ENVELOPE = { status: "CHANGED", impact: "breaking", in: "envelope", before: "body", after: "{ data: body }", note: "Every success response is wrapped in data." };
  let mapped: any, meta: any, finished: any;
  s.model.script(
    START, NOTE_CONVENTIONS, MAP_CHANGED,
    // One worker has both files, whose patches startChangelog gave: both make the one change to every endpoint.
    { tool: "putChangelogMapping", args: { draft: DRAFT, files: [{ path: INTERCEPTOR, global: ENVELOPE }, { path: MAIN, global: ENVELOPE }] } },
    "Mapped.",
    async (turn) => { mapped = turn.toolResults.at(-1); meta = await draftMeta(s); return FINISH; },
    (turn) => { finished = turn.toolResults.at(-1); return written(turn); },
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(mapperStarts(s).map(filesOf)).toEqual([[INTERCEPTOR, MAIN]]);
  expect(mapped).toEqual({ mapped: 2, unverified: 0, files: { mapped: 2, setAside: 0, left: 0 }, candidates: 0, globalChanges: 1, note: "Every changed file is mapped or set aside, and no candidate endpoint is kept to trace; the notes hold 1 global change: call finishChangelog." });
  expect(meta.candidates).toBeUndefined();
  expect(meta.mapping).toEqual({ [INTERCEPTOR]: { read: true, global: ENVELOPE }, [MAIN]: { read: true, global: ENVELOPE } });
  expect(finished).toMatchObject({ written: true, summary: { breaking: 1, deprecated: 0, "non-breaking": 0 }, breaking: ["every endpoint: CHANGED envelope body → { data: body }: Every success response is wrapped in data."] });
  expect(JSON.parse((await s.workspace.read(WRITTEN_FILE))!).info["x-changelog"].globalChanges).toEqual([ENVELOPE]);
});
