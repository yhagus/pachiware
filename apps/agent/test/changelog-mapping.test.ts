import { afterEach, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { BASE, DRAFT, DRAFT_FILE, FINISH, HEAD, PROVIDER_DOWN, START, WRITTEN_FILE, contractDiffOn, draftMeta, pauses } from "./support/changelog";

const PLAYBOOK = new URL("../../../packages/skills/playbooks/contract-diff/", import.meta.url);
/** What every file of acme/api reads as, at any commit: what a worker reads, and the main loop never should. */
const SOURCE = "export class CreateUserDto {\n  full_name: string;\n  phone: string;\n}";
const CONVENTIONS = "Routes: @Controller prefixes under the global prefix api/v2. Envelope: { data } from TransformInterceptor. Errors: HttpExceptionFilter gives { code, message }.";
const CREATE = "src/users/dto/create-user.dto.ts", UPDATE = "src/users/dto/update-user.dto.ts", CONTROLLER = "src/users/users.controller.ts", SERVICE = "src/users/users.service.ts";
/** A patch of exactly `chars` characters. */
const patchOf = (chars: number) => "@@ -1,9 +1,9 @@\n".padEnd(chars, "+");

/**
 * acme/api on GitHub, open in this channel (no threads), at 10:00 on 22 October in Jakarta: main's last commit through that day is HEAD,
 * its last before 1 October BASE. Between them four files of the users module changed, listed out of path order, with patches of 45,000,
 * 12,000, 1,000 and 30,000 characters; only the controller's fits startChangelog's result. Workers map one group at a time.
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
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 3, behind_by: 0, commits: [], files: [
    { filename: SERVICE, status: "modified", patch: patchOf(45_000) }, { filename: CREATE, status: "modified", patch: patchOf(12_000) },
    { filename: CONTROLLER, status: "modified", patch: patchOf(1_000) }, { filename: UPDATE, status: "modified", patch: patchOf(30_000) },
  ] }));
  s.http.on("GET api.github.com/repos/acme/api/contents/", (req) => ({ type: "file", path: new URL(req.url).pathname.split("/contents/")[1], encoding: "base64", content: Buffer.from(SOURCE).toString("base64") }));
}
const NOTE_CONVENTIONS = { tool: "putChangelogNotes", args: { draft: DRAFT, conventions: CONVENTIONS } };
const MAP_FILES = { tool: "mapChangedFiles", args: { draft: DRAFT } };
/** A worker's read of a changed file whole at head, which lets it map the file. */
const read = (path: string) => ({ tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path } });
/** A worker's step that maps each file given as reaching no endpoint. */
const mapNone = (...paths: string[]) => ({ tool: "putChangelogMapping", args: { draft: DRAFT, files: paths.map((path) => ({ path, none: "only a log line changed" })) } });
/** The five tools a mapping worker is offered, whatever the place offers (#370). */
const WORKER_TOOLS = ["putChangelogMapping", "repoFileDiff", "repoReadFile", "repoSearchCode", "repoTree"];
const text = (message: any) => (typeof message?.content === "string" ? message.content : JSON.stringify(message?.content));
/** The first message after the system prompt: a worker's brief, or the turn's message. */
const briefOf = (call: any[]) => text(call[1]);
const isWorker = (call: any[]) => briefOf(call).startsWith("Map ");
/** The first model call of each worker, in the order they started. */
const workerStarts = (s: Scenario) => s.model.calls.filter((call) => isWorker(call) && !call.some((m: any) => m.role === "assistant"));
/** The changed files a worker's brief gives it. */
const filesOf = (call: any[]) => [...briefOf(call).matchAll(/^- (\S+) \(/gm)].map((m) => m[1]);

discordScenario("mapChangedFiles hands the changed files to workers in groups by path within the patch bound, an oversized file alone; each worker starts from a brief and five tools, and the main loop hears only counts (#370)", async (s) => {
  await acmeApi(s);
  let mapped: any;
  s.model.script(
    START, NOTE_CONVENTIONS, MAP_FILES,
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

  expect(s.model.calls.map(isWorker)).toEqual([false, false, false, true, true, true, true, true, true, true, true, true, false, false]);
  expect(workerStarts(s).map(filesOf)).toEqual([[CREATE], [UPDATE, CONTROLLER], [SERVICE]]);
  for (const call of workerStarts(s)) expect([...s.model.tools[s.model.calls.indexOf(call)]!].sort()).toEqual(WORKER_TOOLS);
  // Its brief: the repository, both commits, the draft, the conventions the main loop kept, and its files.
  const brief = briefOf(workerStarts(s)[1]!);
  for (const part of ["acme/api", "branch main", BASE, HEAD, DRAFT, `<untrusted_data source="conventions summary">\n${CONVENTIONS}\n</untrusted_data>`]) expect([part, brief.includes(part)]).toEqual([part, true]);
  // It follows the mapping rules alone: not the main loop's steps, and not the tracing rules.
  const rules = text(workerStarts(s)[0]![0]);
  expect(rules).toContain(readFileSync(new URL("mapping.md", PLAYBOOK), "utf8").trim());
  expect(rules).not.toContain("## 1. Pin what the changelog covers");
  expect(rules).not.toContain("**Presence versus null.**");
  // The main loop hears counts, and never reads what the workers read.
  expect(mapped).toEqual({ mapped: 4, unverified: 0, files: { mapped: 4, setAside: 0, left: 0 }, candidates: 0, note: "Every changed file is mapped or set aside, and no change reaches an endpoint: call finishChangelog." });
  for (const call of s.model.calls.slice(12)) expect(call.map(text).join("\n")).not.toContain(SOURCE);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["Nothing the frontend sees changed."]);
});

// Budgets are shortened for a scenario and put back after it.
let shipped: { turn: number; worker: { steps: number; ms: number; leastMs: number } } | undefined;
async function budgets(turnMs: number, worker: Partial<{ steps: number; ms: number; leastMs: number }>) {
  const { turnDeadline } = await import("../src/loop/react.ts");
  const { workerBudget } = await import("../../../packages/skills/src/openapi/workers.ts");
  shipped ??= { turn: turnDeadline.ms, worker: { ...workerBudget } };
  turnDeadline.ms = turnMs;
  Object.assign(workerBudget, worker);
}
afterEach(async () => {
  if (!shipped) return;
  (await import("../src/loop/react.ts")).turnDeadline.ms = shipped.turn;
  Object.assign((await import("../../../packages/skills/src/openapi/workers.ts")).workerBudget, shipped.worker);
  shipped = undefined;
});
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

discordScenario("a turn cut while its workers map goes on by itself with the files still unmapped only, and never maps one again (#370)", async (s) => {
  await acmeApi(s);
  // A turn has 3 seconds here, and a worker starts only with at least 1 second left.
  await budgets(3000, { leastMs: 1000 });
  let cut: any, state = "";
  s.model.script(
    START, NOTE_CONVENTIONS, MAP_FILES,
    // The first worker maps its file and answers once the turn's time is gone, so no other worker starts.
    read(CREATE), mapNone(CREATE), async () => { await pause(3200); return "Mapped."; },
    // Out of time, the main loop is asked for its answer after the tool's result.
    (turn) => { cut = JSON.parse(text(turn.messages.findLast((m: any) => m.role === "tool")).replace(/<\/?untrusted_data[^>]*>/g, "")); return "One of four changed files is mapped; three wait."; },
    // The turn that goes on by itself starts from the draft, which lists the files left.
    (turn) => { state = text(turn.messages[1]); return MAP_FILES; },
    read(UPDATE), mapNone(UPDATE, CONTROLLER), "Mapped.",
    read(SERVICE), mapNone(SERVICE), "Mapped.",
    FINISH, "Nothing the frontend sees changed.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(cut).toEqual({ mapped: 1, unverified: 0, files: { mapped: 1, setAside: 0, left: 3 }, candidates: 0, note: "This turn's time is nearly out: 3 changed files wait to be mapped, and the next turn goes on with them through mapChangedFiles." });
  expect(state).toContain(`Changed files: 4: 1 mapped, 0 set aside, 3 left.\nMapped:\n- ${CREATE} → no endpoint (only a log line changed)\nLeft:\n- ${SERVICE} (modified)\n- ${CONTROLLER} (modified, read whole)\n- ${UPDATE} (modified)\n`);
  expect(workerStarts(s).map(filesOf)).toEqual([[CREATE], [UPDATE, CONTROLLER], [SERVICE]]);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["<@user-alice> Nothing the frontend sees changed."]);
}, 30000);

discordScenario("a file two workers could not map is listed as unverified with why, counts as mapped, and does not keep the changelog from being written (#370)", async (s) => {
  await acmeApi(s);
  let mapped: any, entry: any, finished: any;
  s.model.script(
    START, NOTE_CONVENTIONS, MAP_FILES,
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
  expect(workerStarts(s).map(filesOf)).toEqual([[CREATE], [CREATE], [UPDATE, CONTROLLER], [SERVICE]]);
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
    MAP_FILES, PROVIDER_DOWN,
    MAP_FILES, PROVIDER_DOWN,
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
  expect(workerStarts(s).map(filesOf)).toEqual([[CREATE], [CREATE]]);
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
    MAP_FILES,
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
