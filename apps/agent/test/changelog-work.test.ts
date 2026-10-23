import { afterEach, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { discordScenario, type Scenario } from "./support/discordScenario";

const FOLDER = "guilds/guild-1/channels/channel-1/files/changelogs/acme-api";
const DRAFT_FILE = `${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`, WRITTEN_FILE = `${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.json`;
const DRAFT = "channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.draft.json", WRITTEN = DRAFT.replace(".draft.json", ".json");
const BASE = "9f8e7d6".padEnd(40, "0"), HEAD = "a1b2c3d".padEnd(40, "0");
/** The skill's example operation and its components, a valid changelog entry (packages/skills/test/openapi-validate.test.ts checks it). */
const FIXTURE = JSON.parse(readFileSync(new URL("../../../packages/skills/test/fixtures/contract-diff/create-user.json", import.meta.url), "utf8"));
/** The changed files whose patches startChangelog does not give: each is examined by reading it whole. */
const DTOS = ["a", "b", "c", "d", "e", "f"].map((n) => `src/users/dto/${n}.dto.ts`);
const SOURCE = "export class Dto {\n  full_name: string;\n  phone: string;\n}";
const contractDiffOn = (s: Scenario) => s.availability({ level: "tenant" }, { kind: "playbook", name: "contract-diff", value: "on" });

/**
 * acme/api on GitHub, open in this channel (no threads): main's last commit through 22 October is HEAD, its last before 1 October BASE.
 * Between them the controller changed, its patch given, and the six DTOs; any file reads as SOURCE at any ref.
 */
async function acmeApi(s: Scenario) {
  await s.guildSettings({ language: "en", useThreads: false });
  s.clock.set("2026-10-22T10:00:00+07:00");
  process.env.PUBLIC_URL = "https://pachi.example.com";
  await s.git({ repos: ["acme/*"] });
  await contractDiffOn(s);
  s.http.on("GET api.github.com/repos/acme/api", () => ({ default_branch: "main" }));
  s.http.on("GET api.github.com/repos/acme/api/commits", (req) => (new URL(req.url).searchParams.get("until")! < "2026-10-01"
    ? [{ sha: BASE, commit: { committer: { date: "2026-09-29T08:00:00Z" } } }] : [{ sha: HEAD, commit: { committer: { date: "2026-10-21T08:00:00Z" } } }]));
  s.http.on(`GET api.github.com/repos/acme/api/compare/${BASE}...${HEAD}`, () => ({ ahead_by: 3, behind_by: 0, commits: [], files: [
    { filename: "src/users/users.controller.ts", status: "modified", patch: "@@ -10 +10 @@\n-  @Post()\n+  @Post('v2')" }, ...DTOS.map((filename) => ({ filename, status: "modified" })),
  ] }));
  s.http.on("GET api.github.com/repos/acme/api/contents/", (req) => ({ type: "file", path: new URL(req.url).pathname.split("/contents/")[1], encoding: "base64", content: Buffer.from(SOURCE).toString("base64") }));
}
const START = { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01", publish: true } };
/** Reads one changed DTO whole at head, which examines it. */
const read = (i: number) => ({ tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path: DTOS[i] } });
const READ_REST = [1, 2, 3, 4, 5].map(read);
const { "x-impact": _impact, ...OPERATION } = FIXTURE.paths["/api/v2/users"].post;
const RECORD = [{ tool: "putChangelogComponents", args: { draft: DRAFT, components: FIXTURE.components } }, { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: OPERATION } }];
const FINISH = { tool: "finishChangelog", args: { draft: DRAFT } };
const written = (turn: any) => `The acme/api changelog is written: ${turn.toolResults.at(-1).path}`;

/** Alice's open Changelog draft of acme/api from before work states, started in `place` (a public thread shares its channel's folder), with one of its three changed files examined. */
async function aliceDraft(s: Scenario, place = "channel-1") {
  const changelog = { date: "2026-10-22", base: { ref: "main before 2026-10-01", commit: "9f8e7d6" }, head: { ref: "main through 2026-10-22", commit: "a1b2c3d" }, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, globalChanges: [], removedOperations: [], unverified: [] };
  await s.workspace.write(DRAFT_FILE, JSON.stringify({
    openapi: "3.1.2", info: { title: "acme/api API changes", version: "a1b2c3d", "x-changelog": changelog }, paths: {}, components: {},
    "x-draft": {
      repo: "acme/api", branch: "main", scope: "range", from: "2026-10-01", to: "2026-10-22", place, startedBy: { id: "user-alice", name: "Alice" }, changedFiles: 3,
      base: BASE, head: HEAD, files: [{ path: "a.ts", status: "modified" }, { path: "b.ts", status: "modified" }, { path: "c.ts", status: "modified" }], examined: ["a.ts"],
      touchedAt: new Date().toISOString(),
    },
  }));
}
const draftMeta = async (s: Scenario) => JSON.parse((await s.workspace.read(DRAFT_FILE))!)["x-draft"];

// The progress message's wait is shortened, so a slow turn shows it with its Stop button.
let shippedProgress: { showAfterMs: number; everyMs: number } | undefined;
async function fastProgress() {
  const { progressTiming } = await import("../src/discord/progress.ts");
  shippedProgress ??= { ...progressTiming };
  Object.assign(progressTiming, { showAfterMs: 150, everyMs: 40 });
}
afterEach(async () => {
  if (!shippedProgress) return;
  Object.assign((await import("../src/discord/progress.ts")).progressTiming, shippedProgress);
  shippedProgress = undefined;
});
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** A step's wait for the progress message, then `user` presses its Stop button; the click settles once the bot is idle again. */
const pressStop = (s: Scenario, clicks: Promise<unknown>[], user?: { id: string; name: string }) => async () => {
  await pause(400);
  clicks.push(s.discord.click(s.discord.botMessages.find((m) => m.components.length)!, "Stop", user ? { user } : {}));
  await pause(50);
};
const buttonsOf = (m: any): string[] => m.components.flatMap((row: any) => row.components.map((c: any) => c.custom_id));

/** Each of a chat turn's model calls may be a step, so a turn that asks for tools twice is cut by its budget and ends with a summary. */
async function twoSteps(s: Scenario) {
  const { repositories } = await import("@pachiware/db");
  await repositories().agentConfig.update(s.tenant.id, { settings: { maxReActIterations: 2 } });
}
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
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const DRAFT_TURN = "[No one wrote this: the API changelog is not written yet, so the work on it goes on by itself. Continue from where it stopped, building on what is already recorded; do not start over or repeat finished steps.]";

discordScenario("a turn that goes on by itself needs only its place and asker: with the message that started the work deleted, the final answer is a new message in the channel (#355)", async (s) => {
  await acmeApi(s);
  s.model.script(
    // Alice deletes her message while the first turn works; Discord refuses a reply to a deleted message.
    () => { void s.discord.deleteMessage(s.discord.channel("channel-1").messages.find((m) => !m.author.bot)!); return START; }, "Started the acme/api changelog.",
    [read(0), ...READ_REST], RECORD, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October, then publish it`);

  expect(s.model.calls).toHaveLength(6);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, reference: m.reference }))).toEqual([{ content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, reference: undefined }]);
});

discordScenario("the draft keeps where its progress message is, the one message the turns that go on by themselves edit (#355)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  let kept: unknown;
  s.model.script(
    START, "Started the acme/api changelog.",
    async () => { await pause(300); return read(0); }, "Read the first DTO.",
    async () => { kept = (await draftMeta(s)).progressMessage; await pause(100); return READ_REST; }, RECORD, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  const [progress, answer, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(answer!.content).toBe(`<@user-alice> The acme/api changelog is written: ${WRITTEN}`);
  expect(progress!.content).toMatch(/^-# 🧠 Done in /);
  expect(progress!.edits.map((e) => e.content).join("\n")).toContain("2 of 7 changed files done");
  expect(kept).toEqual({ channelId: "channel-1", messageId: progress!.id });
});

discordScenario("the Stop button names the draft: only its asker can press it, also on someone else's turn going on with it, and it cuts that turn at its next tool call (#355)", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  await contractDiffOn(s);
  await aliceDraft(s);
  await fastProgress();
  const buttons: string[] = [], clicks: Promise<any>[] = [];
  const notes = { tool: "putChangelogNotes", args: { draft: DRAFT, unverified: [] } };
  s.model.script(
    notes,
    async () => {
      await pause(400);
      const progress = s.discord.botMessages.find((m) => m.components.length)!;
      buttons.push(...buttonsOf(progress));
      clicks.push(s.discord.click(progress, "Stop", { user: s.discord.bob }));
      await pause(50);
      clicks.push(s.discord.click(progress, "Stop"));
      await pause(50);
      return notes;
    },
    "Paused with 1 of 3 changed files done.",
  );
  // Bob goes on with Alice's changelog: it is still hers to stop.
  await s.discord.send(`${s.discord.mention} lanjut changelog-nya`, { author: s.discord.bob });
  const [bob, alice] = await Promise.all(clicks);

  expect(buttons).toEqual(["changelogstop:2026-10-22_9f8e7d6..a1b2c3d"]);
  expect(bob.responses).toEqual([{ kind: "reply", payload: expect.objectContaining({ content: "Only Alice can stop this.", ephemeral: true }) }]);
  expect(alice.responses.map((r: any) => r.kind)).toEqual(["update"]);
  expect(s.model.calls).toHaveLength(3);
  expect(String(s.model.calls[2]!.findLast((m: any) => m.role === "tool")!.content)).toContain("This tool call was not run: the person stopped the turn.");
  expect(s.discord.botMessages.at(-1)).toMatchObject({ content: "<@user-alice> Paused with 1 of 3 changed files done.", allowedMentions: { users: ["user-alice"] } });
  expect(await s.workspace.list(FOLDER)).toEqual([DRAFT_FILE]);
});

discordScenario("one request whose work spans many turns, cut by their budget or ended by the model, is written and published without a lanjut; only the final answer is posted, pinging the asker (#361)", async (s) => {
  await acmeApi(s);
  await twoSteps(s);
  let link = "";
  s.model.script(
    START, "Started the acme/api changelog.",
    read(0), "Read the first DTO.",
    read(1), read(2), "Two more DTOs read.",
    read(3), "Read another DTO.",
    read(4), read(5), "Every DTO read.",
    RECORD, "Recorded POST /api/v2/users.",
    FINISH, (turn) => { link = turn.toolResults.at(-1).published.url; return `The acme/api changelog is written and published: ${link}`; },
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October, then publish it`);

  // Seven turns, six of them going on by themselves: no cap of five, and each a host line, never a person's.
  expect(s.model.calls).toHaveLength(16);
  expect(s.model.calls[2]!.at(-2)!.content).toStartWith(DRAFT_TURN);
  expect(link).toMatch(new RegExp(`^https://pachi\\.example\\.com/open-api/${UUID}$`));
  expect(s.discord.botMessages).toEqual([expect.objectContaining({ content: `<@user-alice> The acme/api changelog is written and published: ${link}`, allowedMentions: { users: ["user-alice"] } })]);
  expect(await s.workspace.list(FOLDER)).toEqual([WRITTEN_FILE]);
});

discordScenario("the asker's Stop pauses the draft at the running turn's next tool call: the pause answer pings them, the progress message says it paused, and the console has why (#361)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  await agentLog();
  const clicks: Promise<unknown>[] = [];
  const stop = pressStop(s, clicks);
  s.model.script(
    START, "Started the acme/api changelog.",
    read(0), async () => { await stop(); return read(1); },
    "Paused with 2 of 7 changed files done. Say go on when you want the rest.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await Promise.all(clicks);

  expect(s.model.calls).toHaveLength(5);
  expect(String(s.model.calls[4]!.find((m: any) => m.role === "tool" && String(m.content).includes("not run"))!.content)).toContain("This tool call was not run: the person stopped the turn.");
  const [progress, answer, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(progress).toMatchObject({ content: expect.stringMatching(/^-# ⏸️ Paused after /), components: [] });
  expect(answer).toMatchObject({ content: "<@user-alice> Paused with 2 of 7 changed files done. Say go on when you want the rest.", allowedMentions: { users: ["user-alice"] } });
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "stopped", since: "2026-10-22T03:00:00.000Z" });
  expect(await pauses(s)).toEqual([expect.objectContaining({ reason: "stopped", repo: "acme/api", branch: "main", draft: "2026-10-22_9f8e7d6..a1b2c3d" })]);
  expect(await warnings(s)).toEqual([expect.stringMatching(/^Paused acme\/api \(branch main, draft 2026-10-22_9f8e7d6\.\.a1b2c3d\) in channel channel-1: stopped/)]);
});

discordScenario("the asker's Stop pressed while someone's question is answered: the question is answered first, then the work says it paused, pinging the asker, and goes no further (#361)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  const asked: Promise<unknown>[] = [], clicks: Promise<unknown>[] = [];
  s.model.script(
    START, "Started the acme/api changelog.",
    // Bob asks while the work is on its second turn, after its progress message went up.
    async () => { asked.push(s.discord.send(`${s.discord.mention} berapa lama lagi?`, { author: s.discord.bob })); await pause(300); return read(0); }, "Read the first DTO.",
    // Alice presses Stop while Bob's question is answered.
    () => { clicks.push(s.discord.click(s.discord.botMessages.find((m) => m.components.length)!, "Stop")); return "Masih ada 5 file lagi."; },
    "Paused with 2 of 7 changed files done. Say go on when you want the rest.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await Promise.all([...asked, ...clicks]);

  expect(s.model.calls).toHaveLength(6);
  const [progress, ...answers] = s.discord.botMessages;
  expect(progress).toMatchObject({ content: expect.stringMatching(/^-# ⏸️ Paused after /), components: [] });
  expect(answers.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: "Masih ada 5 file lagi.", pinged: [] },
    { content: "<@user-alice> Paused with 2 of 7 changed files done. Say go on when you want the rest.", pinged: ["user-alice"] },
  ]);
  expect((await draftMeta(s)).work).toMatchObject({ state: "paused", reason: "stopped" });
});

discordScenario("a person's message during the work is answered first and the work goes on after it; a lanjut meanwhile goes on with the same work, never a second chain (#361)", async (s) => {
  await acmeApi(s);
  const sent: Promise<unknown>[] = [];
  s.model.script(
    START, "Started the acme/api changelog.",
    async () => { sent.push(s.discord.send(`${s.discord.mention} berapa lama lagi?`, { author: s.discord.bob })); await pause(50); return read(0); }, "Read the first DTO.",
    // Bob's side question is answered; Alice says lanjut while it is.
    () => { sent.push(s.discord.send(`${s.discord.mention} lanjut`)); return "Masih ada 5 file lagi."; },
    read(1), "Reading on.",
    [read(2), read(3), read(4), read(5)], RECORD, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await Promise.all(sent);

  expect(s.model.calls).toHaveLength(11);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: "Masih ada 5 file lagi.", pinged: [] },
    { content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, pinged: ["user-alice"] },
  ]);
});

discordScenario("a paused draft stays paused through a turn that only talks, and anyone's turn that goes on with it has it worked on again to the end (#361)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  const clicks: Promise<unknown>[] = [];
  const stop = pressStop(s, clicks);
  s.model.script(
    START, "Started the acme/api changelog.",
    read(0), async () => { await stop(); return read(1); }, "Paused with 2 of 7 changed files done.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await Promise.all(clicks);

  s.model.script("Sama-sama!");
  await s.discord.send(`${s.discord.mention} makasih`);
  expect(s.discord.botMessages.at(-1)).toMatchObject({ content: "Sama-sama!", allowedMentions: { parse: [] } });
  expect((await draftMeta(s)).work).toMatchObject({ state: "paused", reason: "stopped" });

  s.model.script(
    [read(1), read(2)], "Going on with the DTOs.",
    [read(3), read(4), read(5)], RECORD, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} lanjut`, { author: s.discord.bob });

  expect(s.model.calls).toHaveLength(5 + 1 + 6);
  expect(s.discord.botMessages.at(-2)!.content).toBe("Sama-sama!");
  expect(s.discord.botMessages.at(-1)).toMatchObject({ content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, allowedMentions: { users: ["user-alice"] } });
  expect(await s.workspace.list(FOLDER)).toEqual([WRITTEN_FILE]);
});

discordScenario("a progress message put up before its turn started the draft then names the draft, which keeps where it is (#361)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  const clicks: Promise<unknown>[] = [];
  let seen: { buttons: string[]; kept: unknown } | undefined;
  s.model.script(
    async () => { await pause(300); return START; }, "Started the acme/api changelog.",
    async () => {
      const progress = s.discord.botMessages.find((m) => m.components.length)!;
      seen = { buttons: buttonsOf(progress), kept: (await draftMeta(s)).progressMessage };
      clicks.push(s.discord.click(progress, "Stop"));
      await pause(50);
      return read(0);
    },
    "Paused with 1 of 7 changed files done.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await Promise.all(clicks);

  const [progress] = s.discord.botMessages;
  expect(seen).toEqual({ buttons: ["changelogstop:2026-10-22_9f8e7d6..a1b2c3d"], kept: { channelId: "channel-1", messageId: progress!.id } });
  expect((await draftMeta(s)).work).toMatchObject({ state: "paused", reason: "stopped" });
});

const NO_PROGRESS = 'The changelog made no progress, so I paused it; type "go on" to continue.';

discordScenario("a model that answers every turn without calling a tool pauses the draft after two such turns: they post nothing, and one line pings the asker to go on (#357)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  s.model.script(
    START, "Started the acme/api changelog.",
    async () => { await pause(300); return "Next I will read the DTOs."; },
    "Going on with the DTOs.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(s.model.calls).toHaveLength(4);
  const [progress, answer, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(progress).toMatchObject({ content: expect.stringMatching(/^-# ⏸️ Paused after /), components: [] });
  expect(answer).toMatchObject({ content: `<@user-alice> ${NO_PROGRESS}`, allowedMentions: { users: ["user-alice"] } });
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "no-progress", since: "2026-10-22T03:00:00.000Z" });
  expect(await pauses(s)).toEqual([expect.objectContaining({ reason: "no-progress", repo: "acme/api", branch: "main", draft: "2026-10-22_9f8e7d6..a1b2c3d", channelId: "channel-1" })]);
});

discordScenario("only the turns that go on by themselves count: a file examined starts the count again, and a person's chat in between neither counts nor resets it (#357)", async (s) => {
  await acmeApi(s);
  const asked: Promise<unknown>[] = [];
  s.model.script(
    START, "Started the acme/api changelog.",
    "Next I will read the DTOs.",
    read(0), "Read the first DTO.",
    // Bob asks while the work reads the first DTO again, which adds nothing.
    async () => { asked.push(s.discord.send(`${s.discord.mention} berapa lama lagi?`, { author: s.discord.bob })); await pause(50); return read(0); }, "Read it again.",
    "Masih ada 5 file lagi.",
    "Going on with the DTOs.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await Promise.all(asked);

  expect(s.model.calls).toHaveLength(9);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: "Masih ada 5 file lagi.", pinged: [] },
    { content: `<@user-alice> ${NO_PROGRESS}`, pinged: ["user-alice"] },
  ]);
  expect((await draftMeta(s)).work).toMatchObject({ state: "paused", reason: "no-progress" });
});

discordScenario("a draft paused for no progress that a lanjut goes on with counts afresh: it pauses again only after two more turns without progress (#357)", async (s) => {
  await acmeApi(s);
  s.model.script(START, "Started the acme/api changelog.", "Next I will read the DTOs.", "Going on with the DTOs.");
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  expect((await draftMeta(s)).work).toMatchObject({ state: "paused", reason: "no-progress" });

  s.model.script(
    read(0), "Read the first DTO.",
    "Next I will read the rest.",
    "Still on the DTOs.",
  );
  await s.discord.send(`${s.discord.mention} lanjut`);

  expect(s.model.calls).toHaveLength(4 + 4);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: `<@user-alice> ${NO_PROGRESS}`, pinged: ["user-alice"] },
    { content: `<@user-alice> ${NO_PROGRESS}`, pinged: ["user-alice"] },
  ]);
  expect((await pauses(s)).map((p: any) => p.reason)).toEqual(["no-progress", "no-progress"]);
});

const QUESTION = "Is src/users/dto/f.dto.ts still served, or can it be set aside?";
const ASK = { tool: "askChangelogAsker", args: { draft: DRAFT, question: QUESTION } };

discordScenario("a turn the model ends with a question in its answer goes on; askChangelogAsker pauses the draft with its question as the answer, pinging the asker, and anyone's reply that goes on with it sends it to the end (#356)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  await agentLog();
  s.model.script(
    START, "Started the acme/api changelog. Shall I go on?",
    async () => { await pause(300); return read(0); }, ASK, "I asked Alice about the last DTO.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(s.model.calls).toHaveLength(5);
  const [progress, answer, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(progress).toMatchObject({ content: expect.stringMatching(/^-# ⏸️ Paused after /), components: [] });
  expect(answer).toMatchObject({ content: `<@user-alice> ${QUESTION}`, allowedMentions: { users: ["user-alice"] } });
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "question", question: QUESTION, since: "2026-10-22T03:00:00.000Z" });
  expect(await pauses(s)).toEqual([expect.objectContaining({ reason: "question", repo: "acme/api", draft: "2026-10-22_9f8e7d6..a1b2c3d" })]);
  expect(await warnings(s)).toEqual([expect.stringMatching(/: question$/)]);

  // Bob answers for Alice: his turn goes on with the draft, so the work goes on by itself to the end.
  s.model.script(
    { tool: "putChangelogNotes", args: { draft: DRAFT, setAside: [{ pattern: DTOS[5], reason: "no longer served" }] } }, "Set it aside; going on.",
    [1, 2, 3, 4].map(read), RECORD, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} set it aside, it is not served any more`, { author: s.discord.bob });

  expect(s.model.calls).toHaveLength(5 + 2 + 4);
  expect(s.discord.botMessages.slice(2).map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, pinged: ["user-alice"] },
  ]);
  expect(await s.workspace.list(FOLDER)).toEqual([WRITTEN_FILE]);
});

discordScenario("a question longer than three short lines is refused and asks nothing; asked in the asker's own turn, the question answers her message without a ping (#356)", async (s) => {
  await acmeApi(s);
  const long = { tool: "askChangelogAsker", args: { draft: DRAFT, question: "I read the controller.\nI read the first DTO.\nThe last DTO looks unused.\nIs it still served, or can it be set aside?" } };
  s.model.script(START, long, ASK, "Asked.");
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(String(s.model.calls[2]!.findLast((m: any) => m.role === "tool")!.content)).toContain("Ask in at most 3 short lines");
  expect(s.model.calls).toHaveLength(4);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([{ content: QUESTION, pinged: [] }]);
  expect((await draftMeta(s)).work).toMatchObject({ state: "paused", reason: "question", question: QUESTION });
  expect(await pauses(s)).toHaveLength(1);
});

discordScenario("a turn going on by itself that asks after a turn without progress posts its question, not the no-progress line, and ends with it: the draft and the conversation keep the question as its closing summary (#356, #357, #360)", async (s) => {
  await acmeApi(s);
  s.model.script(START, "Started the acme/api changelog.", "Next I will read the DTOs.", ASK, "Asked.");
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(s.model.calls).toHaveLength(5);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: `<@user-alice> ${QUESTION}`, pinged: ["user-alice"] },
  ]);
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "question", question: QUESTION, since: "2026-10-22T03:00:00.000Z" });
  expect((await pauses(s)).map((p: any) => p.reason)).toEqual(["question"]);
  expect((await draftMeta(s)).closingSummary).toBe(QUESTION);

  // A person's later turn reads the question the reply answers, not the model's own last words.
  s.model.script("It is still served.");
  await s.discord.send(`${s.discord.mention} f.dto.ts is still served`, { author: s.discord.bob });
  expect(s.model.calls[5]!.filter((m) => m.role === "assistant" && !m.toolCalls?.length).map((m) => m.content)).toEqual([
    "Started the acme/api changelog.", "Next I will read the DTOs.", QUESTION,
  ]);
});

/** What the model may learn of acme/api's global conventions in step 2, about 60 tokens. */
const CONVENTIONS = "NestJS: routes from @Controller and @Post, under the global prefix /api with URI versioning (v1, v2). Every success is wrapped as { data }; errors are { statusCode, message } from the global HttpExceptionFilter. Bodies are validated by class-validator; every route but /auth needs a Bearer JWT.";
const NOTE_CONVENTIONS = { tool: "putChangelogNotes", args: { draft: DRAFT, conventions: CONVENTIONS } };
/** Alice's request worked through in four turns of two steps each: hers, then three that go on by themselves. */
function fourTurns(s: Scenario) {
  s.model.script(
    START, NOTE_CONVENTIONS, "Started the acme/api changelog and noted its conventions.",
    read(0), "Read the first DTO.",
    READ_REST, RECORD, "Recorded POST /api/v2/users.",
    FINISH, written,
  );
}
const toolsIn = (call: any[]) => call.filter((m) => m.role === "tool").map((m) => /source="tool:(\w+)/.exec(String(m.content))![1]);

discordScenario("a turn that goes on by itself starts from the draft alone: the draft's state, the repository's conventions and the last turn's closing summary, none of the earlier turns' steps (#360)", async (s) => {
  await acmeApi(s);
  await twoSteps(s);
  await agentLog();
  fourTurns(s);
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(s.model.calls).toHaveLength(10);
  // The second turn: the system prompt, the draft's state and the per-turn context, nothing of Alice's turn.
  const second = s.model.calls[3]!;
  expect(second.map((m) => m.role)).toEqual(["system", "user", "user"]);
  expect(second[1]!.content).toBe(`${DRAFT_TURN}
This turn starts from the draft alone: what earlier turns read is not here, only what they recorded in it.
<untrusted_data source="changelog draft">
Draft: ${DRAFT} (acme/api, branch main, 2026-10-01 to 2026-10-22, commits 9f8e7d6..a1b2c3d)
Changed files: 7: 1 examined, 0 set aside, 6 left.
Examined: src/users/users.controller.ts
Left:
${DTOS.map((p) => `- ${p} (modified)`).join("\n")}
Endpoints recorded: none yet.
Repository conventions: ${CONVENTIONS}
How the last turn ended: Started the acme/api changelog and noted its conventions.
</untrusted_data>`);
  expect(String(second[2]!.content)).toContain(`Draft: ${DRAFT}`);

  // The third turn knows the second's reads only as files examined, and its closing summary replaced the one before.
  const third = String(s.model.calls[5]![1]!.content);
  expect(s.model.calls[5]!.map((m) => m.role)).toEqual(["system", "user", "user"]);
  expect(third).toContain("Changed files: 7: 2 examined, 0 set aside, 5 left.\nExamined: src/users/users.controller.ts, src/users/dto/a.dto.ts\n");
  expect(third).toContain("How the last turn ended: Read the first DTO.\n");
  expect(third).not.toContain("full_name");

  // The fourth turn sees what the third recorded.
  const fourth = String(s.model.calls[8]![1]!.content);
  expect(fourth).toContain("Changed files: 7: 7 examined, 0 set aside, 0 left.\n");
  expect(fourth).toContain("Endpoints recorded (1):\n- POST /api/v2/users (breaking)\nComponents recorded: securitySchemes/bearerAuth, schemas/NewUser, schemas/User, schemas/UserEnvelope, schemas/Error\n");
  expect(fourth).toContain("How the last turn ended: Recorded POST /api/v2/users.\n");

  // Their steps are in the Agent log, one line a turn.
  const steps = (await s.admin("GET", "/api/admin/logs?level=info&source=changelog")).body.entries.map((e: any) => e.text);
  expect(steps).toEqual([
    "Went on with acme/api (branch main, draft 2026-10-22_9f8e7d6..a1b2c3d) in channel channel-1: repoReadFile ×1",
    "Went on with acme/api (branch main, draft 2026-10-22_9f8e7d6..a1b2c3d) in channel channel-1: repoReadFile ×5, putChangelogComponents ×1, putChangelogOperation ×1",
    "Went on with acme/api (branch main, draft 2026-10-22_9f8e7d6..a1b2c3d) in channel channel-1: finishChangelog ×1",
  ]);
});

discordScenario("the conversation keeps one closing-summary row per turn that went on by itself, and a person's later turn reads those rows, not their steps (#360)", async (s) => {
  await acmeApi(s);
  await twoSteps(s);
  fourTurns(s);
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  s.model.script("Yes, it is written.");
  await s.discord.send(`${s.discord.mention} is the changelog done?`, { author: s.discord.bob });

  const bobs = s.model.calls[10]!;
  // Alice's own turn is read as it was stored, steps and all; each turn after it left only what it concluded.
  expect(toolsIn(bobs)).toEqual(["startChangelog", "putChangelogNotes"]);
  expect(bobs.filter((m) => m.role === "assistant" && !m.toolCalls?.length).map((m) => m.content)).toEqual([
    "Started the acme/api changelog and noted its conventions.", "Read the first DTO.", "Recorded POST /api/v2/users.", `The acme/api changelog is written: ${WRITTEN}`,
  ]);
  expect(bobs.some((m) => String(m.content).startsWith(DRAFT_TURN))).toBe(false);
  expect(s.discord.botMessages.at(-1)!.content).toBe("Yes, it is written.");
});

discordScenario("putChangelogNotes keeps the repository's conventions summary in the draft, refused past about 1,500 tokens (#360)", async (s) => {
  await acmeApi(s);
  let refusal = "", kept: unknown;
  s.model.script(
    START, { tool: "putChangelogNotes", args: { draft: DRAFT, conventions: `${CONVENTIONS} `.repeat(25) } },
    (turn) => { refusal = turn.toolResults.at(-1).error; return NOTE_CONVENTIONS; },
    async () => { kept = (await draftMeta(s)).conventions; return [read(0), ...READ_REST]; },
    RECORD, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(refusal).toMatch(/^conventions is about 1,8\d\d tokens; keep it to about 1,500/);
  expect(kept).toBe(CONVENTIONS);
  // Kept for the draft's turns only: the written changelog has none of it.
  expect(await s.workspace.read(WRITTEN_FILE)).not.toContain("class-validator");
});
