import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

/** What the person's side said in the model's last request: its user messages, joined. */
const lastTurn = (s: Parameters<Parameters<typeof discordScenario>[1]>[0]) => s.model.calls.at(-1)!.filter((m) => m.role === "user").map((m) => String(m.content)).join("\n");

discordScenario("Alice replies to Bob's message with \"@bot catat ini jadi tugas\": the turn carries Bob's name and his text, on one line, before her line", async (s) => {
  await s.guildSettings({ useThreads: false });
  const [bob] = s.discord.history([{ content: "Kirim invoice ke vendor\nsebelum Jumat", author: s.discord.bob }]);
  s.model.script("Dicatat.");
  await s.discord.send(`${s.discord.mention} catat ini jadi tugas`, { replyTo: bob });
  expect(lastTurn(s)).toContain('(replying to Bob: "Kirim invoice ke vendor sebelum Jumat")\nAlice: catat ini jadi tugas');
});

discordScenario("a reply to an old message of the bot's carries that message's text as replying to you", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.model.script("Rilis 2.4 pindah ke 14 Oktober.");
  await s.discord.send(`${s.discord.mention} kapan rilis 2.4?`);
  const answer = s.discord.botMessages.at(-1)!;
  s.model.script("Baik.");
  await s.discord.send(`${s.discord.mention} siapa yang memutuskan itu?`, { author: s.discord.bob, replyTo: answer });
  expect(lastTurn(s)).toContain('(replying to you: "Rilis 2.4 pindah ke 14 Oktober.")\nBob: siapa yang memutuskan itu?');
});

discordScenario("a replied-to text over 2,000 characters is clipped to 500 in the line and names its message, and keepAsNote keeps it whole by that id", async (s) => {
  s.clock.set("2026-10-15T03:00:00Z");
  await s.guildSettings({ useThreads: false });
  const email = `${"a".repeat(500)}${"b".repeat(1600)}`;
  const [pasted] = s.discord.history([{ content: email, author: s.discord.bob }]);
  s.model.script({ tool: "keepAsNote", args: { messageIds: [pasted!.id], path: "channel/notes/vendor-email.md" } }, (turn) => `Kept as ${turn.toolResults[0].path}`);
  await s.discord.send(`${s.discord.mention} keep this as a note`, { replyTo: pasted });

  expect(lastTurn(s)).toContain(`(replying to Bob (message ${pasted!.id}): "${"a".repeat(500)}…")\nAlice: keep this as a note`);
  expect(lastTurn(s)).not.toContain("ab");
  expect(s.discord.botMessages.at(-1)?.content).toBe("Kept as channel/notes/vendor-email.md");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/notes/vendor-email.md")).toBe(
    `---\nsource: "https://discord.com/channels/guild-1/channel-1/${pasted!.id}"\nauthor: "Bob"\naskedBy: "Alice"\ndate: "2026-10-15"\n---\n${email}`,
  );
});

discordScenario("a mention replying to a long message opens a thread, and keepAsNote there still keeps the replied-to message from the channel", async (s) => {
  s.clock.set("2026-10-15T03:00:00Z");
  const email = `${"a".repeat(500)}${"b".repeat(1600)}`;
  const [pasted] = s.discord.history([{ content: email, author: s.discord.bob }]);
  s.model.script({ tool: "keepAsNote", args: { messageIds: [pasted!.id], path: "channel/notes/vendor-email.md" } }, (turn) => `Kept as ${turn.toolResults[0].path}`);
  const ask = await s.discord.send(`${s.discord.mention} keep this as a note`, { replyTo: pasted });

  expect(ask.thread).toBeDefined();
  expect(lastTurn(s)).toContain(`(replying to Bob (message ${pasted!.id}): "`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Kept as channel/notes/vendor-email.md");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/notes/vendor-email.md")).toBe(
    `---\nsource: "https://discord.com/channels/guild-1/channel-1/${pasted!.id}"\nauthor: "Bob"\naskedBy: "Alice"\ndate: "2026-10-15"\n---\n${email}`,
  );
});

discordScenario("a reply to a message deleted before the bot reads it adds nothing, and the turn is answered", async (s) => {
  await s.guildSettings({ useThreads: false });
  const [gone] = s.discord.history([{ content: "draft I will delete", author: s.discord.bob }]);
  await s.discord.deleteMessage(gone!);
  s.model.script("Sure.");
  await s.discord.send(`${s.discord.mention} what about this?`, { replyTo: gone });
  expect(lastTurn(s)).toContain("Alice: what about this?");
  expect(lastTurn(s)).not.toContain("replying to");
  expect(s.discord.botMessages.at(-1)?.content).toBe("Sure.");
});
