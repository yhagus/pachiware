import { afterEach, expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const FOLDER = "guilds/guild-1/channels/channel-1/files/changelogs/acme-api";
const DRAFT_FILE = `${FOLDER}/2026-10-22_9f8e7d6..a1b2c3d.draft.json`;

/** Alice's open Changelog draft of acme/api, started in `place` (a public thread shares its channel's folder), with one of its three changed files examined. */
async function aliceDraft(s: Scenario, place = "channel-1") {
  const changelog = { date: "2026-10-22", base: { ref: "main before 2026-10-01", commit: "9f8e7d6" }, head: { ref: "main through 2026-10-22", commit: "a1b2c3d" }, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, globalChanges: [], removedOperations: [], unverified: [] };
  await s.workspace.write(DRAFT_FILE, JSON.stringify({
    openapi: "3.1.2", info: { title: "acme/api API changes", version: "a1b2c3d", "x-changelog": changelog }, paths: {}, components: {},
    "x-draft": {
      repo: "acme/api", branch: "main", scope: "range", from: "2026-10-01", to: "2026-10-22", place, startedBy: { id: "user-alice", name: "Alice" }, changedFiles: 3,
      base: "9f8e7d6".padEnd(40, "0"), head: "a1b2c3d".padEnd(40, "0"), files: [{ path: "a.ts", status: "modified" }, { path: "b.ts", status: "modified" }, { path: "c.ts", status: "modified" }], examined: ["a.ts"],
      touchedAt: new Date().toISOString(),
    },
  }));
}

// A chat turn's deadline is shortened, so each turn of the work runs out of time after one slow model call.
let shippedTurn: number | undefined;
async function turnDeadline(ms: number) {
  const { turnDeadline } = await import("../src/loop/react.ts");
  shippedTurn ??= turnDeadline.ms;
  turnDeadline.ms = ms;
}
afterEach(async () => {
  if (shippedTurn === undefined) return;
  (await import("../src/loop/react.ts")).turnDeadline.ms = shippedTurn;
  shippedTurn = undefined;
});
const slowLookup = async () => { await new Promise((resolve) => setTimeout(resolve, 900)); return { tool: "listFiles", args: { path: "channel" } }; };

discordScenario("a turn that goes on by itself with a Changelog draft open needs only its place and asker: with the message that started the work deleted, it answers as a new message in the channel", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  await aliceDraft(s);
  await turnDeadline(600);
  s.model.script(
    // Alice deletes her message while the first turn works; Discord refuses a reply to a deleted message.
    async () => { void s.discord.deleteMessage(s.discord.channel("channel-1").messages.find((m) => !m.author.bot)!); return slowLookup(); },
    "Traced GET /users; POST /users is left.",
    "Traced POST /users.",
  );
  await s.discord.send(`${s.discord.mention} lanjut changelog-nya`);

  expect(s.model.calls).toHaveLength(3);
  expect(s.discord.botMessages.map((m) => ({ content: m.content, reference: m.reference }))).toEqual([{ content: "Traced POST /users.", reference: undefined }]);
});

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
const draftMeta = async (s: Scenario) => JSON.parse((await s.workspace.read(DRAFT_FILE))!)["x-draft"];

discordScenario("the draft keeps where its progress message is, the one message the turns that go on by themselves edit", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  await aliceDraft(s);
  await turnDeadline(600);
  await fastProgress();
  s.model.script(slowLookup, "Part 1 done.", slowLookup, "Part 2 done.", "All traced.");
  await s.discord.send(`${s.discord.mention} lanjut changelog-nya`);

  expect(s.model.calls).toHaveLength(5);
  const [progress, answer, ...rest] = s.discord.botMessages;
  expect(rest).toEqual([]);
  expect(answer!.content).toBe("All traced.");
  expect(progress!.content).toMatch(/^-# 🧠 Done in /);
  expect((await draftMeta(s)).progressMessage).toEqual({ channelId: "channel-1", messageId: progress!.id });
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

discordScenario("the Stop button names the draft: only its asker can press it, which cuts the running turn at its next tool call and keeps the draft open", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  await aliceDraft(s);
  await fastProgress();
  const buttons: string[] = [], clicks: Promise<any>[] = [];
  s.model.script(
    async () => {
      await pause(400);
      const progress = s.discord.botMessages.find((m) => m.components.length)!;
      buttons.push(...progress.components.flatMap((row: any) => row.components.map((c: any) => c.custom_id)));
      clicks.push(s.discord.click(progress, "Stop", { user: s.discord.bob }));
      await pause(50);
      clicks.push(s.discord.click(progress, "Stop"));
      await pause(50);
      return { tool: "listFiles", args: { path: "channel" } };
    },
    "Paused with 1 of 3 changed files done.",
  );
  // Bob goes on with Alice's changelog: it is still hers to stop.
  await s.discord.send(`${s.discord.mention} lanjut changelog-nya`, { author: s.discord.bob });
  const [bob, alice] = await Promise.all(clicks);

  expect(buttons).toEqual(["changelogstop:2026-10-22_9f8e7d6..a1b2c3d"]);
  expect(bob.responses).toEqual([{ kind: "reply", payload: expect.objectContaining({ content: "Only Alice can stop this.", ephemeral: true }) }]);
  expect(alice.responses.map((r: any) => r.kind)).toEqual(["update"]);
  expect(s.model.calls).toHaveLength(2);
  expect(String(s.model.calls[1]!.find((m: any) => m.role === "tool")!.content)).toContain("This tool call was not run: the person stopped the turn.");
  expect(s.discord.botMessages.at(-1)!.content).toBe("Paused with 1 of 3 changed files done.");
  expect(await s.workspace.list(FOLDER)).toEqual([DRAFT_FILE]);
});
