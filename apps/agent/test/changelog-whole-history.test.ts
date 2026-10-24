import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import {
  FIXTURE, FOLDER, HEAD, MAPPER_TOOLS, OPERATION, acmeOnGitHub, briefOf, budgets, draftMeta as metaOf, fastProgress, filesOf, mapperStarts, progressShows, text, tracerStarts,
} from "./support/changelog";

/** acme/api's changelog of the whole history through 22 October: its draft and written file, named by the empty tree and HEAD. */
const NAME = "2026-10-22_4b825dc..a1b2c3d";
const DRAFT = `channel/files/changelogs/acme-api/${NAME}.draft.json`, DRAFT_FILE = `${FOLDER}/${NAME}.draft.json`, WRITTEN_FILE = `${FOLDER}/${NAME}.json`;
const APP = "src/app.controller.ts", ORDERS = "src/orders/orders.controller.ts", USERS = "src/users/users.controller.ts";
/** What every file of acme/api reads as at HEAD: what a worker reads, and the main loop never should. */
const SOURCE = "@Controller('api/v2/users')\nexport class UsersController {\n  @Get() list() {}\n  @Post() create(@Body() dto: CreateUserDto) {}\n}";
const CONVENTIONS = "Routes: @Controller classes in *.controller.ts under src, no global prefix. Envelope: none; bodies are returned as they are.";
const CHOSEN = "The conventions say routes are declared by @Controller classes in *.controller.ts files, so every one of those under src at head.";

/**
 * acme/api on GitHub at 10:00 on 22 October in Jakarta, as acmeOnGitHub has it: main's last commit is HEAD, and its tree there holds six
 * files, three of them controllers of 2,000, 15,000 and 30,000 bytes. Workers run one at a time.
 */
async function acmeApi(s: Scenario) {
  await acmeOnGitHub(s, { source: SOURCE });
  s.http.on(`GET api.github.com/repos/acme/api/git/trees/${HEAD}?recursive=1`, () => ({ truncated: false, tree: [
    { path: "package.json", type: "blob", sha: "b1", size: 700 }, { path: "src", type: "tree", sha: "t1" }, { path: APP, type: "blob", sha: "b2", size: 2_000 },
    { path: "src/main.ts", type: "blob", sha: "b3", size: 400 }, { path: ORDERS, type: "blob", sha: "b4", size: 15_000 },
    { path: "src/users/dto/create-user.dto.ts", type: "blob", sha: "b5", size: 300 }, { path: USERS, type: "blob", sha: "b6", size: 30_000 },
  ] }));
}
const START = { tool: "startChangelog", args: { repo: "acme/api", scope: "all" } };
const NOTE_CONVENTIONS = { tool: "putChangelogNotes", args: { draft: DRAFT, conventions: CONVENTIONS } };
/** Lists the route files as the main loop chose them, and has workers map them. */
const MAP_ROUTES = { tool: "mapChangedFiles", args: { draft: DRAFT, routeFiles: ["src/**/*.controller.ts"], chosenBy: CHOSEN } };
const TRACE = { tool: "traceEndpoints", args: { draft: DRAFT } };
const FINISH = { tool: "finishChangelog", args: { draft: DRAFT } };
/** A worker's read of a route file whole at head, which lets it map the file. */
const read = (path: string) => ({ tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path } });
/** A route file that declares `endpoints` ("GET /path"), as a worker records it: every one NEW. */
const declares = (path: string, ...endpoints: string[]) => ({ path, change: "NEW", endpoints: endpoints.map((e) => ({ method: e.split(" ")[0]!.toLowerCase(), path: e.split(" ")[1]! })) });
const map = (...files: object[]) => ({ tool: "putChangelogMapping", args: { draft: DRAFT, files } });
/** The whole history's draft metadata as the Workspace holds it. */
const draftMeta = (s: Scenario) => metaOf(s, DRAFT_FILE);

discordScenario("a whole-history draft lists the files that declare routes at head as the main loop chose them, and workers map them in groups by size, keeping every route as a NEW candidate (#373)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  // A worker's answer waits until the progress message shows what it recorded.
  const once = (detail: string, step: unknown) => async () => { await progressShows(s, `🧠 Working…\n${detail}\n`); return step as any; };
  let started: any, before: any[] = [], mapped: any, meta: any;
  s.model.script(
    START,
    (turn) => { started = turn.toolResults.at(-1); return NOTE_CONVENTIONS; },
    // Before the route files are listed nothing is mapped, traced or written; a pattern matching no file of head lists nothing.
    [{ tool: "mapChangedFiles", args: { draft: DRAFT } }, { ...MAP_ROUTES, args: { ...MAP_ROUTES.args, routeFiles: ["src/**/*.routes.ts", "src/**/*.controller.ts"] } }, TRACE, FINISH],
    (turn) => { before = turn.toolResults.map((r: any) => r.error ?? r).slice(-4); return MAP_ROUTES; },
    // 2,000 and 15,000 bytes fit one group; the users controller's 30,000 more would pass 40,000.
    [read(APP), read(ORDERS)], map(declares(APP, "GET /"), declares(ORDERS, "GET /api/v2/orders", "POST /api/v2/orders")), once("2 of 3 route files mapped · 3 candidates", "Mapped."),
    read(USERS), map(declares(USERS, "GET /api/v2/users", "POST /api/v2/users")), once("3 of 3 route files mapped · 5 candidates\n0 of 5 candidates traced", "Mapped."),
    async (turn) => { mapped = turn.toolResults.at(-1); meta = await draftMeta(s); return { tool: "stopChangelog", args: {} }; },
    "Stopped the changelog.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api, the whole history`);

  expect(started.mappingNote).toBe("Nothing came before, so the files mapped are those that declare routes at head. Once the conventions summary is written, choose them from it and from head's tree (repoTree), and call mapChangedFiles with routeFiles (their paths, or patterns such as src/**/*.controller.ts) and chosenBy (how you chose them): its workers read each whole at head and keep every route it declares as a NEW candidate.");
  const unlisted = "This changelog covers the whole history, and its draft lists no route files yet: call mapChangedFiles with routeFiles, the files that declare routes at head (their paths, or patterns such as src/**/*.controller.ts, matched against head's tree), and chosenBy, how you chose them from the conventions summary and the head tree.";
  expect(before).toEqual([
    `${unlisted} Nothing was mapped.`,
    "Nothing was listed or mapped: src/**/*.routes.ts matches no file at head (a1b2c3d). Name the files that declare routes at head by their paths, or by patterns that match them; repoTree lists head's files.",
    `${unlisted} Nothing was traced.`,
    { written: false, fix: `${unlisted} Once they are mapped and their candidates traced, call finishChangelog again.` },
  ]);

  // The draft lists the route files as the main loop named them and why, each weighed by its size at head.
  expect(meta.routeFiles).toEqual({ given: ["src/**/*.controller.ts"], chosenBy: CHOSEN });
  expect(meta.files).toEqual([{ path: APP, status: "added", patchChars: 2_000 }, { path: ORDERS, status: "added", patchChars: 15_000 }, { path: USERS, status: "added", patchChars: 30_000 }]);
  expect(mapperStarts(s).map(filesOf)).toEqual([[APP, ORDERS], [USERS]]);
  for (const call of mapperStarts(s)) expect([...s.model.tools[s.model.calls.indexOf(call)]!].sort()).toEqual(MAPPER_TOOLS);
  // A worker reads head only, and is told every route of its files is NEW.
  const brief = briefOf(mapperStarts(s)[0]!);
  expect(brief).toStartWith("Map 2 route files of the API changelog of acme/api, branch main, and record how each ends in the changelog's draft before you stop.\n");
  expect(brief).toContain(`\nHead: ${HEAD} (main). Nothing came before this changelog: it covers the whole history, so every route your files declare is NEW. Read them at head by passing it as the ref.\n`);
  expect(brief).toContain(`\nYour 2 route files, which the changelog's main work chose as follows:\n<untrusted_data source="how the route files were chosen">\n${CHOSEN}\n</untrusted_data>\n`);

  // Every route of each file is a candidate waiting to be traced, its note naming the file that declares it.
  expect(meta.candidates).toEqual([
    { method: "get", path: "/", note: `${APP}: NEW`, state: "waiting" },
    { method: "get", path: "/api/v2/orders", note: `${ORDERS}: NEW`, state: "waiting" }, { method: "post", path: "/api/v2/orders", note: `${ORDERS}: NEW`, state: "waiting" },
    { method: "get", path: "/api/v2/users", note: `${USERS}: NEW`, state: "waiting" }, { method: "post", path: "/api/v2/users", note: `${USERS}: NEW`, state: "waiting" },
  ]);
  expect(mapped).toEqual({ routeFiles: 3, mapped: 3, unverified: 0, files: { mapped: 3, setAside: 0, left: 0 }, candidates: 5, note: "Every route file is mapped or set aside. Trace the 5 candidate endpoints with traceEndpoints." });
  for (const call of s.model.calls.slice(-2)) expect(call.map(text).join("\n")).not.toContain(SOURCE);
  // The progress message counts the route files mapped of those listed, not the files at head, with the candidates found.
  const shown = s.discord.botMessages[0]!.edits.map((e) => e.content ?? "");
  for (const detail of ["2 of 3 route files mapped · 3 candidates", "3 of 3 route files mapped · 5 candidates\n0 of 5 candidates traced"]) {
    expect([detail, shown.some((edit) => edit.startsWith(`🧠 Working…\n${detail}\n`))]).toEqual([detail, true]);
  }
});

/** A NEW endpoint as its tracing worker records it, with what it needs to be valid and nothing else. */
const NEW_ORDERS = { operationId: "listOrders", summary: "List orders", security: [], responses: { "200": { description: "The orders" } }, "x-changes": [{ status: "NEW", impact: "non-breaking", in: "operation" }] };

discordScenario("tracing a whole-history draft waits until every route file it lists is mapped, and a turn going on by itself sees which are left; each candidate is then traced as NEW (#373)", async (s) => {
  await acmeApi(s);
  // A turn has 3 seconds here, and a worker starts only with at least 1 second left.
  await budgets(3000, { leastMs: 1000 });
  let state = "", context = "", refused: any[] = [];
  s.model.script(
    START, NOTE_CONVENTIONS,
    // Named by their paths: 15,000 and 30,000 bytes do not fit one group.
    { tool: "mapChangedFiles", args: { draft: DRAFT, routeFiles: [USERS, ORDERS], chosenBy: CHOSEN } },
    // The first worker maps its file and answers once the turn's time is gone, so no other worker starts.
    read(ORDERS), map(declares(ORDERS, "GET /api/v2/orders")), () => { s.clock.advance(3200); return "Mapped."; },
    "One of two route files is mapped; one waits.",
    // The turn that goes on by itself starts from the draft; tracing and finishing wait for the file left.
    (turn) => { state = text(turn.messages.find((m: any) => typeof m.content === "string" && m.content.startsWith("[No one wrote this"))); context = text(turn.messages.find((m: any) => typeof m.content === "string" && m.content.startsWith("[Context for this turn"))); return [TRACE, FINISH]; },
    (turn) => { refused = turn.toolResults.map((r: any) => r.error ?? r); return { tool: "mapChangedFiles", args: { draft: DRAFT } }; },
    read(USERS), map(declares(USERS, "POST /api/v2/users")), "Mapped.",
    TRACE,
    [{ tool: "putChangelogOperation", args: { draft: DRAFT, method: "get", path: "/api/v2/orders", operation: NEW_ORDERS } }], "Recorded GET /api/v2/orders.",
    [{ tool: "putChangelogComponents", args: { draft: DRAFT, components: FIXTURE.components } }, { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: OPERATION } }], "Recorded POST /api/v2/users.",
    FINISH, "The acme/api changelog of the whole history is written.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api, the whole history`);

  expect(state).toContain(`Route files: 2 of the 6 files at head (${USERS}, ${ORDERS}): 1 mapped, 0 set aside, 1 left. How they were chosen: ${CHOSEN}\nMapped:\n- ${ORDERS} → GET /api/v2/orders\nLeft:\n- ${USERS}\n`);
  expect(context).toContain("acme/api, branch main, the whole history through 2026-10-22 (commits 4b825dc..a1b2c3d, 6 files at head, 2 route files: 1 mapped, 0 set aside, 1 left)");
  expect(refused).toEqual([
    `1 of 2 route files is not mapped yet, so nothing was traced: tracing waits until every route file is mapped, so that the candidates it counts are all there are. Map them with mapChangedFiles; then call traceEndpoints again. Not mapped yet:\n- ${USERS}`,
    { written: false, unmapped: 1, files: [USERS], fix: "Map them with mapChangedFiles; then call finishChangelog again." },
  ]);
  // Mapping went on with the file left alone; then every candidate was traced, each as NEW, from the file that declares it.
  expect(mapperStarts(s).map(filesOf)).toEqual([[ORDERS], [USERS]]);
  const tracers = tracerStarts(s).map(briefOf);
  expect(tracers.map((brief) => brief.split("\n").find((l: string) => l.startsWith("Your endpoint:")))).toEqual(["Your endpoint: GET /api/v2/orders", "Your endpoint: POST /api/v2/users"]);
  for (const brief of tracers) expect(brief).toContain(`\nHead: ${HEAD} (main). Nothing came before this changelog: the endpoint is NEW. Read head only.\n`);
  expect(tracers[1]).toContain(`Why it is a candidate: <untrusted_data source="candidate note">\n${USERS}: NEW\n</untrusted_data>`);
  const changelog = JSON.parse((await s.workspace.read(WRITTEN_FILE))!);
  expect(Object.entries(changelog.paths).map(([path, ops]: [string, any]) => `${Object.keys(ops).join(",")} ${path}`)).toEqual(["get /api/v2/orders", "post /api/v2/users"]);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["<@user-alice> The acme/api changelog of the whole history is written."]);
}, 30000);
