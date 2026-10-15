import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const GENERAL = "guilds/guild-1/channels/channel-1", DIREKSI = "guilds/guild-1/channels/channel-3";
/** Every tool result of the turn as the model read it: the refusal text, or the result itself. */
const results = (turn: any) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? r));
/** #general (channel-1, where people ask) and #direksi (channel-3), a channel @everyone cannot view; replies go in the channel itself. */
async function generalAndDireksi(s: Scenario, language: "en" | "id" = "en") {
  await s.guildSettings({ language, useThreads: false });
  s.discord.channel("channel-1").name = "general";
  s.discord.channel("channel-3").name = "direksi";
  s.discord.hide("channel-3");
  await s.workspace.write(`${DIREKSI}/minutes/2026-10-14-board.md`, "# Board\nWe decided the pricing for Q4.\n");
}
async function ask(s: Scenario, calls: { tool: string; args: Record<string, unknown> }[], options: { author?: Scenario["discord"]["alice"]; channel?: string } = {}) {
  s.model.script(calls, results);
  await s.discord.send(`${s.discord.mention} what did we decide about pricing?`, options);
  return s.discord.botMessages.at(-1)!.content;
}

const SUGGEST_EN = (n: number) => `${n} more matching ${n === 1 ? "file" : "files"} you can read cannot be shown in this channel. Do not say what or where they are; suggest asking in a DM instead.`;

discordScenario("asking in #general about something kept in a non-public channel, the result names no channel, file or line and suggests a DM", async (s) => {
  await generalAndDireksi(s);
  await s.workspace.write(`${GENERAL}/notes/pricing.md`, "Pricing questions\n");
  const said = await ask(s, [{ tool: "searchFiles", args: { query: "pricing decided" } }, { tool: "searchFiles", args: { query: "pricing" } }]);
  expect(said).not.toMatch(/direksi|board|channel-3|Q4/i);
  expect(JSON.parse(said)).toEqual([
    { groups: [], total: 0, leftOut: 0, notShownHere: 1, suggestion: SUGGEST_EN(1) },
    { groups: [{ channel: "#general", matches: [{ path: "channel/notes/pricing.md", lines: [{ line: 1, text: "Pricing questions" }] }] }], total: 1, leftOut: 0, notShownHere: 1, suggestion: SUGGEST_EN(1) },
  ]);
});

discordScenario("reading or listing a non-quotable channel's files by path is refused alike whether the file exists or not", async (s) => {
  await generalAndDireksi(s);
  const refused = "Files from there cannot be shown in this channel. Do not say what or where they are; suggest asking in a DM instead.";
  const said = await ask(s, [
    { tool: "readFile", args: { path: "#direksi/minutes/2026-10-14-board.md" } },
    { tool: "readFile", args: { path: "#direksi/minutes/2026-10-15-nothing.md" } },
    { tool: "listFiles", args: { path: "#direksi/minutes" } },
    { tool: "listFiles", args: { path: "<#channel-3>" } },
    { tool: "searchFiles", args: { query: "pricing", path: "#direksi/minutes" } },
  ]);
  expect(said).not.toMatch(/board|Q4/i);
  expect(JSON.parse(said)).toEqual([refused, refused, refused, refused, { matches: [], notShownHere: 1, suggestion: SUGGEST_EN(1) }]);
});

discordScenario("inside a non-public channel its own files and Public channels' are quoted, another non-public channel's only counted", async (s) => {
  await generalAndDireksi(s);
  s.discord.channel("channel-2").name = "marketing";
  s.discord.channel("channel-4").name = "rahasia";
  s.discord.hide("channel-4");
  await s.workspace.write("guilds/guild-1/channels/channel-2/minutes/2026-10-13-pricing.md", "Pricing call\n");
  await s.workspace.write("guilds/guild-1/channels/channel-4/notes/pricing.md", "Pricing secret\n");
  const board = { path: "channel/minutes/2026-10-14-board.md", lines: [{ line: 2, text: "We decided the pricing for Q4." }] };
  const marketing = { channel: "#marketing", matches: [{ path: "#marketing/minutes/2026-10-13-pricing.md", lines: [{ line: 1, text: "Pricing call" }] }] };
  expect(JSON.parse(await ask(s, [
    { tool: "searchFiles", args: { query: "pricing" } },
    { tool: "readFile", args: { path: "channel/minutes/2026-10-14-board.md" } },
    { tool: "readFile", args: { path: "#marketing/minutes/2026-10-13-pricing.md" } },
    { tool: "readFile", args: { path: "#rahasia/notes/pricing.md" } },
  ], { channel: "channel-3" }))).toEqual([
    { groups: [{ channel: "#direksi", matches: [board] }, marketing], total: 2, leftOut: 0, notShownHere: 1, suggestion: SUGGEST_EN(1) },
    { content: "# Board\nWe decided the pricing for Q4.\n", version: expect.any(String) },
    { content: "Pricing call\n", version: expect.any(String) },
    "Files from there cannot be shown in this channel. Do not say what or where they are; suggest asking in a DM instead.",
  ]);
  expect(JSON.parse(await ask(s, [{ tool: "searchFiles", args: { query: "pricing" } }]))).toEqual([
    { groups: [marketing], total: 1, leftOut: 0, notShownHere: 2, suggestion: SUGGEST_EN(2) },
  ]);
});

discordScenario("the DM suggestion and the refusal are in Indonesian when the place's language is Indonesian", async (s) => {
  await generalAndDireksi(s, "id");
  expect(JSON.parse(await ask(s, [
    { tool: "searchFiles", args: { query: "pricing" } },
    { tool: "readFile", args: { path: "#direksi/minutes/2026-10-14-board.md" } },
  ]))).toEqual([
    { groups: [], total: 0, leftOut: 0, notShownHere: 1, suggestion: "1 file lain yang cocok dan bisa kamu baca tidak bisa ditampilkan di channel ini. Jangan sebutkan isi atau tempatnya; sarankan bertanya lewat DM." },
    "File dari sana tidak bisa ditampilkan di channel ini. Jangan sebutkan isi atau tempatnya; sarankan bertanya lewat DM.",
  ]);
});

discordScenario("a private thread of another channel counts only for people added to it, and is never named", async (s) => {
  await generalAndDireksi(s);
  s.discord.channel("channel-2").name = "marketing";
  s.discord.channel("thread-9", { thread: true, private: true, parentId: "channel-2", members: [s.discord.alice.id] }).name = "launch";
  await s.workspace.write("guilds/guild-1/channels/channel-2/threads/thread-9/minutes/2026-10-12-pricing.md", "Launch pricing\n");
  const alice = await ask(s, [{ tool: "searchFiles", args: { query: "pricing" } }]);
  expect(alice).not.toMatch(/launch|thread-9|marketing/i);
  expect(JSON.parse(alice)).toEqual([{ groups: [], total: 0, leftOut: 0, notShownHere: 2, suggestion: SUGGEST_EN(2) }]);
  expect(JSON.parse(await ask(s, [{ tool: "searchFiles", args: { query: "pricing" } }], { author: s.discord.bob }))).toEqual([
    { groups: [], total: 0, leftOut: 0, notShownHere: 1, suggestion: SUGGEST_EN(1) },
  ]);
});
