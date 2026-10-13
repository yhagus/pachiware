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
