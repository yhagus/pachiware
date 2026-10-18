import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const FOLDER = "guilds/guild-1/channels/channel-1/daily-logs";
const link = (channelId: string, id: string) => `https://discord.com/channels/guild-1/${channelId}/${id}`;

discordScenario("at 00:30 the scheduler writes yesterday's Daily log with its four parts and message links, and posts nothing", async (s) => {
  const { alice, bob } = s.discord;
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  const [, release, friday, announce, after] = s.discord.history([
    { content: "the day before", author: bob, at: Date.parse("2026-03-05T23:50:00+07:00") },
    { content: "Which day do we release?", author: alice, at: Date.parse("2026-03-06T10:00:00+07:00") },
    { content: "Friday. Agreed? I write the release notes by Thursday", author: bob, at: Date.parse("2026-03-06T10:05:00+07:00") },
    { content: "Agreed. Who announces it?", author: alice, at: Date.parse("2026-03-06T10:10:00+07:00") },
    { content: "the next day", author: bob, at: Date.parse("2026-03-07T00:10:00+07:00") },
  ]);

  s.clock.set("2026-03-07T00:29:00+07:00");
  await s.scheduler.tick();
  expect(await s.workspace.list(FOLDER)).toEqual([]);
  expect(s.model.calls).toHaveLength(0);

  s.model.script(JSON.stringify({
    topics: [{ name: "Release day", keywords: { id: ["hari rilis", "catatan rilis"], en: ["release day", "release notes"] }, refs: [1, 2] }],
    decided: [{ text: "Release on Friday", refs: [2, 3] }],
    open: [{ text: "Who announces the release", refs: [3] }],
    next: [{ owner: "Bob", task: "Write the release notes", due: "Thursday", refs: [2] }],
  }));
  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();

  const sent = s.model.calls[0]!.map((m) => m.content).join("\n");
  expect(sent).toContain("Which day do we release?");
  expect(sent).toContain("Who announces it?");
  expect(sent).not.toContain("the day before");
  expect(sent).not.toContain("the next day");
  expect(after).toBeDefined();

  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-03-06.md`]);
  const log = (await s.workspace.read(`${FOLDER}/2026-03-06.md`))!;
  expect(log).toContain("# Daily log #channel-1, 2026-03-06");
  expect(log).toContain("Topics: Release day");
  expect(log).toContain("Keywords: hari rilis, catatan rilis, release day, release notes");
  expect(log).toContain(`1. Release day: hari rilis, catatan rilis, release day, release notes [↗](${link("channel-1", release!.id)}) [↗](${link("channel-1", friday!.id)})`);
  expect(log).toContain("## Decided");
  expect(log).toContain(`2. Release on Friday [↗](${link("channel-1", friday!.id)}) [↗](${link("channel-1", announce!.id)})`);
  expect(log).toContain("## Still open");
  expect(log).toContain(`3. Who announces the release [↗](${link("channel-1", announce!.id)})`);
  expect(log).toContain("## Who does what next");
  expect(log).toContain(`4. **Bob**: Write the release notes (due Thursday) [↗](${link("channel-1", friday!.id)})`);
  expect(s.discord.botMessages).toEqual([]);

  s.clock.set("2026-03-07T09:00:00+07:00");
  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(1);
});

discordScenario("a Daily log reads people's messages and webhook posts, and leaves out other bots and the bot's own messages", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  const [asked, merged] = s.discord.history([
    { content: "Is the audio normalization in?", author: alice, at: Date.parse("2026-03-06T10:00:00+07:00") },
    { content: "", embeds: [{ title: "PR #88 merged: normalize audio loudness" }], author: { id: "hook-1", name: "GitHub" }, webhook: true, at: Date.parse("2026-03-06T10:05:00+07:00") },
    { content: "deploy finished", author: { id: "ci-bot", name: "CI", bot: true }, at: Date.parse("2026-03-06T10:06:00+07:00") },
    { content: "Noted, I will remember that.", author: { id: s.discord.botUserId, name: "Pachiware", bot: true }, at: Date.parse("2026-03-06T10:07:00+07:00") },
  ]);
  s.model.script(JSON.stringify({ topics: [{ name: "Audio normalization", keywords: { id: ["normalisasi audio"], en: ["audio normalization"] }, refs: [1, 2] }], decided: [], open: [], next: [] }));

  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();

  const sent = s.model.calls[0]!.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  expect(sent).toContain("Is the audio normalization in?");
  expect(sent).toContain("[embed: PR #88 merged: normalize audio loudness]");
  expect(sent).not.toContain("deploy finished");
  expect(sent).not.toContain("Noted, I will remember that.");
  const log = (await s.workspace.read(`${FOLDER}/2026-03-06.md`))!;
  expect(log).toContain(`1. Audio normalization: normalisasi audio, audio normalization [↗](${link("channel-1", asked!.id)}) [↗](${link("channel-1", merged!.id)})`);
});

discordScenario("a Daily log reads the channel's public threads and never a private thread", async (s) => {
  const { alice, bob } = s.discord;
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  const [starter] = s.discord.history([{ content: "Thread about the invoice template", author: alice, at: Date.parse("2026-03-06T09:00:00+07:00") }]);
  const open = s.discord.channel(starter!.id, { thread: true, parentId: "channel-1" });
  const [inThread] = s.discord.history([{ content: "Template v2 is approved", author: bob, at: Date.parse("2026-03-06T09:30:00+07:00") }], { channel: open });
  const hidden = s.discord.channel("private-1", { thread: true, parentId: "channel-1", private: true, members: [alice.id] });
  s.discord.history([{ content: "salary of the new hire", author: alice, at: Date.parse("2026-03-06T09:40:00+07:00") }], { channel: hidden });
  s.model.script(JSON.stringify({ topics: [{ name: "Invoice template", keywords: { id: ["templat faktur"], en: ["invoice template"] }, refs: [1, 2] }], decided: [{ text: "Template v2 approved", refs: [2] }], open: [], next: [] }));

  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();

  const sent = s.model.calls[0]!.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  expect(sent).toContain("Thread about the invoice template");
  expect(sent).toContain("Template v2 is approved");
  expect(sent).not.toContain("salary of the new hire");
  const log = (await s.workspace.read(`${FOLDER}/2026-03-06.md`))!;
  expect(log).toContain(`2. Template v2 approved [↗](${link(open.id, inThread!.id)})`);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/threads")).toEqual([]);
});

discordScenario("an Availability rule that turns the Daily log playbook off in a channel stops its Daily log there and nowhere else", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-06T08:00:00+07:00");
  s.discord.channel("channel-2");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }, { channelId: "channel-2", backfill: false }] });
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "playbook", name: "daily-log", value: "off" });
  s.discord.history([{ content: "Budget talk in channel one", author: alice, at: Date.parse("2026-03-06T10:00:00+07:00") }]);
  s.discord.history([{ content: "Hiring talk in channel two", author: alice, at: Date.parse("2026-03-06T10:00:00+07:00") }], { channel: "channel-2" });
  s.model.script(JSON.stringify({ topics: [{ name: "Hiring", keywords: { id: ["rekrutmen"], en: ["hiring"] }, refs: [1] }], decided: [], open: [], next: [] }));

  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();

  expect(s.model.calls).toHaveLength(1);
  expect(s.model.calls[0]!.map((m) => m.content).join("\n")).toContain("Hiring talk in channel two");
  expect(await s.workspace.list(FOLDER)).toEqual([]);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-2/daily-logs")).toEqual(["guilds/guild-1/channels/channel-2/daily-logs/2026-03-06.md"]);
});

discordScenario("a search from another channel finds a Public channel's Daily log and only counts a non-public channel's", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.guildSettings({ language: "en", useThreads: false, dailyLogChannels: [{ channelId: "channel-2", backfill: false }, { channelId: "channel-3", backfill: false }] });
  s.discord.channel("channel-1").name = "general";
  s.discord.channel("channel-2").name = "audio";
  s.discord.channel("channel-3").name = "direksi";
  s.discord.hide("channel-3");
  s.discord.history([{ content: "loudness target is -14 LUFS", author: alice, at: Date.parse("2026-03-06T10:00:00+07:00") }], { channel: "channel-2" });
  s.discord.history([{ content: "loudness budget for the board", author: alice, at: Date.parse("2026-03-06T10:00:00+07:00") }], { channel: "channel-3" });
  const logOf = (turn: { messages: { content: unknown }[] }) => {
    const board = String(turn.messages.at(-1)!.content).includes("board");
    return JSON.stringify({ topics: [{ name: board ? "Board budget" : "Loudness target", keywords: { id: ["normalisasi audio"], en: ["audio normalization"] }, refs: [1] }], decided: [], open: [], next: [] });
  };
  s.model.script(logOf, logOf);
  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();
  expect(s.discord.botMessages).toEqual([]);

  s.model.script({ tool: "searchFiles", args: { query: "normalisasi audio" } }, (turn) => JSON.stringify(turn.toolResults[0]));
  await s.discord.send(`${s.discord.mention} was normalisasi audio discussed?`);
  const said = s.discord.botMessages.at(-1)!.content;
  expect(said).not.toMatch(/direksi|board|channel-3/i);
  expect(JSON.parse(said)).toMatchObject({ groups: [{ channel: "#audio", matches: [{ path: "#audio/daily-logs/2026-03-06.md" }] }], total: 1, notShownHere: 1 });
});

discordScenario("a day with only bot messages writes no Daily log and asks the model nothing", async (s) => {
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  s.discord.history([
    { content: "deploy finished", author: { id: "ci-bot", name: "CI", bot: true }, at: Date.parse("2026-03-06T10:06:00+07:00") },
    { content: "Reminder: standup", author: { id: s.discord.botUserId, name: "Pachiware", bot: true }, at: Date.parse("2026-03-06T10:07:00+07:00") },
  ]);
  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(0);
  expect(await s.workspace.list(FOLDER)).toEqual([]);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["Reminder: standup"]);
});
