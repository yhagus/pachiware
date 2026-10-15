import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { attachment } from "./support/images";

const THREAD = "guilds/guild-1/channels/channel-1/threads/thread-p";
const said = (turn: any) => { const r = turn.toolResults[0]; return r.error ? `refused: ${r.error}` : r.content ?? r.path ?? JSON.stringify(r); };

discordScenario("minutes written in a private thread go to the thread's folder, are read from inside it, and take corrections there", async (s) => {
  const { alice } = s.discord;
  const thread = s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  s.discord.history([{ content: "We ship pricing v2 on Monday, agreed", author: alice, at: Date.now() - 60_000 }], { channel: thread });
  s.model.script(JSON.stringify({ title: "Pricing", decided: [{ text: "Ship pricing v2 on Monday", ref: 1 }], open: [], actions: [] }));
  await s.discord.send(`${s.discord.mention} minutes`, { channel: thread });

  const file = `${new Date().toISOString().slice(0, 10)}-pricing.md`;
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/minutes")).toEqual([]);
  expect(await s.workspace.list(`${THREAD}/minutes`)).toEqual([`${THREAD}/minutes/${file}`]);

  s.model.script({ tool: "readFile", args: { path: `thread/minutes/${file}` } }, said);
  await s.discord.send(`${s.discord.mention} what did we decide?`, { channel: thread });
  expect(s.discord.botMessages.at(-1)!.content).toContain("Ship pricing v2 on Monday");

  const minutes = s.discord.botMessages.find((m) => m.embeds.length)!;
  s.model.script(JSON.stringify({ title: "Pricing", decided: [], open: [{ text: "Pricing v2 date not settled", ref: 1 }], actions: [] }));
  await s.discord.send("Monday was not agreed yet", { author: alice, replyTo: minutes, channel: thread });
  expect(await s.workspace.read(`${THREAD}/minutes/${file}`)).toContain("Pricing v2 date not settled");
});

discordScenario("a Note, a Decision and a Document kept in a private thread land in the thread's folder, even when the model names the channel's", async (s) => {
  s.clock.set("2026-10-15T03:00:00Z");
  const { alice } = s.discord;
  const thread = s.discord.channel("thread-p", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  const offer = attachment(s, "offer.txt", new TextEncoder().encode("Salary band 5\n"), { contentType: "text/plain" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} the offer`, { channel: thread, attachments: [offer] });
  expect(s.model.calls[0]!.at(-2)!.content).toContain("saved as thread/files/offer.txt");

  const [said] = s.discord.history([{ content: "We hire Dana at band 5", author: alice }], { channel: thread });
  s.model.script(
    [{ tool: "keepAsNote", args: { messageIds: [said!.id], path: "channel/notes/hire.md" } }, { tool: "writeFile", args: { path: "channel/decisions/2026-10-15-hire-dana.md", content: "# Hire Dana at band 5\n" } }],
    (turn) => turn.toolResults.map((r: any) => r.error ?? r.path).join(" "),
  );
  await s.discord.send(`${s.discord.mention} keep that as a note and record the decision`, { channel: thread });
  expect(s.discord.botMessages.at(-1)!.content).toBe("thread/notes/hire.md thread/decisions/2026-10-15-hire-dana.md");

  expect(await s.workspace.read(`${THREAD}/files/offer.txt`)).toBe("Salary band 5\n");
  expect(await s.workspace.read(`${THREAD}/.documents/files/offer.txt.json`)).toContain("Alice");
  expect(await s.workspace.read(`${THREAD}/notes/hire.md`)).toContain("We hire Dana at band 5");
  expect(await s.workspace.read(`${THREAD}/decisions/2026-10-15-hire-dana.md`)).toBe("# Hire Dana at band 5\n");
  for (const folder of ["files", "notes", "decisions", ".documents"]) expect(await s.workspace.list(`guilds/guild-1/channels/channel-1/${folder}`)).toEqual([]);
});
