import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const LAUNCH = "guilds/guild-1/channels/channel-1", BOARD = "guilds/guild-1/channels/channel-2";
const OPS = "guilds/guild-2/channels/beta-ops", VAULT = "guilds/guild-2/channels/beta-vault", STUDIO = "guilds/guild-3/channels/gamma-studio";
/** Every tool result of the turn as the model read it: the refusal text, or the result itself. */
const results = (turn: any) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? r));

/**
 * Alice is in Acme (guild-1: #launch, and #board which @everyone cannot view but she can) and Beta (guild-2: #ops, #vault she is denied).
 * Gamma (guild-3: #studio) has the bot and Bob but not Alice. Each channel holds Minutes on pricing.
 */
async function threeGuilds(s: Scenario) {
  await s.guildSettings({ language: "en" });
  s.discord.channel("channel-1").name = "launch";
  s.discord.channel("channel-2").name = "board";
  s.discord.hide("channel-2");
  await s.discord.joinGuild("guild-2", "Beta", { members: [s.discord.alice, s.discord.bob] });
  s.discord.channel("beta-ops", { guild: "guild-2" }).name = "ops";
  s.discord.channel("beta-vault", { guild: "guild-2" }).name = "vault";
  s.discord.deny("beta-vault", s.discord.alice.id, ["ViewChannel"]);
  await s.discord.joinGuild("guild-3", "Gamma", { members: [s.discord.bob] });
  s.discord.channel("gamma-studio", { guild: "guild-3" }).name = "studio";
  await s.workspace.write(`${LAUNCH}/minutes/2026-10-10-pricing.md`, "Launch pricing set\n");
  await s.workspace.write(`${BOARD}/minutes/2026-10-12-pricing.md`, "Board pricing approved\n");
  await s.workspace.write(`${OPS}/decisions/2026-10-11-pricing.md`, "Ops pricing decided\n");
  await s.workspace.write(`${VAULT}/minutes/2026-10-13-pricing.md`, "Vault pricing secret\n");
  await s.workspace.write(`${STUDIO}/minutes/2026-10-14-pricing.md`, "Studio pricing\n");
}
async function askInDm(s: Scenario, calls: { tool: string; args: Record<string, unknown> }[], who = s.discord.alice) {
  s.model.script(calls, results);
  await s.discord.send("what did we decide about pricing?", { channel: s.discord.channel(`dm-${who.id}`, { dm: true }), author: who });
  return JSON.parse(s.discord.botMessages.at(-1)!.content);
}
const hit = (path: string, text: string) => ({ path, lines: [{ line: 1, text }] });

discordScenario("from a DM, a member searches and reads the Minutes of every channel they can view in every guild they share with the bot, each labelled with its guild", async (s) => {
  await threeGuilds(s);
  expect(await askInDm(s, [
    { tool: "searchFiles", args: { query: "pricing" } },
    { tool: "readFile", args: { path: "#board (Acme)/minutes/2026-10-12-pricing.md" } },
    { tool: "listFiles", args: { path: "#ops (Beta)/decisions" } },
  ])).toEqual([
    {
      groups: [
        { channel: "#board (Acme)", matches: [hit("#board (Acme)/minutes/2026-10-12-pricing.md", "Board pricing approved")] },
        { channel: "#ops (Beta)", matches: [hit("#ops (Beta)/decisions/2026-10-11-pricing.md", "Ops pricing decided")] },
        { channel: "#launch (Acme)", matches: [hit("#launch (Acme)/minutes/2026-10-10-pricing.md", "Launch pricing set")] },
      ],
      total: 3, leftOut: 0,
    },
    { content: "Board pricing approved\n", version: expect.any(String) },
    { entries: [{ path: "#ops (Beta)/decisions/2026-10-11-pricing.md", type: "file", size: 20 }] },
  ]);
});

discordScenario("from a DM, a guild the member is not in and a channel they cannot view are never sources", async (s) => {
  await threeGuilds(s);
  const calls = [
    { tool: "searchFiles", args: { query: "vault pricing" } },
    { tool: "searchFiles", args: { query: "studio pricing" } },
    { tool: "readFile", args: { path: "#vault (Beta)/minutes/2026-10-13-pricing.md" } },
    { tool: "readFile", args: { path: "<#gamma-studio>/minutes/2026-10-14-pricing.md" } },
  ];
  expect(await askInDm(s, calls)).toEqual([
    { groups: [], total: 0, leftOut: 0 },
    { groups: [], total: 0, leftOut: 0 },
    "#vault (Beta) bukan channel yang file-nya bisa kamu baca dari sini.",
    "<#gamma-studio> bukan channel yang file-nya bisa kamu baca dari sini.",
  ]);
  expect(await askInDm(s, calls, s.discord.bob)).toEqual([
    { groups: [{ channel: "#vault (Beta)", matches: [hit("#vault (Beta)/minutes/2026-10-13-pricing.md", "Vault pricing secret")] }], total: 1, leftOut: 0 },
    { groups: [{ channel: "#studio (Gamma)", matches: [hit("#studio (Gamma)/minutes/2026-10-14-pricing.md", "Studio pricing")] }], total: 1, leftOut: 0 },
    { content: "Vault pricing secret\n", version: expect.any(String) },
    { content: "Studio pricing\n", version: expect.any(String) },
  ]);
});

discordScenario("from a DM, a private thread's files are read only by members added to the thread, and a deleted thread's by nobody", async (s) => {
  await threeGuilds(s);
  s.discord.channel("thread-plan", { thread: true, private: true, parentId: "channel-1", members: [s.discord.alice.id] }).name = "roadmap-call";
  await s.workspace.write(`${LAUNCH}/threads/thread-plan/minutes/2026-10-09-roadmap.md`, "Roadmap agreed in private\n");
  await s.workspace.write(`${LAUNCH}/threads/thread-gone/minutes/2026-10-08-roadmap.md`, "Roadmap from a deleted thread\n");
  await s.workspace.write(`${LAUNCH}/threads/thread-plan.md`, "Roadmap brief binding\n");
  const calls = [
    { tool: "searchFiles", args: { query: "roadmap" } },
    { tool: "readFile", args: { path: "#roadmap-call (Acme)/minutes/2026-10-09-roadmap.md" } },
    { tool: "listFiles", args: { path: "<#thread-plan>/minutes" } },
  ];
  expect(await askInDm(s, calls)).toEqual([
    { groups: [{ channel: "#roadmap-call (Acme)", matches: [hit("#roadmap-call (Acme)/minutes/2026-10-09-roadmap.md", "Roadmap agreed in private")] }], total: 1, leftOut: 0 },
    { content: "Roadmap agreed in private\n", version: expect.any(String) },
    { entries: [{ path: "#roadmap-call (Acme)/minutes/2026-10-09-roadmap.md", type: "file", size: 26 }] },
  ]);
  expect(await askInDm(s, calls, s.discord.bob)).toEqual([
    { groups: [], total: 0, leftOut: 0 },
    "#roadmap-call (Acme) bukan channel yang file-nya bisa kamu baca dari sini.",
    "<#thread-plan> bukan channel yang file-nya bisa kamu baca dari sini.",
  ]);
});

discordScenario("from a DM, a channel where an Availability rule turns the Workspace off is never a source, nor are its private threads", async (s) => {
  await threeGuilds(s);
  await s.availability({ level: "channel", guildId: "guild-2", channelId: "beta-ops" }, { kind: "skill", name: "workspace", value: "off" });
  s.discord.channel("ops-private", { thread: true, private: true, parentId: "beta-ops", members: [s.discord.alice.id] }).name = "ops-huddle";
  await s.workspace.write(`${OPS}/threads/ops-private/minutes/2026-10-09-pricing.md`, "Ops huddle pricing\n");
  expect(await askInDm(s, [
    { tool: "searchFiles", args: { query: "pricing" } },
    { tool: "readFile", args: { path: "#ops (Beta)/decisions/2026-10-11-pricing.md" } },
    { tool: "readFile", args: { path: "#ops-huddle (Beta)/minutes/2026-10-09-pricing.md" } },
  ])).toEqual([
    {
      groups: [
        { channel: "#board (Acme)", matches: [hit("#board (Acme)/minutes/2026-10-12-pricing.md", "Board pricing approved")] },
        { channel: "#launch (Acme)", matches: [hit("#launch (Acme)/minutes/2026-10-10-pricing.md", "Launch pricing set")] },
      ],
      total: 2, leftOut: 0,
    },
    "#ops (Beta) bukan channel yang file-nya bisa kamu baca dari sini.",
    "#ops-huddle (Beta) bukan channel yang file-nya bisa kamu baca dari sini.",
  ]);
});
