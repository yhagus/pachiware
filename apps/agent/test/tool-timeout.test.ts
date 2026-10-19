import { afterEach, expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

// A tool call that hangs gives up at the ceiling instead of holding the turn (#220). The ceiling is 90 s; scenarios shorten it.

const NEVER = new Promise<never>(() => {});

/**
 * A test skill whose tools answer only when the scenario says so: `slowLookup` reads, `slowSave` writes without asking for a Confirm,
 * `slowChain` runs three `slowLookup`s one after another as nested calls, the way recall runs its parts, and `slowAsk` gets the tool's context.
 */
async function slowSkill(s: Scenario, answers: { slowLookup?: () => Promise<unknown>; slowSave?: () => Promise<unknown>; slowAsk?: (ctx: any) => Promise<unknown> }) {
  const { skillRegistry } = await import("@pachiware/skills");
  const { repositories } = await import("../../../packages/db/src/index.ts");
  const text = { type: "object" as const, properties: { text: { type: "string" } } };
  const skill = {
    id: "test_slow", name: "Slow", description: "Tools that take their time.", confirmsInternally: true,
    tools: ["slowLookup", "slowSave", "slowChain", "slowAsk"].map((name) => ({ name, description: name, parameters: text })),
    toolPolicy: { slowLookup: { effect: "read" as const }, slowSave: { effect: "write" as const }, slowChain: { effect: "read" as const }, slowAsk: { effect: "read" as const } },
    handlers: {
      slowLookup: () => (answers.slowLookup ?? (() => NEVER))(), slowSave: () => (answers.slowSave ?? (() => NEVER))(),
      slowAsk: (_args: unknown, ctx: any) => (answers.slowAsk ?? (() => NEVER))(ctx),
      slowChain: async (_args: unknown, ctx: any) => { for (let i = 0; i < 3; i++) await ctx.tools.run("slowLookup", {}); return { parts: 3 }; },
    },
  };
  skillRegistry.registerSkill(skill as any);
  await repositories().skills.register({ id: skill.id, name: skill.name, description: skill.description, defaultEnabled: false, toolDefinitions: skill.tools, handlerType: "builtin", config: {} });
  await repositories().skills.enable(s.tenant.id, skill.id);
}

let shipped: number | undefined;
async function ceiling(ms: number) {
  const { toolTimeout } = await import("../src/loop/react.ts");
  shipped ??= toolTimeout.ms;
  toolTimeout.ms = ms;
}
afterEach(async () => {
  if (shipped === undefined) return;
  (await import("../src/loop/react.ts")).toolTimeout.ms = shipped;
  shipped = undefined;
});

const timeouts = async (s: Scenario) => {
  const { repositories } = await import("@pachiware/db");
  return (await repositories().usage.list({ tenantId: s.tenant.id, type: "guardrail_denied" })).map((e: any) => e.metadata).filter((m: any) => m.reason === "tool_timeout");
};

discordScenario("a tool that never answers gives the model a timeout error at the ceiling, the turn answers, and the timeout is audited", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  await slowSkill(s, {});
  await ceiling(60);
  let seen: any;
  s.model.script({ tool: "slowLookup", args: { text: "venue" } }, (turn) => { seen = turn.toolResults[0]; return "The lookup did not answer in time."; });
  await s.discord.send(`${s.discord.mention} look up the venue`);

  expect(seen).toEqual({ error: "The tool did not answer in time. A change may or may not have happened: check before trying again." });
  expect(s.discord.botMessages.at(-1)!.content).toBe("The lookup did not answer in time.");
  expect(await timeouts(s)).toEqual([expect.objectContaining({ kind: "limit", reason: "tool_timeout", tool: "slowLookup" })]);
});

discordScenario("in Indonesian the timeout error is in Indonesian", async (s) => {
  await s.guildSettings({ language: "id", useThreads: false });
  await slowSkill(s, {});
  await ceiling(60);
  let seen: any;
  s.model.script({ tool: "slowLookup", args: {} }, (turn) => { seen = turn.toolResults[0]; return "ok"; });
  await s.discord.send(`${s.discord.mention} cari tempatnya`);
  expect(seen).toEqual({ error: "Alatnya tidak menjawab tepat waktu. Perubahan mungkin sudah terjadi atau belum: periksa dulu sebelum mencoba lagi." });
});

discordScenario("a result that arrives after the ceiling is dropped: it never reaches the model or the stored history", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  let arrived = false;
  await slowSkill(s, { slowLookup: () => new Promise((resolve) => setTimeout(() => { arrived = true; resolve({ venue: "LATE-HALL" }); }, 200)) });
  await ceiling(40);
  s.model.script({ tool: "slowLookup", args: {} }, "gave up");
  await s.discord.send(`${s.discord.mention} look up the venue`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(arrived).toBe(true);

  s.model.script("still nothing");
  await s.discord.send(`${s.discord.mention} and now?`);
  expect(JSON.stringify(s.model.calls)).not.toContain("LATE-HALL");
});

discordScenario("a write that timed out before a provider failure is listed as uncertain, not as done", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  await slowSkill(s, {});
  await ceiling(40);
  s.model.script({ tool: "createTask", args: { title: "Book the venue" } }, { tool: "slowSave", args: { text: "venue" } }, { error: "I couldn't reach the model provider just now." });
  await s.discord.send(`${s.discord.mention} add a task and save the venue`);
  expect(s.discord.botMessages.at(-1)!.content).toBe(
    'Done before the failure:\n- Created task "Book the venue"\n\nNo answer in time, so these may or may not have happened:\n- slowSave\n\nI couldn\'t reach the model provider just now.',
  );
});

discordScenario("a recall part that hangs is reported under unavailable with the timeout reason while the other parts still return", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  await s.git({ provider: "github", repos: ["acme/*"] });
  s.http.on("GET api.github.com/user/repos", () => NEVER);
  await s.workspace.write("guilds/guild-1/channels/channel-1/minutes/2026-10-01-loudness.md", "# Loudness\nAudio normalization targets -14 LUFS.\n");
  // Long enough for the kept search to finish on a loaded machine, so only the hung git part times out.
  await ceiling(400);
  let result: any;
  s.model.script({ tool: "recall", args: { queries: ["audio normalization", "normalisasi audio"] } }, (turn) => { result = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} is audio normalization done?`);

  expect(result.unavailable).toMatchObject({ git: "The tool did not answer in time. A change may or may not have happened: check before trying again." });
  expect(result.kept.map((k: any) => k.path)).toEqual([expect.stringContaining("2026-10-01-loudness.md")]);
  expect(await timeouts(s)).toEqual([expect.objectContaining({ kind: "limit", reason: "tool_timeout", tool: "repoSearchWork" })]);
});

discordScenario("a call running nested calls one after another gives up at twice the ceiling, however many nested calls it starts", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  await slowSkill(s, {});
  // Three hung nested calls of 60 ms each would hold the chain for 180 ms; it is cut at 120 ms.
  await ceiling(60);
  let seen: any;
  s.model.script({ tool: "slowChain", args: {} }, (turn) => { seen = turn.toolResults[0]; return "gave up"; });
  await s.discord.send(`${s.discord.mention} look everything up`);
  expect(seen).toEqual({ error: "The tool did not answer in time. A change may or may not have happened: check before trying again." });
});

// A turn stops at its deadline (#254): no model call or tool call starts past it, and the turn ends with the summary the action budget gives.
let shippedDeadline: number | undefined;
async function deadline(ms: number) {
  const { turnDeadline } = await import("../src/loop/react.ts");
  shippedDeadline ??= turnDeadline.ms;
  turnDeadline.ms = ms;
}
afterEach(async () => {
  if (shippedDeadline === undefined) return;
  (await import("../src/loop/react.ts")).turnDeadline.ms = shippedDeadline;
  shippedDeadline = undefined;
});

discordScenario("past the turn's deadline the next tool call is not run and the turn ends with a summary of what was done", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  let saved = false;
  // The lookup outlasts the deadline by a wide margin, so a loaded machine cannot reach the deadline before the first model call.
  await slowSkill(s, { slowLookup: () => new Promise((resolve) => setTimeout(() => resolve({ venue: "Hall B" }), 1500)), slowSave: async () => { saved = true; return { saved: true }; } });
  await deadline(600);
  let asked: any[] = [];
  s.model.script([{ tool: "slowLookup", args: {} }, { tool: "slowSave", args: { text: "Hall B" } }], (turn) => { asked = turn.messages; return "I found Hall B but ran out of time before saving it."; });
  await s.discord.send(`${s.discord.mention} look up the venue and save it`);

  expect(saved).toBe(false);
  const tools = asked.filter((m) => m.role === "tool").map((m) => String(m.content));
  expect(tools[0]).toContain("Hall B");
  expect(tools[1]).toContain("This tool call was not run: the turn ran out of time. Say it was not done.");
  expect(String(asked.at(-1).content)).toBe("The time for this turn ran out. Summarize what was completed, mention any unfinished work, and give the next concrete step. Do not call tools.");
  expect(s.discord.botMessages.at(-1)!.content).toBe("I found Hall B but ran out of time before saving it.");
  expect(s.model.calls.length).toBe(2);
  const { repositories } = await import("@pachiware/db");
  const limits = (await repositories().usage.list({ tenantId: s.tenant.id, type: "guardrail_denied" })).map((e: any) => e.metadata).filter((m: any) => m.kind === "limit" && m.synthesized);
  expect(limits).toEqual([expect.objectContaining({ source: "deadline" })]);
});

// A tool's own model call (ctx.complete: keywords, image descriptions, Minutes, the reader of long files) stops at the turn's deadline too (#265).
discordScenario("a tool's own model call made past the turn's deadline gets no answer and never reaches the model", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  let answer: unknown = "not asked";
  // The tool asks only after waiting longer than the whole turn may last, so its call is made past the deadline however loaded the machine is.
  await slowSkill(s, { slowAsk: async (ctx) => { await new Promise((resolve) => setTimeout(resolve, 900)); answer = await ctx.complete({ system: "Name the venue in one word.", user: "Hall B or Hall C?" }); return { asked: true }; } });
  await deadline(600);
  s.model.script({ tool: "slowAsk", args: {} }, "I ran out of time before the venue was named.");
  await s.discord.send(`${s.discord.mention} which hall is the venue?`);

  expect(answer).toBeNull();
  expect(s.model.calls.map((call) => call[0]?.content)).not.toContain("Name the venue in one word.");
  expect(s.model.calls.length).toBe(2);
  expect(s.discord.botMessages.at(-1)!.content).toBe("I ran out of time before the venue was named.");
});

// A tool that spends model time (the reader of long files, #266) plans within the time its call has left.
discordScenario("a tool call sees when it must answer: at the tool ceiling, or at the turn's deadline when that comes first", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  let seen: { at: number; ends: unknown } | undefined;
  await slowSkill(s, { slowAsk: async (ctx) => { seen = { at: Date.now(), ends: ctx.callDeadline?.() }; return { asked: true }; } });

  // The ceiling (90 s) is far past a 5 s turn: the call must answer by the turn's deadline.
  await deadline(5000);
  s.model.script({ tool: "slowAsk", args: {} }, "done");
  await s.discord.send(`${s.discord.mention} which hall is the venue?`);
  expect(typeof seen!.ends).toBe("number");
  expect((seen!.ends as number) - seen!.at).toBeGreaterThan(0);
  expect((seen!.ends as number) - seen!.at).toBeLessThanOrEqual(5000);

  // A 3 s ceiling comes long before the 180 s turn's deadline.
  (await import("../src/loop/react.ts")).turnDeadline.ms = shippedDeadline!;
  await ceiling(3000);
  s.model.script({ tool: "slowAsk", args: {} }, "done");
  await s.discord.send(`${s.discord.mention} and the room?`);
  expect((seen!.ends as number) - seen!.at).toBeGreaterThan(0);
  expect((seen!.ends as number) - seen!.at).toBeLessThanOrEqual(3000);
});

discordScenario("a turn without a saved iteration setting gets the shared default of 32 model calls, not 12", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  const { repositories } = await import("@pachiware/db");
  const config = await repositories().agentConfig.get(s.tenant.id);
  await repositories().agentConfig.update(s.tenant.id, { settings: { ...(config?.settings ?? {}), maxReActIterations: undefined } } as any);
  s.model.script(...Array.from({ length: 13 }, () => ({ tool: "listTasks", args: {} })), "thirteen lists later");
  await s.discord.send(`${s.discord.mention} keep listing`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("thirteen lists later");
});
