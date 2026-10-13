import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const systemPrompt = (messages: { role: string; content: any }[]) => String(messages.find((m) => m.role === "system")?.content);
const turnContext = (messages: { role: string; content: any }[]) => String(messages.findLast((m) => m.role === "user")?.content);

discordScenario("the turn context tells the time in the guild's zone, a DM in the tenant's, and the system prompt never changes with the clock", async (s) => {
  s.clock.set("2026-03-06T02:30:00Z");
  await s.guildSettings({ timezone: "Asia/Tokyo" });
  s.model.script("ok", "ok", "ok", "ok");
  await s.discord.send(`${s.discord.mention} when is the next release?`);
  expect(turnContext(s.model.calls[0])).toContain("Now: Friday, 6 March 2026, 11:30 Asia/Tokyo (UTC+09:00)");

  const dm = s.discord.channel("dm-alice", { dm: true });
  await s.discord.send("and in my DM?", { channel: dm });
  expect(turnContext(s.model.calls[1])).toContain("Now: Friday, 6 March 2026, 09:30 Asia/Jakarta (UTC+07:00)");

  await s.guildSettings({ timezone: null });
  await s.discord.send(`${s.discord.mention} without the override?`);
  expect(turnContext(s.model.calls[2])).toContain("Now: Friday, 6 March 2026, 09:30 Asia/Jakarta (UTC+07:00)");

  s.clock.advance(2 * 60 * 60_000);
  await s.discord.send(`${s.discord.mention} two hours later?`);
  expect(turnContext(s.model.calls[3])).toContain("Now: Friday, 6 March 2026, 11:30 Asia/Jakarta (UTC+07:00)");
  expect(systemPrompt(s.model.calls[3])).toBe(systemPrompt(s.model.calls[0]));
  expect(systemPrompt(s.model.calls[0])).not.toContain("2026");
  expect(turnContext(s.model.calls[3]).match(/^Now: /gm)).toHaveLength(1);
});

discordScenario("a provider failure is reported in the configured language, the guild's over the tenant's, whatever the message's language", async (s) => {
  const { useProfile } = await import(process.cwd() + "/apps/agent/test/support/images.ts");
  await useProfile(s, { provider: "openai", model: "gpt-x", acceptsImages: false });
  s.http.on("POST api.openai.com/v1/chat/completions", () => new Response("down", { status: 503 }));
  await s.discord.send(`${s.discord.mention} what is on the list for today?`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("Penyedia modelnya tidak bisa saya hubungi saat ini. Coba lagi sebentar lagi.");

  await s.guildSettings({ language: "en" });
  await s.discord.send(`${s.discord.mention} apa saja yang ada di daftar hari ini?`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("I couldn't reach the model provider just now. Try again in a moment.");
});
