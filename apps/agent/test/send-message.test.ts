import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("an announcement to another channel posts only after the asker clicks Confirm, without pings", async (s) => {
  const target = s.discord.channel("channel-2");
  s.model.script({ tool: "sendMessage", args: { channelId: "<#channel-2>", content: `Deploy at 5pm, <@${s.discord.bob.id}> is on call` } }, "Press Confirm to post it.");
  await s.discord.send(`${s.discord.mention} announce in #channel-2 that we deploy at 5pm`);
  const confirmation = s.discord.botMessages.at(-1)!;
  expect(confirmation.components[0].components.map((b: any) => b.label)).toContain("Confirm");
  expect(target.messages).toEqual([]);

  const stranger = await s.discord.click(confirmation, "Confirm", { user: s.discord.bob });
  expect(stranger.responses).toMatchObject([{ kind: "reply", payload: { ephemeral: true } }]);
  expect(target.messages).toEqual([]);

  await s.discord.click(confirmation, "Confirm");
  expect(target.messages.map((m) => [m.author.id, m.content])).toEqual([[s.discord.botUserId, `Deploy at 5pm, <@${s.discord.bob.id}> is on call`]]);
  expect(target.messages[0].allowedMentions).toEqual({ parse: [] });
  expect(confirmation.content).toContain("Completed");
  expect(confirmation.components).toEqual([]);
});

discordScenario("a channel the asker cannot see gets no Confirm message", async (s) => {
  const target = s.discord.channel("channel-2");
  s.discord.deny(target, s.discord.alice.id, ["ViewChannel"]);
  s.model.script({ tool: "sendMessage", args: { channelId: "channel-2", content: "Deploy at 5pm" } }, (turn) => `Refused: ${turn.toolResults[0].error}`);
  await s.discord.send(`${s.discord.mention} announce the deploy in channel-2`);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([expect.stringContaining("Refused: You can't see that channel")]);
  expect(target.messages).toEqual([]);
});

discordScenario("a channel the bot cannot post in gets no Confirm message", async (s) => {
  const target = s.discord.channel("channel-2");
  s.discord.deny(target, s.discord.botUserId, ["SendMessages"]);
  s.model.script({ tool: "sendMessage", args: { channelId: "channel-2", content: "Deploy at 5pm" } }, (turn) => `Refused: ${turn.toolResults[0].error}`);
  await s.discord.send(`${s.discord.mention} announce the deploy in channel-2`);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual([expect.stringContaining("Refused: I can't post there: I'm missing the Send Messages permission")]);
  expect(target.messages).toEqual([]);
});

discordScenario("access is checked again when the asker clicks Confirm", async (s) => {
  const target = s.discord.channel("channel-2");
  s.model.script({ tool: "sendMessage", args: { channelId: "channel-2", content: "Deploy at 5pm" } }, "Press Confirm to post it.");
  await s.discord.send(`${s.discord.mention} announce the deploy in channel-2`);
  const confirmation = s.discord.botMessages.at(-1)!;
  s.discord.deny(target, s.discord.alice.id, ["ViewChannel"]);

  await s.discord.click(confirmation, "Confirm");
  expect(target.messages).toEqual([]);
  expect(confirmation.content).toContain("I couldn't complete that");
  expect(confirmation.content).toContain("You can't see that channel");
});
