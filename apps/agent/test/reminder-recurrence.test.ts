import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const SCHEDULES = () => import("../../../packages/db/src/index.ts").then((m) => m.schedules);
const posts = (s: any) => s.discord.botMessages.filter((m: any) => m.allowedMentions?.users).map((m: any) => m.content);

discordScenario("a weekly Reminder posts on each chosen weekday at its time and advances to the next chosen one", async (s) => {
  s.clock.set("2026-03-06T14:00:00+07:00"); // Friday
  s.model.script({ tool: "createReminder", args: { text: "standup", recurrence: "weekly", weekdays: ["monday", "thursday"], time: "09:00" } }, (turn) => `${turn.toolResults[0].recurrence} next ${turn.toolResults[0].at}`);
  await s.discord.send(`${s.discord.mention} remind me every Monday and Thursday at 09:00: standup`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("weekly next 2026-03-09T09:00:00+07:00");

  s.clock.set("2026-03-09T09:00:10+07:00");
  await s.scheduler.tick();
  expect(posts(s)).toEqual([`<@${s.discord.alice.id}> Pengingat: standup`]);
  const schedules = await SCHEDULES();
  let [row] = await s.db.select().from(schedules);
  expect([row.status, row.recurrence, row.weekdays, row.nextAt.toISOString()]).toEqual(["active", "weekly", [1, 4], "2026-03-12T02:00:00.000Z"]);

  s.clock.set("2026-03-10T09:00:10+07:00");
  await s.scheduler.tick();
  expect(posts(s).length).toBe(1);
  s.clock.set("2026-03-12T09:00:10+07:00");
  await s.scheduler.tick();
  expect(posts(s).length).toBe(2);
  [row] = await s.db.select().from(schedules);
  expect(row.nextAt.toISOString()).toBe("2026-03-16T02:00:00.000Z");
});

discordScenario("a tick more than six hours late skips a once Reminder and advances a repeating one; one two hours late posts with a late note", async (s) => {
  s.clock.set("2026-03-06T08:00:00+07:00");
  s.model.script({ tool: "createReminder", args: { text: "once one", at: "09:00" } }, "ok");
  await s.discord.send(`${s.discord.mention} remind me at 09:00: once one`);
  s.model.script({ tool: "createReminder", args: { text: "daily one", recurrence: "daily", time: "09:00" } }, "ok");
  await s.discord.send(`${s.discord.mention} remind me every day at 09:00: daily one`, { channel: "channel-2" });
  s.model.script({ tool: "createReminder", args: { text: "later one", at: "14:00" } }, "ok");
  await s.discord.send(`${s.discord.mention} remind me at 14:00: later one`, { channel: "channel-3" });

  s.clock.set("2026-03-06T16:00:00+07:00");
  await s.scheduler.tick();
  expect(posts(s)).toEqual([`<@${s.discord.alice.id}> Pengingat: later one\n-# Terlambat: seharusnya diposting 6 Mar 14:00.`]);
  const schedules = await SCHEDULES();
  const rows = (await s.db.select().from(schedules)).sort((a: any, b: any) => a.text.localeCompare(b.text));
  expect(rows.map((r: any) => [r.text, r.status, r.nextAt.toISOString(), r.lastFiredAt?.toISOString() ?? null])).toEqual([
    ["daily one", "active", "2026-03-07T02:00:00.000Z", null],
    ["later one", "done", "2026-03-06T07:00:00.000Z", "2026-03-06T09:00:00.000Z"],
    ["once one", "done", "2026-03-06T02:00:00.000Z", null],
  ]);

  await s.guildSettings({ language: "en" });
  s.clock.set("2026-03-07T10:30:00+07:00");
  await s.scheduler.tick();
  expect(posts(s).at(-1)).toBe(`<@${s.discord.alice.id}> Reminder: daily one\n-# Posted late: this was due 7 Mar, 09:00.`);
});

discordScenario("a post Discord refuses keeps its time and is retried next tick; after three failures the row is done with an error note", async (s) => {
  s.clock.set("2026-03-06T08:00:00+07:00");
  s.model.script({ tool: "createReminder", args: { text: "fragile", at: "09:00" } }, "ok");
  const ask = await s.discord.send(`${s.discord.mention} remind me at 09:00: fragile`, { channel: "channel-2" });
  const channel: any = s.discord.channel(ask.thread!.id);
  const send = channel.send;
  channel.send = async () => { throw new Error("Missing Access"); };
  const schedules = await SCHEDULES();
  const row = async () => { const [r] = await s.db.select().from(schedules); return [r.status, r.attempts, r.nextAt.toISOString(), r.error]; };

  s.clock.set("2026-03-06T09:00:10+07:00");
  await s.scheduler.tick();
  expect(await row()).toEqual(["active", 1, "2026-03-06T02:00:00.000Z", null]);
  s.clock.advance(60_000);
  await s.scheduler.tick();
  expect(await row()).toEqual(["active", 2, "2026-03-06T02:00:00.000Z", null]);
  s.clock.advance(60_000);
  await s.scheduler.tick();
  expect(await row()).toEqual(["done", 3, "2026-03-06T02:00:00.000Z", "Could not post after 3 attempts: Missing Access"]);

  channel.send = send;
  s.clock.advance(60_000);
  await s.scheduler.tick();
  expect(posts(s)).toEqual([]);
});

discordScenario("a monthly Reminder on the 31st lands on the last day of a shorter month, and ends after its until date", async (s) => {
  s.clock.set("2026-01-30T10:00:00+07:00");
  s.model.script({ tool: "createReminder", args: { text: "invoices", recurrence: "monthly", dayOfMonth: 31, time: "09:00", until: "2026-03-15" } }, (turn) => `${turn.toolResults[0].at} until ${turn.toolResults[0].until}`);
  await s.discord.send(`${s.discord.mention} remind me on the 31st of every month at 09:00 until mid-March: invoices`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("2026-01-31T09:00:00+07:00 until 2026-03-15T23:59:59+07:00");
  const schedules = await SCHEDULES();
  const row = async () => { const [r] = await s.db.select().from(schedules); return [r.status, r.nextAt.toISOString()]; };

  s.clock.set("2026-01-31T09:00:20+07:00");
  await s.scheduler.tick();
  expect(await row()).toEqual(["active", "2026-02-28T02:00:00.000Z"]);
  s.clock.set("2026-02-28T09:00:20+07:00");
  await s.scheduler.tick();
  expect(posts(s).length).toBe(2);
  expect(await row()).toEqual(["done", "2026-02-28T02:00:00.000Z"]);

  s.model.script({ tool: "createReminder", args: { text: "never", recurrence: "weekly", weekdays: ["friday"], time: "09:00", until: "2026-03-01" } }, (turn) => turn.toolResults[0].error);
  await s.discord.send(`${s.discord.mention} remind me every Friday at 09:00 until yesterday: never`, { channel: "channel-2" });
  expect(s.discord.botMessages.at(-1)!.content).toMatch(/end date comes before/);
  expect((await s.db.select().from(schedules)).length).toBe(1);
});
