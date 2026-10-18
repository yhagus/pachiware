import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const rows = async (s: Scenario, type: string) => {
  const { repositories } = await import("@pachiware/db");
  return (await repositories().usage.list({ tenantId: s.tenant.id, type })).map((e: any) => e.metadata);
};
const SECRET = "sk-live0123456789abcdefghij";

discordScenario("a turn that throws still gets the failure text, and leaves one turn_failed audit row without its secret or the message", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.model.script(() => { throw new TypeError(`socket hang up while sending ${SECRET}`); });
  await s.discord.send(`${s.discord.mention} what is due this week?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Unable to process this request. Check your tenant configuration.");
  const failed = await rows(s, "turn_failed");
  expect(failed).toEqual([expect.objectContaining({ channelId: "channel-1", error: "TypeError", message: "socket hang up while sending [redacted]" })]);
  expect(JSON.stringify(failed)).not.toContain("due this week");
});

discordScenario("a Daily log the model cannot write leaves one daily_log_failed audit row naming the day", async (s) => {
  const { alice } = s.discord;
  s.clock.set("2026-03-06T08:00:00+07:00");
  await s.guildSettings({ dailyLogChannels: [{ channelId: "channel-1", backfill: false }] });
  s.discord.history([{ content: "Budget talk", author: alice, at: Date.parse("2026-03-06T10:00:00+07:00") }]);
  s.model.script("This is not a Daily log.");
  s.clock.set("2026-03-07T00:30:00+07:00");
  await s.scheduler.tick();
  expect(await rows(s, "daily_log_failed")).toEqual([expect.objectContaining({ channelId: "channel-1", day: "2026-03-06" })]);
});
