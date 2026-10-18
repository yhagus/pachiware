import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

/** Every tool result of the turn as the model read it: the refusal text, or the result itself. */
const results = (turn: any) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? r));
const link = (channelId: string, messageId: string, guildId = "guild-1") => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

async function ask(s: Scenario, links: string[], options: { author?: Scenario["discord"]["alice"]; channel?: string } = {}) {
  s.model.script(links.map((l) => ({ tool: "readMessage", args: { link: l } })), results);
  await s.discord.send(`${s.discord.mention} what exactly did Bob say about it?`, options);
  return JSON.parse(s.discord.botMessages.at(-1)!.content);
}

discordScenario("the exact wording behind a Daily log item is the linked message, quoted with its speaker and time", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const { alice, bob } = s.discord;
  const [said] = s.discord.history([{ content: "Normalize audio to -14 LUFS before Friday", author: bob, at: Date.parse("2026-10-16T03:05:00Z") }]);
  const [result] = await ask(s, [link("channel-1", said!.id)], { author: alice });
  expect(result).toEqual({ link: link("channel-1", said!.id), channelId: "channel-1", author: "Bob", at: "2026-10-16 03:05 UTC", text: "Normalize audio to -14 LUFS before Friday" });
});

discordScenario("a link to a deleted message is reported as no longer there", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const { bob } = s.discord;
  const [said] = s.discord.history([{ content: "Ship it on Thursday", author: bob, at: Date.parse("2026-10-16T03:05:00Z") }]);
  await s.discord.deleteMessage(said!);
  const [result] = await ask(s, [link("channel-1", said!.id)]);
  expect(result).toEqual({ link: link("channel-1", said!.id), gone: true, note: "That message is no longer in Discord: it was deleted. Say so, and do not guess what it said." });
});

discordScenario("a message in a channel the asker cannot view or read is refused without its text", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const { alice, bob } = s.discord;
  s.discord.channel("channel-2");
  s.discord.channel("channel-3");
  const [hidden] = s.discord.history([{ content: "secret budget is 40k", author: bob }], { channel: "channel-2" });
  const [unread] = s.discord.history([{ content: "secret launch date", author: bob }], { channel: "channel-3" });
  s.discord.deny("channel-2", alice.id, ["ViewChannel"]);
  s.discord.deny("channel-3", alice.id, ["ReadMessageHistory"]);
  const said = await ask(s, [link("channel-2", hidden!.id), link("channel-3", unread!.id)], { author: alice });
  expect(said).toEqual([
    "You need View Channel in that channel to read its history, so I won't read it for you.",
    "You need Read Message History in that channel to read its history, so I won't read it for you.",
  ]);
});

discordScenario("a deleted message in a channel the asker cannot view is refused, not reported as gone", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const { alice, bob } = s.discord;
  s.discord.channel("channel-2");
  const [hidden] = s.discord.history([{ content: "secret", author: bob }], { channel: "channel-2" });
  await s.discord.deleteMessage(hidden!);
  s.discord.deny("channel-2", alice.id, ["ViewChannel"]);
  const [refused] = await ask(s, [link("channel-2", hidden!.id)], { author: alice });
  expect(refused).toBe("You need View Channel in that channel to read its history, so I won't read it for you.");
});

discordScenario("a non-public channel's message is shown in that channel, refused in #general, and not opened from a DM, as channel history is not", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const { alice, bob } = s.discord;
  s.discord.channel("channel-3").name = "direksi";
  s.discord.hide("channel-3");
  const [board] = s.discord.history([{ content: "Pricing for Q4 is settled", author: bob }], { channel: "channel-3" });
  const target = link("channel-3", board!.id);

  const [inGeneral] = await ask(s, [target], { author: alice });
  expect(inGeneral).toBe("That message is in a channel whose messages cannot be shown here. Do not say what or where it is; suggest asking in a DM instead.");
  const [inDireksi] = await ask(s, [target], { author: alice, channel: "channel-3" });
  expect(inDireksi).toMatchObject({ author: "Bob", text: "Pricing for Q4 is settled" });
  s.discord.channel("dm-alice", { dm: true });
  const [inDm] = await ask(s, [target], { author: alice, channel: "dm-alice" });
  // A DM has no guild override, so the refusal is in the tenant's language, Indonesian by default.
  expect(inDm).toContain("channel server Discord");
});

discordScenario("a link to another server, or no message link at all, is refused", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const { bob } = s.discord;
  await s.discord.joinGuild("guild-2", "Other");
  const elsewhere = s.discord.channel("channel-9", { guild: "guild-2" });
  const [there] = s.discord.history([{ content: "other server talk", author: bob }], { channel: elsewhere });
  const said = await ask(s, [link("channel-9", there!.id, "guild-2"), "channel-1 message 5"]);
  expect(said).toEqual([
    "That link points to another server; I only open messages of this server here.",
    "Give a Discord message link: https://discord.com/channels/<server>/<channel>/<message>.",
  ]);
});

discordScenario("a non-public channel's thread messages are shown in that channel, but a private thread's not inside another private thread", async (s) => {
  await s.guildSettings({ useThreads: false, language: "en" });
  const { alice, bob } = s.discord;
  s.discord.hide("channel-3");
  s.discord.channel("thread-public", { thread: true, parentId: "channel-3" });
  s.discord.channel("thread-private", { thread: true, parentId: "channel-3", private: true, members: [alice.id, bob.id] });
  s.discord.channel("thread-other", { thread: true, parentId: "channel-3", private: true, members: [alice.id] });
  const [open] = s.discord.history([{ content: "Draft is in the shared folder", author: bob }], { channel: "thread-public" });
  const [closed] = s.discord.history([{ content: "Salary bands are final", author: bob }], { channel: "thread-private" });
  const targets = [link("thread-public", open!.id), link("thread-private", closed!.id)];

  const inChannel = await ask(s, targets, { author: alice, channel: "channel-3" });
  expect(inChannel.map((r: any) => r.text)).toEqual(["Draft is in the shared folder", "Salary bands are final"]);
  const inOtherPrivate = await ask(s, targets, { author: alice, channel: "thread-other" });
  expect(inOtherPrivate).toEqual([
    expect.objectContaining({ text: "Draft is in the shared folder" }),
    "That message is in a channel whose messages cannot be shown here. Do not say what or where it is; suggest asking in a DM instead.",
  ]);
});
