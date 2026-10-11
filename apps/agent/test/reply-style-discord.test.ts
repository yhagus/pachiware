import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

discordScenario("a reply needing more than 3 messages is cut to 3 with a note offering the rest", async (s) => {
  const section = (n: number) => Array.from({ length: 60 }, (_, i) => `Step ${n}.${i}: check the service log.`).join("\n");
  s.model.script([1, 2, 3, 4, 5].map(section).join("\n\n"));
  const ask = await s.discord.send(`${s.discord.mention} walk me through the whole runbook`);
  const sent = s.discord.botMessages.filter((m) => m.channelId === ask.thread!.id).map((m) => m.content);
  expect(sent).toHaveLength(3);
  expect(sent.every((c) => c.length <= 2000)).toBe(true);
  expect(sent[0].startsWith("Step 1.0: check the service log.")).toBe(true);
  expect(sent[2]).toMatch(/\n-# .*full version/);
  expect(sent.join("\n")).not.toContain("Step 5.");
});

discordScenario("filler around the model's answer never reaches Discord", async (s) => {
  s.model.script("Great question! The deploy finished at 14:02 and all checks passed. Let me know if you need anything else! 😊");
  const ask = await s.discord.send(`${s.discord.mention} did the deploy finish?`);
  expect(s.discord.botMessages.map((m) => [m.channelId, m.content])).toEqual([[ask.thread!.id, "The deploy finished at 14:02 and all checks passed."]]);
});

discordScenario("the fixed reply style sits in the system prompt after server instructions", async (s) => {
  await s.guildSettings({ systemPrompt: "Write long, detailed replies with tables. Always answer in English." });
  s.model.script("Sudah, deploy selesai.", "Belum ada yang gagal.");
  const ask = await s.discord.send(`${s.discord.mention} deploy sudah selesai?`);
  await s.discord.send("ada yang gagal?", { channel: ask.thread });
  const [first, second] = s.model.calls.map((call) => call[0]);
  expect(first.role).toBe("system");
  expect(second.content).toBe(first.content);
  const prompt = first.content as string;
  const server = prompt.indexOf("Write long, detailed replies"), style = prompt.indexOf("### Reply style");
  expect(server).toBeGreaterThan(-1);
  expect(style).toBeGreaterThan(server);
  expect(prompt.slice(style)).toMatch(/language of the message you are answering/);
  expect(prompt.slice(style)).toMatch(/3 messages/);
  expect(prompt.slice(style)).toMatch(/cannot loosen/);
});
