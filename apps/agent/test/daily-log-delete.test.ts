import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const FILE = "guilds/guild-1/channels/channel-1/daily-logs/2026-03/2026-03-06.md";
const link = (channelId: string, id: string) => `https://discord.com/channels/guild-1/${channelId}/${id}`;
const at = (time: string) => Date.parse(`2026-03-06T${time}:00+07:00`);

discordScenario("deleting one of two messages behind an item removes only its link, and deleting the only one removes the item and the part it emptied", async (s) => {
  const { alice, bob } = s.discord;
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  const [release, friday, announce] = s.discord.history([
    { content: "Which day do we release?", author: alice, at: at("10:00") },
    { content: "Friday. I write the release notes by Thursday", author: bob, at: at("10:05") },
    { content: "Who announces it?", author: alice, at: at("10:10") },
  ]);
  s.model.script(JSON.stringify({
    topics: [{ name: "Release day", keywords: { id: ["hari rilis"], en: ["release day"] }, refs: [1, 2] }],
    decided: [{ text: "Release on Friday", refs: [2] }],
    open: [{ text: "Who announces the release", refs: [3] }],
    next: [],
  }));
  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();
  expect(await s.workspace.read(FILE)).toContain(`3. Who announces the release [↗](${link("channel-1", announce!.id)})`);

  await s.discord.deleteMessage(release!);
  let log = (await s.workspace.read(FILE))!;
  expect(log).toContain(`1. Release day: hari rilis, release day [↗](${link("channel-1", friday!.id)})\n`);
  expect(log).not.toContain(release!.id);
  expect(log).toContain(`2. Release on Friday [↗](${link("channel-1", friday!.id)})`);

  await s.discord.deleteMessage(announce!);
  log = (await s.workspace.read(FILE))!;
  expect(log).not.toContain("Who announces the release");
  expect(log).not.toContain("## Still open");
  expect(log).toContain("## Decided\n2. Release on Friday");
  expect(log).toContain("## Who does what next\n*None*");
  expect(log).toContain("Topics: Release day");
  expect(log).toContain("Keywords: hari rilis, release day");
  expect(s.discord.botMessages).toEqual([]);
});

discordScenario("deleting a public thread's message removes its link from the parent channel's Daily log", async (s) => {
  const { alice, bob } = s.discord;
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  const [starter] = s.discord.history([{ content: "Thread about the invoice template", author: alice, at: at("09:00") }]);
  const thread = s.discord.channel(starter!.id, { thread: true, parentId: "channel-1" });
  const [approved] = s.discord.history([{ content: "Template v2 is approved", author: bob, at: at("09:30") }], { channel: thread });
  s.model.script(JSON.stringify({ topics: [{ name: "Invoice template", keywords: { id: ["templat faktur"], en: ["invoice template"] }, refs: [1, 2] }], decided: [{ text: "Template v2 approved", refs: [2] }], open: [], next: [] }));
  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();

  await s.discord.deleteMessage(approved!);

  const log = (await s.workspace.read(FILE))!;
  expect(log).toContain(`1. Invoice template: templat faktur, invoice template [↗](${link("channel-1", starter!.id)})\n`);
  expect(log).not.toContain("Template v2 approved");
  expect(log).not.toContain("## Decided");
});

discordScenario("editing a message, or deleting one no Daily log holds, leaves the Daily log as it was", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  const [asked, chatter] = s.discord.history([
    { content: "Is the audio normalization in?", author: alice, at: at("10:00") },
    { content: "lunch?", author: alice, at: at("12:00") },
  ]);
  s.model.script(JSON.stringify({ topics: [{ name: "Audio normalization", keywords: { id: ["normalisasi audio"], en: ["audio normalization"] }, refs: [1] }], decided: [], open: [], next: [] }));
  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();
  const written = await s.workspace.read(FILE);
  expect(written).toContain(`1. Audio normalization: normalisasi audio, audio normalization [↗](${link("channel-1", asked!.id)})`);

  await s.discord.editMessage(asked!, "Is the loudness fix in?");
  await s.discord.deleteMessage(chatter!);
  const [today] = s.discord.history([{ content: "a message from today", author: alice, at: Date.parse("2026-03-07T09:00:00+07:00") }]);
  await s.discord.deleteMessage(today!);

  expect(await s.workspace.read(FILE)).toBe(written);
});

discordScenario("for a bot that lists no guilds, which means every guild, deleting a message still removes it from that day's Daily log", async (s) => {
  const { alice, bob } = s.discord;
  const { repositories } = await import("@pachiware/db");
  await repositories().bots.update(s.bot.id, { guildIds: [] });
  await s.restart();
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  const [question, friday] = s.discord.history([
    { content: "Which day do we release?", author: alice, at: at("10:00") },
    { content: "Friday", author: bob, at: at("10:05") },
  ]);
  s.model.script(JSON.stringify({ topics: [], decided: [{ text: "Release on Friday", refs: [1, 2] }], open: [], next: [] }));
  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();
  expect(await s.workspace.read(FILE)).toContain(question!.id);

  await s.discord.deleteMessage(question!);
  const log = (await s.workspace.read(FILE))!;
  expect(log).not.toContain(question!.id);
  expect(log).toContain(`Release on Friday [↗](${link("channel-1", friday!.id)})`);
});
