import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const NOTICE_ID = "Mulai sekarang saya mencatat obrolan channel ini setiap malam sebagai Daily log, mulai hari ini. Catatannya tidak diposting di sini, tetapi bisa ditanyakan kapan saja.";
const RECORDED_ID = "Mulai sekarang saya mencatat obrolan channel ini setiap malam sebagai Daily log, dan obrolan 30 hari terakhir sudah saya catat. Catatannya tidak diposting di sini, tetapi bisa ditanyakan kapan saja.";
const RECORDED_EN = "From now on I keep a nightly record of this channel's talk as a Daily log, and I have recorded the talk of the last 30 days. It is not posted here, but you can ask me about it anytime.";
const config = (botId: string) => `/api/admin/bots/${botId}/guilds/guild-1/config`;
const posts = (s: any, channelId: string) => s.discord.botMessages.filter((m: any) => m.channelId === channelId);
const dailyLogRows = async (s: any, botId: string) => {
  const { repositories } = await import("@pachiware/db");
  return (await repositories().schedules.list({ botId, kind: "daily-log" })).map((r) => ({ channelId: r.channelId, guildId: r.guildId, recurrence: r.recurrence, timeOfDay: r.timeOfDay, timezone: r.timezone, nextAt: r.nextAt.toISOString(), status: r.status }));
};

discordScenario("an admin turns Daily logs on for a channel: it is stored, one notice is posted there, and one nightly row is kept at 00:30", async (s) => {
  s.clock.set("2026-03-06T20:00:00+07:00");
  s.discord.channel("channel-2");
  expect((await s.admin("GET", config(s.bot.id))).body.config.dailyLogChannels).toEqual([]);

  const on = await s.admin("PUT", config(s.bot.id), { dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  expect(on.status).toBe(200);
  expect(on.body.config.dailyLogChannels).toEqual([{ channelId: "channel-1", backfill: false }]);
  expect(posts(s, "channel-1").map((m: any) => m.content)).toEqual([NOTICE_ID]);
  expect(posts(s, "channel-1")[0].allowedMentions).toEqual({ parse: [] });
  expect(await dailyLogRows(s, s.bot.id)).toEqual([{ channelId: "channel-1", guildId: "guild-1", recurrence: "daily", timeOfDay: "00:30", timezone: "Asia/Jakarta", nextAt: "2026-03-06T17:30:00.000Z", status: "active" }]);

  await s.admin("PUT", config(s.bot.id), { dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  await s.admin("PUT", config(s.bot.id), { systemPrompt: "Be brief." });
  expect(posts(s, "channel-1")).toHaveLength(1);
  expect(await dailyLogRows(s, s.bot.id)).toHaveLength(1);

  const second = await s.admin("PUT", config(s.bot.id), { dailyLogChannels: [{ channelId: "channel-1", backfill: false }, { channelId: "channel-2" }] });
  expect(second.body.config.dailyLogChannels).toEqual([{ channelId: "channel-1", backfill: false }, { channelId: "channel-2", backfill: true }]);
  expect(posts(s, "channel-1")).toHaveLength(1);
  expect(posts(s, "channel-2").map((m: any) => m.content)).toEqual([RECORDED_ID]);
});

discordScenario("a channel another bot of the tenant already logs is refused, naming that bot, and nothing is posted", async (s) => {
  s.clock.set("2026-03-06T20:00:00+07:00");
  const helper = await s.discord.addBot({ name: "Helper" });
  expect((await s.admin("PUT", config(helper.id), { dailyLogChannels: [{ channelId: "channel-1", backfill: true }] })).status).toBe(200);
  expect(helper.messages.map((m) => m.content)).toEqual([RECORDED_ID]);

  const refused = await s.admin("PUT", config(s.bot.id), { useThreads: false, dailyLogChannels: [{ channelId: "channel-1", backfill: true }] });
  expect(refused.status).toBe(409);
  expect(refused.body.error).toBe("Helper already keeps Daily logs of channel channel-1.");
  expect(s.discord.botMessages).toHaveLength(0);
  expect((await s.admin("GET", config(s.bot.id))).body.config).toMatchObject({ useThreads: true, dailyLogChannels: [] });
  expect(await dailyLogRows(s, s.bot.id)).toEqual([]);

  for (const bad of [[{ backfill: true }], [{ channelId: "", backfill: true }], [{ channelId: "channel-2", backfill: "yes" }], [{ channelId: "channel-2" }, { channelId: "channel-2" }], "channel-2", { channelId: "channel-2" }]) {
    expect((await s.admin("PUT", config(s.bot.id), { dailyLogChannels: bad })).status).toBe(400);
  }
  expect(s.discord.botMessages).toHaveLength(0);
});

discordScenario("turning Daily logs off cancels the nightly row and posts nothing; the row follows the place's zone and posts nothing when it comes due", async (s) => {
  s.clock.set("2026-03-06T20:00:00+07:00");
  await s.guildSettings({ language: "en" });
  await s.admin("PUT", config(s.bot.id), { dailyLogChannels: [{ channelId: "channel-1", backfill: true }] });
  expect(posts(s, "channel-1").map((m: any) => m.content)).toEqual([RECORDED_EN]);

  await s.admin("PUT", `/api/admin/tenants/${s.tenant.id}/settings`, { timezone: "Europe/Berlin" });
  expect(await dailyLogRows(s, s.bot.id)).toEqual([{ channelId: "channel-1", guildId: "guild-1", recurrence: "daily", timeOfDay: "00:30", timezone: "Europe/Berlin", nextAt: "2026-03-06T23:30:00.000Z", status: "active" }]);

  s.clock.set("2026-03-07T00:31:00+01:00");
  await s.scheduler.tick();
  expect(posts(s, "channel-1")).toHaveLength(1);
  expect((await dailyLogRows(s, s.bot.id))[0]).toMatchObject({ nextAt: "2026-03-07T23:30:00.000Z", status: "active" });

  const off = await s.admin("PUT", config(s.bot.id), { dailyLogChannels: [] });
  expect(off.body.config.dailyLogChannels).toEqual([]);
  expect(await dailyLogRows(s, s.bot.id)).toEqual([expect.objectContaining({ channelId: "channel-1", status: "cancelled" })]);
  expect(posts(s, "channel-1")).toHaveLength(1);
});
