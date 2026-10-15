import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";

const MINUTES = "guilds/guild-1/channels/channel-1/minutes";
const paths = (turn: any) => JSON.stringify(turn.toolResults.at(-1).matches?.map((m: any) => m.path) ?? turn.toolResults.at(-1).error);
const found = (s: any) => JSON.parse(s.discord.botMessages.at(-1)!.content);
const search = async (s: any, query: string, path = "channel/") => {
  s.model.script({ tool: "searchFiles", args: { query, path } }, paths);
  await s.discord.send(`${s.discord.mention} find ${query}`);
  return found(s);
};

discordScenario("a file the bot writes is found by the very next search", async (s) => {
  await s.workspace.write(`${MINUTES}/2026-10-01-weekly.md`, "Pricing stays flat.\n");
  expect(await search(s, "pricing")).toEqual(["channel/minutes/2026-10-01-weekly.md"]);

  s.model.script({ tool: "writeFile", args: { path: "channel/decisions/2026-10-02-pricing.md", content: "We decided the pricing for Q4.\n" } }, "Kept.");
  await s.discord.send(`${s.discord.mention} keep the pricing decision`);
  expect(await search(s, "pricing")).toEqual(["channel/decisions/2026-10-02-pricing.md", "channel/minutes/2026-10-01-weekly.md"]);
});

discordScenario("a file the bot rewrites is found by its new text and no longer by its old text", async (s) => {
  await s.workspace.write(`${MINUTES}/2026-10-01-weekly.md`, "Pricing stays flat.\n");
  expect(await search(s, "flat")).toEqual(["channel/minutes/2026-10-01-weekly.md"]);

  await s.workspace.write(`${MINUTES}/2026-10-01-weekly.md`, "Pricing goes up 5%.\n");
  expect(await search(s, "flat")).toEqual([]);
  expect(await search(s, "goes up")).toEqual(["channel/minutes/2026-10-01-weekly.md"]);
});

discordScenario("a moved file is found at its new path and no longer at its old one", async (s) => {
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/pricing.md", "Pricing stays flat.\n");
  expect(await search(s, "pricing")).toEqual(["channel/notes/pricing.md"]);

  s.model.script({ tool: "moveFile", args: { from: "channel/notes/pricing.md", to: "channel/decisions/2026-10-02-pricing.md" } }, "Moved.");
  await s.discord.send(`${s.discord.mention} that note is a decision`);
  expect(await search(s, "pricing")).toEqual(["channel/decisions/2026-10-02-pricing.md"]);
});

discordScenario("a moved folder's files are found under its new name", async (s) => {
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/q4/pricing.md", "Pricing stays flat.\n");
  expect(await search(s, "pricing")).toEqual(["channel/notes/q4/pricing.md"]);

  s.model.script({ tool: "moveFile", args: { from: "channel/notes/q4", to: "channel/notes/2026-q4" } }, "Moved.");
  await s.discord.send(`${s.discord.mention} rename the q4 folder`);
  expect(await search(s, "pricing")).toEqual(["channel/notes/2026-q4/pricing.md"]);
});

discordScenario("a deleted file is no longer returned", async (s) => {
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/pricing.md", "Pricing stays flat.\n");
  expect(await search(s, "pricing")).toEqual(["channel/notes/pricing.md"]);

  s.model.script({ tool: "deleteFile", args: { path: "channel/notes/pricing.md" } }, "Waiting for your Confirm.");
  await s.discord.send(`${s.discord.mention} delete the pricing note`);
  await s.discord.click(s.discord.botMessages.at(-1)!, "Confirm");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/notes/pricing.md")).toBeNull();
  expect(await search(s, "pricing")).toEqual([]);
});

discordScenario("a file changed, added or deleted directly on disk is searched as it now stands", async (s) => {
  const { writeFileSync, rmSync } = await import("node:fs");
  const onDisk = (path: string) => `${process.env.WORKSPACE_DIR}/${s.tenant.id}/${path}`;
  await s.workspace.write(`${MINUTES}/2026-10-01-weekly.md`, "Pricing stays flat.\n");
  await s.workspace.write(`${MINUTES}/2026-10-08-weekly.md`, "Pricing was not discussed.\n");
  expect(await search(s, "pricing")).toEqual(["channel/minutes/2026-10-08-weekly.md", "channel/minutes/2026-10-01-weekly.md"]);

  writeFileSync(onDisk(`${MINUTES}/2026-10-01-weekly.md`), "Budget review moved to November.\n");
  rmSync(onDisk(`${MINUTES}/2026-10-08-weekly.md`));
  writeFileSync(onDisk(`${MINUTES}/2026-10-15-weekly.md`), "Budget approved.\n");
  expect(await search(s, "pricing")).toEqual([]);
  expect(await search(s, "budget")).toEqual(["channel/minutes/2026-10-15-weekly.md", "channel/minutes/2026-10-01-weekly.md"]);
});

discordScenario("search looks past the first 500 files of a channel", async (s) => {
  for (const folder of ["files", "minutes", "notes"])
    for (let i = 0; i < 200; i++) await s.workspace.write(`guilds/guild-1/channels/channel-1/${folder}/${String(i).padStart(3, "0")}.md`, `Routine ${folder} ${i}.\n`);
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/zz-pricing.md", "Pricing stays flat.\n");
  expect(await search(s, "pricing")).toEqual(["channel/notes/zz-pricing.md"]);
});

discordScenario("the fifty-match cap still holds, keeping the newest and saying how many were left out", async (s) => {
  const day = (i: number) => new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10);
  for (let i = 0; i < 60; i++) await s.workspace.write(`${MINUTES}/${day(i)}-weekly.md`, "Pricing.\n");
  s.model.script({ tool: "searchFiles", args: { query: "pricing", path: "channel" } }, (turn) => {
    const r = turn.toolResults[0];
    return `${r.matches.length} shown, ${r.matches[0].path} … ${r.matches.at(-1).path}; ${r.total} matched, ${r.leftOut} left out`;
  });
  await s.discord.send(`${s.discord.mention} find pricing`);
  expect(s.discord.botMessages.at(-1)!.content).toBe("50 shown, channel/minutes/2026-09-29-weekly.md … channel/minutes/2026-08-11-weekly.md; 60 matched, 10 left out");
});

discordScenario("files in a private thread the asker was not added to never count toward the fifty-match cap or appear in results", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  const { alice, bob } = s.discord;
  const threads = "guilds/guild-1/channels/channel-1/threads";
  s.discord.channel("thread-a", { thread: true, private: true, parentId: "channel-1", members: [alice.id] });
  s.discord.channel("thread-z", { thread: true, private: true, parentId: "channel-1", members: [alice.id, bob.id] });
  for (let i = 0; i < 60; i++) await s.workspace.write(`${threads}/thread-a/minutes/${String(i).padStart(3, "0")}.md`, "Pricing.\n");
  await s.workspace.write(`${threads}/thread-a.md`, "---\nplaybook: issue-draft\n---\nPricing page brief\n");
  await s.workspace.write(`${threads}/thread-z/notes/pricing.md`, "Pricing stays flat.\n");

  s.model.script({ tool: "searchFiles", args: { query: "pricing", path: "channel" } }, paths);
  await s.discord.send(`${s.discord.mention} find pricing`, { author: bob });
  expect(found(s)).toEqual(["channel/threads/thread-z/notes/pricing.md"]);

  s.model.script({ tool: "searchFiles", args: { query: "pricing", path: "channel" } }, (turn: any) => {
    const matched: string[] = turn.toolResults[0].matches.map((m: any) => m.path);
    return JSON.stringify({ count: matched.length, binding: matched.includes("channel/threads/thread-a.md") });
  });
  await s.discord.send(`${s.discord.mention} find pricing`, { author: alice });
  expect(found(s)).toEqual({ count: 50, binding: false });
});
