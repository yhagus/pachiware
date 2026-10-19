import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const HOUR = 3600_000;
/** What the model read of the people and itself on one call: every user and assistant message, context included. */
const read = (call: any[]) => call.filter((m) => m.role === "user" || m.role === "assistant").map((m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n");
const conversationsIn = async (s: Scenario, channelId = "channel-1") => {
  const { repositories } = await import("@pachiware/db");
  return repositories().conversations.listForBot(s.bot.id, { channelId, limit: 50 });
};

discordScenario("after 24 hours with nobody talking to the bot in a channel, its next message starts a fresh conversation, and the old one stays", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.model.script("Noted: the launch moved to Friday.", "Halo! Ada yang bisa kubantu?");
  await s.discord.send(`${s.discord.mention} the launch moved to Friday`);
  s.clock.advance(25 * HOUR);
  await s.discord.send(`${s.discord.mention} Halo`);

  expect(read(s.model.calls[1])).toContain("Halo");
  expect(read(s.model.calls[1])).not.toContain("launch moved to Friday");
  const [fresh, old] = await conversationsIn(s);
  expect([fresh.messageCount, old.messageCount]).toEqual([2, 2]);
});

discordScenario("under 24 hours the conversation goes on", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.model.script("Noted.", "Friday, as you said.");
  await s.discord.send(`${s.discord.mention} the launch moved to Friday`);
  s.clock.advance(23 * HOUR);
  await s.discord.send(`${s.discord.mention} when is the launch?`);

  expect(read(s.model.calls[1])).toContain("launch moved to Friday");
  expect(await conversationsIn(s)).toHaveLength(1);
});

discordScenario("in an always-on channel every message keeps the conversation going, and 24 quiet hours start a fresh one", async (s) => {
  await s.guildSettings({ useThreads: false, alwaysChannelIds: ["channel-1"] });
  s.model.script("Noted.", "[[silent]]", "Friday.", "Halo!");
  await s.discord.send(`${s.discord.mention} the launch moved to Friday`);
  s.clock.advance(20 * HOUR);
  await s.discord.send("anyone up for lunch?", { author: s.discord.bob });
  s.clock.advance(20 * HOUR);
  await s.discord.send("when is the launch again?");
  expect(read(s.model.calls[2])).toContain("launch moved to Friday");

  s.clock.advance(25 * HOUR);
  await s.discord.send("halo");
  expect(read(s.model.calls[3])).not.toContain("launch");
  expect(await conversationsIn(s)).toHaveLength(2);
});

discordScenario("with conversationIdleHours 0 the conversation never starts fresh on its own", async (s) => {
  await s.guildSettings({ useThreads: false });
  expect((await s.admin("PUT", `/api/admin/tenants/${s.tenant.id}/settings`, { conversationIdleHours: 0 })).status).toBe(200);
  s.model.script("Noted.", "Friday.");
  await s.discord.send(`${s.discord.mention} the launch moved to Friday`);
  s.clock.advance(30 * 24 * HOUR);
  await s.discord.send(`${s.discord.mention} when is the launch?`);

  expect(read(s.model.calls[1])).toContain("launch moved to Friday");
});

discordScenario("a fresh conversation still reads the channel's Memory", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write("guilds/guild-1/channels/channel-1/MEMORY.md", "- Release owner: Bob\n");
  s.model.script("Noted.", "Halo!");
  await s.discord.send(`${s.discord.mention} the launch moved to Friday`);
  s.clock.advance(25 * HOUR);
  await s.discord.send(`${s.discord.mention} Halo`);

  expect(read(s.model.calls[1])).not.toContain("launch moved to Friday");
  expect(read(s.model.calls[1])).toContain("Release owner: Bob");
});

discordScenario("a thread following a playbook keeps its conversation however long it waits", async (s) => {
  await s.availability({ level: "tenant" }, { kind: "playbook", name: "grilling", value: "on" });
  s.model.script("What problem does the queue solve?", "And what if SQS is down?");
  const start = await s.discord.send(`${s.discord.mention} grilling: we move billing to a queue`);
  s.clock.advance(3 * 24 * HOUR);
  await s.discord.send("the queue is SQS", { channel: start.thread! });

  expect(read(s.model.calls[1])).toContain("we move billing to a queue");
});

discordScenario("ending a conversation in the console makes the next message there start fresh, with no word in Discord", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.model.script("Noted.", "Halo!");
  await s.discord.send(`${s.discord.mention} the launch moved to Friday`);
  const [current] = await conversationsIn(s);
  expect(current.endedAt).toBeNull();
  const posted = s.discord.botMessages.length;

  const ended = await s.admin("POST", `/api/admin/bots/${s.bot.id}/conversations/${current.id}/end`);
  expect(ended.status).toBe(200);
  expect(s.discord.botMessages).toHaveLength(posted);
  const again = await s.admin("POST", `/api/admin/bots/${s.bot.id}/conversations/${current.id}/end`);
  expect(again.body.endedAt).toBe(ended.body.endedAt);

  await s.discord.send(`${s.discord.mention} Halo`);
  expect(read(s.model.calls[1])).not.toContain("launch moved to Friday");
  const [fresh, old] = await conversationsIn(s);
  expect([fresh.endedAt, old.id, old.endedAt?.toISOString()]).toEqual([null, current.id, ended.body.endedAt]);

  expect((await s.admin("POST", `/api/admin/bots/${s.bot.id}/conversations/nope/end`)).status).toBe(404);
  expect((await s.admin("POST", `/api/admin/bots/other-bot/conversations/${fresh.id}/end`)).status).toBe(404);
});
