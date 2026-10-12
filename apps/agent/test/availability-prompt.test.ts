import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const systemPrompt = (messages: { role: string; content: any }[]) => String(messages.find((m) => m.role === "system")?.content);

discordScenario("with danger off in a channel the prompt says so, and the bot can tell the user it is turned off here", async (s) => {
  await s.git({ repos: ["acme/*"] });
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "effect", name: "danger", value: "off" });
  s.model.script((turn) => (/turned off here[\s\S]*\bdanger\b/i.test(systemPrompt(turn.messages)) ? "Deleting a repository is turned off in this channel." : "I cannot do that."));
  await s.discord.send(`${s.discord.mention} delete the repository acme/old`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Deleting a repository is turned off in this channel.");
  expect(s.model.tools[0]).not.toContain("repoDelete");
});

discordScenario("with nothing off here the prompt is byte for byte the one without rules, and an off-summary only adds to its end", async (s) => {
  s.model.script("ok", "ok", "ok");
  await s.discord.send(`${s.discord.mention} hi`, { channel: "channel-1" });
  const before = systemPrompt(s.model.calls[0]);

  await s.availability({ level: "channel", channelId: "channel-2" }, { kind: "skill", name: "task_management", value: "off" });
  await s.discord.send(`${s.discord.mention} hi`, { channel: "channel-1" });
  await s.discord.send(`${s.discord.mention} hi`, { channel: "channel-2" });
  expect(systemPrompt(s.model.calls[1])).toBe(before);
  const elsewhere = systemPrompt(s.model.calls[2]);
  expect(elsewhere.startsWith(before)).toBe(true);
  expect(elsewhere.length).toBeGreaterThan(before.length);
});

discordScenario("the off-summary names skills and effects, never their tools", async (s) => {
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "skill", name: "task_management", value: "off" });
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "tool", name: "listChannels", value: "off" });
  await s.availability({ level: "channel", channelId: "channel-1" }, { kind: "effect", name: "write", value: "off" });
  s.model.script("ok", "ok");
  await s.discord.send(`${s.discord.mention} hi`, { channel: "channel-2" });
  await s.discord.send(`${s.discord.mention} hi`, { channel: "channel-1" });
  const summary = systemPrompt(s.model.calls[1]).slice(systemPrompt(s.model.calls[0]).length);
  expect(summary).toContain("Task Management");
  expect(summary).toContain("Discord Management");
  expect(summary).toMatch(/\bwrite\b/);
  expect(summary).not.toMatch(/\b(danger|read)\b/);
  for (const tool of ["createTask", "listTasks", "listChannels", "createChannel", "writeFile"]) expect(summary).not.toContain(tool);
});
