import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { FOLDER, HEAD, contractDiffOn } from "./support/changelog";

/** acme/api's changelog of the whole history through 22 October: its draft and written file, named by the empty tree and HEAD. */
const NAME = "2026-10-22_4b825dc..a1b2c3d";
const DRAFT = `channel/files/changelogs/acme-api/${NAME}.draft.json`, DRAFT_FILE = `${FOLDER}/${NAME}.draft.json`;
const APP = "src/app.controller.ts", ORDERS = "src/orders/orders.controller.ts", USERS = "src/users/users.controller.ts";
/** What every file of acme/api reads as at HEAD: what a worker reads, and the main loop never should. */
const SOURCE = "@Controller('api/v2/users')\nexport class UsersController {\n  @Get() list() {}\n  @Post() create(@Body() dto: CreateUserDto) {}\n}";
const CONVENTIONS = "Routes: @Controller classes in *.controller.ts under src, no global prefix. Envelope: none; bodies are returned as they are.";
const CHOSEN = "The conventions say routes are declared by @Controller classes in *.controller.ts files, so every one of those under src at head.";

/**
 * acme/api on GitHub, open in this channel (no threads), at 10:00 on 22 October in Jakarta: main's last commit is HEAD, and its tree there
 * holds six files, three of them controllers of 2,000, 15,000 and 30,000 bytes. Workers run one at a time.
 */
async function acmeApi(s: Scenario) {
  await s.guildSettings({ language: "en", useThreads: false });
  s.clock.set("2026-10-22T10:00:00+07:00");
  await s.git({ repos: ["acme/*"] });
  await contractDiffOn(s);
  expect((await s.admin("PUT", `/api/admin/tenants/${s.tenant.id}/settings`, { playbookWorkers: 1 })).status).toBe(200);
  s.http.on("GET api.github.com/repos/acme/api", () => ({ default_branch: "main" }));
  s.http.on("GET api.github.com/repos/acme/api/commits", () => [{ sha: HEAD, commit: { committer: { date: "2026-10-21T08:00:00Z" } } }]);
  s.http.on(`GET api.github.com/repos/acme/api/git/trees/${HEAD}?recursive=1`, () => ({ truncated: false, tree: [
    { path: "package.json", type: "blob", sha: "b1", size: 700 }, { path: "src", type: "tree", sha: "t1" }, { path: APP, type: "blob", sha: "b2", size: 2_000 },
    { path: "src/main.ts", type: "blob", sha: "b3", size: 400 }, { path: ORDERS, type: "blob", sha: "b4", size: 15_000 },
    { path: "src/users/dto/create-user.dto.ts", type: "blob", sha: "b5", size: 300 }, { path: USERS, type: "blob", sha: "b6", size: 30_000 },
  ] }));
  s.http.on("GET api.github.com/repos/acme/api/contents/", (req) => ({ type: "file", path: new URL(req.url).pathname.split("/contents/")[1], encoding: "base64", content: Buffer.from(SOURCE).toString("base64") }));
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
/** The five tools a mapping worker is offered (#370). */
const WORKER_TOOLS = ["putChangelogMapping", "repoFileDiff", "repoReadFile", "repoSearchCode", "repoTree"];
const text = (message: any) => (typeof message?.content === "string" ? message.content : JSON.stringify(message?.content));
const briefOf = (call: any[]) => text(call[1]);
const isWorker = (call: any[]) => briefOf(call).startsWith("Map ");
/** The first model call of each mapping worker, in the order they started. */
const workerStarts = (s: Scenario) => s.model.calls.filter((call) => isWorker(call) && !call.some((m: any) => m.role === "assistant"));
/** The route files a worker's brief gives it. */
const filesOf = (call: any[]) => [...briefOf(call).matchAll(/^- (\S+)$/gm)].map((m) => m[1]);
const draftMeta = async (s: Scenario) => JSON.parse((await s.workspace.read(DRAFT_FILE))!)["x-draft"];

discordScenario("a whole-history draft lists the files that declare routes at head as the main loop chose them, and workers map them in groups by size, keeping every route as a NEW candidate (#373)", async (s) => {
  await acmeApi(s);
  let started: any, before: any[] = [], mapped: any, meta: any;
  s.model.script(
    START,
    (turn) => { started = turn.toolResults.at(-1); return NOTE_CONVENTIONS; },
    // Before the route files are listed nothing is mapped, traced or written; a pattern matching no file of head lists nothing.
    [{ tool: "mapChangedFiles", args: { draft: DRAFT } }, { ...MAP_ROUTES, args: { ...MAP_ROUTES.args, routeFiles: ["src/**/*.routes.ts", "src/**/*.controller.ts"] } }, TRACE, FINISH],
    (turn) => { before = turn.toolResults.map((r: any) => r.error ?? r).slice(-4); return MAP_ROUTES; },
    // 2,000 and 15,000 bytes fit one group; the users controller's 30,000 more would pass 40,000.
    [read(APP), read(ORDERS)], map(declares(APP, "GET /"), declares(ORDERS, "GET /api/v2/orders", "POST /api/v2/orders")), "Mapped.",
    read(USERS), map(declares(USERS, "GET /api/v2/users", "POST /api/v2/users")), "Mapped.",
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
  expect(workerStarts(s).map(filesOf)).toEqual([[APP, ORDERS], [USERS]]);
  for (const call of workerStarts(s)) expect([...s.model.tools[s.model.calls.indexOf(call)]!].sort()).toEqual(WORKER_TOOLS);
  // A worker reads head only, and is told every route of its files is NEW.
  const brief = briefOf(workerStarts(s)[0]!);
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
});
