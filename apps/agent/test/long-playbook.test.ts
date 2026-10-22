import { afterEach, expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

/** A tenant playbook started by "@bot <word>: ...", with `budget: long` or without. */
async function playbook(s: Scenario, name: string, long: boolean) {
  await s.workspace.write(`shared/playbooks/${name}/PLAYBOOK.md`, `---\ndescription: Traces every endpoint\ntrigger: {"word": "${name}"}\nrequires: ["workspace"]\n${long ? "budget: long\n" : ""}---\nTrace every endpoint, one at a time.\n`);
}
const lookups = (n: number) => Array.from({ length: n }, () => ({ tool: "listFiles", args: { path: "channel" } }));
const said = (thread: any) => thread.messages.filter((m: any) => m.author.bot).map((m: any) => m.content);

discordScenario("a long playbook's turn runs past the 32 model calls another playbook's turn stops at", async (s) => {
  await s.guildSettings({ language: "en" });
  await playbook(s, "trace", true);
  await playbook(s, "brief", false);

  s.model.script(...lookups(40), "Traced all 40.");
  const long = await s.discord.send(`${s.discord.mention} trace: the users API`);
  expect(s.model.calls).toHaveLength(41);
  expect(said(long.thread)).toEqual(["Traced all 40."]);

  // The other stops at 32 and summarizes; nothing goes on by itself.
  s.model.script(...lookups(32), "Traced 32; the rest is left.");
  const short = await s.discord.send(`${s.discord.mention} brief: the users API`);
  expect(s.model.calls).toHaveLength(41 + 33);
  expect(String(s.model.calls.at(-1)!.at(-1)!.content)).toBe("The action budget for this turn is exhausted. Summarize what was completed, mention any unfinished work, and give the next concrete step. Do not call tools.");
  expect(said(short.thread)).toEqual(["Traced 32; the rest is left."]);
});

// The long deadline is shortened, so each turn of the work runs out of time after one slow model call.
let shipped: number | undefined;
async function longDeadline(ms: number) {
  const { longTurnDeadline } = await import("../src/loop/react.ts");
  shipped ??= longTurnDeadline.ms;
  longTurnDeadline.ms = ms;
}
afterEach(async () => {
  if (shipped === undefined) return;
  (await import("../src/loop/react.ts")).longTurnDeadline.ms = shipped;
  shipped = undefined;
});
const slowLookup = async () => { await new Promise((resolve) => setTimeout(resolve, 900)); return { tool: "listFiles", args: { path: "channel" } }; };

discordScenario("a long playbook's turn that runs out goes on by itself twice, then waits for a reply in the thread", async (s) => {
  await s.guildSettings({ language: "en" });
  await playbook(s, "trace", true);
  await longDeadline(600);
  s.model.script(slowLookup, "Traced GET /users.", slowLookup, "Traced POST /users.", slowLookup, "Traced DELETE /users/{id}.");
  const started = await s.discord.send(`${s.discord.mention} trace: the users API`);

  expect(said(started.thread)).toEqual([
    "Traced GET /users.\nNot finished yet: continuing on my own (1 of 2).",
    "Traced POST /users.\nNot finished yet: continuing on my own (2 of 2).",
    "Traced DELETE /users/{id}.\nStill not finished after 2 more turns. Reply here and I'll continue from where I stopped.",
  ]);
  // Each turn that went on by itself was the host's line, not a person's.
  const continued = "[No one wrote this: the last turn ran out of its budget before the work was done. Continue from where it stopped, building on what is already recorded; do not start over or repeat finished steps.]";
  expect([2, 4].map((i) => s.model.calls[i]!.at(-2)!.content)).toEqual([continued, continued]);
  expect(s.model.calls).toHaveLength(6);

  // A person's reply continues it, and a turn that answers goes on no further.
  s.model.script("All endpoints traced.");
  await s.discord.send("lanjut", { channel: started.thread });
  expect(said(started.thread).at(-1)).toBe("All endpoints traced.");
  expect(s.model.calls).toHaveLength(7);
});

discordScenario("the notes about going on are in the asker's language", async (s) => {
  await s.guildSettings({ language: "id" });
  await playbook(s, "trace", true);
  await longDeadline(600);
  s.model.script(slowLookup, "GET /users sudah.", "Semua endpoint sudah dilacak.");
  const started = await s.discord.send(`${s.discord.mention} trace: tolong lacak semua endpoint users yang berubah`);
  expect(said(started.thread)).toEqual(["GET /users sudah.\nBelum selesai: saya lanjutkan sendiri (1 dari 2).", "Semua endpoint sudah dilacak."]);
});
