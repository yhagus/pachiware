import { afterEach, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { BASE, DRAFT, FINISH, HEAD, START, contractDiffOn, draftMeta } from "./support/changelog";

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
