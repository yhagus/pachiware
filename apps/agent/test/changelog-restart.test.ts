import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { discordScenario, type FakeMessage, type Scenario } from "./support/discordScenario";

const FOLDER = "guilds/guild-1/channels/channel-1/files/changelogs/acme-api";
const DRAFT_FILE = `${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`, WRITTEN_FILE = `${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.json`;
const DRAFT = "channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.draft.json", WRITTEN = DRAFT.replace(".draft.json", ".json");
const NAME = "2026-10-22_9f8e7d6..a1b2c3d";
const BASE = "9f8e7d6".padEnd(40, "0"), HEAD = "a1b2c3d".padEnd(40, "0");
/** The skill's example operation and its components, a valid changelog entry (packages/skills/test/openapi-validate.test.ts checks it). */
const FIXTURE = JSON.parse(readFileSync(new URL("../../../packages/skills/test/fixtures/contract-diff/create-user.json", import.meta.url), "utf8"));
const CONTROLLER = "src/users/users.controller.ts";
const DTOS = ["a", "b", "c", "d", "e", "f"].map((n) => `src/users/dto/${n}.dto.ts`);
const SOURCE = "export class Dto {\n  full_name: string;\n  phone: string;\n}";

/**
 * acme/api on GitHub, open in this channel (no threads), at 10:00 on 22 October in Jakarta: main's last commit through that day is HEAD,
 * its last before 1 October BASE. Between them the controller changed and six DTOs; any file reads as SOURCE.
 */
async function acmeApi(s: Scenario) {
  await s.guildSettings({ language: "en", useThreads: false });
  s.clock.set("2026-10-22T10:00:00+07:00");
  await s.git({ repos: ["acme/*"] });
  await s.availability({ level: "tenant" }, { kind: "playbook", name: "contract-diff", value: "on" });
  s.http.on("GET api.github.com/repos/acme/api", () => ({ default_branch: "main" }));
  s.http.on("GET api.github.com/repos/acme/api/commits", (req) => (new URL(req.url).searchParams.get("until")! < "2026-10-01"
    ? [{ sha: BASE, commit: { committer: { date: "2026-09-29T08:00:00Z" } } }] : [{ sha: HEAD, commit: { committer: { date: "2026-10-21T08:00:00Z" } } }]));
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 3, behind_by: 0, commits: [], files: [
    { filename: CONTROLLER, status: "modified", patch: "@@ -10 +10 @@\n-  @Post()\n+  @Post('v2')" }, ...DTOS.map((filename) => ({ filename, status: "modified" })),
  ] }));
  s.http.on("GET api.github.com/repos/acme/api/contents/", (req) => ({ type: "file", path: new URL(req.url).pathname.split("/contents/")[1], encoding: "base64", content: Buffer.from(SOURCE).toString("base64") }));
}
const START = { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } };
/** Reads one changed DTO whole at head, which examines it. */
const read = (i: number) => ({ tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path: DTOS[i] } });
const READ_REST = [1, 2, 3, 4, 5].map(read);
const { "x-impact": _impact, ...OPERATION } = FIXTURE.paths["/api/v2/users"].post;
const RECORD = [{ tool: "putChangelogComponents", args: { draft: DRAFT, components: FIXTURE.components } }, { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: OPERATION } }];
const FINISH = { tool: "finishChangelog", args: { draft: DRAFT } };
const written = (turn: any) => `The acme/api changelog is written: ${turn.toolResults.at(-1).path}`;
const draftMeta = async (s: Scenario) => JSON.parse((await s.workspace.read(DRAFT_FILE))!)["x-draft"];
const DRAFT_TURN = "[No one wrote this: the API changelog is not written yet, so the work on it goes on by itself. Continue from where it stopped, building on what is already recorded; do not start over or repeat finished steps.]";
const STOP_ROW = { type: 1, components: [{ type: 2, custom_id: `changelogstop:${NAME}`, label: "Stop", style: 2 }] };

/**
 * Alice's Changelog draft of acme/api as an agent process that ended in the middle of the work leaves it: worked on, the controller and
 * the first DTO examined, and the progress message the bot showed for it, with its Stop button. `touched` is how long ago the work last
 * changed the draft.
 */
async function leftWorkedOn(s: Scenario, { work = { state: "worked-on" } as object, touched = 0, place = "channel-1" } = {}): Promise<FakeMessage> {
  const [progress] = s.discord.history([{ content: "Working · 12 min\n-# ✓ Read src/users/dto/a.dto.ts", author: { id: s.discord.botUserId, name: "Pachiware", bot: true } }], { channel: place });
  progress!.components = [STOP_ROW];
  const changelog = { date: "2026-10-22", base: { ref: "main before 2026-10-01", commit: "9f8e7d6" }, head: { ref: "main through 2026-10-22", commit: "a1b2c3d" }, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, globalChanges: [], removedOperations: [], unverified: [] };
  await s.workspace.write(DRAFT_FILE.replace("channel-1", place), JSON.stringify({
    openapi: "3.1.2", info: { title: "acme/api API changes", version: "a1b2c3d", "x-changelog": changelog }, paths: {}, components: {},
    "x-draft": {
      repo: "acme/api", branch: "main", scope: "range", from: "2026-10-01", to: "2026-10-22", place, startedBy: { id: "user-alice", name: "Alice" }, changedFiles: 7,
      base: BASE, head: HEAD, files: [CONTROLLER, ...DTOS].map((path) => ({ path, status: "modified" })), examined: [CONTROLLER, DTOS[0]],
      touchedAt: new Date(s.clock.now() - touched).toISOString(), work, progressMessage: { channelId: place, messageId: progress!.id },
    },
  }));
  return progress!;
}

discordScenario("a draft an earlier agent process left worked on goes on by itself once the bot is back, in the progress message it showed, with no other message until the end (#362)", async (s) => {
  await acmeApi(s);
  const progress = await leftWorkedOn(s);
  s.model.script(READ_REST, RECORD, FINISH, written);
  await s.restart();

  expect(s.model.calls).toHaveLength(4);
  expect(String(s.model.calls[0]!.at(-2)!.content)).toStartWith(DRAFT_TURN);
  const [shown, answer, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(shown!.id).toBe(progress.id);
  expect(shown).toMatchObject({ content: expect.stringMatching(/^-# 🧠 Done in /), components: [] });
  expect(answer).toMatchObject({ content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, allowedMentions: { users: ["user-alice"] } });
  expect(await s.workspace.list(FOLDER)).toEqual([WRITTEN_FILE]);
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PROVIDER_DOWN = { error: "I can't reach the AI service right now. Try again in a moment." };
const PAUSED = "Paused with 2 of 7 changed files done. Say go on when you want the rest.";
// The progress message's wait is shortened, so a slow turn shows it with its Stop button.
async function fastProgress() {
  const { progressTiming } = await import("../src/discord/progress.ts");
  Object.assign(progressTiming, { showAfterMs: 150, everyMs: 40 });
}

discordScenario("after a restart, work whose progress message was deleted shows in a new one that the draft keeps, and its asker's Stop pauses it (#362)", async (s) => {
  await acmeApi(s);
  await s.discord.deleteMessage(await leftWorkedOn(s));
  const clicks: Promise<any>[] = [];
  s.model.script(
    async () => { await pause(100); clicks.push(s.discord.click(s.discord.botMessages.find((m) => m.components.length)!, "Stop")); await pause(50); return read(1); },
    PAUSED,
  );
  await s.restart();
  const [click] = await Promise.all(clicks);

  expect(click.responses.map((r: any) => r.kind)).toEqual(["update"]);
  expect(s.model.calls).toHaveLength(2);
  const [progress, answer, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(progress).toMatchObject({ content: expect.stringMatching(/^-# ⏸️ Paused after /), components: [] });
  expect(answer).toMatchObject({ content: `<@user-alice> ${PAUSED}`, allowedMentions: { users: ["user-alice"] } });
  expect(await draftMeta(s)).toMatchObject({ progressMessage: { channelId: "channel-1", messageId: progress!.id }, work: { state: "paused", reason: "stopped" } });
});

discordScenario("after a restart, the asker's Stop on work waiting on a model retry pauses the draft, so the retry never runs, and its progress message says it paused; anyone else's Stop is refused (#362)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  s.model.script(START, "Started the acme/api changelog.", async () => { await pause(300); return read(0); }, PROVIDER_DOWN);
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  const [progress] = s.discord.botMessages;
  await s.restart();

  const bob = await s.discord.click(progress!, "Stop", { user: s.discord.bob });
  const alice = await s.discord.click(progress!, "Stop");
  s.clock.advance(60_000);
  await s.scheduler.tick();

  expect(bob.responses).toEqual([{ kind: "reply", payload: expect.objectContaining({ content: "Only Alice can stop this.", ephemeral: true }) }]);
  expect(alice.responses.map((r: any) => r.kind)).toEqual(["update"]);
  expect(progress).toMatchObject({ content: expect.stringMatching(/^-# ⏸️ Paused after /), components: [] });
  expect(s.model.calls).toHaveLength(4);
  expect(s.discord.botMessages).toEqual([progress]);
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "stopped", since: "2026-10-22T03:00:00.000Z" });
});

discordScenario("a model retry pending when the bot restarted runs at its time from a scheduler pass, in the same progress message, and the work goes on to the end (#362)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  s.model.script(
    START, "Started the acme/api changelog.",
    async () => { await pause(300); return read(0); }, PROVIDER_DOWN,
    READ_REST, RECORD, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  const [progress] = s.discord.botMessages;
  await s.restart();
  s.clock.advance(59_000);
  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(4);

  s.clock.advance(1_000);
  await s.scheduler.tick();

  expect(s.model.calls).toHaveLength(8);
  expect(String(s.model.calls[4]!.at(-2)!.content)).toStartWith(DRAFT_TURN);
  const [shown, answer, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(shown!.id).toBe(progress!.id);
  expect(shown).toMatchObject({ content: expect.stringMatching(/^-# 🧠 Done in /), components: [] });
  expect(answer).toMatchObject({ content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, allowedMentions: { users: ["user-alice"] } });
});

discordScenario("a model retry pending when the bot restarted that fails again pauses the draft, naming only the AI model (#362)", async (s) => {
  await acmeApi(s);
  s.model.script(START, "Started the acme/api changelog.", PROVIDER_DOWN, PROVIDER_DOWN);
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await s.restart();
  s.clock.advance(60_000);
  await s.scheduler.tick();

  expect(s.model.calls).toHaveLength(4);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: "<@user-alice> The AI model can't be reached; say go on to carry on.", pinged: ["user-alice"] },
  ]);
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "model", since: "2026-10-22T03:01:00.000Z" });
});

discordScenario("a scheduler pass adds no turn to work whose turn is running, and a restart in the middle of a turn leaves the work to the pass after it, never to two chains (#362)", async (s) => {
  await acmeApi(s);
  const passes: Promise<void>[] = [];
  let restarted: Promise<void> | undefined;
  s.model.script(
    START, "Started the acme/api changelog.",
    async () => { passes.push(s.scheduler.tick()); await pause(50); return read(0); }, "Read the first DTO.",
    async () => { restarted = s.restart(); await pause(50); return read(1); }, "Read the second DTO.",
    READ_REST.slice(1), RECORD, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await Promise.all([...passes, restarted]);

  // The turn that was running when the bot restarted ended; the work it handed on gave way, as the bot's start left the busy place alone.
  expect(s.model.calls).toHaveLength(6);
  expect(s.discord.botMessages).toEqual([]);
  expect((await draftMeta(s)).work).toEqual({ state: "worked-on" });

  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(10);
  expect(String(s.model.calls[6]!.at(-2)!.content)).toStartWith(DRAFT_TURN);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([`<@user-alice> The acme/api changelog is written: ${WRITTEN}`]);
});

discordScenario("neither a paused draft nor a worked-on one untouched for seven days is woken by a restart or a scheduler pass; the untouched one is dropped as before (#362)", async (s) => {
  await acmeApi(s);
  const paused = await leftWorkedOn(s, { work: { state: "paused", reason: "model", since: "2026-10-22T02:00:00.000Z" } });
  const untouched = await leftWorkedOn(s, { place: "channel-2", touched: 7 * 24 * 3600_000 + 60_000 });
  await s.restart();
  s.clock.advance(3600_000);
  await s.scheduler.tick();

  expect(s.model.calls).toEqual([]);
  expect(s.discord.botMessages).toEqual([paused, untouched]);
  expect(paused.edits).toEqual([]);
  expect(untouched.edits).toEqual([]);
  expect(await s.workspace.list(FOLDER)).toEqual([DRAFT_FILE]);
  expect(await s.workspace.files("guilds/guild-1/channels/channel-2")).toEqual([]);
  const { repositories } = await import("@pachiware/db");
  const expired = (await repositories().usage.list({ tenantId: s.tenant.id, type: "changelog_draft_expired" })).map((e: any) => e.metadata);
  expect(expired).toEqual([expect.objectContaining({ repo: "acme/api", branch: "main", touchedAt: "2026-10-15T02:59:00.000Z" })]);
});

discordScenario("a turn that goes on by itself and fails posts nothing and counts as a turn without progress: the second in a row pauses the draft with one line pinging the asker, and no scheduler pass wakes it again (#357, #362)", async (s) => {
  await acmeApi(s);
  const progress = await leftWorkedOn(s);
  const broken = () => { throw new Error("socket hang up"); };
  s.model.script(broken, broken);
  await s.restart();
  s.clock.advance(60_000);
  await s.scheduler.tick();

  expect(s.model.calls).toHaveLength(2);
  const [shown, answer, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(shown!.id).toBe(progress.id);
  expect(shown).toMatchObject({ content: expect.stringMatching(/^-# ⏸️ Paused after /), components: [] });
  expect(answer).toMatchObject({ content: '<@user-alice> The changelog made no progress, so I paused it; type "go on" to continue.', allowedMentions: { users: ["user-alice"] } });
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "no-progress", since: "2026-10-22T03:00:00.000Z" });
  // What failed is the console's: each failed turn's audit row.
  const { repositories } = await import("@pachiware/db");
  const failed = (await repositories().usage.list({ tenantId: s.tenant.id, type: "turn_failed" })).map((e: any) => e.metadata);
  expect(failed).toEqual([expect.objectContaining({ channelId: "channel-1", message: "socket hang up" }), expect.objectContaining({ channelId: "channel-1", message: "socket hang up" })]);
});
