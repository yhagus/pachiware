import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("readChannelHistory hands the model the current channel's recent history as a transcript", async (s) => {
  await s.guildSettings({ useThreads: false });
  const { alice, bob } = s.discord;
  const minute = 60_000, now = Date.now();
  s.discord.history([
    { content: "yesterday's leftovers", author: bob, at: now - 25 * 60 * minute },
    { content: "Which day do we release?", author: alice, at: now - 30 * minute },
    { content: "deploy finished", author: { id: "ci-bot", name: "CI", bot: true }, at: now - 25 * minute },
    { content: "Friday works for me", author: bob, at: now - 20 * minute },
  ]);
  s.model.script({ tool: "readChannelHistory", args: {} }, (turn) => `history: ${JSON.stringify(turn.toolResults[0])}`);
  await s.discord.send(`${s.discord.mention} what was discussed here this morning?`);

  const result = JSON.parse(s.discord.botMessages.at(-1)!.content.replace(/^history: /, ""));
  expect(result.channelId).toBe("channel-1");
  expect(result.count).toBe(3);
  expect(result.transcript.split("\n")).toEqual([
    expect.stringMatching(/^\[1\] \d{4}-\d{2}-\d{2} \d{2}:\d{2} Alice: Which day do we release\?$/),
    expect.stringMatching(/^\[2\] \d{4}-\d{2}-\d{2} \d{2}:\d{2} Bob: Friday works for me$/),
    expect.stringMatching(/^\[3\] \d{4}-\d{2}-\d{2} \d{2}:\d{2} Alice: .*what was discussed here this morning\?$/),
  ]);
  expect(result.transcript).not.toContain("leftovers");
  expect(result.transcript).not.toContain("deploy finished");

  const toolMessage = s.model.calls[1]!.findLast((m) => m.role === "tool")!;
  expect(toolMessage.content).toMatch(/^<untrusted_data[^>]*>[\s\S]*<\/untrusted_data>$/);
});

discordScenario("a channel named by mention is read for someone who can read it and refused to someone who cannot", async (s) => {
  await s.guildSettings({ useThreads: false });
  const { alice, bob } = s.discord;
  const design = s.discord.channel("channel-design");
  s.discord.history([{ content: "Let's go with the blue palette", author: alice, at: Date.now() - 600_000 }], { channel: design });
  s.discord.deny(design, bob.id, ["ReadMessageHistory"]);
  const answer = (turn: any) => `history: ${JSON.stringify(turn.toolResults[0])}`;
  s.model.script({ tool: "readChannelHistory", args: { channelId: "<#channel-design>" } }, answer);
  s.model.script({ tool: "readChannelHistory", args: { channelId: "<#channel-design>" } }, answer);

  await s.discord.send(`${s.discord.mention} what was discussed in <#channel-design> this morning?`, { author: alice });
  const seen = JSON.parse(s.discord.botMessages.at(-1)!.content.replace(/^history: /, ""));
  expect(seen).toMatchObject({ channelId: "channel-design", count: 1, transcript: expect.stringContaining("Alice: Let's go with the blue palette") });

  await s.discord.send(`${s.discord.mention} what was discussed in <#channel-design> this morning?`, { author: bob });
  const refused = JSON.parse(s.discord.botMessages.at(-1)!.content.replace(/^history: /, ""));
  expect(refused).toEqual({ error: expect.stringContaining("Read Message History") });
  expect(refused.error).not.toContain("blue palette");
});

discordScenario("since and limit narrow the history, and the bot missing a permission or a DM is refused", async (s) => {
  await s.guildSettings({ useThreads: false });
  const { alice, bob } = s.discord;
  const minute = 60_000, now = Date.now();
  s.discord.history([
    { content: "first", author: alice, at: now - 50 * minute },
    { content: "second", author: bob, at: now - 40 * minute },
    { content: "third", author: alice, at: now - 30 * minute },
    { content: "fourth", author: bob, at: now - 20 * minute },
  ]);
  const answer = (turn: any) => `history: ${JSON.stringify(turn.toolResults[0])}`;
  const since = new Date(now - 45 * minute).toISOString();
  s.model.script([{ tool: "readChannelHistory", args: { since } }, { tool: "readChannelHistory", args: { limit: 2 } }], (turn) => `history: ${JSON.stringify(turn.toolResults)}`);
  await s.discord.send(`${s.discord.mention} recap`);
  const [bySince, byLimit] = JSON.parse(s.discord.botMessages.at(-1)!.content.replace(/^history: /, ""));
  const texts = (r: any) => r.transcript.split("\n").map((line: string) => line.replace(/^\[\d+\] \S+ \S+ /, ""));
  expect(texts(bySince)).toEqual(["Bob: second", "Alice: third", "Bob: fourth", expect.stringContaining("recap")]);
  expect(bySince.note).toBeUndefined();
  expect(texts(byLimit)).toEqual(["Bob: fourth", expect.stringContaining("recap")]);
  expect(byLimit.note).toMatch(/latest 2 messages/);

  s.discord.deny("channel-1", s.discord.botUserId, ["ReadMessageHistory"]);
  s.model.script({ tool: "readChannelHistory", args: { limit: 1000 } }, answer);
  await s.discord.send(`${s.discord.mention} recap`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content.replace(/^history: /, ""))).toEqual({ error: expect.stringContaining("missing the Read Message History permission") });

  const dm = s.discord.channel("dm-alice", { dm: true });
  s.model.script({ tool: "readChannelHistory", args: {} }, answer);
  await s.discord.send("recap", { channel: dm });
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content.replace(/^history: /, ""))).toEqual({ error: expect.stringContaining("Discord server channel") });
});
