import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const CHANNEL_MEMORY = "guilds/guild-1/channels/channel-1/MEMORY.md";
const GUILD_MEMORY = "guilds/guild-1/shared/MEMORY.md";
const contextOf = (call: { role: string; content: unknown }[]) => String(call.findLast((m) => m.role === "user")?.content);

discordScenario("a channel remember lands in the channel's Memory without Confirm and shows in the next turn's context", async (s) => {
  s.model.script({ tool: "remember", args: { scope: "channel", text: "Bob prefers to be pinged in the morning" } }, (turn) => `kept in ${turn.toolResults[0].scope}`);
  const ask = await s.discord.send(`${s.discord.mention} remember that Bob prefers to be pinged in the morning`);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["kept in channel"]);
  expect(await s.workspace.read(CHANNEL_MEMORY)).toMatch(/^- \d{4}-\d{2}-\d{2} \(Alice\): Bob prefers to be pinged in the morning$/);

  s.model.script("ok");
  await s.discord.send("anything new?", { channel: ask.thread });
  const context = contextOf(s.model.calls.at(-1)!);
  expect(context).toContain("Memory (kept by you");
  expect(context).toContain("channel");
  expect(context).toContain("(Alice): Bob prefers to be pinged in the morning");
});

discordScenario("guild Memory refuses a plain user and accepts the same person after a Manage Server grant", async (s) => {
  const guildRemember = { tool: "remember", args: { scope: "guild", text: "Releases go out on Thursdays" } };
  s.model.script(guildRemember, (turn) => `refused: ${turn.toolResults[0].error}`);
  await s.discord.send(`${s.discord.mention} remember for the whole server: releases go out on Thursdays`);
  expect(s.discord.botMessages.at(-1)?.content).toMatch(/^refused: .*Manage Server/);
  expect(await s.workspace.read(GUILD_MEMORY)).toBeNull();

  s.discord.grant(s.discord.alice, ["ManageGuild"]);
  s.model.script(guildRemember, (turn) => `kept in ${turn.toolResults[0].scope}`);
  await s.discord.send(`${s.discord.mention} remember for the whole server: releases go out on Thursdays`, { channel: "channel-2" });
  expect(s.discord.botMessages.at(-1)?.content).toBe("kept in guild");
  expect(await s.workspace.read(GUILD_MEMORY)).toMatch(/^- \d{4}-\d{2}-\d{2} \(Alice\): Releases go out on Thursdays$/);
});

discordScenario("forget removes the lines matching case-insensitively and reports how many", async (s) => {
  await s.workspace.write(CHANNEL_MEMORY, ["- 2026-10-01 (Alice): Bob prefers to be pinged in the morning", "- 2026-10-02 (Alice): Standup is at 09:30", "- 2026-10-03 (Bob): BOB is away in November"].join("\n"));
  s.model.script({ tool: "forget", args: { scope: "channel", match: "bob" } }, (turn) => `removed ${turn.toolResults[0].removed}`);
  await s.discord.send(`${s.discord.mention} forget the lines about Bob`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("removed 2");
  expect(await s.workspace.read(CHANNEL_MEMORY)).toBe("- 2026-10-02 (Alice): Standup is at 09:30");
});

discordScenario("in a DM both scopes mean the person's own Memory", async (s) => {
  s.discord.channel("dm-alice", { dm: true });
  s.model.script({ tool: "remember", args: { scope: "guild", text: "Alice reads mail at 8" } }, (turn) => `kept in ${turn.toolResults[0].scope}`);
  await s.discord.send("remember that I read mail at 8", { channel: "dm-alice" });
  expect(s.discord.botMessages.at(-1)?.content).toBe("kept in dm");
  expect(await s.workspace.read("dms/user-alice/MEMORY.md")).toMatch(/^- \d{4}-\d{2}-\d{2} \(Alice\): Alice reads mail at 8$/);
});

const TODAY = "2026-10-14", YESTERDAY_LINE = "- 2026-10-13 (Bob): Standup moved to 10:00";
const oldLines = () => {
  const lines: string[] = [];
  while (lines.join("\n").length < 3900) lines.push(`- 2026-07-${String((lines.length % 28) + 1).padStart(2, "0")} (Alice): Old fact ${lines.length + 1} about the office layout and the badges`);
  return lines;
};
const fullMemory = () => [...oldLines(), YESTERDAY_LINE].join("\n");
const rememberOver = { tool: "remember", args: { scope: "channel", text: "Releases go out on Thursdays" } };

discordScenario("a compaction that drops a line dated yesterday is discarded and the oldest lines beyond the cap go instead", async (s) => {
  s.clock.set(`${TODAY}T09:00:00Z`);
  await s.workspace.write(CHANNEL_MEMORY, fullMemory());
  s.model.script(rememberOver, ["- 2026-07-01 (Alice): Old facts about the office", `- ${TODAY} (Alice): Releases go out on Thursdays`].join("\n"), "kept");
  await s.discord.send(`${s.discord.mention} remember that releases go out on Thursdays`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("kept");

  expect(s.model.tools[1]).toEqual([]);
  expect(String(s.model.calls[1].at(-1)?.content)).toContain(YESTERDAY_LINE);

  const lines = (await s.workspace.read(CHANNEL_MEMORY))!.split("\n");
  expect(lines).toContain(YESTERDAY_LINE);
  expect(lines).toContain(`- ${TODAY} (Alice): Releases go out on Thursdays`);
  expect(lines[0]).not.toBe(oldLines()[0]);
  expect(lines.at(-1)).toMatch(new RegExp(`^- ${TODAY} \\(bot\\): .+`));
  expect(lines.join("\n").length).toBeLessThanOrEqual(4000);
});

discordScenario("a compaction that keeps every line from the last 30 days is stored with a dated line recording it", async (s) => {
  s.clock.set(`${TODAY}T09:00:00Z`);
  await s.workspace.write(CHANNEL_MEMORY, fullMemory());
  const compacted = ["- 2026-07-28 (Alice): The office layout and badge facts, merged", YESTERDAY_LINE, `- ${TODAY} (Alice): Releases go out on Thursdays`].join("\n");
  s.model.script(rememberOver, compacted, "kept");
  await s.discord.send(`${s.discord.mention} remember that releases go out on Thursdays`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("kept");

  const lines = (await s.workspace.read(CHANNEL_MEMORY))!.split("\n");
  expect(lines.slice(0, 3).join("\n")).toBe(compacted);
  expect(lines).toHaveLength(4);
  expect(lines[3]).toMatch(new RegExp(`^- ${TODAY} \\(bot\\): .+`));
});

discordScenario("a remember that stays under the cap makes no compaction call", async (s) => {
  s.clock.set(`${TODAY}T09:00:00Z`);
  await s.workspace.write(CHANNEL_MEMORY, YESTERDAY_LINE);
  s.model.script(rememberOver, "kept");
  await s.discord.send(`${s.discord.mention} remember that releases go out on Thursdays`);
  expect(s.model.calls).toHaveLength(2);
  expect(await s.workspace.read(CHANNEL_MEMORY)).toBe(`${YESTERDAY_LINE}\n- ${TODAY} (Alice): Releases go out on Thursdays`);
});
