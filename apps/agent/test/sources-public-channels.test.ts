import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

const GENERAL = "guilds/guild-1/channels/channel-1", MARKETING = "guilds/guild-1/channels/channel-2";
/** Every tool result of the turn as the model read it: the refusal text, or the result itself. */
const results = (turn: any) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? r));
/** #general (channel-1, where people ask) and #marketing (channel-2), with replies posted in the channel itself. */
async function twoChannels(s: Scenario) {
  await s.guildSettings({ language: "en", useThreads: false });
  s.discord.channel("channel-1").name = "general";
  s.discord.channel("channel-2").name = "marketing";
}
async function ask(s: Scenario, calls: { tool: string; args: Record<string, unknown> }[], options: { author?: Scenario["discord"]["alice"]; channel?: string } = {}) {
  s.model.script(calls, results);
  await s.discord.send(`${s.discord.mention} what did we decide about pricing?`, options);
  return JSON.parse(s.discord.botMessages.at(-1)!.content);
}

discordScenario("asking in #general, a member searches and reads #marketing's Minutes when #marketing is a Public channel", async (s) => {
  await twoChannels(s);
  await s.workspace.write(`${MARKETING}/minutes/2026-10-14-pricing.md`, "# Pricing\nWe decided the pricing for Q4.\n");
  expect(await ask(s, [
    { tool: "searchFiles", args: { query: "pricing decided" } },
    { tool: "readFile", args: { path: "#marketing/minutes/2026-10-14-pricing.md" } },
    { tool: "listFiles", args: { path: "#marketing/minutes" } },
  ])).toEqual([
    { groups: [{ channel: "#marketing", matches: [{ path: "#marketing/minutes/2026-10-14-pricing.md", lines: [{ line: 2, text: "We decided the pricing for Q4." }, { line: 1, text: "# Pricing" }] }] }], total: 1, leftOut: 0 },
    { content: "# Pricing\nWe decided the pricing for Q4.\n", version: expect.any(String) },
    { entries: [{ path: "#marketing/minutes/2026-10-14-pricing.md", type: "file", size: 41 }] },
  ]);
});

discordScenario("a channel the asker cannot view, or one Discord cannot resolve, is never a source", async (s) => {
  await twoChannels(s);
  s.discord.channel("channel-3").name = "direksi";
  s.discord.deny("channel-3", s.discord.alice.id, ["ViewChannel"]);
  await s.workspace.write("guilds/guild-1/channels/channel-3/minutes/2026-10-14-pricing.md", "Pricing for the board\n");
  await s.workspace.write("guilds/guild-1/channels/channel-gone/minutes/2026-10-14-pricing.md", "Pricing from a deleted channel\n");
  const calls = [{ tool: "searchFiles", args: { query: "pricing" } }, { tool: "readFile", args: { path: "#direksi/minutes/2026-10-14-pricing.md" } }];
  expect(await ask(s, calls)).toEqual([{ groups: [], total: 0, leftOut: 0 }, "#direksi is not a channel whose files you can read from here."]);
  expect(await ask(s, calls, { author: s.discord.bob })).toEqual([
    { groups: [{ channel: "#direksi", matches: [{ path: "#direksi/minutes/2026-10-14-pricing.md", lines: [{ line: 1, text: "Pricing for the board" }] }] }], total: 1, leftOut: 0 },
    { content: "Pricing for the board\n", version: expect.any(String) },
  ]);
});

discordScenario("a channel @everyone cannot view is not quoted in another channel, while inside it its own Minutes are read", async (s) => {
  await twoChannels(s);
  s.discord.hide("channel-2");
  await s.workspace.write(`${MARKETING}/minutes/2026-10-14-pricing.md`, "Pricing agreed\n");
  const calls = [{ tool: "searchFiles", args: { query: "pricing" } }, { tool: "readFile", args: { path: "#marketing/minutes/2026-10-14-pricing.md" } }];
  expect(await ask(s, calls)).toEqual([
    { groups: [], total: 0, leftOut: 0, notShownHere: 1, suggestion: "1 more matching file you can read cannot be shown in this channel. Do not say what or where they are; suggest asking in a DM instead." },
    "Files from there cannot be shown in this channel. Do not say what or where they are; suggest asking in a DM instead.",
  ]);
  expect(await ask(s, [{ tool: "searchFiles", args: { query: "pricing" } }], { channel: "channel-2" })).toEqual([
    { groups: [{ channel: "#marketing", matches: [{ path: "channel/minutes/2026-10-14-pricing.md", lines: [{ line: 1, text: "Pricing agreed" }] }] }], total: 1, leftOut: 0 },
  ]);
});

discordScenario("a channel where an Availability rule turns the Workspace off is never a source", async (s) => {
  await twoChannels(s);
  await s.availability({ level: "channel", channelId: "channel-2" }, { kind: "skill", name: "workspace", value: "off" });
  await s.workspace.write(`${MARKETING}/minutes/2026-10-14-pricing.md`, "Pricing agreed\n");
  await s.workspace.write(`${GENERAL}/notes/pricing.md`, "Pricing questions\n");
  expect(await ask(s, [{ tool: "searchFiles", args: { query: "pricing" } }, { tool: "listFiles", args: { path: "#marketing/minutes" } }])).toEqual([
    { groups: [{ channel: "#general", matches: [{ path: "channel/notes/pricing.md", lines: [{ line: 1, text: "Pricing questions" }] }] }], total: 1, leftOut: 0 },
    "#marketing is not a channel whose files you can read from here.",
  ]);
});

discordScenario("another channel's Memory, tasks and other folders cannot be listed, read or searched", async (s) => {
  await twoChannels(s);
  await s.workspace.write(`${MARKETING}/MEMORY.md`, "- Pricing is secret\n");
  await s.workspace.write(`${MARKETING}/tasks/pricing.md`, "---\ntitle: Pricing task\n---\n");
  await s.workspace.write(`${MARKETING}/drafts/pricing.md`, "Pricing draft\n");
  await s.workspace.write(`${MARKETING}/threads/thread-x.md`, "Pricing brief\n");
  await s.workspace.write(`${MARKETING}/decisions/2026-10-14-pricing.md`, "Pricing decided\n");
  const refused = "From another channel only notes, decisions, files, minutes can be read.";
  const decided = { path: "#marketing/decisions/2026-10-14-pricing.md", lines: [{ line: 1, text: "Pricing decided" }] };
  expect(await ask(s, [
    { tool: "listFiles", args: { path: "#marketing" } },
    { tool: "readFile", args: { path: "#marketing/MEMORY.md" } },
    { tool: "readFile", args: { path: "#marketing/tasks/pricing.md" } },
    { tool: "listFiles", args: { path: "#marketing/drafts" } },
    { tool: "searchFiles", args: { query: "pricing", path: "#marketing/threads" } },
    { tool: "searchFiles", args: { query: "pricing", path: "#marketing" } },
    { tool: "searchFiles", args: { query: "pricing" } },
  ])).toEqual([
    { entries: [{ path: "#marketing/decisions", type: "dir" }] },
    refused, refused, refused, refused,
    { matches: [decided] },
    { groups: [{ channel: "#marketing", matches: [decided] }], total: 1, leftOut: 0 },
  ]);
});

discordScenario("writing, moving or deleting a file in another channel is refused in the place's language and changes nothing", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.discord.channel("channel-2").name = "marketing";
  const minutes = `${MARKETING}/minutes/2026-10-14-pricing.md`;
  await s.workspace.write(minutes, "Pricing agreed\n");
  const [said] = s.discord.history([{ content: "Pricing is final" }]);
  const refused = "File channel lain hanya bisa dibaca dari sini; mengubahnya dilakukan di channel itu.";
  expect(await ask(s, [
    { tool: "writeFile", args: { path: "#marketing/notes/pricing.md", content: "x" } },
    { tool: "writeFile", args: { path: "#marketing/minutes/2026-10-14-pricing.md", content: "x", version: "1" } },
    { tool: "moveFile", args: { from: "#marketing/minutes/2026-10-14-pricing.md", to: "channel/notes/pricing.md" } },
    { tool: "moveFile", args: { from: "channel/notes/x.md", to: "#marketing/notes/x.md" } },
    { tool: "keepAsNote", args: { messageIds: [said!.id], path: "#marketing/notes/final.md" } },
  ])).toEqual([refused, refused, refused, refused, refused]);
  s.model.script({ tool: "deleteFile", args: { path: "#marketing/minutes/2026-10-14-pricing.md" } }, results);
  await s.discord.send(`${s.discord.mention} hapus notulen pricing di #marketing`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual([refused]);
  expect(await s.workspace.read(minutes)).toBe("Pricing agreed\n");
  expect(await s.workspace.list(`${MARKETING}/notes`)).toEqual([]);
  expect(await s.workspace.list(`${GENERAL}/notes`)).toEqual([]);
});

discordScenario("a search naming no channel groups results by channel, newest first, at most fifty files with the total and the left-out count", async (s) => {
  await twoChannels(s);
  const day = (month: number, d: number) => `2026-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  for (let d = 1; d <= 30; d++) await s.workspace.write(`${MARKETING}/minutes/${day(10, d)}-pricing.md`, `Pricing call ${d}\n`);
  for (let d = 1; d <= 30; d++) await s.workspace.write(`${GENERAL}/notes/${day(9, d)}-pricing.md`, `Pricing note ${d}\n`);
  await s.workspace.write(`${GENERAL}/files/pricing.md`, "Pricing sheet\n");
  s.model.script({ tool: "searchFiles", args: { query: "pricing" } }, (turn) => {
    const r = turn.toolResults[0];
    return [...r.groups.map((g: any) => `${g.channel}: ${g.matches.length}, ${g.matches[0].path} … ${g.matches.at(-1).path}`), `${r.total} matched, ${r.leftOut} left out`].join("\n");
  });
  await s.discord.send(`${s.discord.mention} everything on pricing`);
  expect(s.discord.botMessages.at(-1)!.content).toBe([
    "#marketing: 30, #marketing/minutes/2026-10-30-pricing.md … #marketing/minutes/2026-10-01-pricing.md",
    "#general: 20, channel/notes/2026-09-30-pricing.md … channel/notes/2026-09-11-pricing.md",
    "61 matched, 11 left out",
  ].join("\n"));
});
