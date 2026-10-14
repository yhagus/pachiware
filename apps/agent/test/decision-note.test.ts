import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const systemPrompt = (messages: { role: string; content: any }[]) => String(messages.find((m) => m.role === "system")?.content);
const CHANNEL = "guilds/guild-1/channels/channel-1";
const TODAY = "2026-10-14";

discordScenario("the persona says how a Decision and a Note are filed, and names the Reminder list and cancel tools", async (s) => {
  s.model.script("ok");
  await s.discord.send(`${s.discord.mention} hi`);
  const prompt = systemPrompt(s.model.calls[0]!);
  expect(prompt).toMatch(/decisions\/<yyyy-mm-dd>-<slug>\.md/);
  expect(prompt).toMatch(/context[^.\n]*reason/i);
  expect(prompt).toMatch(/only when (someone )?ask/i);
  expect(prompt).toMatch(/remember line/i);
  expect(prompt).toMatch(/notes\/[^.\n]*(their|the person's) (own )?words/i);
  for (const name of ["listReminders", "cancelReminder"]) expect(prompt).toContain(name);
});

discordScenario("record this decision: one file under decisions/ named by date and slug, and one Memory line pointing at it", async (s) => {
  s.clock.set(`${TODAY}T09:00:00Z`);
  const decision = ["# Use Postgres", "", "Context: the team needs one database for tasks and schedules; SQLite is fine locally but not for two bots.", "Reason: Postgres 18 is already in docker-compose and the ops team runs it elsewhere.", "Decided by Alice on 2026-10-14."].join("\n");
  s.model.script(
    [
      { tool: "writeFile", args: { path: `channel/decisions/${TODAY}-use-postgres.md`, content: decision } },
      { tool: "remember", args: { level: "channel", text: `Decided: use Postgres (decisions/${TODAY}-use-postgres.md)` } },
    ],
    (turn) => (turn.toolResults.every((r: any) => r.success !== false && !r.error) ? "Recorded." : `not recorded: ${JSON.stringify(turn.toolResults)}`),
  );
  await s.discord.send(`${s.discord.mention} record this decision: we use Postgres, because it is already in docker-compose`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Recorded.");
  expect(await s.workspace.read(`${CHANNEL}/decisions/${TODAY}-use-postgres.md`)).toBe(decision);
  expect(await s.workspace.read(`${CHANNEL}/MEMORY.md`)).toBe(`- ${TODAY} (Alice): Decided: use Postgres (decisions/${TODAY}-use-postgres.md)`);
});

discordScenario("keep this as a note: a file under notes/ in the person's words and nothing in Memory", async (s) => {
  s.clock.set(`${TODAY}T09:00:00Z`);
  const words = "The vendor said the new badges arrive on the 20th and the old ones stop working on the 31st.";
  s.model.script({ tool: "writeFile", args: { path: `channel/notes/${TODAY}-badges.md`, content: words } }, (turn) => (turn.toolResults[0].success ? "Kept." : `not kept: ${turn.toolResults[0].error}`));
  await s.discord.send(`${s.discord.mention} keep this as a note: ${words}`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Kept.");
  expect(await s.workspace.read(`${CHANNEL}/notes/${TODAY}-badges.md`)).toBe(words);
  expect(await s.workspace.read(`${CHANNEL}/MEMORY.md`)).toBeNull();
  expect(await s.workspace.list(`${CHANNEL}/decisions`)).toEqual([]);
});
