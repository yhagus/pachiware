import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";
import {
  BASE, DRAFT, DRAFT_FILE, DRAFT_TURN, DTOS, FINISH, FOLDER, HEAD, MAP_CHANGED, MAPPED, READ_REST, TRACE, WORKER, WRITE_CONVENTIONS, WRITTEN, WRITTEN_FILE,
  acmeApi, agentLog, contractDiffOn, draftMeta, fastProgress, mapper, mappers, oneWorkerATurn, outlasting, pauses, pressStop, progressShown, progressShows, progressUp, reaches, read, startChangelog, stopTaken,
  warnings, written,
} from "./support/changelog";
import { missingFacts } from "./support/facts";

/** Alice asks for the changelog to be published too, so finishing publishes it as it writes it (#349). */
const START = startChangelog({ publish: true });

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
const buttonsOf = (m: any): string[] => m.components.flatMap((row: any) => row.components.map((c: any) => c.custom_id));

/** Each of a chat turn's model calls may be a step, so a turn that asks for tools twice is cut by its budget and ends with a summary. */
async function twoSteps(s: Scenario) {
  const { repositories } = await import("@pachiware/db");
  const { settings } = (await repositories().agentConfig.get(s.tenant.id))!;
  await repositories().agentConfig.update(s.tenant.id, { settings: { ...settings, maxReActIterations: 2 } });
}
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

discordScenario("a turn that goes on by itself needs only its place and asker: with the message that started the work deleted, the final answer is a new message in the channel (#355)", async (s) => {
  await acmeApi(s);
  s.model.script(
    // Alice deletes her message while the first turn works; Discord refuses a reply to a deleted message.
    () => { void s.discord.deleteMessage(s.discord.channel("channel-1").messages.find((m) => !m.author.bot)!); return START; }, "Started the acme/api changelog.",
    [read(0), ...READ_REST], [WRITE_CONVENTIONS, MAP_CHANGED, TRACE], ...MAPPED, ...WORKER, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October, then publish it`);

  expect(s.model.calls).toHaveLength(22);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, reference: m.reference }))).toEqual([{ content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, reference: undefined }]);
});

discordScenario("the draft keeps where its progress message is, the one message the turns that go on by themselves edit (#355)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  let kept: unknown;
  s.model.script(
    START, "Started the acme/api changelog.",
    async () => { await progressShown(s); return [read(0), ...READ_REST]; }, "Read every DTO.",
    // The first mapping worker's answer comes once the progress message has shown its file mapped.
    async () => { kept = (await draftMeta(s)).progressMessage; return [WRITE_CONVENTIONS, MAP_CHANGED, TRACE]; },
    MAPPED[0]!, async () => { await progressShows(s, "\n3 commits · 1 of 7 changed files mapped · 1 candidate so far\n"); return "Mapped."; }, ...MAPPED.slice(2), ...WORKER, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  const [progress, answer, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(answer!.content).toBe(`<@user-alice> The acme/api changelog is written: ${WRITTEN}`);
  expect(progress!.content).toMatch(/^-# 🧠 Done in /);
  // The files mapped of all and the candidates found so far (#366).
  expect(progress!.edits.map((e) => e.content).join("\n")).toContain("\n3 commits · 1 of 7 changed files mapped · 1 candidate so far\n");
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
      await progressShown(s);
      const progress = progressUp(s)!;
      buttons.push(...buttonsOf(progress));
      clicks.push(s.discord.click(progress, "Stop", { user: s.discord.bob }));
      clicks.push(s.discord.click(progress, "Stop"));
      await s.discord.handled();
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
  // The call the Stop cut is not run, and the model is told the person stopped it.
  expect(missingFacts(String(s.model.calls[2]!.findLast((m: any) => m.role === "tool")!.content), /not run/, /person stopped/)).toEqual([]);
  expect(s.discord.botMessages.at(-1)).toMatchObject({ content: "<@user-alice> Paused with 1 of 3 changed files done.", allowedMentions: { users: ["user-alice"] } });
  expect(await s.workspace.list(FOLDER)).toEqual([DRAFT_FILE]);
});

discordScenario("one request whose work spans many turns, cut by their budget or ended by the model, is written and published without a lanjut; only the final answer is posted, pinging the asker (#361)", async (s) => {
  await acmeApi(s);
  await twoSteps(s);
  await oneWorkerATurn();
  let link = "";
  // Each turn's mapping worker reads its DTO whole and maps it, which is what counts as progress (#366), and leaves no time for another.
  const dto = (i: number) => [read(i), mapper(reaches(DTOS[i]!, "a body field changed"))[0]!, outlasting(s, "Mapped.")];
  s.model.script(
    START, "Started the acme/api changelog.",
    [WRITE_CONVENTIONS, MAP_CHANGED], ...dto(0), "Mapped the first DTO.",
    ...[1, 2, 3, 4, 5].flatMap((i) => [MAP_CHANGED, ...dto(i), "Mapped another DTO."]),
    MAP_CHANGED, ...mappers([]), "Every changed file is mapped.",
    TRACE, ...WORKER, "Traced POST /api/v2/users.",
    FINISH, (turn) => { link = turn.toolResults.at(-1).published.url; return `The acme/api changelog is written and published: ${link}`; },
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October, then publish it`);

  // Ten turns, nine of them going on by themselves: no cap of five, and each a host line, never a person's.
  expect(s.model.calls).toHaveLength(42);
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
  s.model.script(
    START, "Started the acme/api changelog.",
    read(0), async () => { await pressStop(s, clicks); return read(1); },
    "Paused with 2 of 7 changed files done. Say go on when you want the rest.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await Promise.all(clicks);

  expect(s.model.calls).toHaveLength(5);
  expect(missingFacts(String(s.model.calls[4]!.find((m: any) => m.role === "tool" && String(m.content).includes("not run"))!.content), /person stopped/)).toEqual([]);
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
    async () => { asked.push(s.discord.send(`${s.discord.mention} berapa lama lagi?`, { author: s.discord.bob })); await s.discord.handled(); await progressShown(s); return read(0); }, "Read the first DTO.",
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
    async () => { sent.push(s.discord.send(`${s.discord.mention} berapa lama lagi?`, { author: s.discord.bob })); await s.discord.handled(); return read(0); }, "Read the first DTO.",
    // Bob's side question is answered; Alice says lanjut while it is.
    () => { sent.push(s.discord.send(`${s.discord.mention} lanjut`)); return "Masih ada 5 file lagi."; },
    read(1), "Reading on.",
    [read(2), read(3), read(4), read(5)], [WRITE_CONVENTIONS, MAP_CHANGED, TRACE], ...MAPPED, ...WORKER, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await Promise.all(sent);

  expect(s.model.calls).toHaveLength(27);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: "Masih ada 5 file lagi.", pinged: [] },
    { content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, pinged: ["user-alice"] },
  ]);
});

discordScenario("a person's message mid-work leaves the work's progress message in place: the message is answered, and the work goes on under that same progress message to the end (#361)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  const asked: Promise<unknown>[] = [];
  s.model.script(
    START, "Started the acme/api changelog.",
    // Bob asks once the work's progress message is up.
    async () => { await progressShown(s); asked.push(s.discord.send(`${s.discord.mention} berapa lama lagi?`, { author: s.discord.bob })); await s.discord.handled(); return read(0); }, "Read the first DTO.",
    "Masih ada 5 file lagi.",
    READ_REST, [WRITE_CONVENTIONS, MAP_CHANGED, TRACE], ...MAPPED, ...WORKER, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await Promise.all(asked);

  const [progress, answer, final, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(progress).toMatchObject({ content: expect.stringMatching(/^-# 🧠 Done in /), components: [] });
  expect(answer!.content).toBe("Masih ada 5 file lagi.");
  expect(final).toMatchObject({ content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, allowedMentions: { users: ["user-alice"] } });
  expect(await s.workspace.list(FOLDER)).toEqual([WRITTEN_FILE]);
});

discordScenario("a person's turn that fails mid-work is answered with the failure line as before, and the work still goes on after it to the end (#361)", async (s) => {
  await acmeApi(s);
  const asked: Promise<unknown>[] = [];
  s.model.script(
    START, "Started the acme/api changelog.",
    async () => { asked.push(s.discord.send(`${s.discord.mention} berapa lama lagi?`, { author: s.discord.bob })); await s.discord.handled(); return read(0); }, "Read the first DTO.",
    // Bob's turn breaks before the model answers.
    () => { throw new Error("socket hang up"); },
    READ_REST, [WRITE_CONVENTIONS, MAP_CHANGED, TRACE], ...MAPPED, ...WORKER, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await Promise.all(asked);

  expect(s.model.calls).toHaveLength(25);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: "Sorry, I couldn't process this. Try again in a moment; if it keeps failing, ask an admin to check the bot's settings.", pinged: [] },
    { content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, pinged: ["user-alice"] },
  ]);
});

discordScenario("a paused draft stays paused through a turn that only talks, and anyone's turn that goes on with it has it worked on again to the end (#361)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  const clicks: Promise<unknown>[] = [];
  s.model.script(
    START, "Started the acme/api changelog.",
    read(0), async () => { await pressStop(s, clicks); return read(1); }, "Paused with 2 of 7 changed files done.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await Promise.all(clicks);

  s.model.script("Sama-sama!");
  await s.discord.send(`${s.discord.mention} makasih`);
  expect(s.discord.botMessages.at(-1)).toMatchObject({ content: "Sama-sama!", allowedMentions: { parse: [] } });
  expect((await draftMeta(s)).work).toMatchObject({ state: "paused", reason: "stopped" });

  s.model.script(
    [read(1), read(2)], "Going on with the DTOs.",
    [read(3), read(4), read(5)], [WRITE_CONVENTIONS, MAP_CHANGED, TRACE], ...MAPPED, ...WORKER, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} lanjut`, { author: s.discord.bob });

  expect(s.model.calls).toHaveLength(5 + 1 + 22);
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
    async () => { await progressShown(s); return START; }, "Started the acme/api changelog.",
    async () => {
      const progress = s.discord.botMessages.find((m) => m.components.length)!;
      seen = { buttons: buttonsOf(progress), kept: (await draftMeta(s)).progressMessage };
      clicks.push(s.discord.click(progress, "Stop"));
      await stopTaken(progress);
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
    async () => { await progressShown(s); return "Next I will read the DTOs."; },
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

discordScenario("only the turns that go on by themselves count: a turn that only maps a file starts the count again, one that only reads adds nothing, and a person's chat in between neither counts nor resets it (#357, #366)", async (s) => {
  await acmeApi(s);
  await oneWorkerATurn();
  const asked: Promise<unknown>[] = [];
  s.model.script(
    START, "Started the acme/api changelog.",
    "Next I will read the DTOs.",
    // This turn's one mapping worker reads the first DTO and maps it, leaving no time for another.
    [WRITE_CONVENTIONS, MAP_CHANGED], read(0), mapper(reaches(DTOS[0]!, "a body field changed"))[0]!, outlasting(s, "Mapped."), "Mapped the first DTO.",
    // Bob asks while the work reads the second DTO without mapping it, which adds nothing.
    async () => { asked.push(s.discord.send(`${s.discord.mention} berapa lama lagi?`, { author: s.discord.bob })); await s.discord.handled(); return read(1); }, "Read the second DTO.",
    "Masih ada 5 file lagi.",
    "Going on with the DTOs.",
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  await Promise.all(asked);

  expect(s.model.calls).toHaveLength(12);
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

discordScenario("in a thread, the asker's own turn that writes the changelog pings her, since a post in a thread replies to nothing (#361)", async (s) => {
  await acmeApi(s);
  await s.guildSettings({ language: "en", useThreads: true });
  s.model.script(START, [read(0), ...READ_REST], [WRITE_CONVENTIONS, MAP_CHANGED, TRACE], ...MAPPED, ...WORKER, FINISH, written);
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(s.model.calls).toHaveLength(21);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [], reference: m.reference }))).toEqual([
    { content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, pinged: ["user-alice"], reference: undefined },
  ]);
});

const QUESTION = "Is src/users/dto/f.dto.ts still served, or can it be set aside?";
const ASK = { tool: "askChangelogAsker", args: { draft: DRAFT, question: QUESTION } };

discordScenario("a turn the model ends with a question in its answer goes on; askChangelogAsker pauses the draft with its question as the answer, pinging the asker, and anyone's reply that goes on with it sends it to the end (#356)", async (s) => {
  await acmeApi(s);
  await fastProgress();
  await agentLog();
  s.model.script(
    START, "Started the acme/api changelog. Shall I go on?",
    async () => { await progressShown(s); return read(0); }, ASK, "I asked Alice about the last DTO.",
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
    [1, 2, 3, 4].map(read), [WRITE_CONVENTIONS, MAP_CHANGED, TRACE], ...mappers([0, 1, 2, 3, 4]), ...WORKER, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} set it aside, it is not served any more`, { author: s.discord.bob });

  expect(s.model.calls).toHaveLength(5 + 2 + 18);
  expect(s.discord.botMessages.slice(2).map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: `<@user-alice> The acme/api changelog is written: ${WRITTEN}`, pinged: ["user-alice"] },
  ]);
  expect(await s.workspace.list(FOLDER)).toEqual([WRITTEN_FILE]);
});

discordScenario("a question longer than three short lines is refused and asks nothing; asked in the asker's own turn, the question replies to her message mentioning her as its reply, so she is notified and no one else is (#356, #361)", async (s) => {
  await acmeApi(s);
  const long = { tool: "askChangelogAsker", args: { draft: DRAFT, question: "I read the controller.\nI read the first DTO.\nThe last DTO looks unused.\nIs it still served, or can it be set aside?" } };
  s.model.script(START, long, ASK, "Asked.");
  const asked = await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(String(s.model.calls[2]!.findLast((m: any) => m.role === "tool")!.content)).toContain("Ask in at most 3 short lines");
  expect(s.model.calls).toHaveLength(4);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, reference: m.reference, allowedMentions: m.allowedMentions }))).toEqual([
    { content: QUESTION, reference: { messageId: asked.id }, allowedMentions: { parse: [], repliedUser: true } },
  ]);
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

discordScenario("a turn going on by itself whose model fails after it asked still posts the question and keeps it as its closing summary, and waits for an answer, not a model retry (#356, #358, #360)", async (s) => {
  await acmeApi(s);
  s.model.script(START, "Started the acme/api changelog.", ASK, { error: "I can't reach the AI service right now. Try again in a moment." });
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(s.model.calls).toHaveLength(4);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, pinged: m.allowedMentions?.users ?? [] }))).toEqual([
    { content: `<@user-alice> ${QUESTION}`, pinged: ["user-alice"] },
  ]);
  const meta = await draftMeta(s);
  expect(meta.work).toEqual({ state: "paused", reason: "question", question: QUESTION, since: "2026-10-22T03:00:00.000Z" });
  expect(meta.closingSummary).toBe(QUESTION);

  s.clock.advance(60_000);
  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(4);
});

/** What the model may learn of acme/api's global conventions in step 2, about 60 tokens. */
const CONVENTIONS = "NestJS: routes from @Controller and @Post, under the global prefix /api with URI versioning (v1, v2). Every success is wrapped as { data }; errors are { statusCode, message } from the global HttpExceptionFilter. Bodies are validated by class-validator; every route but /auth needs a Bearer JWT.";
const NOTE_CONVENTIONS = { tool: "putChangelogNotes", args: { draft: DRAFT, conventions: CONVENTIONS } };
/**
 * Alice's request worked through in four turns of two steps each: hers, then three that go on by themselves. The second turn's one mapping
 * worker reads and maps the first DTO and leaves no time for another; the third's map the rest, and the endpoint is traced.
 */
async function fourTurns(s: Scenario) {
  await oneWorkerATurn();
  const dto = (i: number) => [read(i), mapper(reaches(DTOS[i]!, "a body field changed"))[0]!];
  s.model.script(
    START, NOTE_CONVENTIONS, "Started the acme/api changelog and noted its conventions.",
    MAP_CHANGED, ...dto(0), outlasting(s, "Mapped."), "Mapped the first DTO.",
    MAP_CHANGED, ...[1, 2, 3, 4, 5].flatMap((i) => [...dto(i), "Mapped."]), ...mappers([]), TRACE, ...WORKER, "Recorded POST /api/v2/users.",
    FINISH, written,
  );
}
const toolsIn = (call: any[]) => call.filter((m) => m.role === "tool").map((m) => /source="tool:(\w+)/.exec(String(m.content))![1]);

discordScenario("a turn that goes on by itself starts from the draft alone: the draft's state, the repository's conventions and the last turn's closing summary, none of the earlier turns' steps (#360)", async (s) => {
  await acmeApi(s);
  await twoSteps(s);
  await agentLog();
  await fourTurns(s);
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(s.model.calls).toHaveLength(32);
  // The second turn: the system prompt, the draft's state and the per-turn context, nothing of Alice's turn.
  const second = s.model.calls[3]!;
  expect(second.map((m) => m.role)).toEqual(["system", "user", "user"]);
  const brief = String(second[1]!.content);
  expect(brief).toStartWith(DRAFT_TURN);
  expect(brief).not.toContain("from 1 to 22 October");
  // The draft's state, as data: its range and commits, every changed file left, no endpoint yet, the conventions and the last closing summary.
  expect(brief.split("\n")).toEqual(expect.arrayContaining([
    '<untrusted_data source="changelog draft">',
    `Draft: ${DRAFT} (acme/api, branch main, 2026-10-01 to 2026-10-22, commits 9f8e7d6..a1b2c3d)`,
    "Changed files: 7: 0 mapped, 0 set aside, 7 left.",
    "- src/users/users.controller.ts (modified, read whole)",
    ...DTOS.map((p) => `- ${p} (modified)`),
    "Endpoints recorded: none yet.",
    `Repository conventions: ${CONVENTIONS}`,
    "How the last turn ended: Started the acme/api changelog and noted its conventions.",
    "</untrusted_data>",
  ]));
  expect(String(second[2]!.content)).toContain(`Draft: ${DRAFT}`);

  // The third turn knows the second's reads only as the files its worker mapped and the candidate they reach, and its closing summary replaced the one before.
  const third = String(s.model.calls[8]![1]!.content);
  expect(s.model.calls[8]!.map((m) => m.role)).toEqual(["system", "user", "user"]);
  expect(third).toContain(`Changed files: 7: 1 mapped, 0 set aside, 6 left.
Mapped:
- src/users/dto/a.dto.ts → POST /api/v2/users
Left:
- src/users/users.controller.ts (modified, read whole)
${DTOS.slice(1).map((p) => `- ${p} (modified)`).join("\n")}
Endpoints recorded: none yet.
Candidate endpoints: 1: 0 traced, 0 failed, 1 waiting.
Waiting to be traced: POST /api/v2/users
`);
  expect(third).toContain("How the last turn ended: Mapped the first DTO.\n");
  expect(third).not.toContain("full_name");

  // The fourth turn sees what the third recorded.
  const fourth = String(s.model.calls[30]![1]!.content);
  expect(fourth).toContain("Changed files: 7: 7 mapped, 0 set aside, 0 left.\nMapped:\n- src/users/users.controller.ts → POST /api/v2/users\n");
  expect(fourth).toContain("Endpoints recorded (1):\n- POST /api/v2/users (breaking)\nComponents recorded: securitySchemes/bearerAuth, schemas/NewUser, schemas/User, schemas/UserEnvelope, schemas/Error\n");
  expect(fourth).toContain("How the last turn ended: Recorded POST /api/v2/users.\n");

  // Their steps are in the Agent log, one line a turn, beside one a worker.
  const steps = (await s.admin("GET", "/api/admin/logs?level=info&source=changelog")).body.entries.map((e: any) => e.text);
  const mapped = (calls: number) => `Mapping worker on 1 changed file (acme/api, draft 2026-10-22_9f8e7d6..a1b2c3d): ${calls} tool call${calls === 1 ? "" : "s"}, 1 mapped`;
  expect(steps).toEqual([
    mapped(2),
    "Went on with acme/api (branch main, draft 2026-10-22_9f8e7d6..a1b2c3d) in channel channel-1: mapChangedFiles ×1",
    mapped(2), mapped(2), mapped(2), mapped(2), mapped(2), mapped(1),
    "Worker on POST /api/v2/users (acme/api, draft 2026-10-22_9f8e7d6..a1b2c3d): 2 tool calls, traced",
    "Went on with acme/api (branch main, draft 2026-10-22_9f8e7d6..a1b2c3d) in channel channel-1: mapChangedFiles ×1, traceEndpoints ×1",
    "Went on with acme/api (branch main, draft 2026-10-22_9f8e7d6..a1b2c3d) in channel channel-1: finishChangelog ×1",
  ]);
});

discordScenario("the conversation keeps one closing-summary row per turn that went on by itself, and a person's later turn reads those rows, not their steps (#360)", async (s) => {
  await acmeApi(s);
  await twoSteps(s);
  await fourTurns(s);
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);
  s.model.script("Yes, it is written.");
  await s.discord.send(`${s.discord.mention} is the changelog done?`, { author: s.discord.bob });

  const bobs = s.model.calls[32]!;
  // Alice's own turn is read as it was stored, steps and all; each turn after it left only what it concluded.
  expect(toolsIn(bobs)).toEqual(["startChangelog", "putChangelogNotes"]);
  expect(bobs.filter((m) => m.role === "assistant" && !m.toolCalls?.length).map((m) => m.content)).toEqual([
    "Started the acme/api changelog and noted its conventions.", "Mapped the first DTO.", "Recorded POST /api/v2/users.", `The acme/api changelog is written: ${WRITTEN}`,
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
    [MAP_CHANGED, TRACE], ...MAPPED, ...WORKER, FINISH, written,
  );
  await s.discord.send(`${s.discord.mention} changelog acme/api from 1 to 22 October`);

  expect(missingFacts(refusal, /^conventions /, /1,8\d\d tokens/, "1,500")).toEqual([]);
  expect(kept).toBe(CONVENTIONS);
  // Kept for the draft's turns only: the written changelog has none of it.
  expect(await s.workspace.read(WRITTEN_FILE)).not.toContain("class-validator");
});
