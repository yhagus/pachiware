import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { attachment } from "./support/images";
import { pdf } from "./support/documents";

const shown = (turn: any) => JSON.stringify(turn.toolResults[0].matches ?? turn.toolResults[0].error);

discordScenario("a search for every word finds a Minutes file whose words sit on different lines", async (s) => {
  await s.workspace.write("guilds/guild-1/channels/channel-1/minutes/2026-10-01-weekly.md", "# Weekly\n\nWe decided the pricing for Q4.\nThe decision is final.\n");
  s.model.script({ tool: "searchFiles", args: { query: "pricing decision", path: "channel/" } }, shown);
  await s.discord.send(`${s.discord.mention} what was the pricing decision?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual([
    { path: "channel/minutes/2026-10-01-weekly.md", lines: [{ line: 3, text: "We decided the pricing for Q4." }, { line: 4, text: "The decision is final." }] },
  ]);
});

discordScenario("case does not matter in the query or the file", async (s) => {
  await s.workspace.write("guilds/guild-1/channels/channel-1/decisions/2026-10-02-flat.md", "PRICING stays flat; Decision by Alice.\n");
  s.model.script({ tool: "searchFiles", args: { query: "Pricing DECISION", path: "channel/" } }, shown);
  await s.discord.send(`${s.discord.mention} pricing decision?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual([
    { path: "channel/decisions/2026-10-02-flat.md", lines: [{ line: 1, text: "PRICING stays flat; Decision by Alice." }] },
  ]);
});

discordScenario("a file missing any one query word is not returned", async (s) => {
  await s.workspace.write("guilds/guild-1/channels/channel-1/minutes/2026-10-01-weekly.md", "We decided the pricing for Q4.\n");
  await s.workspace.write("guilds/guild-1/channels/channel-1/minutes/2026-10-08-weekly.md", "Pricing decision: flat for Q4.\n");
  s.model.script({ tool: "searchFiles", args: { query: "pricing decision", path: "channel/minutes" } }, shown);
  await s.discord.send(`${s.discord.mention} pricing decision?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content).map((m: any) => m.path)).toEqual(["channel/minutes/2026-10-08-weekly.md"]);
});

discordScenario("each match returns at most three lines, those holding the most query words, with line numbers", async (s) => {
  await s.workspace.write("guilds/guild-1/channels/channel-1/minutes/2026-10-01-weekly.md", [
    "# Weekly sync", "Pricing came up first.", "Budget was next.", "The Q4 pricing budget stays flat.", "Hiring was skipped.", "Budget review in November.", "Pricing page copy goes out Friday.",
  ].join("\n"));
  s.model.script({ tool: "searchFiles", args: { query: "pricing budget", path: "channel/" } }, shown);
  await s.discord.send(`${s.discord.mention} what about the pricing budget?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual([
    { path: "channel/minutes/2026-10-01-weekly.md", lines: [
      { line: 4, text: "The Q4 pricing budget stays flat." },
      { line: 2, text: "Pricing came up first." },
      { line: 3, text: "Budget was next." },
    ] },
  ]);
});

discordScenario("a query matching a file's name still returns it", async (s) => {
  await s.workspace.write("guilds/guild-1/channels/channel-1/minutes/2026-10-01-roadmap.md", "Q1 themes agreed.\nRoadmap owner: Bob.\n");
  s.model.script({ tool: "searchFiles", args: { query: "roadmap minutes", path: "channel/" } }, shown);
  await s.discord.send(`${s.discord.mention} the roadmap minutes?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual([
    { path: "channel/minutes/2026-10-01-roadmap.md", lines: [{ line: 2, text: "Roadmap owner: Bob." }] },
  ]);
});

discordScenario("an uploaded PDF's extracted text is searched for every word", async (s) => {
  const minutes = attachment(s, "board.pdf", pdf(["Board meeting", "The pricing was decided.", "Decision owner: Alice."]), { contentType: "application/pdf" });
  s.model.script("Filed.", { tool: "searchFiles", args: { query: "pricing decision", path: "channel/files" } }, shown);
  await s.discord.send(`${s.discord.mention} board minutes`, { attachments: [minutes] });
  await s.discord.send(`${s.discord.mention} what was the pricing decision?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual([
    { path: "channel/files/board.md", lines: [{ line: 2, text: "The pricing was decided." }, { line: 3, text: "Decision owner: Alice." }] },
  ]);
});

discordScenario("hidden files and folders are skipped", async (s) => {
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/pricing.md", "Pricing is flat.\n");
  await s.workspace.write("guilds/guild-1/channels/channel-1/.pricing.md", "Pricing is secret.\n");
  await s.workspace.write("guilds/guild-1/channels/channel-1/.documents/files/pricing.pdf.json", "{\"name\":\"pricing\"}\n");
  s.model.script({ tool: "searchFiles", args: { query: "pricing", path: "channel/" } }, shown);
  await s.discord.send(`${s.discord.mention} pricing?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content).map((m: any) => m.path)).toEqual(["channel/notes/pricing.md"]);
});
