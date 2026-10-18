import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const FOLDER = "guilds/guild-1/channels/channel-1/daily-logs";
const link = (id: string) => `https://discord.com/channels/guild-1/channel-1/${id}`;
const at = (time: string) => Date.parse(`2026-03-06T${time}:00+07:00`);
const LOG = JSON.stringify({ topics: [{ name: "Release day", keywords: { id: ["hari rilis"], en: ["release day"] }, refs: [1, 2] }], decided: [{ text: "Release on Friday", refs: [2] }], open: [], next: [] });

discordScenario("a Daily log is kept in its month's folder, and recall finds it there with its date and the decision's message link", async (s) => {
  const { alice, bob } = s.discord;
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.guildSettings({ language: "en", useThreads: false, dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  const [, friday] = s.discord.history([
    { content: "Which day do we release?", author: alice, at: at("10:00") },
    { content: "Friday, after the review", author: bob, at: at("10:05") },
  ]);
  s.model.script(LOG);
  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();
  expect(await s.workspace.files(FOLDER)).toEqual([`${FOLDER}/2026-03/2026-03-06.md`]);

  s.model.script({ tool: "recall", args: { queries: ["release day", "hari rilis"] } }, (turn) => JSON.stringify(turn.toolResults[0].kept));
  await s.discord.send(`${s.discord.mention} when do we release?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toMatchObject([{ label: "#channel-1 · Daily log 2026-03-06", url: link(friday!.id), path: "channel/daily-logs/2026-03/2026-03-06.md" }]);
});

discordScenario("a day kept at the old flat path is not written again, and a deleted message still leaves it", async (s) => {
  const { alice, bob } = s.discord;
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  const [question, friday] = s.discord.history([
    { content: "Which day do we release?", author: alice, at: at("10:00") },
    { content: "Friday, after the review", author: bob, at: at("10:05") },
  ]);
  s.model.script(LOG);
  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();
  // As a night before monthly folders left it.
  const kept = (await s.workspace.read(`${FOLDER}/2026-03/2026-03-06.md`))!;
  await s.workspace.remove(`${FOLDER}/2026-03/2026-03-06.md`);
  await s.workspace.write(`${FOLDER}/2026-03-06.md`, kept);

  const config = `/api/admin/bots/${s.bot.id}/guilds/guild-1/config`;
  await s.admin("PUT", config, { dailyLogChannels: [] });
  expect((await s.admin("PUT", config, { dailyLogChannels: [{ channelId: "channel-1", backfill: true }] })).status).toBe(200);
  expect(s.model.calls).toHaveLength(1);
  expect(await s.workspace.files(FOLDER)).toEqual([`${FOLDER}/2026-03-06.md`]);

  await s.discord.deleteMessage(question!);
  const log = (await s.workspace.read(`${FOLDER}/2026-03-06.md`))!;
  expect(log).not.toContain(question!.id);
  expect(log).toContain(`Release on Friday [↗](${link(friday!.id)})`);
});
