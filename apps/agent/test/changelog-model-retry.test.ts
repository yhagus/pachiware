import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { BASE, DRAFT_FILE, FINISH, FOLDER, HEAD, MAP_CHANGED, MAPPED, PROVIDER_DOWN, READ_REST, START, TRACE, WORKER, WRITTEN, WRITTEN_FILE, WRITE_CONVENTIONS, acmeApi, draftMeta, fastProgress, pause, pauses, read, written } from "./support/changelog";

/** Every changed DTO, read whole at head. */
const READ_ALL = [read(0), ...READ_REST];

discordScenario("a turn that goes on by itself and cannot reach the model runs once more after the tenant's wait, and the work goes on to the end; the failure posts nothing (#358)", async (s) => {
  await acmeApi(s);
  s.model.script(
    START, "Started the acme/api changelog.",
    PROVIDER_DOWN,
    READ_ALL, [WRITE_CONVENTIONS, MAP_CHANGED, TRACE], ...MAPPED, ...WORKER, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  // 10:00 in Jakarta is 03:00 UTC; the retry comes after the default wait of 60 seconds.
  expect(s.model.calls).toHaveLength(3);
  expect((await draftMeta(s)).work).toEqual({ state: "worked-on", retryAt: "2026-10-22T03:01:00.000Z" });
  expect(s.discord.botMessages).toEqual([]);
  // The failure is no closing summary: the draft keeps how Alice's turn ended (#360).
  expect((await draftMeta(s)).closingSummary).toBe("Started the acme/api changelog.");

  s.clock.advance(59_000);
  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(3);

  s.clock.advance(1_000);
  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(23);
  // The same continuation runs again, from where the work stopped: from the draft alone, as the failed one did (#360).
  expect(s.model.calls[3]!.at(-2)!.content).toBe(s.model.calls[2]!.at(-2)!.content);
  expect(s.model.calls[3]!.map((m: any) => m.role)).toEqual(["system", "user", "user"]);
  expect(String(s.model.calls[3]![1]!.content)).toContain("How the last turn ended: Started the acme/api changelog.\n");
  expect(s.discord.botMessages).toEqual([expect.objectContaining({ content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, allowedMentions: { users: ["user-alice"] } })]);
  expect(await s.workspace.list(FOLDER)).toEqual([WRITTEN_FILE]);
});


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

/** Alice's Changelog draft of acme/api, worked on in channel-1 with one of its three changed files mapped, as the work leaves it between turns. */
async function workedOnDraft(s: Scenario) {
  const changelog = { date: "2026-10-22", base: { ref: "main before 2026-10-01", commit: "9f8e7d6" }, head: { ref: "main through 2026-10-22", commit: "a1b2c3d" }, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, globalChanges: [], removedOperations: [], unverified: [] };
  await s.workspace.write(DRAFT_FILE, JSON.stringify({
    openapi: "3.1.2", info: { title: "acme/api API changes", version: "a1b2c3d", "x-changelog": changelog }, paths: {}, components: {},
    "x-draft": {
      repo: "acme/api", branch: "main", scope: "range", from: "2026-10-01", to: "2026-10-22", place: "channel-1", startedBy: { id: "user-alice", name: "Alice" }, changedFiles: 3,
      base: BASE, head: HEAD, files: [{ path: "a.ts", status: "modified" }, { path: "b.ts", status: "modified" }, { path: "c.ts", status: "modified" }], mapping: { "a.ts": { read: true, none: "a seed script" } },
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
    [...READ_ALL, WRITE_CONVENTIONS, MAP_CHANGED], ...MAPPED, "Mapped every changed file.",
    PROVIDER_DOWN,
    TRACE, ...WORKER, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  s.clock.advance(60_000);
  await s.scheduler.tick();

  // The retry answered and the work went on, until the model failed again a minute later.
  expect(s.model.calls).toHaveLength(20);
  expect((await draftMeta(s)).work).toEqual({ state: "worked-on", retryAt: "2026-10-22T03:02:00.000Z" });

  s.clock.advance(60_000);
  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(25);
  expect(s.discord.botMessages).toEqual([expect.objectContaining({ content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}` })]);
});

discordScenario("the asker's Stop while a model retry waits pauses the draft there and then: its progress message says it paused, and the retry never runs (#358, #362)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  s.model.script(START, "Started the acme/api changelog.", async () => { await pause(300); return READ_ALL[0]!; }, PROVIDER_DOWN);
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  const [progress] = s.discord.botMessages;
  const click = await s.discord.click(progress!, "Stop");
  s.clock.advance(60_000);
  await s.scheduler.tick();

  expect(click.responses.map((r: any) => r.kind)).toEqual(["update"]);
  expect(s.model.calls).toHaveLength(4);
  expect(s.discord.botMessages).toEqual([progress]);
  expect(progress).toMatchObject({ content: expect.stringMatching(/^-# ⏸️ Paused after /), components: [] });
  expect((await draftMeta(s)).work).toEqual({ state: "paused", reason: "stopped", since: "2026-10-22T03:00:00.000Z" });
});
