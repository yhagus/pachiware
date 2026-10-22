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

const RECORD_NOW = "This turn is nearly out of time. Before anything else, record with your playbook's tools everything you have finished but not recorded yet, then go on with the rest: the next turn continues from what is recorded, not from what you read.";
const lastSent = (call: any[]) => call.at(-1)!.content;

discordScenario("a long playbook's turn is told once to record what it finished, when 80% of its time has passed", async (s) => {
  await s.guildSettings({ language: "en" });
  await playbook(s, "trace", true);
  await longDeadline(4000);
  const lookupFor = (ms: number) => async () => { await new Promise((resolve) => setTimeout(resolve, ms)); return { tool: "listFiles", args: { path: "channel" } }; };
  // 3.3 s of 4 s is past 80%: the next call carries the instruction, and the one after it does not get it again.
  s.model.script(lookupFor(3300), { tool: "listFiles", args: { path: "channel" } }, "Recorded GET /users; POST /users is left.");
  const started = await s.discord.send(`${s.discord.mention} trace: the users API`);

  expect(s.model.calls.map(lastSent).filter((c) => c === RECORD_NOW)).toHaveLength(1);
  expect(lastSent(s.model.calls[1]!)).toBe(RECORD_NOW);
  // A turn that answers after recording is not out of budget: nothing goes on by itself.
  expect(said(started.thread)).toEqual(["Recorded GET /users; POST /users is left."]);
});

discordScenario("a long playbook's turn is told to record after 102 of its 128 model calls, and another playbook's turn never is", async (s) => {
  await s.guildSettings({ language: "en" });
  await playbook(s, "trace", true);
  await playbook(s, "brief", false);
  s.model.script(...lookups(103), "Traced 103.");
  await s.discord.send(`${s.discord.mention} trace: the users API`);
  expect(s.model.calls.map(lastSent).flatMap((c, i) => (c === RECORD_NOW ? [i] : []))).toEqual([102]);

  s.model.script(...lookups(32), "Traced 32; the rest is left.");
  await s.discord.send(`${s.discord.mention} brief: the users API`);
  expect(s.model.calls.slice(104).map(lastSent)).not.toContain(RECORD_NOW);
});

const EMPTY_ANSWER = "Your last answer was empty. Summarize what was completed, mention any unfinished work, and give the next concrete step. Do not call tools.";

discordScenario("an empty answer after a long playbook's tool work is asked for again without tools, and the work goes on by itself", async (s) => {
  await s.guildSettings({ language: "en" });
  await playbook(s, "trace", true);
  s.model.script({ tool: "listFiles", args: { path: "channel" } }, "", "Traced GET /users; POST /users is left.", "Traced POST /users.");
  const started = await s.discord.send(`${s.discord.mention} trace: the users API`);

  expect(lastSent(s.model.calls[2]!)).toBe(EMPTY_ANSWER);
  expect(said(started.thread)).toEqual(["Traced GET /users; POST /users is left.\nNot finished yet: continuing on my own (1 of 2).", "Traced POST /users."]);
  // The empty answer is not kept: the turn that goes on reads the summary as the bot's last word.
  const history = s.model.calls[3]!.filter((m: any) => m.role === "assistant").map((m: any) => m.content);
  expect(history).not.toContain("");
  expect(history.at(-1)).toBe("Traced GET /users; POST /users is left.");
});

discordScenario("an empty answer after tool work in a chat is asked for once more instead of being called done", async (s) => {
  await s.guildSettings({ language: "en" });
  s.model.script({ tool: "listFiles", args: { path: "channel" } }, "", "The channel folder is empty.");
  await s.discord.send(`${s.discord.mention} what's in our files?`);
  expect(lastSent(s.model.calls[2]!)).toBe(EMPTY_ANSWER);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["The channel folder is empty."]);
  expect(s.model.calls).toHaveLength(3);
});

const CUT_EMPTY = "Your last response reached the output limit before any of it arrived, so nothing was said or run. Keep your thinking short and make the next step smaller, for example by splitting the content over several calls.";
const CUT_SPENT = "Your last responses kept reaching the output limit before any of them arrived. Summarize what was completed, mention any unfinished work, and give the next concrete step. Do not call tools.";

discordScenario("a response cut before any of it arrived is asked for smaller, and the turn goes on", async (s) => {
  await s.guildSettings({ language: "en" });
  await playbook(s, "trace", true);
  s.model.script({ tool: "listFiles", args: { path: "channel" } }, { cut: "" }, { tool: "listFiles", args: { path: "channel" } }, "Traced GET /users.");
  const started = await s.discord.send(`${s.discord.mention} trace: the users API`);
  expect(lastSent(s.model.calls[2]!)).toBe(CUT_EMPTY);
  expect(said(started.thread)).toEqual(["Traced GET /users."]);
});

discordScenario("a response cut before any of it arrived three times ends the turn with a summary, and a long playbook goes on by itself", async (s) => {
  await s.guildSettings({ language: "en" });
  await playbook(s, "trace", true);
  s.model.script({ tool: "listFiles", args: { path: "channel" } }, { cut: "" }, { cut: "" }, { cut: "" }, "Traced GET /users; POST /users is left.", "Traced POST /users.");
  const started = await s.discord.send(`${s.discord.mention} trace: the users API`);
  expect(s.model.calls.slice(2, 5).map(lastSent)).toEqual([CUT_EMPTY, CUT_EMPTY, CUT_SPENT]);
  expect(said(started.thread)).toEqual(["Traced GET /users; POST /users is left.\nNot finished yet: continuing on my own (1 of 2).", "Traced POST /users."]);
});

discordScenario("a long playbook's turn asks for at least 16,384 output tokens on every call, and a chat leaves the tenant's limit alone", async (s) => {
  await s.guildSettings({ language: "en" });
  await playbook(s, "trace", true);
  const { llmRouter } = await import("../src/llm/router.ts");
  const scripted = llmRouter.complete, floors: unknown[] = [];
  (llmRouter as any).complete = (messages: any, options: any) => { floors.push(options?.minOutputTokens); return scripted.call(llmRouter, messages, options); };
  try {
    s.model.script({ tool: "listFiles", args: { path: "channel" } }, "Traced.", "Hello.");
    await s.discord.send(`${s.discord.mention} trace: the users API`);
    expect(floors).toEqual([16384, 16384]);
    await s.discord.send(`${s.discord.mention} hi`, { channel: "channel-2" });
    expect(floors).toEqual([16384, 16384, undefined]);
  } finally { (llmRouter as any).complete = scripted; }
});
