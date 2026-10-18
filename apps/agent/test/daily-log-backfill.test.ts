import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const FOLDER = "guilds/guild-1/channels/channel-1/daily-logs";
const config = (botId: string) => `/api/admin/bots/${botId}/guilds/guild-1/config`;
const notices = (s: any) => s.discord.botMessages.filter((m: any) => m.channelId === "channel-1").map((m: any) => m.content);
const jakarta = (local: string) => Date.parse(`${local}+07:00`);
const log = (topic: string) => JSON.stringify({ topics: [{ name: topic, keywords: { id: [], en: [] }, refs: [1] }], decided: [], open: [], next: [] });

const RECORDED_ID = "Mulai sekarang saya mencatat obrolan channel ini setiap malam sebagai Daily log, dan obrolan 30 hari terakhir sudah saya catat. Catatannya tidak diposting di sini, tetapi bisa ditanyakan kapan saja.";
const FROM_TODAY_ID = "Mulai sekarang saya mencatat obrolan channel ini setiap malam sebagai Daily log, mulai hari ini. Catatannya tidak diposting di sini, tetapi bisa ditanyakan kapan saja.";

discordScenario("turning Daily logs on with the backfill tick writes a Daily log for each day with talk in the last 30 days, then says so", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-06T20:00:00+07:00");
  s.discord.history([
    { content: "thirty-one days ago", author: alice, at: jakarta("2026-02-03T12:00:00") },
    { content: "thirty days ago", author: alice, at: jakarta("2026-02-04T12:00:00") },
    { content: "mid February", author: alice, at: jakarta("2026-02-20T12:00:00") },
    { content: "yesterday", author: alice, at: jakarta("2026-03-05T12:00:00") },
    { content: "today", author: alice, at: jakarta("2026-03-06T12:00:00") },
  ]);
  s.model.script(log("Thirty days ago"), log("Mid February"), log("Yesterday"));

  expect((await s.admin("PUT", config(s.bot.id), { dailyLogChannels: [{ channelId: "channel-1", backfill: true }] })).status).toBe(200);

  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-02-04.md`, `${FOLDER}/2026-02-20.md`, `${FOLDER}/2026-03-05.md`]);
  expect(await s.workspace.read(`${FOLDER}/2026-02-20.md`)).toContain("Topics: Mid February");
  expect(s.model.calls).toHaveLength(3);
  expect(notices(s)).toEqual([RECORDED_ID]);
});

discordScenario("turning Daily logs on without the tick writes none, and the notice says recording starts today", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-06T20:00:00+07:00");
  s.discord.history([{ content: "yesterday", author: alice, at: jakarta("2026-03-05T12:00:00") }]);

  await s.admin("PUT", config(s.bot.id), { dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });

  expect(await s.workspace.list(FOLDER)).toEqual([]);
  expect(s.model.calls).toHaveLength(0);
  expect(notices(s)).toEqual([FROM_TODAY_ID]);
});

const INCOMPLETE_ID = "Mulai sekarang saya mencatat obrolan channel ini setiap malam sebagai Daily log, mulai hari ini; obrolan 30 hari terakhir tidak semuanya berhasil saya catat. Catatannya tidak diposting di sini, tetapi bisa ditanyakan kapan saja.";

discordScenario("a backfill whose day cannot be written, or whose playbook an Availability rule turns off, does not say the last 30 days are recorded", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-06T20:00:00+07:00");
  s.discord.channel("channel-2");
  s.discord.history([{ content: "yesterday", author: alice, at: jakarta("2026-03-05T12:00:00") }]);
  s.discord.history([{ content: "yesterday in two", author: alice, at: jakarta("2026-03-05T12:00:00") }], { channel: "channel-2" });
  s.model.script("I cannot summarize this.");

  await s.admin("PUT", config(s.bot.id), { dailyLogChannels: [{ channelId: "channel-1", backfill: true }] });
  expect(await s.workspace.list(FOLDER)).toEqual([]);
  expect(notices(s)).toEqual([INCOMPLETE_ID]);

  await s.availability({ level: "channel", channelId: "channel-2" }, { kind: "playbook", name: "daily-log", value: "off" });
  await s.admin("PUT", config(s.bot.id), { dailyLogChannels: [{ channelId: "channel-1", backfill: true }, { channelId: "channel-2", backfill: true }] });
  expect(s.model.calls).toHaveLength(1);
  expect(s.discord.botMessages.filter((m: any) => m.channelId === "channel-2").map((m: any) => m.content)).toEqual([INCOMPLETE_ID]);
});

discordScenario("off then on again keeps every Daily log as written and fills only the days missing", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-06T20:00:00+07:00");
  s.discord.history([
    { content: "Wednesday talk", author: alice, at: jakarta("2026-03-04T12:00:00") },
    { content: "Thursday talk", author: alice, at: jakarta("2026-03-05T12:00:00") },
  ]);
  s.model.script(log("Wednesday"), log("Thursday"));
  await s.admin("PUT", config(s.bot.id), { dailyLogChannels: [{ channelId: "channel-1", backfill: true }] });
  const wednesday = await s.workspace.read(`${FOLDER}/2026-03-04.md`);

  await s.admin("PUT", config(s.bot.id), { dailyLogChannels: [] });
  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-03-04.md`, `${FOLDER}/2026-03-05.md`]);
  s.discord.history([
    { content: "Saturday talk", author: alice, at: jakarta("2026-03-07T12:00:00") },
    { content: "Sunday talk", author: alice, at: jakarta("2026-03-08T12:00:00") },
  ]);

  s.clock.set("2026-03-09T20:00:00+07:00");
  s.model.script(log("Saturday"), log("Sunday"));
  await s.admin("PUT", config(s.bot.id), { dailyLogChannels: [{ channelId: "channel-1", backfill: true }] });

  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-03-04.md`, `${FOLDER}/2026-03-05.md`, `${FOLDER}/2026-03-07.md`, `${FOLDER}/2026-03-08.md`]);
  expect(await s.workspace.read(`${FOLDER}/2026-03-04.md`)).toBe(wednesday);
  expect(await s.workspace.read(`${FOLDER}/2026-03-08.md`)).toContain("Topics: Sunday");
  expect(s.model.calls).toHaveLength(4);
  expect(notices(s)).toEqual([RECORDED_ID, RECORDED_ID]);
});

discordScenario("after two missed nights, a start writes both days' Daily logs, and the late nightly row writes nothing twice", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-04T20:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  s.discord.history([
    { content: "Thursday talk", author: alice, at: jakarta("2026-03-05T12:00:00") },
    { content: "Friday talk", author: alice, at: jakarta("2026-03-06T12:00:00") },
  ]);
  s.model.script(log("Thursday"), log("Friday"));

  s.clock.set("2026-03-07T09:00:00+07:00");
  await s.restart();

  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-03-05.md`, `${FOLDER}/2026-03-06.md`]);
  expect(await s.workspace.read(`${FOLDER}/2026-03-06.md`)).toContain("Topics: Friday");
  await s.scheduler.tick();
  expect(s.model.calls).toHaveLength(2);
  expect(s.discord.botMessages).toEqual([]);
});

discordScenario("a start catches up 7 days at most: talk older than that stays without a Daily log", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-01T20:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  s.discord.history([
    { content: "eight days before the start", author: alice, at: jakarta("2026-03-03T12:00:00") },
    { content: "seven days before the start", author: alice, at: jakarta("2026-03-04T12:00:00") },
    { content: "the day before the start", author: alice, at: jakarta("2026-03-10T12:00:00") },
  ]);
  s.model.script(log("Seven days"), log("Day before"));

  s.clock.set("2026-03-11T09:00:00+07:00");
  await s.restart();
  await s.scheduler.tick();

  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-03-04.md`, `${FOLDER}/2026-03-10.md`]);
  expect(s.model.calls).toHaveLength(2);
});

discordScenario("nights an Availability rule turned the playbook off stay without a Daily log after the rule is lifted; a night missed while down is still written", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-04T20:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  s.discord.history([
    { content: "Thursday talk", author: alice, at: jakarta("2026-03-05T12:00:00") },
    { content: "Friday talk", author: alice, at: jakarta("2026-03-06T12:00:00") },
    { content: "Saturday talk", author: alice, at: jakarta("2026-03-07T12:00:00") },
  ]);
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "playbook", name: "daily-log", value: "off" });

  s.clock.set("2026-03-06T00:30:00+07:00");
  await s.scheduler.tick();
  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();
  expect(await s.workspace.list(FOLDER)).toEqual([]);

  expect((await s.admin("DELETE", `/api/admin/bots/${s.bot.id}/guilds/guild-1/channels/channel-1/availability?kind=playbook&name=daily-log`)).status).toBeLessThan(300);
  s.model.script(log("Saturday"));
  s.clock.set("2026-03-08T09:00:00+07:00");
  await s.restart();
  await s.scheduler.tick();

  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-03-07.md`]);
  expect(await s.workspace.read(`${FOLDER}/2026-03-07.md`)).toContain("Topics: Saturday");
  expect(s.model.calls).toHaveLength(1);
});

discordScenario("a day whose nightly write failed is written on the next start", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-04T20:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  s.discord.history([{ content: "Thursday talk", author: alice, at: jakarta("2026-03-05T12:00:00") }]);
  s.model.script("I cannot summarize this.");

  s.clock.set("2026-03-06T00:30:00+07:00");
  await s.scheduler.tick();
  expect(await s.workspace.list(FOLDER)).toEqual([]);

  s.model.script(log("Thursday"));
  s.clock.set("2026-03-06T09:00:00+07:00");
  await s.restart();

  expect(await s.workspace.list(FOLDER)).toEqual([`${FOLDER}/2026-03-05.md`]);
  expect(s.model.calls).toHaveLength(2);
});
