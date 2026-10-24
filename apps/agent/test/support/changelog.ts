/**
 * What the Changelog draft scenarios share: acme/api's changelog from 1 to 22 October in channel-1, where its draft and written file
 * are, the model steps that start, read, record and finish it, and what people and admins can see of it (the draft's metadata, the audit
 * rows of its pauses, the Agent log's warnings). Each value is a literal the scenarios check against, never one the code computes.
 */
import { readFileSync } from "node:fs";
import { expect } from "bun:test";
import { until, type Scenario } from "./discordScenario";

export const FOLDER = "guilds/guild-1/channels/channel-1/files/changelogs/acme-api";
export const NAME = "2026-10-22_9f8e7d6..a1b2c3d";
export const DRAFT_FILE = `${FOLDER}/${NAME}.draft.json`, WRITTEN_FILE = `${FOLDER}/${NAME}.json`;
/** The draft's and the written changelog's paths as the tools give them. */
export const DRAFT = `channel/files/changelogs/acme-api/${NAME}.draft.json`, WRITTEN = `channel/files/changelogs/acme-api/${NAME}.json`;
export const BASE = "9f8e7d6".padEnd(40, "0"), HEAD = "a1b2c3d".padEnd(40, "0");
/** The skill's example operation and its components, a valid changelog entry (packages/skills/test/openapi-validate.test.ts checks it): four changes, breaking. */
export const FIXTURE = JSON.parse(readFileSync(new URL("../../../../packages/skills/test/fixtures/contract-diff/create-user.json", import.meta.url), "utf8"));
const { "x-impact": _impact, ...operation } = FIXTURE.paths["/api/v2/users"].post;
/** The example operation without its impact, which the tools set. */
export const OPERATION = operation;
export const CONTROLLER = "src/users/users.controller.ts";
/** The changed files whose patches startChangelog does not give: each is read whole before it is mapped. */
export const DTOS = ["a", "b", "c", "d", "e", "f"].map((n) => `src/users/dto/${n}.dto.ts`);
/** What every file of acme/api reads as, at any commit. */
export const SOURCE = "export class Dto {\n  full_name: string;\n  phone: string;\n}";
/** What a turn that goes on by itself is sent instead of a person's words (#361). */
export const DRAFT_TURN = "[No one wrote this: the API changelog is not written yet, so the work on it goes on by itself. Continue from where it stopped, building on what is already recorded; do not start over or repeat finished steps.]";
/** The router's answer when every model of the Profile failed. */
export const PROVIDER_DOWN = { error: "I can't reach the AI service right now. Try again in a moment." };

export const contractDiffOn = (s: Scenario) => s.availability({ level: "tenant" }, { kind: "playbook", name: "contract-diff", value: "on" });

/**
 * acme/api on GitHub, open in this channel (no threads), at `at` in Jakarta, its workers running one at a time: what each scenario's own
 * comparison goes with. main's last commit before 1 October is BASE and its last through any later day `head`, made at `headDate`; any file
 * reads as `source` at any commit.
 */
export async function acmeOnGitHub(s: Scenario, { at = "2026-10-22T10:00:00+07:00", head = HEAD, headDate = "2026-10-21T08:00:00Z", source = SOURCE } = {}) {
  await s.guildSettings({ language: "en", useThreads: false });
  s.clock.set(at);
  await s.git({ repos: ["acme/*"] });
  await contractDiffOn(s);
  expect((await s.admin("PUT", `/api/admin/tenants/${s.tenant.id}/settings`, { playbookWorkers: 1 })).status).toBe(200);
  s.http.on("GET api.github.com/repos/acme/api", () => ({ default_branch: "main" }));
  s.http.on("GET api.github.com/repos/acme/api/commits", (req) => (new URL(req.url).searchParams.get("until")! < "2026-10-01"
    ? [{ sha: BASE, commit: { committer: { date: "2026-09-29T08:00:00Z" } } }] : [{ sha: head, commit: { committer: { date: headDate } } }]));
  s.http.on("GET api.github.com/repos/acme/api/contents/", (req) => ({ type: "file", path: new URL(req.url).pathname.split("/contents/")[1], encoding: "base64", content: Buffer.from(source).toString("base64") }));
}

/**
 * acme/api on GitHub at 10:00 on 22 October in Jakarta, as acmeOnGitHub has it: between BASE and HEAD the controller changed, its patch
 * given, and the six DTOs; any file reads as SOURCE.
 */
export async function acmeApi(s: Scenario) {
  await acmeOnGitHub(s);
  process.env.PUBLIC_URL = "https://pachi.example.com";
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 3, behind_by: 0, commits: [], files: [
    { filename: CONTROLLER, status: "modified", patch: "@@ -10 +10 @@\n-  @Post()\n+  @Post('v2')" }, ...DTOS.map((filename) => ({ filename, status: "modified" })),
  ] }));
}

/** Starts the changelog from 1 October through today; `publish` asks for it to be published as it is written (#349). */
export const startChangelog = (extra: { publish?: boolean } = {}) => ({ tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01", ...extra } });
export const START = startChangelog();
/** Reads one changed DTO whole at head, so it can be mapped. */
export const read = (i: number) => ({ tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path: DTOS[i] } });
export const READ_REST = [1, 2, 3, 4, 5].map(read);
/** A changed file that reaches POST /api/v2/users, as putChangelogMapping takes it. */
export const reaches = (path: string, change: string) => ({ path, change, endpoints: [{ method: "post", path: "/api/v2/users" }] });
/** Has workers map the changed files neither mapped nor set aside: the main loop maps none itself (#370, ADR 0026). */
export const MAP_CHANGED = { tool: "mapChangedFiles", args: { draft: DRAFT } };
/** A mapping worker's steps once its files are read whole: it records how each ends, then answers. */
export const mapper = (...files: object[]) => [{ tool: "putChangelogMapping", args: { draft: DRAFT, files } }, "Mapped."];
/**
 * The mapping workers' steps for the DTOs given and the controller, each read whole already and each reaching POST /api/v2/users, so one
 * candidate whose note names each change (#366). A DTO, too large for a patch, is a group of its own, and the groups go by path: the DTOs,
 * then the controller.
 */
export const mappers = (dtos = [0, 1, 2, 3, 4, 5], controller = true) => [
  ...dtos.flatMap((i) => mapper(reaches(DTOS[i]!, "a body field changed"))), ...(controller ? mapper(reaches(CONTROLLER, "@Post() became @Post('v2')")) : []),
];
/** Every changed file's mapping worker, once all seven are read whole. */
export const MAPPED = mappers();
export const RECORD = [{ tool: "putChangelogComponents", args: { draft: DRAFT, components: FIXTURE.components } }, { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: OPERATION } }];
/** The repository's conventions summary, which the draft holds before any endpoint is traced (#365). */
export const WRITE_CONVENTIONS = { tool: "putChangelogNotes", args: { draft: DRAFT, conventions: "NestJS: routes from @Controller, no global prefix; bodies are returned as they are." } };
/** Traces the candidates mapping kept, once every changed file is mapped: traceEndpoints takes the draft alone (#369). */
export const TRACE = { tool: "traceEndpoints", args: { draft: DRAFT } };
/** The worker tracing POST /api/v2/users, the one candidate the changed files reach: it records the example operation and says so. */
export const WORKER = [RECORD, "Recorded POST /api/v2/users."];
export const FINISH = { tool: "finishChangelog", args: { draft: DRAFT } };
/** The model's answer once finishChangelog wrote the changelog, naming the path it was written to. */
export const written = (turn: any) => `The acme/api changelog is written: ${turn.toolResults.at(-1).path}`;

/** The draft's metadata as the Workspace holds it: this changelog's, or the draft `file`'s. */
export const draftMeta = async (s: Scenario, file = DRAFT_FILE) => JSON.parse((await s.workspace.read(file))!)["x-draft"];
/** The audit rows of the draft's pauses, oldest first. */
export const pauses = async (s: Scenario) => {
  const { repositories } = await import("@pachiware/db");
  return (await repositories().usage.list({ tenantId: s.tenant.id, type: "changelog_draft_paused" })).map((e: any) => e.metadata);
};
/** Every console line from now on is kept in the Agent log, as the agent process keeps it, for the console's logs API. */
export async function agentLog() {
  const { installAgentLog } = await import("../../src/logs/agentLog.ts");
  installAgentLog();
}
/** The changelog warnings of the Agent log, as the console's logs API lists them. */
export const warnings = async (s: Scenario) => (await s.admin("GET", "/api/admin/logs?level=warn&source=changelog")).body.entries.map((e: any) => e.text);
/**
 * The progress message's wait is shortened, so a slow turn shows it with its Stop button. Each scenario runs in a process of its own, so
 * the shortened timing never reaches another.
 */
export async function fastProgress() {
  const { progressTiming } = await import("../../src/discord/progress.ts");
  Object.assign(progressTiming, { showAfterMs: 150, everyMs: 40 });
}
export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** The turn's progress message, once it is up with its Stop button. */
export const progressUp = (s: Scenario) => s.discord.botMessages.find((m) => m.components.length);
/** Waits for the progress message to go up (fastProgress). */
export const progressShown = (s: Scenario) => until("the progress message", () => progressUp(s));
/** Waits for an edit of the progress message that shows every one of `lines`. */
export const progressShows = (s: Scenario, ...lines: string[]) =>
  until(`the progress message to show ${lines.join(" and ")}`, () => s.discord.botMessages.some((m) => m.edits.some((e) => lines.every((line) => (e.content ?? "").includes(line)))));
/** Once the progress message is up, the asker presses its Stop, kept in `clicks`; returns when the bot has taken it, and the button came off. */
export async function pressStop(s: Scenario, clicks: Promise<unknown>[]) {
  await progressShown(s);
  const progress = progressUp(s)!;
  clicks.push(s.discord.click(progress, "Stop"));
  await stopTaken(progress);
}
/** Waits for the bot to take the asker's Stop on `progress`: its button comes off. */
export const stopTaken = (progress: { components: unknown[] }) => until("the Stop to be taken", () => !progress.components.length);

/**
 * Shortens the turn to `turnMs` and the workers' budget for a scenario. Each scenario runs in a process of its own, so the shortened budgets
 * never reach another. Both are measured on the scenario's clock, which acmeOnGitHub pins: only a step that moves it spends them.
 */
export async function budgets(turnMs: number, worker: Partial<{ steps: number; ms: number; leastMs: number }>) {
  const { turnDeadline } = await import("../../src/loop/react.ts");
  const { workerBudget } = await import("../../../../packages/skills/src/openapi/workers.ts");
  turnDeadline.ms = turnMs;
  Object.assign(workerBudget, worker);
}
/** A turn has 2 seconds, and a worker starts only with at least 1.5 left: the turn of a worker answering `outlasting` starts no other. */
export const oneWorkerATurn = () => budgets(2000, { leastMs: 1500 });
/** A worker's last step, which takes 600 ms of its turn's time, so the turn has too little left to start another worker (oneWorkerATurn). */
export const outlasting = (s: Scenario, step: string) => () => { s.clock.advance(600); return step; };

/** What a message to the model says, as text. */
export const text = (message: any) => (typeof message?.content === "string" ? message.content : JSON.stringify(message?.content));
/** The first message after the system prompt: a worker's brief, or the turn's message. */
export const briefOf = (call: any[]) => text(call[1]);
/** Whether a model call is a mapping worker's (#370), or a tracing worker's (ADR 0024), by how its brief starts. */
export const isMapper = (call: any[]) => briefOf(call).startsWith("Map ");
export const isTracer = (call: any[]) => briefOf(call).startsWith("Trace one endpoint");
/** The first model call of each mapping worker, or tracing worker, in the order they started. */
export const mapperStarts = (s: Scenario) => s.model.calls.filter((call) => isMapper(call) && !call.some((m: any) => m.role === "assistant"));
export const tracerStarts = (s: Scenario) => s.model.calls.filter((call) => isTracer(call) && !call.some((m: any) => m.role === "assistant"));
/** The files a mapping worker's brief gives it: a range's changed files with their status, or the whole history's route files. */
export const filesOf = (call: any[]) => [...briefOf(call).matchAll(/^- (\S+)(?: \(|$)/gm)].map((m) => m[1]);
/** The endpoint a tracing worker's brief names. */
export const endpointOf = (call: any[]) => briefOf(call).match(/^Your endpoint: (.+)$/m)?.[1];
/** The tools a mapping worker is offered (#370), and a tracing worker (ADR 0024), whatever the place offers. */
export const MAPPER_TOOLS = ["putChangelogMapping", "repoFileDiff", "repoReadFile", "repoSearchCode", "repoTree"];
export const TRACER_TOOLS = ["putChangelogComponents", "putChangelogOperation", "repoFileDiff", "repoReadFile", "repoSearchCode", "repoTree"];
