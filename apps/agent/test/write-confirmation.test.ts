import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

/**
 * A skill that is not git, switched on for the scenario's tenant: every change goes through the shared Write confirmation helper.
 * `noteWipe` is for Trusted members only, and `noteBatch` needs its own Confirm.
 */
async function notebook(s: Scenario) {
  const { skillRegistry, confirmWrite } = await import("@pachiware/skills");
  const { repositories } = await import("../../../packages/db/src/index.ts");
  const notes: string[] = [];
  const text = { type: "object" as const, properties: { text: { type: "string" } }, required: ["text"] };
  const write = (tool: string, options: { access?: "anyone" | "trusted"; ownConfirmation?: boolean } = {}) =>
    (a: any, ctx: any) => confirmWrite(ctx, { tool, args: a, ...options }, () => ({ summary: `${tool} "${a.text}"`, run: async () => { notes.push(`${tool}:${a.text}`); return { done: a.text }; } }));
  const skill = {
    id: "test_notebook", name: "Notebook", description: "Notes kept for the test.", confirmsInternally: true,
    tools: ["noteWrite", "noteWipe", "noteBatch"].map((name) => ({ name, description: name, parameters: text })),
    toolPolicy: { noteWrite: { effect: "write" as const }, noteWipe: { effect: "danger" as const }, noteBatch: { effect: "write" as const } },
    handlers: { noteWrite: write("noteWrite"), noteWipe: write("noteWipe", { access: "trusted" }), noteBatch: write("noteBatch", { ownConfirmation: true }) },
  };
  skillRegistry.registerSkill(skill);
  await repositories().skills.register({ id: skill.id, name: skill.name, description: skill.description, defaultEnabled: false, toolDefinitions: skill.tools, handlerType: "builtin", config: {} });
  await repositories().skills.enable(s.tenant.id, skill.id);
  return notes;
}

const ask = async (s: Scenario, tool: string, text: string, options: { author?: any; channel?: string } = {}) => {
  s.model.script({ tool, args: { text } }, (turn) => `result: ${JSON.stringify(turn.toolResults[0])}`);
  await s.discord.send(`${s.discord.mention} ${tool} ${text}`, options);
  return s.discord.botMessages.at(-1)!;
};
const labels = (m: { components: any[] }) => m.components.flatMap((row: any) => row.components.map((b: any) => b.label));

discordScenario("a skill that is not git queues a change through the helper, and only the asker's Confirm runs it", async (s) => {
  const notes = await notebook(s);
  const confirmation = await ask(s, "noteWrite", "hello");
  expect(labels(confirmation)).toEqual(["Confirm", "Cancel", "Confirm changes in this thread"]);
  expect(notes).toEqual([]);

  const stranger = await s.discord.click(confirmation, "Confirm", { user: s.discord.bob });
  expect(stranger.responses).toMatchObject([{ kind: "reply", payload: { ephemeral: true } }]);
  expect(notes).toEqual([]);

  await s.discord.click(confirmation, "Confirm");
  expect(notes).toEqual(["noteWrite:hello"]);
  expect(confirmation.content).toContain("Completed");
});

discordScenario("a Trusted member's thread grant covers the next change of any skill in the thread, but not one that needs its own Confirm", async (s) => {
  process.env.TRUSTED_DISCORD_IDS = s.discord.alice.id;
  const notes = await notebook(s);
  const first = await ask(s, "noteWrite", "first");
  await s.discord.click(first, "Confirm changes in this thread");
  expect(notes).toEqual(["noteWrite:first"]);

  const thread = { channel: first.channelId };
  await ask(s, "noteWrite", "second", thread);
  expect(notes).toEqual(["noteWrite:first", "noteWrite:second"]);

  const own = await ask(s, "noteBatch", "third", thread);
  expect(labels(own)).toEqual(["Confirm", "Cancel"]);
  expect(notes).toEqual(["noteWrite:first", "noteWrite:second"]);
  await s.discord.click(own, "Confirm");
  expect(notes).toEqual(["noteWrite:first", "noteWrite:second", "noteBatch:third"]);
});

discordScenario("with TRUSTED_DISCORD_IDS set, someone listed only in GIT_OWNER_DISCORD_IDS cannot confirm changes for the thread", async (s) => {
  process.env.TRUSTED_DISCORD_IDS = s.discord.bob.id;
  process.env.GIT_OWNER_DISCORD_IDS = s.discord.alice.id;
  const notes = await notebook(s);
  const confirmation = await ask(s, "noteWrite", "hello");
  const click = await s.discord.click(confirmation, "Confirm changes in this thread");
  expect(click.responses).toMatchObject([{ kind: "reply", payload: { ephemeral: true, content: expect.stringContaining("Trusted member") } }]);
  expect(notes).toEqual([]);
});

discordScenario("an action for Trusted members only is refused for anyone else before any confirmation appears", async (s) => {
  process.env.TRUSTED_DISCORD_IDS = s.discord.alice.id;
  const notes = await notebook(s);
  const refused = await ask(s, "noteWipe", "all", { author: s.discord.bob });
  expect(refused.content).toContain("limited to Trusted members");
  expect(refused.components).toEqual([]);

  const queued = await ask(s, "noteWipe", "all");
  expect(labels(queued)).toContain("Confirm");
  await s.discord.click(queued, "Confirm");
  expect(notes).toEqual(["noteWipe:all"]);
});

discordScenario("the confirmation message and its buttons say nothing about Git", async (s) => {
  await notebook(s);
  const shared = await ask(s, "noteWrite", "hello");
  const own = await ask(s, "noteBatch", "batch");
  for (const m of [shared, own]) expect(JSON.stringify({ content: m.content, embeds: m.embeds, labels: labels(m) })).not.toMatch(/git/i);
});
