import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const report = (turn: any) => (turn.toolResults[0].error ? `refused: ${turn.toolResults[0].error}` : "Pinned.");

discordScenario("pinMessage is refused without Manage Messages and pins the message once granted", async (s) => {
  await s.guildSettings({ useThreads: false });
  const [decision] = s.discord.history([{ content: "Decision: ship on Friday", author: s.discord.bob }]);
  s.model.script({ tool: "pinMessage", args: { messageId: decision!.id } }, report);
  await s.discord.send(`${s.discord.mention} pin that decision`);
  expect(s.discord.botMessages.at(-1)?.content).toMatch(/refused: .*ManageMessages/);
  expect(decision!.pinned).toBe(false);

  s.discord.grant(s.discord.alice, ["ManageMessages"]);
  s.model.script({ tool: "pinMessage", args: { messageId: decision!.id } }, report);
  await s.discord.send(`${s.discord.mention} pin that decision`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Pinned.");
  expect(decision!.pinned).toBe(true);
});

discordScenario("pinMessage takes a channelId for a message outside the current channel", async (s) => {
  s.discord.grant(s.discord.alice, ["ManageMessages"]);
  const [decision] = s.discord.history([{ content: "Decision: ship on Friday" }], { channel: "channel-2" });
  s.model.script({ tool: "pinMessage", args: { messageId: decision!.id, channelId: "channel-2" } }, report);
  await s.discord.send(`${s.discord.mention} pin the decision in #channel-2`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Pinned.");
  expect(decision!.pinned).toBe(true);
});

discordScenario("Manage Messages alone does not open the channel tools", async (s) => {
  s.discord.grant(s.discord.alice, ["ManageMessages"]);
  s.model.script({ tool: "setChannelTopic", args: { channelId: "channel-1", topic: "Ops" } }, report);
  await s.discord.send(`${s.discord.mention} set the topic to Ops`);
  expect(s.discord.botMessages.at(-1)?.content).toMatch(/refused: .*ManageChannels/);
});

discordScenario("listMembers finds Bob by the start of his name, with id and roles", async (s) => {
  s.model.script({ tool: "listMembers", args: { query: "bo" } }, (turn) => JSON.stringify(turn.toolResults[0].members));
  await s.discord.send(`${s.discord.mention} who is bo?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual([{ id: "user-bob", displayName: "Bob", roles: [] }]);
});

discordScenario("listMembers needs a query and returns at most 50 people", async (s) => {
  s.discord.history(Array.from({ length: 60 }, (_, i) => ({ content: "hi", author: { id: `user-m${i}`, name: `Member ${i}` } })));
  s.model.script({ tool: "listMembers", args: { query: " " } }, (turn) => `refused: ${turn.toolResults[0].error}`);
  await s.discord.send(`${s.discord.mention} list everyone`);
  expect(s.discord.botMessages.at(-1)?.content).toMatch(/^refused: /);

  s.model.script({ tool: "listMembers", args: { query: "member", limit: 500 } }, (turn) => String(turn.toolResults[0].members.length));
  await s.discord.send(`${s.discord.mention} who are the members?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("50");
});
