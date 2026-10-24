import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { BASE, CONTROLLER, DRAFT, DRAFT_FILE, FINISH, FIXTURE, FOLDER, HEAD, contractDiffOn, draftMeta, fastProgress, pause } from "./support/changelog";

/**
 * A range covers its last day to its end (#371, GLOSSARY): acme/api's changelog of 1 to 22 October, pinned at 10:00 on the 22nd at HEAD,
 * when main gained two commits that afternoon. LATER is the last of them, so the last commit of the day.
 */
const LATER = "c4d5e6f".padEnd(40, "0");
const ORDERS = "src/orders/orders.controller.ts", REFUND = "src/orders/dto/refund.dto.ts", HEALTH = "scripts/health.ts";
const CONVENTIONS = "Routes: @Controller prefixes under api/v2. Envelope: { data } from TransformInterceptor.";
const SOURCE = "@Controller('api/v2/orders')\nexport class OrdersController {}";
const patch = (line: string) => `@@ -1 +1 @@\n-// before\n+${line}`;

/** acme/api on GitHub at 23:58 on 22 October in Jakarta, one worker tracing at a time. */
async function acmeApi(s: Scenario) {
  await s.guildSettings({ language: "en", useThreads: false });
  s.clock.set("2026-10-22T23:58:00+07:00");
  await s.git({ repos: ["acme/*"] });
  await contractDiffOn(s);
  expect((await s.admin("PUT", `/api/admin/tenants/${s.tenant.id}/settings`, { playbookWorkers: 1 })).status).toBe(200);
  s.http.on("GET api.github.com/repos/acme/api", () => ({ default_branch: "main" }));
  s.http.on("GET api.github.com/repos/acme/api/commits", (req) => (new URL(req.url).searchParams.get("until")! < "2026-10-01"
    ? [{ sha: BASE, commit: { committer: { date: "2026-09-29T08:00:00Z" } } }] : [{ sha: LATER, commit: { committer: { date: "2026-10-22T09:00:00Z" } } }]));
  // That afternoon the orders controller changed again and a refund DTO came; the users controller and the health script did not change again.
  s.http.on(`GET api.github.com/repos/acme/api/compare/${HEAD}...${LATER}`, () => ({ ahead_by: 2, behind_by: 0, commits: [], files: [
    { filename: ORDERS, status: "modified", patch: patch("@Get() list(@Query('page_size') size: number) {}") }, { filename: REFUND, status: "added", patch: patch("export class RefundDto { reason: string }") },
  ] }));
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${LATER}`, () => ({ ahead_by: 5, behind_by: 0, commits: [], files: [
    { filename: CONTROLLER, status: "modified", patch: patch("@Controller('api/v2/users')") }, { filename: ORDERS, status: "modified", patch: patch("@Get() list(@Query('status') status: string) {}") },
    { filename: REFUND, status: "added", patch: patch("export class RefundDto { reason: string }") }, { filename: HEALTH, status: "modified", patch: patch("ping()") },
  ] }));
  s.http.on("GET api.github.com/repos/acme/api/contents/", (req) => ({ type: "file", path: new URL(req.url).pathname.split("/contents/")[1], encoding: "base64", content: Buffer.from(SOURCE).toString("base64") }));
}

/** A new endpoint's operation, valid as it stands, with one change: what a worker records here. */
const operation = (id: string) => ({
  operationId: id, summary: id, security: [],
  responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { data: { type: "string" } }, required: ["data"] }, example: { data: "x" } } } } },
  "x-changes": [{ status: "NEW", impact: "non-breaking", in: "operation" }],
});

/**
 * Alice's draft as the work left it at 23:58 on its last day, worked on: pinned at 10:00 at HEAD, its three changed files mapped, and both
 * candidates they reach traced and recorded, POST /api/v2/users at 10:30 and GET /api/v2/orders at 10:40.
 */
async function tracedBeforeTheDayEnded(s: Scenario) {
  const changelog = { date: "2026-10-22", base: { ref: "main before 2026-10-01", commit: "9f8e7d6" }, head: { ref: "main through 2026-10-22", commit: "a1b2c3d" }, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, globalChanges: [], removedOperations: [], unverified: [] };
  await s.workspace.write(DRAFT_FILE, JSON.stringify({
    openapi: "3.1.2", info: { title: "acme/api API changes", version: "a1b2c3d", "x-changelog": changelog },
    paths: { "/api/v2/users": { post: FIXTURE.paths["/api/v2/users"].post }, "/api/v2/orders": { get: { ...operation("listOrdersByStatus"), "x-impact": "non-breaking" } } }, components: FIXTURE.components,
    "x-draft": {
      repo: "acme/api", branch: "main", scope: "range", from: "2026-10-01", to: "2026-10-22", place: "channel-1", startedBy: { id: "user-alice", name: "Alice" }, changedFiles: 3, commits: 3,
      base: BASE, head: HEAD, files: [CONTROLLER, ORDERS, HEALTH].map((path) => ({ path, status: "modified" })),
      mapping: { [CONTROLLER]: { read: true, reaches: ["POST /api/v2/users"] }, [ORDERS]: { read: true, reaches: ["GET /api/v2/orders"] }, [HEALTH]: { read: true, none: "a script no route runs" } },
      conventions: CONVENTIONS,
      candidates: [
        { method: "post", path: "/api/v2/users", note: `${CONTROLLER}: the controller moved to api/v2`, state: "traced", recorded: ["POST /api/v2/users"], at: "2026-10-22T03:30:00.000Z" },
        { method: "get", path: "/api/v2/orders", note: `${ORDERS}: list gains a status filter`, state: "traced", recorded: ["GET /api/v2/orders"], at: "2026-10-22T03:40:00.000Z" },
      ],
      touchedAt: new Date(s.clock.now()).toISOString(), work: { state: "worked-on" },
    },
  }));
}

const text = (message: any) => (typeof message?.content === "string" ? message.content : JSON.stringify(message?.content));
/** The first message after the system prompt: a worker's brief, or the turn's message, which for a turn going on by itself holds the draft's state. */
const briefOf = (call: any[]) => text(call[1]);
const isWorker = (call: any[]) => briefOf(call).startsWith("Trace one endpoint");
/** The endpoint each worker traced, in the order they started. */
const workerStarts = (s: Scenario) => s.model.calls.filter((call) => isWorker(call) && !call.some((m: any) => m.role === "assistant"));
const endpointOf = (call: any[]) => briefOf(call).match(/^Your endpoint: (.+)$/m)?.[1];
const diff = (path: string) => ({ tool: "repoFileDiff", args: { repo: "acme/api", from: BASE, to: LATER, path } });

discordScenario("a draft pinned before its last day ended moves its head to that day's last commit on its first turn after the day: only the files changed since are mapped again, and only the candidates they reach are traced again, against the new head (#371)", async (s) => {
  await acmeApi(s);
  await tracedBeforeTheDayEnded(s);
  await fastProgress();
  const states: string[] = [];
  let candidates: any;
  s.model.script(
    // The turn at 23:58 is still on the last day; it ends after midnight.
    (turn) => { states.push(briefOf(turn.messages)); s.clock.set("2026-10-23T00:01:00+07:00"); return "Every changed file is mapped and every candidate traced."; },
    // The first turn after the day: the files changed since HEAD are read and mapped again, and tracing goes on.
    async (turn) => { states.push(briefOf(turn.messages)); await pause(250); return [diff(ORDERS), diff(REFUND)]; },
    { tool: "putChangelogMapping", args: { draft: DRAFT, files: [
      { path: ORDERS, change: "list gains a status filter and a page size", endpoints: [{ method: "get", path: "/api/v2/orders" }] },
      { path: REFUND, change: "a new refund body", endpoints: [{ method: "post", path: "/api/v2/orders/{id}/refund" }] },
    ] } },
    { tool: "traceEndpoints", args: { draft: DRAFT } },
    { tool: "putChangelogOperation", args: { draft: DRAFT, method: "get", path: "/api/v2/orders", operation: operation("listOrders") } }, "Recorded GET /api/v2/orders.",
    { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/orders/{id}/refund", operation: operation("refundOrder") } }, "Recorded POST /api/v2/orders/{id}/refund.",
    async () => { candidates = (await draftMeta(s)).candidates; return FINISH; },
    (turn) => `The acme/api changelog is written: ${turn.toolResults.at(-1).path}`,
  );
  await s.restart();

  // Before midnight the draft is as it was pinned.
  expect(states[0]).toContain(`Draft: ${DRAFT} (acme/api, branch main, 2026-10-01 to 2026-10-22, commits 9f8e7d6..a1b2c3d)\nChanged files: 3: 3 mapped, 0 set aside, 0 left.`);
  // After it, the head is the day's last commit: the orders controller, changed again, and the refund DTO, new, are left to map; the
  // candidate the orders controller reached waits, and the one only the users controller reaches keeps its record.
  expect(states[1]).toContain(`Draft: ${DRAFT} (acme/api, branch main, 2026-10-01 to 2026-10-22, commits 9f8e7d6..c4d5e6f)\nChanged files: 4: 2 mapped, 0 set aside, 2 left.\nMapped:\n- ${CONTROLLER} → POST /api/v2/users\n- ${HEALTH} → no endpoint (a script no route runs)\nLeft:\n- ${ORDERS} (modified)\n- ${REFUND} (added)\n`);
  expect(states[1]).toContain("Endpoints recorded (1):\n- POST /api/v2/users (breaking)\n");
  expect(states[1]).toContain("Candidate endpoints: 2: 1 traced, 0 failed, 1 waiting.\nWaiting to be traced: GET /api/v2/orders\n");

  // The progress message of the work says in one line that the head moved, and how many commits that added.
  const shown = s.discord.botMessages[0]!.edits.map((e) => e.content ?? "");
  expect(shown.find((t) => t.includes("\n2 commits added through the end of 22 Oct\n"))).toContain("\n2 commits added through the end of 22 Oct\n5 commits · 2 of 4 changed files mapped · 2 candidates so far\n");

  expect(workerStarts(s).map(endpointOf)).toEqual(["GET /api/v2/orders", "POST /api/v2/orders/{id}/refund"]);
  for (const worker of workerStarts(s)) expect(briefOf(worker)).toContain(LATER);
  expect(candidates).toEqual([
    { method: "post", path: "/api/v2/users", note: `${CONTROLLER}: the controller moved to api/v2`, state: "traced", recorded: ["POST /api/v2/users"], at: "2026-10-22T03:30:00.000Z" },
    { method: "get", path: "/api/v2/orders", note: `${ORDERS}: list gains a status filter and a page size`, state: "traced", recorded: ["GET /api/v2/orders"], at: "2026-10-22T17:01:00.000Z" },
    { method: "post", path: "/api/v2/orders/{id}/refund", note: `${REFUND}: a new refund body`, state: "traced", recorded: ["POST /api/v2/orders/{id}/refund"], at: "2026-10-22T17:01:00.000Z" },
  ]);

  // The written changelog is named by the commits it compares, and holds the endpoint traced again as recorded against the new head.
  const WRITTEN = "channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..c4d5e6f.json";
  expect(s.discord.botMessages.map((m) => m.content).at(-1)).toBe(`<@user-alice> The acme/api changelog is written: ${WRITTEN}`);
  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-10-22_9f8e7d6..c4d5e6f.json`]);
  const changelog = JSON.parse((await s.workspace.read(`${FOLDER}/2026-10-22_9f8e7d6..c4d5e6f.json`))!);
  expect([changelog.info.version, changelog.info["x-changelog"].head]).toEqual(["c4d5e6f", { ref: "main through 2026-10-22", commit: "c4d5e6f" }]);
  expect(Object.keys(changelog.paths).sort()).toEqual(["/api/v2/orders", "/api/v2/orders/{id}/refund", "/api/v2/users"]);
  expect(changelog.paths["/api/v2/orders"].get.operationId).toBe("listOrders");
});

const PHONE = "src/users/dto/phone.dto.ts";
const isMapper = (call: any[]) => briefOf(call).startsWith("Map ");

discordScenario("a file new after the old head that reaches candidates traced or failed before the day ended has them traced again against the new head, their old records and unverified entries gone (#371)", async (s) => {
  await acmeApi(s);
  await tracedBeforeTheDayEnded(s);
  // Before the day ended GET /api/v2/users failed, so the notes list it as unverified.
  const draft = JSON.parse((await s.workspace.read(DRAFT_FILE))!);
  draft["x-draft"].candidates.push({ method: "get", path: "/api/v2/users", note: `${CONTROLLER}: the list moved to api/v2`, state: "failed", reason: "its route is built at runtime", at: "2026-10-22T03:50:00.000Z" });
  draft["x-draft"].mapping[CONTROLLER].reaches.push("GET /api/v2/users");
  draft.info["x-changelog"].unverified = [{ in: "operation", reason: "GET /api/v2/users could not be traced: its route is built at runtime" }];
  await s.workspace.write(DRAFT_FILE, JSON.stringify(draft));
  // That afternoon only a phone DTO came, which both users endpoints take.
  s.http.on(`GET api.github.com/repos/acme/api/compare/${HEAD}...${LATER}`, () => ({ ahead_by: 1, behind_by: 0, commits: [], files: [{ filename: PHONE, status: "added", patch: patch("export class PhoneDto { phone: string }") }] }));
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${LATER}`, () => ({ ahead_by: 4, behind_by: 0, commits: [], files: [
    { filename: CONTROLLER, status: "modified", patch: patch("@Controller('api/v2/users')") }, { filename: ORDERS, status: "modified", patch: patch("@Get() list(@Query('status') status: string) {}") },
    { filename: HEALTH, status: "modified", patch: patch("ping()") }, { filename: PHONE, status: "added", patch: patch("export class PhoneDto { phone: string }") },
  ] }));
  let moved: any, unverified: unknown;
  s.model.script(
    () => { s.clock.set("2026-10-23T00:01:00+07:00"); return "Every changed file is mapped and every candidate traced."; },
    // The first turn after the day: the phone DTO alone is left to map, and its worker finds both users endpoints take it.
    async () => { moved = (await draftMeta(s)).candidates; return { tool: "mapChangedFiles", args: { draft: DRAFT } }; },
    { tool: "repoFileDiff", args: { repo: "acme/api", from: BASE, to: LATER, path: PHONE } },
    { tool: "putChangelogMapping", args: { draft: DRAFT, files: [{ path: PHONE, change: "a phone field comes", endpoints: [{ method: "post", path: "/api/v2/users" }, { method: "get", path: "/api/v2/users" }] }] } },
    "Mapped.",
    async () => { unverified = JSON.parse((await s.workspace.read(DRAFT_FILE))!).info["x-changelog"].unverified; return { tool: "traceEndpoints", args: { draft: DRAFT } }; },
    { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: operation("createUserWithPhone") } }, "Recorded POST /api/v2/users.",
    { tool: "putChangelogOperation", args: { draft: DRAFT, method: "get", path: "/api/v2/users", operation: operation("listUsersWithPhone") } }, "Recorded GET /api/v2/users.",
    FINISH,
    (turn) => `The acme/api changelog is written: ${turn.toolResults.at(-1).path}`,
  );
  await s.restart();

  // Moving the head left both users endpoints as they were: the file that changed after it was not mapped yet.
  expect(moved.map((c: any) => `${c.method.toUpperCase()} ${c.path}: ${c.state}`)).toEqual(["POST /api/v2/users: traced", "GET /api/v2/orders: traced", "GET /api/v2/users: failed"]);
  expect(s.model.calls.filter((call) => isMapper(call) && !call.some((m: any) => m.role === "assistant")).map(briefOf)).toEqual([expect.stringContaining(`\n- ${PHONE} (added)`)]);
  // Mapped, the phone DTO sent both back to waiting: the failure's unverified entry left the notes, and each was traced again at the new head.
  expect(unverified).toEqual([]);
  expect(workerStarts(s).map(endpointOf)).toEqual(["POST /api/v2/users", "GET /api/v2/users"]);
  for (const worker of workerStarts(s)) expect(briefOf(worker)).toContain(LATER);
  const changelog = JSON.parse((await s.workspace.read(`${FOLDER}/2026-10-22_9f8e7d6..c4d5e6f.json`))!);
  expect([changelog.paths["/api/v2/users"].post.operationId, changelog.paths["/api/v2/users"].get.operationId, changelog.paths["/api/v2/orders"].get.operationId]).toEqual(["createUserWithPhone", "listUsersWithPhone", "listOrdersByStatus"]);
  expect(changelog.info["x-changelog"].unverified).toEqual([]);
});

discordScenario("a candidate that failed before the day ended, reached by a file that changed again after the old head, goes back to waiting when the head moves, its unverified entry gone (#371)", async (s) => {
  await acmeApi(s);
  await tracedBeforeTheDayEnded(s);
  // GET /api/v2/orders failed instead, so it is listed as unverified and nothing was recorded for it.
  const draft = JSON.parse((await s.workspace.read(DRAFT_FILE))!);
  draft["x-draft"].candidates[1] = { method: "get", path: "/api/v2/orders", note: `${ORDERS}: list gains a status filter`, state: "failed", reason: "its route is built at runtime", at: "2026-10-22T03:40:00.000Z" };
  delete draft.paths["/api/v2/orders"];
  draft.info["x-changelog"].unverified = [{ in: "operation", reason: "GET /api/v2/orders could not be traced: its route is built at runtime" }];
  await s.workspace.write(DRAFT_FILE, JSON.stringify(draft));
  let moved: any;
  s.model.script(
    () => { s.clock.set("2026-10-23T00:01:00+07:00"); return "Every changed file is mapped."; },
    async () => { moved = JSON.parse((await s.workspace.read(DRAFT_FILE))!); return { tool: "askChangelogAsker", args: { draft: DRAFT, question: "Is the orders list still routed from config?" } }; },
    "Is the orders list still routed from config?",
  );
  await s.restart();

  expect(moved["x-draft"].head).toBe(LATER);
  expect(moved["x-draft"].candidates).toEqual([
    { method: "post", path: "/api/v2/users", note: `${CONTROLLER}: the controller moved to api/v2`, state: "traced", recorded: ["POST /api/v2/users"], at: "2026-10-22T03:30:00.000Z" },
    { method: "get", path: "/api/v2/orders", state: "waiting" },
  ]);
  expect(moved.info["x-changelog"].unverified).toEqual([]);
});

discordScenario("files that changed again after the old head take out of the notes the global changes and removed endpoints only they recorded when the head moves; those another file still records stay (#371, #372)", async (s) => {
  await acmeApi(s);
  await tracedBeforeTheDayEnded(s);
  const MAIN = "src/main.ts", INTERCEPTOR = "src/common/transform.interceptor.ts";
  const ENVELOPE = { status: "CHANGED", impact: "breaking", in: "envelope", before: "body", after: "{ data: body }" };
  const REQUEST_ID = { status: "NEW", impact: "non-breaking", in: "header", field: "X-Request-Id", note: "Every response carries it." };
  const SESSIONS = { method: "delete", path: "/api/v2/sessions", replacedBy: "POST /api/v2/sessions/revoke" }, ORDER = { method: "delete", path: "/api/v2/orders/{id}" };
  // Before the day ended the health script added a header to every response and the interceptor and bootstrap the envelope; the orders
  // controller took away DELETE /api/v2/orders/{id}, and with the users controller DELETE /api/v2/sessions.
  const draft = JSON.parse((await s.workspace.read(DRAFT_FILE))!);
  draft["x-draft"].files.push({ path: MAIN, status: "modified" }, { path: INTERCEPTOR, status: "added" });
  Object.assign(draft["x-draft"].mapping, {
    [CONTROLLER]: { read: true, reaches: ["POST /api/v2/users"], removes: ["DELETE /api/v2/sessions"] }, [ORDERS]: { read: true, reaches: ["GET /api/v2/orders"], removes: ["DELETE /api/v2/orders/{id}", "DELETE /api/v2/sessions"] },
    [HEALTH]: { read: true, global: REQUEST_ID }, [MAIN]: { read: true, global: ENVELOPE }, [INTERCEPTOR]: { read: true, global: ENVELOPE },
  });
  Object.assign(draft.info["x-changelog"], { globalChanges: [ENVELOPE, REQUEST_ID], removedOperations: [ORDER, SESSIONS] });
  await s.workspace.write(DRAFT_FILE, JSON.stringify(draft));
  // That afternoon the orders controller, the health script and the interceptor changed again.
  const files = (...paths: string[]) => paths.map((filename) => ({ filename, status: "modified", patch: patch(filename) }));
  s.http.on(`GET api.github.com/repos/acme/api/compare/${HEAD}...${LATER}`, () => ({ ahead_by: 2, behind_by: 0, commits: [], files: files(ORDERS, HEALTH, INTERCEPTOR) }));
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${LATER}`, () => ({ ahead_by: 5, behind_by: 0, commits: [], files: files(CONTROLLER, ORDERS, HEALTH, MAIN, INTERCEPTOR) }));
  let moved: any;
  s.model.script(
    () => { s.clock.set("2026-10-23T00:01:00+07:00"); return "Every changed file is mapped."; },
    async () => { moved = JSON.parse((await s.workspace.read(DRAFT_FILE))!); return { tool: "askChangelogAsker", args: { draft: DRAFT, question: "Is the request id header still sent?" } }; },
    "Is the request id header still sent?",
  );
  await s.restart();

  expect(moved["x-draft"].head).toBe(LATER);
  expect(Object.keys(moved["x-draft"].mapping)).toEqual([CONTROLLER, MAIN]);
  expect(moved.info["x-changelog"]).toMatchObject({ globalChanges: [ENVELOPE], removedOperations: [SESSIONS] });
});

discordScenario("a person's turn that first works on a draft after its last day moves its head before anything else: its mapping and tracing workers read the new head (#371)", async (s) => {
  await acmeApi(s);
  await tracedBeforeTheDayEnded(s);
  // Alice stopped the work before the day ended, so no turn goes on by itself; she says lanjut two days later.
  const draft = JSON.parse((await s.workspace.read(DRAFT_FILE))!);
  draft["x-draft"].work = { state: "paused", reason: "stopped", since: "2026-10-22T16:58:00.000Z" };
  await s.workspace.write(DRAFT_FILE, JSON.stringify(draft));
  s.clock.set("2026-10-24T09:00:00+07:00");
  s.model.script(
    { tool: "mapChangedFiles", args: { draft: DRAFT } },
    [diff(REFUND), diff(ORDERS)],
    { tool: "putChangelogMapping", args: { draft: DRAFT, files: [
      { path: REFUND, change: "a new refund body", endpoints: [{ method: "post", path: "/api/v2/orders/{id}/refund" }] },
      { path: ORDERS, change: "list gains a status filter and a page size", endpoints: [{ method: "get", path: "/api/v2/orders" }] },
    ] } },
    "Mapped.",
    { tool: "traceEndpoints", args: { draft: DRAFT } },
    { tool: "putChangelogOperation", args: { draft: DRAFT, method: "get", path: "/api/v2/orders", operation: operation("listOrders") } }, "Recorded GET /api/v2/orders.",
    { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/orders/{id}/refund", operation: operation("refundOrder") } }, "Recorded POST /api/v2/orders/{id}/refund.",
    FINISH,
    (turn) => `The acme/api changelog is written: ${turn.toolResults.at(-1).path}`,
  );
  await s.discord.send(`${s.discord.mention} lanjut`);

  const mappers = s.model.calls.filter((call) => isMapper(call) && !call.some((m: any) => m.role === "assistant")).map(briefOf);
  expect(mappers).toEqual([expect.stringContaining(`\nBase: ${BASE} (main before 2026-10-01); head: ${LATER} (main through 2026-10-22).`)]);
  expect(mappers[0]).toContain(`\n- ${REFUND} (added)\n- ${ORDERS} (modified)\n`);
  expect(workerStarts(s).map(endpointOf)).toEqual(["GET /api/v2/orders", "POST /api/v2/orders/{id}/refund"]);
  for (const worker of workerStarts(s)) expect(briefOf(worker)).toContain(LATER);
  expect(s.discord.botMessages.map((m) => m.content).at(-1)).toBe("The acme/api changelog is written: channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..c4d5e6f.json");
});

discordScenario("a file two mapping workers could not map that changed again after the old head goes back to unmapped, its unverified entry gone; one that did not change again stays unverified (#370, #371)", async (s) => {
  await acmeApi(s);
  await tracedBeforeTheDayEnded(s);
  // Two workers could map neither the orders controller nor the health script before the day ended.
  const draft = JSON.parse((await s.workspace.read(DRAFT_FILE))!);
  const why: Record<string, string> = { [ORDERS]: "its routes are registered from config at runtime", [HEALTH]: "its runner comes from another repository" };
  Object.assign(draft["x-draft"].mapping, { [ORDERS]: { read: true, attempts: 2, unverified: why[ORDERS] }, [HEALTH]: { read: true, attempts: 2, unverified: why[HEALTH] } });
  draft.info["x-changelog"].unverified = [ORDERS, HEALTH].map((path) => ({ in: "operation", reason: `${path} could not be mapped: ${why[path]}` }));
  await s.workspace.write(DRAFT_FILE, JSON.stringify(draft));
  let moved: any;
  s.model.script(
    () => { s.clock.set("2026-10-23T00:01:00+07:00"); return "Every changed file is mapped."; },
    // The first turn after the day: the head moved, and the draft is read before anything else.
    async () => { moved = JSON.parse((await s.workspace.read(DRAFT_FILE))!); return { tool: "askChangelogAsker", args: { draft: DRAFT, question: "Is the orders module still routed from config?" } }; },
    "Is the orders module still routed from config?",
  );
  await s.restart();

  expect(moved["x-draft"].head).toBe(LATER);
  expect(moved["x-draft"].mapping).toEqual({ [CONTROLLER]: { read: true, reaches: ["POST /api/v2/users"] }, [HEALTH]: { read: true, attempts: 2, unverified: why[HEALTH] } });
  expect(moved.info["x-changelog"].unverified).toEqual([{ in: "operation", reason: `${HEALTH} could not be mapped: ${why[HEALTH]}` }]);
});
