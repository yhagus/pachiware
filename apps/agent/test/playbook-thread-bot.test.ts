import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("with two bots of one tenant in a guild, only the bot that started a playbook thread answers in it", async (s) => {
  const helper = await s.discord.addBot();
  s.model.script("Drafting from your point.", "Noted, Safari 17 and up.");
  const brief = await s.discord.send(`${s.discord.mention} issue: login loops on Safari`);
  await s.discord.send("Safari 17 and up", { channel: brief.thread });

  expect(brief.thread!.messages.filter((m) => m.author.bot).map((m) => [m.author.id, m.content])).toEqual([
    [s.discord.botUserId, "Drafting from your point."],
    [s.discord.botUserId, "Noted, Safari 17 and up."],
  ]);
  expect(helper.messages).toEqual([]);
  expect(s.model.calls).toHaveLength(2);
});

discordScenario("the second bot of a tenant answers in its own playbook thread while the first stays silent", async (s) => {
  const helper = await s.discord.addBot();
  s.model.script("Drafting from your point.", "Noted, Safari 17 and up.");
  const brief = await s.discord.send(`${helper.mention} issue: login loops on Safari`);
  await s.discord.send("Safari 17 and up", { channel: brief.thread });

  expect(brief.thread!.messages.filter((m) => m.author.bot).map((m) => [m.author.id, m.content])).toEqual([
    [helper.botUserId, "Drafting from your point."],
    [helper.botUserId, "Noted, Safari 17 and up."],
  ]);
  expect(s.discord.botMessages).toEqual([]);
});

discordScenario("a playbook thread bound before bindings recorded their bot is still answered", async (s) => {
  const thread = s.discord.channel("thread-9", { thread: true, parentId: "channel-1", ownerId: s.discord.botUserId });
  await s.workspace.write("guilds/guild-1/channels/channel-1/threads/thread-9.md", [
    "---", "playbook: issue-draft", "status: active", "guildId: guild-1", "channelId: channel-1", "threadId: thread-9",
    `authorId: ${s.discord.alice.id}`, "authorName: Alice", "botName: Pachiware", "sourceMessageId: thread-9", "startedAt: 2026-01-05T00:00:00.000Z",
    "---", "login loops on Safari", "",
  ].join("\n"));
  s.model.script("Noted, Safari 17 and up.");
  await s.discord.send("Safari 17 and up", { channel: thread });

  expect(s.discord.botMessages.map((m) => [m.channelId, m.content])).toEqual([["thread-9", "Noted, Safari 17 and up."]]);
  expect(s.model.calls[0]![0]!.content).toContain("### Playbook: issue-draft");
});
