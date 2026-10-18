import { afterEach, expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

// A tool call that hangs gives up at the ceiling instead of holding the turn (#220). The ceiling is 90 s; scenarios shorten it.

const NEVER = new Promise<never>(() => {});

/**
 * A test skill whose tools answer only when the scenario says so: `slowLookup` reads, `slowSave` writes without asking for a Confirm,
 * and `slowChain` runs three `slowLookup`s one after another as nested calls, the way recall runs its parts.
 */
async function slowSkill(s: Scenario, answers: { slowLookup?: () => Promise<unknown>; slowSave?: () => Promise<unknown> }) {
  const { skillRegistry } = await import("@pachiware/skills");
  const { repositories } = await import("../../../packages/db/src/index.ts");
  const text = { type: "object" as const, properties: { text: { type: "string" } } };
  const skill = {
    id: "test_slow", name: "Slow", description: "Tools that take their time.", confirmsInternally: true,
    tools: ["slowLookup", "slowSave", "slowChain"].map((name) => ({ name, description: name, parameters: text })),
    toolPolicy: { slowLookup: { effect: "read" as const }, slowSave: { effect: "write" as const }, slowChain: { effect: "read" as const } },
    handlers: {
      slowLookup: () => (answers.slowLookup ?? (() => NEVER))(), slowSave: () => (answers.slowSave ?? (() => NEVER))(),
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
  await ceiling(80);
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
