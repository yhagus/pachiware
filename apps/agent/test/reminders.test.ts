import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("a one-shot Reminder posts where it was asked when its time comes, pinging the owner, and only then", async (s) => {
  s.clock.set("2026-03-06T14:00:00+07:00");
  s.model.script({ tool: "createReminder", args: { text: "send the invoice", at: "2026-03-06T15:00" } }, (turn) => `Set for ${turn.toolResults[0].at}`);
  const ask = await s.discord.send(`${s.discord.mention} remind me at 15:00 to send the invoice`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Set for 2026-03-06T15:00:00+07:00");
  const before = s.discord.botMessages.length;

  s.clock.set("2026-03-06T14:59:00+07:00");
  await s.scheduler.tick();
  expect(s.discord.botMessages.length).toBe(before);

  s.clock.set("2026-03-06T15:00:00+07:00");
  await s.scheduler.tick();
  const post = s.discord.botMessages.at(-1)!;
  expect(s.discord.botMessages.length).toBe(before + 1);
  expect(post.channelId).toBe(ask.thread!.id);
  expect(post.content).toContain(`<@${s.discord.alice.id}>`);
  expect(post.content).toContain("send the invoice");
  expect(post.allowedMentions).toEqual({ users: [s.discord.alice.id] });
  for (const m of s.discord.botMessages.slice(0, -1)) expect(m.allowedMentions).toEqual({ parse: [] });

  s.clock.advance(60_000);
  await s.scheduler.tick();
  expect(s.discord.botMessages.length).toBe(before + 1);
});

discordScenario("the people named when the Reminder was made are pinged with the owner, and the once row is done afterwards", async (s) => {
  s.clock.set("2026-03-06T14:00:00+07:00");
  s.model.script({ tool: "createReminder", args: { text: "standup moved to 16:00", at: "15:00", mentions: [`<@${s.discord.bob.id}>`, s.discord.alice.id] } }, (turn) => `ok ${turn.toolResults[0].id}`);
  await s.discord.send(`${s.discord.mention} remind me and Bob at 15:00 that standup moved to 16:00`);
  s.clock.set("2026-03-06T15:00:30+07:00");
  await s.scheduler.tick();
  const post = s.discord.botMessages.at(-1)!;
  expect(post.content).toBe(`<@${s.discord.alice.id}> <@${s.discord.bob.id}> Pengingat: standup moved to 16:00`);
  expect(post.allowedMentions).toEqual({ users: [s.discord.alice.id, s.discord.bob.id] });
  const { schedules } = await import("../../../packages/db/src/index.ts");
  const [row] = await s.db.select().from(schedules);
  expect([row.status, row.recurrence, row.kind, row.timezone, row.lastFiredAt?.toISOString()]).toEqual(["done", "once", "reminder", "Asia/Jakarta", "2026-03-06T08:00:30.000Z"]);
});

discordScenario("a time without an offset is read in the guild's zone, and in a DM in the tenant's", async (s) => {
  s.clock.set("2026-03-06T00:00:00Z");
  await s.guildSettings({ timezone: "Asia/Tokyo" });
  s.model.script({ tool: "createReminder", args: { text: "guild one", at: "2026-03-06T15:00" } }, (turn) => turn.toolResults[0].at);
  const ask = await s.discord.send(`${s.discord.mention} remind me at 15:00: guild one`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("2026-03-06T15:00:00+09:00");
  const dm = s.discord.channel("dm-alice", { dm: true });
  s.model.script({ tool: "createReminder", args: { text: "dm one", at: "2026-03-06T15:00" } }, (turn) => turn.toolResults[0].at);
  await s.discord.send("remind me at 15:00: dm one", { channel: dm });
  expect(s.discord.botMessages.at(-1)!.content).toBe("2026-03-06T15:00:00+07:00");
  const posted = () => s.discord.botMessages.filter((m) => m.allowedMentions?.users).map((m) => [m.channelId, m.content]);

  s.clock.set("2026-03-06T06:00:00Z");
  await s.scheduler.tick();
  expect(posted()).toEqual([[ask.thread!.id, `<@${s.discord.alice.id}> Pengingat: guild one`]]);
  s.clock.set("2026-03-06T08:00:00Z");
  await s.scheduler.tick();
  expect(posted().at(-1)).toEqual([dm.id, `<@${s.discord.alice.id}> Pengingat: dm one`]);
});

discordScenario("a time that has passed or cannot be read is refused and nothing is scheduled", async (s) => {
  s.clock.set("2026-03-06T14:00:00+07:00");
  s.model.script({ tool: "createReminder", args: { text: "too late", at: "2026-03-06T13:00" } }, (turn) => `1: ${turn.toolResults[0].error}`);
  await s.discord.send(`${s.discord.mention} remind me at 13:00`);
  expect(s.discord.botMessages.at(-1)!.content).toMatch(/^1: .*already passed/);
  s.model.script({ tool: "createReminder", args: { text: "when?", at: "soonish" } }, (turn) => `2: ${turn.toolResults[0].error}`);
  await s.discord.send(`${s.discord.mention} remind me soonish`, { channel: "channel-2" });
  expect(s.discord.botMessages.at(-1)!.content).toMatch(/^2: at must be a date and time/);
  const { schedules } = await import("../../../packages/db/src/index.ts");
  expect(await s.db.select().from(schedules)).toEqual([]);
});
