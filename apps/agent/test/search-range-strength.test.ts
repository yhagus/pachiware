import { expect } from "bun:test";
import { discordScenario, type Scenario } from "./support/discordScenario";

// searchFiles takes a date range and says how well each file matched (#210).

const CHANNEL = "guilds/guild-1/channels/channel-1";
async function search(s: Scenario, args: Record<string, unknown>) {
  let result: any;
  s.model.script({ tool: "searchFiles", args: { path: "channel/", ...args } }, (turn) => { result = turn.toolResults[0]; return "done"; });
  await s.discord.send(`${s.discord.mention} search`);
  return result;
}
const paths = (result: any) => result.matches.map((m: any) => m.path);

discordScenario("since and until keep only files of that range; a file without a date in its name is judged by the day it last changed", async (s) => {
  const { utimesSync } = await import("node:fs");
  await s.workspace.write(`${CHANNEL}/minutes/2026-08-28-pricing.md`, "Pricing stays flat.\n");
  await s.workspace.write(`${CHANNEL}/minutes/2026-09-03-pricing.md`, "Pricing goes up in October.\n");
  await s.workspace.write(`${CHANNEL}/minutes/2026-09-30-pricing.md`, "Pricing page copy is ready.\n");
  await s.workspace.write(`${CHANNEL}/minutes/2026-10-01-pricing.md`, "Pricing emails sent.\n");
  await s.workspace.write(`${CHANNEL}/files/pricing-sheet.md`, "Pricing sheet for September.\n");
  await s.workspace.write(`${CHANNEL}/files/pricing-old.md`, "Pricing sheet from last year.\n");
  const onDisk = (rel: string) => `${process.env.WORKSPACE_DIR}/${s.tenant.id}/${CHANNEL}/${rel}`;
  utimesSync(onDisk("files/pricing-sheet.md"), new Date("2026-09-15T05:00:00Z"), new Date("2026-09-15T05:00:00Z"));
  utimesSync(onDisk("files/pricing-old.md"), new Date("2025-10-01T05:00:00Z"), new Date("2025-10-01T05:00:00Z"));

  expect(paths(await search(s, { query: "pricing", since: "2026-09-01", until: "2026-09-30" })).sort()).toEqual([
    "channel/files/pricing-sheet.md", "channel/minutes/2026-09-03-pricing.md", "channel/minutes/2026-09-30-pricing.md",
  ]);
  expect(paths(await search(s, { query: "pricing", since: "2026-10-01" }))).toEqual(["channel/minutes/2026-10-01-pricing.md"]);
  expect(paths(await search(s, { query: "pricing", until: "2026-08-31" })).sort()).toEqual(["channel/files/pricing-old.md", "channel/minutes/2026-08-28-pricing.md"]);
});

discordScenario("a file holding every word of one query is strong, one holding only some is marked partial", async (s) => {
  await s.workspace.write(`${CHANNEL}/minutes/2026-09-01-loudness.md`, "Audio normalization targets -14 LUFS.\n");
  await s.workspace.write(`${CHANNEL}/notes/2026-09-02-gear.md`, "A new audio interface arrived.\n");
  const result = await search(s, { queries: ["normalisasi audio", "audio normalization"] });
  expect(result.matches).toEqual([
    { path: "channel/minutes/2026-09-01-loudness.md", lines: [{ line: 1, text: "Audio normalization targets -14 LUFS." }] },
    { path: "channel/notes/2026-09-02-gear.md", lines: [{ line: 1, text: "A new audio interface arrived." }], partial: true },
  ]);
  expect(result.nothingStrong).toBeUndefined();
});

discordScenario("when every match is partial the result says nothing matched strongly; with no match at all it says nothing found as before", async (s) => {
  await s.workspace.write(`${CHANNEL}/notes/2026-09-02-gear.md`, "A new audio interface arrived.\n");
  await s.workspace.write(`${CHANNEL}/notes/2026-09-03-mic.md`, "The microphone needs a new cable.\n");
  const weak = await search(s, { query: "audio normalization" });
  expect(weak).toEqual({ matches: [{ path: "channel/notes/2026-09-02-gear.md", lines: [{ line: 1, text: "A new audio interface arrived." }], partial: true }], nothingStrong: true });
  expect(await search(s, { query: "pricing" })).toEqual({ matches: [] });
});

discordScenario("across channels the grouped result carries nothingStrong too, and a malformed date is refused", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  s.discord.channel("channel-1").name = "general";
  await s.workspace.write(`${CHANNEL}/notes/2026-09-02-gear.md`, "A new audio interface arrived.\n");
  s.model.script([{ tool: "searchFiles", args: { query: "audio normalization" } }, { tool: "searchFiles", args: { query: "audio", since: "last week" } }],
    (turn) => JSON.stringify(turn.toolResults));
  await s.discord.send(`${s.discord.mention} search`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual([
    { groups: [{ channel: "#general", matches: [{ path: "channel/notes/2026-09-02-gear.md", lines: [{ line: 1, text: "A new audio interface arrived." }], partial: true }] }], total: 1, leftOut: 0, nothingStrong: true },
    { error: "\"last week\" is not a date: use YYYY-MM-DD" },
  ]);
});
