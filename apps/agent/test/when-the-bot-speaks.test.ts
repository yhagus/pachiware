import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("a mention holding only emoji gets a 👀 reaction and no text", async (s) => {
  const msg = await s.discord.send(`${s.discord.mention} 👍🎉`);
  expect(msg.reactions).toEqual(["👀"]);
  expect(s.discord.botMessages).toEqual([]);
  expect(s.model.calls).toEqual([]);
});

discordScenario("in an always-on channel the model can stay silent on a message not meant for it", async (s) => {
  await s.guildSettings({ alwaysChannelIds: ["channel-1"] });
  s.model.script("[[silent]]");
  const msg = await s.discord.send("anyone got lunch plans?");
  expect(s.model.calls).toHaveLength(1);
  expect(s.discord.botMessages).toEqual([]);
  expect(msg.reactions).toEqual([]);
});

discordScenario("a thanks in the bot's thread gets only the reaction the model chose", async (s) => {
  s.model.script("Restarted api; it is healthy.", "[[react:👍]]");
  const ask = await s.discord.send(`${s.discord.mention} restart api please`);
  const thanks = await s.discord.send("thanks!", { channel: ask.thread });
  expect(thanks.reactions).toEqual(["👍"]);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["Restarted api; it is healthy."]);
});

discordScenario("a mention still gets text when the model answers with the silence marker", async (s) => {
  await s.guildSettings({ alwaysChannelIds: ["channel-1"] });
  s.model.script("[[silent]]", "[[silent]] The build is still running.");
  const first = await s.discord.send(`${s.discord.mention} hm`);
  await s.discord.send(`${s.discord.mention} is the build done?`);
  expect(s.discord.botMessages).toHaveLength(2);
  expect(s.discord.botMessages.every((m) => m.content.trim().length > 0 && !m.content.includes("[["))).toBe(true);
  expect(s.discord.botMessages[1].content).toBe("The build is still running.");
  expect(first.reactions).toEqual([]);
});

discordScenario("in an ordinary channel the bot never answers a message that does not address it", async (s) => {
  s.model.script("Earlier answer.");
  const ask = await s.discord.send(`${s.discord.mention} what time is the deploy?`);
  await s.discord.send("what time is the deploy?");
  await s.discord.send("👍");
  await s.discord.send("ok thanks", { replyTo: ask });
  expect(s.model.calls).toHaveLength(1);
  expect(s.discord.botMessages).toHaveLength(1);
  expect(s.discord.channel("channel-1").messages.flatMap((m) => m.reactions)).toEqual([]);
});

discordScenario("emoji that does not address the bot in an always-on channel gets no reaction", async (s) => {
  await s.guildSettings({ alwaysChannelIds: ["channel-1"] });
  const msg = await s.discord.send("😂");
  expect(msg.reactions).toEqual([]);
  expect(s.model.calls).toEqual([]);
});

discordScenario("a reply to the bot holding only emoji gets a 👀 reaction", async (s) => {
  s.model.script("Deploy is at 14:00.");
  const ask = await s.discord.send(`${s.discord.mention} when is the deploy?`);
  const ack = await s.discord.send("🙏", { replyTo: s.discord.botMessages[0], channel: ask.thread });
  expect(ack.reactions).toEqual(["👀"]);
  expect(s.model.calls).toHaveLength(1);
});

discordScenario("the marker convention sits in the cached prompt for addressed and unaddressed turns alike", async (s) => {
  s.model.script("Which service?", "[[silent]]");
  const ask = await s.discord.send(`${s.discord.mention} can I restart it?`);
  await s.discord.send("the api one", { channel: ask.thread });
  const [first, second] = s.model.calls.map((call) => call[0].content as string);
  expect(second).toBe(first);
  expect(first).toContain("[[silent]]");
  expect(first).toContain("[[react:👍]]");
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["Which service?"]);
});

discordScenario("a mention wears ⏳ while its answer is worked on, and loses it once answered", async (s) => {
  let during: string[] = [];
  s.model.script(() => { during = [...s.discord.channel("channel-1").messages[0].reactions]; return "Deploy is at 14:00."; });
  const ask = await s.discord.send(`${s.discord.mention} when is the deploy?`);
  expect(during).toEqual(["⏳"]);
  expect(ask.reactions).toEqual([]);
  expect(s.discord.botMessages.map((m) => m.content)).toEqual(["Deploy is at 14:00."]);
});

discordScenario("⏳ comes off even when the turn fails", async (s) => {
  s.model.script({ error: "Provider request failed" });
  const ask = await s.discord.send(`${s.discord.mention} when is the deploy?`);
  expect(ask.reactions).toEqual([]);
  expect(s.discord.botMessages).toHaveLength(1);
});

discordScenario("a message not meant for the bot gets no ⏳, since it may get no answer", async (s) => {
  await s.guildSettings({ alwaysChannelIds: ["channel-1"] });
  let during: string[] = ["unset"];
  s.model.script(() => { during = [...s.discord.channel("channel-1").messages[0].reactions]; return "[[silent]]"; });
  await s.discord.send("anyone got lunch plans?");
  expect(during).toEqual([]);
});
