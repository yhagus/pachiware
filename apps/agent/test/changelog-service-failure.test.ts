import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { discordScenario, type Scenario } from "./support/discordScenario";

const FOLDER = "guilds/guild-1/channels/channel-1/files/changelogs/acme-api";
const DRAFT_FILE = `${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`, WRITTEN_FILE = `${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.json`;
const DRAFT = "channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.draft.json", WRITTEN = DRAFT.replace(".draft.json", ".json");
const BASE = "9f8e7d6".padEnd(40, "0"), HEAD = "a1b2c3d".padEnd(40, "0");
/** The skill's example operation and its components, a valid changelog entry (packages/skills/test/openapi-validate.test.ts checks it). */
const FIXTURE = JSON.parse(readFileSync(new URL("../../../packages/skills/test/fixtures/contract-diff/create-user.json", import.meta.url), "utf8"));
/** The changed files, none with a patch given: each is examined by reading it whole. */
const DTOS = ["a", "b", "c"].map((n) => `src/users/dto/${n}.dto.ts`);
const SOURCE = "export class Dto {\n  full_name: string;\n  phone: string;\n}";
const PROJECT = "gitlab.com/api/v4/projects/acme%2Fapi";
/** The repository itself, and no request under it. */
const THE_PROJECT = /^GET https:\/\/gitlab\.com\/api\/v4\/projects\/acme%2Fapi$/;

/**
 * acme/api on GitLab, open in this channel (no threads): main's last commit through 22 October is HEAD, its last before 1 October BASE, and
 * the three DTOs changed between them. Any file reads as SOURCE at any ref.
 */
async function acmeOnGitLab(s: Scenario) {
  await s.guildSettings({ language: "en", useThreads: false });
  s.clock.set("2026-10-22T10:00:00+07:00");
  await s.git({ provider: "gitlab", repos: ["acme/*"] });
  await s.availability({ level: "tenant" }, { kind: "playbook", name: "contract-diff", value: "on" });
  s.http.on(THE_PROJECT, () => ({ default_branch: "main" }));
  s.http.on(`GET ${PROJECT}/repository/commits`, (req) => (new URL(req.url).searchParams.get("until")! < "2026-10-01"
    ? [{ id: BASE, committed_date: "2026-09-29T08:00:00Z" }] : [{ id: HEAD, committed_date: "2026-10-21T08:00:00Z" }]));
  s.http.on(`GET ${PROJECT}/repository/compare`, () => ({ commits: [], diffs: DTOS.map((path) => ({ new_path: path, old_path: path, new_file: false, deleted_file: false, renamed_file: false })) }));
  s.http.on(`GET ${PROJECT}/repository/files/`, () => ({ content: Buffer.from(SOURCE).toString("base64") }));
}
const START = { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } };
/** Reads a changed DTO whole at head, which examines it. */
const read = (i: number) => ({ tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path: DTOS[i] } });
const { "x-impact": _impact, ...OPERATION } = FIXTURE.paths["/api/v2/users"].post;
const RECORD = [{ tool: "putChangelogComponents", args: { draft: DRAFT, components: FIXTURE.components } }, { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: OPERATION } }];
const FINISH = { tool: "finishChangelog", args: { draft: DRAFT } };
const ASK = `changelog acme/api from 1 to 22 October`;
type Step = Parameters<Scenario["model"]["script"]>[number];
/** GitLab's answer to every file read from now on. */
const filesAnswer = (s: Scenario, respond: () => Response) => s.http.on(`GET ${PROJECT}/repository/files/`, respond);
const badGateway = () => new Response("Bad Gateway", { status: 502 });

const draftMeta = async (s: Scenario) => JSON.parse((await s.workspace.read(DRAFT_FILE))!)["x-draft"];
/** Every console line from now on is kept in the Agent log, as the agent process keeps it, for the console's logs API. */
async function agentLog() {
  const { installAgentLog } = await import("../src/logs/agentLog.ts");
  installAgentLog();
}
const warnings = async (s: Scenario) => (await s.admin("GET", "/api/admin/logs?level=warn&source=changelog")).body.entries.map((e: any) => e.text);
const pauses = async (s: Scenario) => {
  const { repositories } = await import("@pachiware/db");
  return (await repositories().usage.list({ tenantId: s.tenant.id, type: "changelog_draft_paused" })).map((e: any) => e.metadata);
};
/** What the asker reads when GitLab failed for good: the service and how to go on, never its host, status or error. */
const PAUSED = '<@user-alice> Changelog paused: GitLab could not be reached. Type "go on" to continue.';

discordScenario("GitLab failing with a 502 three times in a row pauses the draft, naming only GitLab; the console has the host, status, error, tool and file (#359)", async (s) => {
  await acmeOnGitLab(s);
  await agentLog();
  s.model.script(
    START, "Started the acme/api changelog.",
    () => { filesAnswer(s, badGateway); return read(0); }, read(1), read(2),
  );
  await s.discord.send(`${s.discord.mention} ${ASK}`);

  // The third 502 ends the turn: the model is asked nothing more.
  expect(s.model.calls).toHaveLength(5);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([{ content: PAUSED, pinged: ["user-alice"] }]);
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "service", service: "GitLab", since: "2026-10-22T03:00:00.000Z" });
  expect(await pauses(s)).toEqual([expect.objectContaining({
    reason: "service", service: "GitLab", repo: "acme/api", branch: "main", draft: "2026-10-22_9f8e7d6..a1b2c3d", channelId: "channel-1",
    host: "gitlab.com", status: 502, error: "gitlab returned 502: Bad Gateway", tool: "repoReadFile", file: DTOS[2],
  })]);
  expect(await warnings(s)).toEqual([expect.stringMatching(/^Paused acme\/api \(branch main, draft 2026-10-22_9f8e7d6\.\.a1b2c3d\) in channel channel-1: service, GitLab .*"host":"gitlab\.com","status":502/)]);
  // No model failure: no retry waits (#358), and the turn the service ended is no closing summary (#360).
  expect((await draftMeta(s)).closingSummary).toBe("Started the acme/api changelog.");
  s.clock.advance(60_000);
  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(5);
});

discordScenario("GitLab refusing the bot's key (401) pauses the draft at once, naming only GitLab (#359)", async (s) => {
  await acmeOnGitLab(s);
  s.model.script(
    START, "Started the acme/api changelog.",
    () => { filesAnswer(s, () => Response.json({ message: "401 Unauthorized" }, { status: 401 })); return read(0); },
  );
  await s.discord.send(`${s.discord.mention} ${ASK}`);

  expect(s.model.calls).toHaveLength(3);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([{ content: PAUSED, pinged: ["user-alice"] }]);
  expect((await draftMeta(s)).work).toMatchObject({ state: "paused", reason: "service", service: "GitLab" });
  expect(await pauses(s)).toEqual([expect.objectContaining({ reason: "service", service: "GitLab", host: "gitlab.com", status: 401, error: 'gitlab returned 401: {"message":"401 Unauthorized"}', tool: "repoReadFile", file: DTOS[0] })]);
});

discordScenario("a turn that asked its asker and then read through a refusing GitLab posts the question and keeps it as its closing summary; the draft waits for the answer, not for GitLab (#356, #359, #360)", async (s) => {
  await acmeOnGitLab(s);
  const question = "Is src/users/dto/c.dto.ts still served, or can it be set aside?";
  s.model.script(
    START, "Started the acme/api changelog.",
    () => { filesAnswer(s, () => Response.json({ message: "401 Unauthorized" }, { status: 401 })); return [{ tool: "askChangelogAsker", args: { draft: DRAFT, question } }, read(0)]; },
  );
  await s.discord.send(`${s.discord.mention} ${ASK}`);

  expect(s.model.calls).toHaveLength(3);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([{ content: `<@user-alice> ${question}`, pinged: ["user-alice"] }]);
  const meta = await draftMeta(s);
  expect(meta.work).toEqual({ state: "paused", reason: "question", question, since: "2026-10-22T03:00:00.000Z" });
  expect(meta.closingSummary).toBe(question);
  expect((await pauses(s)).map((p: any) => p.reason)).toEqual(["question"]);
});

discordScenario("the draft's repository gone from GitLab pauses the draft, naming only GitLab, though GitLab answers 404 for it as for a file (#359)", async (s) => {
  await acmeOnGitLab(s);
  const notFound = (what: string) => () => Response.json({ message: `404 ${what} Not Found` }, { status: 404 });
  s.model.script(
    START, "Started the acme/api changelog.",
    () => {
      s.http.on(THE_PROJECT, notFound("Project"));
      s.http.on(`GET ${PROJECT}/repository/`, notFound("Project"));
      return read(0);
    },
  );
  await s.discord.send(`${s.discord.mention} ${ASK}`);

  expect(s.model.calls).toHaveLength(3);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([PAUSED]);
  expect(await pauses(s)).toEqual([expect.objectContaining({ reason: "service", service: "GitLab", host: "gitlab.com", status: 404, error: "Repository acme/api not found or not accessible", tool: "repoReadFile", file: DTOS[0] })]);
});

discordScenario("the draft's branch gone from GitLab pauses the draft, naming only GitLab (#359)", async (s) => {
  await acmeOnGitLab(s);
  s.model.script(
    START, "Started the acme/api changelog.",
    // main is deleted: it lists no commit, and GitLab knows no such branch.
    () => {
      s.http.on(`GET ${PROJECT}/repository/commits`, () => []);
      s.http.on(`GET ${PROJECT}/repository/branches/main`, () => Response.json({ message: "404 Branch Not Found" }, { status: 404 }));
      return START;
    },
  );
  await s.discord.send(`${s.discord.mention} ${ASK}`);

  expect(s.model.calls).toHaveLength(3);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([PAUSED]);
  expect(await pauses(s)).toEqual([expect.objectContaining({ reason: "service", service: "GitLab", host: "gitlab.com", status: 404, error: "Branch main not found in acme/api", tool: "startChangelog" })]);
});

discordScenario("two 502s then a read that succeeds, and a file that does not exist, stay the model's to handle: the work goes on to the end (#359)", async (s) => {
  await acmeOnGitLab(s);
  const MISSING = "src/users/dto/gone.dto.ts";
  const ok = () => Response.json({ content: Buffer.from(SOURCE).toString("base64") });
  // Four 502s, never three in a row: a read that succeeds comes after each two.
  const answers = [badGateway, badGateway, ok, badGateway, badGateway, ok];
  const seen: unknown[] = [];
  const saw = (step: Step): Step => (turn) => { seen.push(turn.toolResults.at(-1)); return step; };
  s.model.script(
    START, "Started the acme/api changelog.",
    () => {
      s.http.on(`GET ${PROJECT}/repository/files/`, (req) => (req.url.includes(encodeURIComponent(MISSING)) ? Response.json({ message: "404 File Not Found" }, { status: 404 }) : (answers.shift() ?? ok)()));
      s.http.on(`GET ${PROJECT}/repository/tree`, () => []);
      return read(0);
    },
    saw(read(0)), read(0), read(1), read(1), read(1),
    { tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path: MISSING } }, saw(read(2)),
    RECORD, FINISH, `The acme/api changelog is written: ${WRITTEN}`,
  );
  await s.discord.send(`${s.discord.mention} ${ASK}`);

  expect(seen).toEqual([{ error: "gitlab returned 502: Bad Gateway" }, { error: `${MISSING} not found at ${HEAD}` }]);
  expect(s.model.calls).toHaveLength(13);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([`<@user-alice> The acme/api changelog is written: ${WRITTEN}`]);
  expect(await s.workspace.list(FOLDER)).toEqual([WRITTEN_FILE]);
  expect(await pauses(s)).toEqual([]);
});
