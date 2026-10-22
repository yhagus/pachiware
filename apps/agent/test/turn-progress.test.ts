import { afterEach, expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

// The wait and the edit pace are shortened, so a turn of three slow model calls shows its progress.
let shipped: { showAfterMs: number; everyMs: number } | undefined;
async function fastProgress() {
  const { progressTiming } = await import("../src/discord/progress.ts");
  shipped ??= { ...progressTiming };
  Object.assign(progressTiming, { showAfterMs: 150, everyMs: 40 });
}
afterEach(async () => {
  if (!shipped) return;
  Object.assign((await import("../src/discord/progress.ts")).progressTiming, shipped);
  shipped = undefined;
});
const slow = (ms: number, step: any) => async () => { await new Promise((resolve) => setTimeout(resolve, ms)); return step; };
const states = (m: any) => m.edits.map((e: any) => e.content);

async function keptNotes(s: Scenario) {
  await s.guildSettings({ language: "en" });
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/standup.md", "Standup moved to 9.");
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/retro.md", "Retro on Friday.");
}

discordScenario("a turn still working after the wait posts one progress message in plain words, edits it as it goes, and shrinks it before the answer", async (s) => {
  await keptNotes(s);
  await fastProgress();
  s.model.script(
    slow(250, { tool: "listFiles", args: { path: "channel" } }),
    slow(250, [{ tool: "readFile", args: { path: "channel/notes/standup.md" } }, { tool: "readFile", args: { path: "channel/notes/retro.md" } }]),
    slow(200, "Two notes: standup moved to 9, and the retro is on Friday."),
  );
  await s.discord.send(`${s.discord.mention} what do we have kept here?`);

  const [progress, answer] = s.discord.botMessages;
  expect(answer!.content).toBe("Two notes: standup moved to 9, and the retro is on Friday.");
  // Each step as a person would say it, merged by kind, never a tool's name; then one line on how long it took.
  expect(states(progress)).toContain("🧠 Working…\n-# ✓ Going through what is kept here\n-# ✓ Reading 2 files");
  expect(states(progress).join("\n")).not.toMatch(/listFiles|readFile/);
  expect(progress!.content).toMatch(/^-# 🧠 Done in \d+ s$/);
});

discordScenario("a turn that answers before the wait posts no progress message", async (s) => {
  await keptNotes(s);
  await fastProgress();
  s.model.script({ tool: "listFiles", args: { path: "channel" } }, "Two notes.");
  await s.discord.send(`${s.discord.mention} what do we have kept here?`);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["Two notes."]);
});

discordScenario("the progress message speaks the asker's language", async (s) => {
  await keptNotes(s);
  await s.guildSettings({ language: "id" });
  await fastProgress();
  s.model.script(slow(250, { tool: "readFile", args: { path: "channel/notes/standup.md" } }), slow(200, "Standup pindah ke jam 9."));
  await s.discord.send(`${s.discord.mention} tolong cek catatan standup kita isinya apa ya?`);
  const [progress] = s.discord.botMessages;
  expect(states(progress)).toContain("🧠 Sedang mengerjakan…\n-# ✓ Membaca standup");
  expect(progress!.content).toMatch(/^-# 🧠 Selesai dalam \d+ detik$/);
});
