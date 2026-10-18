import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { attachment } from "./support/images";
import { pdf } from "./support/documents";

const CHANNEL = "guilds/guild-1/channels/channel-1";
const AUDIO_KEYWORDS = JSON.stringify({ topics: ["Audio normalization"], keywords: ["normalisasi audio", "audio normalization", "loudness", "LUFS"] });
const shown = (turn: any) => JSON.stringify(turn.toolResults[0].matches ?? turn.toolResults[0].error);

discordScenario("a Note kept from messages carries topics and keywords in its head, its body word for word, and a search for a head-only keyword finds it", async (s) => {
  s.clock.set("2026-10-15T03:00:00Z");
  await s.guildSettings({ useThreads: false });
  const said = await s.discord.send("Kita targetkan -14 LUFS untuk semua episode.", { author: s.discord.bob });
  s.model.keywords(AUDIO_KEYWORDS);
  s.model.script({ tool: "keepAsNote", args: { messageIds: [said!.id], path: "channel/notes/2026-10-15-lufs.md" } }, "Kept.");
  await s.discord.send(`${s.discord.mention} keep Bob's message as a note`);

  expect(s.model.keywordCalls).toHaveLength(1);
  expect(await s.workspace.read(`${CHANNEL}/notes/2026-10-15-lufs.md`)).toBe(
    `---\nsource: "https://discord.com/channels/guild-1/channel-1/${said!.id}"\nauthor: "Bob"\naskedBy: "Alice"\ndate: "2026-10-15"\n`
    + `topics: ["Audio normalization"]\nkeywords: ["normalisasi audio","audio normalization","loudness","LUFS"]\n---\nKita targetkan -14 LUFS untuk semua episode.`,
  );

  s.model.script({ tool: "searchFiles", args: { query: "loudness", path: "channel/" } }, shown);
  await s.discord.send(`${s.discord.mention} what did we say about loudness?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content).map((m: any) => m.path)).toEqual(["channel/notes/2026-10-15-lufs.md"]);
});

discordScenario("when the keyword call fails, the Note is kept as before and the turn answers", async (s) => {
  s.clock.set("2026-10-15T03:00:00Z");
  await s.guildSettings({ useThreads: false });
  const said = await s.discord.send("Badges arrive on the 20th.", { author: s.discord.bob });
  s.model.keywords({ error: "Provider request failed" });
  s.model.script({ tool: "keepAsNote", args: { messageIds: [said.id], path: "channel/notes/badges.md" } }, (turn) => `Kept as ${turn.toolResults[0].path}`);
  await s.discord.send(`${s.discord.mention} keep Bob's message as a note`);

  expect(s.model.keywordCalls).toHaveLength(1);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Kept as channel/notes/badges.md");
  expect(await s.workspace.read(`${CHANNEL}/notes/badges.md`)).toBe(
    `---\nsource: "https://discord.com/channels/guild-1/channel-1/${said.id}"\nauthor: "Bob"\naskedBy: "Alice"\ndate: "2026-10-15"\n---\nBadges arrive on the 20th.`,
  );
});

discordScenario("a Decision and a Note written with writeFile get topics and keywords in a new head, and writeFile returns the version after it", async (s) => {
  s.model.keywords(AUDIO_KEYWORDS, JSON.stringify({ topics: ["Badges"], keywords: ["lencana", "badges"] }));
  s.model.script(
    { tool: "writeFile", args: { path: "channel/decisions/2026-10-15-lufs.md", content: "# Loudness target\n\nWe master every episode to -14 LUFS.\n" } },
    { tool: "writeFile", args: { path: "channel/notes/badges.md", content: "Badges arrive on the 20th.\n" } },
    (turn) => turn.toolResults[0].version,
  );
  await s.discord.send(`${s.discord.mention} record the loudness decision and note the badges date`);
  const returned = s.discord.botMessages.at(-1)!.content;

  expect(await s.workspace.read(`${CHANNEL}/decisions/2026-10-15-lufs.md`)).toBe(
    `---\ntopics: ["Audio normalization"]\nkeywords: ["normalisasi audio","audio normalization","loudness","LUFS"]\n---\n# Loudness target\n\nWe master every episode to -14 LUFS.\n`,
  );
  expect(await s.workspace.read(`${CHANNEL}/notes/badges.md`)).toBe(`---\ntopics: ["Badges"]\nkeywords: ["lencana","badges"]\n---\nBadges arrive on the 20th.\n`);

  s.model.script({ tool: "readFile", args: { path: "channel/decisions/2026-10-15-lufs.md" } }, (turn) => turn.toolResults[0].version);
  await s.discord.send(`${s.discord.mention} read the decision`);
  expect(s.discord.botMessages.at(-1)!.content).toBe(returned);
});

discordScenario("a Decision rewritten with its old head gets the new topics and keywords in place of the old", async (s) => {
  await s.workspace.write(`${CHANNEL}/decisions/hours.md`, `---\ntopics: ["Support hours"]\nkeywords: ["jam layanan"]\n---\nSupport runs 9 to 17.\n`);
  s.model.keywords(JSON.stringify({ topics: ["Support hours"], keywords: ["jam layanan", "support hours", "weekend"] }));
  s.model.script(
    { tool: "readFile", args: { path: "channel/decisions/hours.md" } },
    (turn) => ({ tool: "writeFile", args: { path: "channel/decisions/hours.md", content: `---\ntopics: ["Support hours"]\nkeywords: ["jam layanan"]\n---\nSupport runs 9 to 17, and 10 to 14 on weekends.\n`, version: turn.toolResults[0].version } }),
    "Updated.",
  );
  await s.discord.send(`${s.discord.mention} add weekend hours to the decision`);
  expect(await s.workspace.read(`${CHANNEL}/decisions/hours.md`)).toBe(
    `---\ntopics: ["Support hours"]\nkeywords: ["jam layanan","support hours","weekend"]\n---\nSupport runs 9 to 17, and 10 to 14 on weekends.\n`,
  );
});

discordScenario("Minutes get topics and keywords as the last lines of their head, and a search for a head-only keyword finds them", async (s) => {
  const [start] = s.discord.history([
    { content: "What loudness do we master to?", author: s.discord.alice },
    { content: "-14 LUFS for every episode. Agreed.", author: s.discord.bob },
  ]);
  s.model.script(JSON.stringify({ title: "Mastering", decided: [{ text: "Master to -14 LUFS", ref: 2 }], open: [], actions: [] }));
  s.model.keywords(AUDIO_KEYWORDS);
  await s.discord.contextMenu("Write minutes", start!);

  expect(String(s.model.keywordCalls[0]?.at(-1)?.content)).toContain("Master to -14 LUFS");
  const [file] = await s.workspace.list(`${CHANNEL}/minutes`);
  const text = (await s.workspace.read(file!))!;
  expect(text).toContain(`\ntopics: ["Audio normalization"]\nkeywords: ["normalisasi audio","audio normalization","loudness","LUFS"]\n---\n# Mastering`);

  s.model.script({ tool: "searchFiles", args: { query: "normalisasi", path: "channel/" } }, shown);
  await s.discord.send(`${s.discord.mention} normalisasi?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content).map((m: any) => m.path)).toEqual([`channel/minutes/${file!.split("/").pop()}`]);
});

discordScenario("a filed PDF's text gets topics and keywords in its head, and a Note kept from it holds the PDF's text word for word under its own", async (s) => {
  s.clock.set("2026-10-15T03:00:00Z");
  const minutes = attachment(s, "mastering.pdf", pdf(["Mastering notes", "Every episode goes out at -14 LUFS"]), { contentType: "application/pdf" });
  s.model.keywords(AUDIO_KEYWORDS);
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} our mastering notes`, { attachments: [minutes] });
  expect(await s.workspace.read(`${CHANNEL}/files/mastering.md`)).toBe(
    `---\ntopics: ["Audio normalization"]\nkeywords: ["normalisasi audio","audio normalization","loudness","LUFS"]\n---\nMastering notes\nEvery episode goes out at -14 LUFS\n`,
  );

  s.model.script({ tool: "searchFiles", args: { query: "loudness", path: "channel/" } }, shown);
  await s.discord.send(`${s.discord.mention} loudness?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content).map((m: any) => m.path)).toEqual(["channel/files/mastering.md"]);

  s.model.keywords(JSON.stringify({ topics: ["Mastering"], keywords: ["mastering"] }));
  s.model.script({ tool: "keepAsNote", args: { document: "channel/files/mastering.pdf", path: "channel/notes/mastering.md" } }, "Kept.");
  await s.discord.send(`${s.discord.mention} keep those notes as a note`);
  expect(await s.workspace.read(`${CHANNEL}/notes/mastering.md`)).toBe(
    `---\nsource: "channel/files/mastering.pdf"\nauthor: "Alice"\naskedBy: "Alice"\ndate: "2026-10-15"\ntopics: ["Mastering"]\nkeywords: ["mastering"]\n---\nMastering notes\nEvery episode goes out at -14 LUFS\n`,
  );
});

discordScenario("a filed Markdown Document gets topics and keywords in its head; a filed TXT is left as given", async (s) => {
  const agenda = attachment(s, "agenda.md", new TextEncoder().encode("# Agenda\n\n- loudness target\n"), { contentType: "text/markdown" });
  const plain = attachment(s, "plain.txt", new TextEncoder().encode("Badges arrive on the 20th.\n"), { contentType: "text/plain" });
  s.model.keywords(AUDIO_KEYWORDS);
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} two files`, { attachments: [agenda, plain] });
  expect(await s.workspace.read(`${CHANNEL}/files/agenda.md`)).toBe(
    `---\ntopics: ["Audio normalization"]\nkeywords: ["normalisasi audio","audio normalization","loudness","LUFS"]\n---\n# Agenda\n\n- loudness target\n`,
  );
  expect(await s.workspace.read(`${CHANNEL}/files/plain.txt`)).toBe("Badges arrive on the 20th.\n");
  expect(s.model.keywordCalls).toHaveLength(1);
});

discordScenario("writeFile outside notes/ and decisions/ asks for no keywords", async (s) => {
  s.model.script({ tool: "writeFile", args: { path: "channel/MEMORY.md", content: "- 2026-10-15 (Alice): Releases on Thursdays\n" } }, "Done.");
  await s.discord.send(`${s.discord.mention} write it down`);
  expect(s.model.keywordCalls).toHaveLength(0);
  expect(await s.workspace.read(`${CHANNEL}/MEMORY.md`)).toBe("- 2026-10-15 (Alice): Releases on Thursdays\n");
});
