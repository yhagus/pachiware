import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { discordScenario, type Scenario } from "./support/discordScenario";

const FOLDER = "guilds/guild-1/channels/channel-1/files/changelogs/acme-api";
const DRAFT_FILE = `${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`, WRITTEN_FILE = `${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.json`;
const DRAFT = "channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.draft.json", WRITTEN = DRAFT.replace(".draft.json", ".json");
const BASE = "9f8e7d6".padEnd(40, "0"), HEAD = "a1b2c3d".padEnd(40, "0");
/** The skill's example operation and its components, a valid changelog entry (packages/skills/test/openapi-validate.test.ts checks it). */
const FIXTURE = JSON.parse(readFileSync(new URL("../../../packages/skills/test/fixtures/contract-diff/create-user.json", import.meta.url), "utf8"));
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
    { filename: "src/users/users.controller.ts", status: "modified", patch: "@@ -10 +10 @@\n-  @Post()\n+  @Post('v2')" }, ...DTOS.map((filename) => ({ filename, status: "modified" })),
  ] }));
  s.http.on("GET api.github.com/repos/acme/api/contents/", (req) => ({ type: "file", path: new URL(req.url).pathname.split("/contents/")[1], encoding: "base64", content: Buffer.from(SOURCE).toString("base64") }));
}
const START = { tool: "startChangelog", args: { repo: "acme/api", scope: "range", from: "2026-10-01" } };
const READ_ALL = DTOS.map((path) => ({ tool: "repoReadFile", args: { repo: "acme/api", ref: HEAD, path } }));
const { "x-impact": _impact, ...OPERATION } = FIXTURE.paths["/api/v2/users"].post;
const RECORD = [{ tool: "putChangelogComponents", args: { draft: DRAFT, components: FIXTURE.components } }, { tool: "putChangelogOperation", args: { draft: DRAFT, method: "post", path: "/api/v2/users", operation: OPERATION } }];
const FINISH = { tool: "finishChangelog", args: { draft: DRAFT } };
const written = (turn: any) => `The acme/api changelog is written: ${turn.toolResults.at(-1).path}`;
const draftMeta = async (s: Scenario) => JSON.parse((await s.workspace.read(DRAFT_FILE))!)["x-draft"];
const PROVIDER_DOWN = { error: "I can't reach the AI service right now. Try again in a moment." };

discordScenario("a turn that goes on by itself and cannot reach the model runs once more after the tenant's wait, and the work goes on to the end; the failure posts nothing (#358)", async (s) => {
  await acmeApi(s);
  s.model.script(
    START, "Started the acme/api changelog.",
    PROVIDER_DOWN,
    READ_ALL, RECORD, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  // 10:00 in Jakarta is 03:00 UTC; the retry comes after the default wait of 60 seconds.
  expect(s.model.calls).toHaveLength(3);
  expect((await draftMeta(s)).work).toEqual({ state: "worked-on", retryAt: "2026-10-22T03:01:00.000Z" });
  expect(s.discord.botMessages).toEqual([]);

  s.clock.advance(59_000);
  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(3);

  s.clock.advance(1_000);
  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(7);
  // The same continuation runs again, from where the work stopped.
  expect(s.model.calls[3]!.at(-2)!.content).toBe(s.model.calls[2]!.at(-2)!.content);
  expect(s.discord.botMessages).toEqual([expect.objectContaining({ content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, allowedMentions: { users: ["user-alice"] } })]);
  expect(await s.workspace.list(FOLDER)).toEqual([WRITTEN_FILE]);
});

// The progress message's wait is shortened, so a slow turn shows it with its Stop button.
async function fastProgress() {
  const { progressTiming } = await import("../src/discord/progress.ts");
  Object.assign(progressTiming, { showAfterMs: 150, everyMs: 40 });
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pauses = async (s: Scenario) => {
  const { repositories } = await import("@pachiware/db");
  return (await repositories().usage.list({ tenantId: s.tenant.id, type: "changelog_draft_paused" })).map((e: any) => e.metadata);
};

discordScenario("the model failing on the retry too pauses the draft after the tenant's wait: one line that names only the AI model pings the asker, and the progress message says it paused (#358)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  expect((await s.admin("PUT", `/api/admin/tenants/${s.tenant.id}/settings`, { modelRetryWaitSeconds: 30 })).status).toBe(200);
  s.model.script(
    START, "Started the acme/api changelog.",
    async () => { await pause(300); return READ_ALL[0]!; }, PROVIDER_DOWN,
    PROVIDER_DOWN,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  // While the retry waits, the progress message stays up with its Stop button, and nothing else is posted.
  expect(s.model.calls).toHaveLength(4);
  const [progress, ...none] = s.discord.botMessages;
  expect(none).toEqual([]);
  expect(progress!.components).not.toEqual([]);
  expect((await draftMeta(s)).work).toEqual({ state: "worked-on", retryAt: "2026-10-22T03:00:30.000Z" });

  s.clock.advance(30_000);
  await s.scheduler.tick();

  expect(s.model.calls).toHaveLength(5);
  const [, answer, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(progress).toMatchObject({ content: expect.stringMatching(/^-# ⏸️ Paused after /), components: [] });
  expect(answer).toMatchObject({ content: "<@user-alice> The AI model can't be reached; say go on to carry on.", allowedMentions: { users: ["user-alice"] } });
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "model", since: "2026-10-22T03:00:30.000Z" });
  expect(await pauses(s)).toEqual([expect.objectContaining({ reason: "model", repo: "acme/api", branch: "main", draft: "2026-10-22_9f8e7d6..a1b2c3d", channelId: "channel-1" })]);

  // A paused draft waits for a person: time passing runs nothing more.
  s.clock.advance(3600_000);
  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(5);
});

discordScenario("with a model retry wait of 0, a turn that goes on by itself and cannot reach the model pauses the draft at once (#358)", async (s) => {
  await acmeApi(s);
  await s.admin("PUT", `/api/admin/tenants/${s.tenant.id}/settings`, { modelRetryWaitSeconds: 0 });
  s.model.script(
    START, "Started the acme/api changelog.",
    PROVIDER_DOWN,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(s.model.calls).toHaveLength(3);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: "<@user-alice> The AI model can't be reached; say go on to carry on.", pinged: ["user-alice"] },
  ]);
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "model", since: "2026-10-22T03:00:00.000Z" });
});

/** Alice's Changelog draft of acme/api, worked on in channel-1 with one of its three changed files examined, as the work leaves it between turns. */
async function workedOnDraft(s: Scenario) {
  const changelog = { date: "2026-10-22", base: { ref: "main before 2026-10-01", commit: "9f8e7d6" }, head: { ref: "main through 2026-10-22", commit: "a1b2c3d" }, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, globalChanges: [], removedOperations: [], unverified: [] };
  await s.workspace.write(DRAFT_FILE, JSON.stringify({
    openapi: "3.1.2", info: { title: "acme/api API changes", version: "a1b2c3d", "x-changelog": changelog }, paths: {}, components: {},
    "x-draft": {
      repo: "acme/api", branch: "main", scope: "range", from: "2026-10-01", to: "2026-10-22", place: "channel-1", startedBy: { id: "user-alice", name: "Alice" }, changedFiles: 3,
      base: BASE, head: HEAD, files: [{ path: "a.ts", status: "modified" }, { path: "b.ts", status: "modified" }, { path: "c.ts", status: "modified" }], examined: ["a.ts"],
      touchedAt: new Date(s.clock.now()).toISOString(), work: { state: "worked-on" },
    },
  }));
}

discordScenario("a person's turn that cannot reach the model is answered as before and the work goes on after it; the work's own failure, retried and failing again, pauses with the provider, model and error in the console only (#358)", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  s.clock.set("2026-10-22T10:00:00+07:00");
  await workedOnDraft(s);
  const { installAgentLog } = await import("../src/logs/agentLog.ts");
  installAgentLog();
  // Every model call goes to the real router, whose Profile's two models both fail.
  const created = await s.admin("POST", `/api/admin/tenants/${s.tenant.id}/profiles`, { apiKey: "profile-key", name: "Main", provider: "openai", model: "gpt-main", fallbackModels: ["gpt-backup"] });
  const { repositories } = await import("@pachiware/db");
  await repositories().bots.update(s.bot.id, { profileId: created.body.profile.id });
  s.model.live();
  s.http.on("POST api.openai.com/v1/chat/completions", () => Response.json({ error: { message: "upstream exploded" } }, { status: 500 }));
  const asked = () => s.http.requests.filter((r) => r.url.includes("api.openai.com")).map((r) => r.body.model);

  await s.discord.send(`${s.discord.mention} lanjut`);

  // Alice's turn, then the work's own turn after it, each asking both models (a request is tried four times).
  expect(asked()).toEqual([...Array(4).fill("gpt-main"), ...Array(4).fill("gpt-backup"), ...Array(4).fill("gpt-main"), ...Array(4).fill("gpt-backup")]);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: "I can't reach the AI service right now. Try again in a moment.", pinged: [] },
  ]);
  expect((await draftMeta(s)).work).toEqual({ state: "worked-on", retryAt: "2026-10-22T03:01:00.000Z" });

  s.clock.advance(60_000);
  await s.scheduler.tick();

  expect(asked()).toHaveLength(24);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: "I can't reach the AI service right now. Try again in a moment.", pinged: [] },
    { content: "<@user-alice> The AI model can't be reached; say go on to carry on.", pinged: ["user-alice"] },
  ]);
  const detail = { provider: "openai", model: "gpt-backup", error: "Provider rejected the request (500)" };
  expect(await pauses(s)).toEqual([expect.objectContaining({ reason: "model", repo: "acme/api", draft: "2026-10-22_9f8e7d6..a1b2c3d", ...detail })]);
  const logged = (await s.admin("GET", "/api/admin/logs?level=warn&source=changelog")).body.entries.map((e: any) => e.text);
  expect(logged).toEqual([expect.stringMatching(/^Paused acme\/api \(branch main, draft 2026-10-22_9f8e7d6\.\.a1b2c3d\) in channel channel-1: model /)]);
  expect(logged[0]).toContain(JSON.stringify(detail).slice(1, -1));
});

discordScenario("once the model answers again, a later outage gets a retry of its own instead of pausing the draft (#358)", async (s) => {
  await acmeApi(s);
  s.model.script(
    START, "Started the acme/api changelog.",
    PROVIDER_DOWN,
    READ_ALL.slice(0, 3), "Read three DTOs.",
    PROVIDER_DOWN,
    READ_ALL.slice(3), RECORD, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  s.clock.advance(60_000);
  await s.scheduler.tick();

  // The retry answered and the work went on, until the model failed again a minute later.
  expect(s.model.calls).toHaveLength(6);
  expect((await draftMeta(s)).work).toEqual({ state: "worked-on", retryAt: "2026-10-22T03:02:00.000Z" });

  s.clock.advance(60_000);
  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(10);
  expect(s.discord.botMessages).toEqual([expect.objectContaining({ content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}` })]);
});
