import { expect } from "bun:test";
import { discordScenario, type ModelTurn } from "./support/discordScenario";

// A file longer than READ_LIMIT is read by the bot's own model in chunks, which answer the model's question with quotes the server checks (#266).

const FILES = "guilds/guild-1/channels/channel-1/files";
/** A filed PDF's text, 900 lines; line 612 alone says how much the generator's tank holds. */
const MANUAL = Array.from({ length: 900 }, (_, i) => i === 611
  ? "Section 612: the fuel tank of the site generator holds 48 litres of diesel."
  : `Section ${i + 1}: routine checks for the site generator, logged by the facilities team.`);
const QUESTION = "Berapa liter tangki bahan bakar genset?";

/** The bot's model reading one chunk: it finds line 612 and quotes it, and invents a second quote the file does not hold. */
const readerReply = (turn: ModelTurn) => JSON.stringify(String(turn.messages[1]?.content).includes("48 litres")
  ? { found: true, answer: "Tangki genset memuat 48 liter solar.", quotes: [{ line: 612, text: "the fuel tank of the site generator holds 48 litres of diesel." }, { line: 300, text: "the tank was refilled with 60 litres" }] }
  : { found: false, answer: "Bagian ini tidak menyebut tangki bahan bakar.", quotes: [] });
const shown = (r: any) => JSON.stringify({ path: r.path, totalLines: r.totalLines, answer: r.answer, quotes: r.quotes, read: r.read, unreadFrom: r.unreadFrom, droppedQuotes: r.droppedQuotes, readerFailed: r.readerFailed, version: typeof r.version });

discordScenario("a question about a 900-line Document is answered by the reader with the true line quoted and an invented quote dropped", async (s) => {
  await s.workspace.write(`${FILES}/genset-manual.pdf`, "%PDF-1.4 (the text is in genset-manual.md)");
  await s.workspace.write(`${FILES}/genset-manual.md`, MANUAL.join("\n") + "\n");
  s.model.script(
    { tool: "readFile", args: { path: "channel/files/genset-manual.pdf", question: QUESTION } },
    readerReply, readerReply,
    (turn) => shown(turn.toolResults.at(-1)),
  );
  await s.discord.send(`${s.discord.mention} ${QUESTION}`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual({
    path: "channel/files/genset-manual.md", totalLines: 900, answer: "Tangki genset memuat 48 liter solar.",
    quotes: [{ line: 612, text: "the fuel tank of the site generator holds 48 litres of diesel." }],
    read: { fromLine: 1, toLine: 900 }, droppedQuotes: 1, version: "string",
  });

  // With a question, a range limits the reader to those lines: one chunk, asked once.
  s.model.script(
    { tool: "readFile", args: { path: "channel/files/genset-manual.md", question: QUESTION, fromLine: 600, toLine: 620 } },
    readerReply,
    (turn) => shown(turn.toolResults.at(-1)),
  );
  const asked = s.model.calls.length;
  await s.discord.send(`${s.discord.mention} ${QUESTION} cek bagian 600 sampai 620`);
  expect(s.model.calls.length - asked).toBe(3);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toMatchObject({ quotes: [{ line: 612 }], read: { fromLine: 600, toLine: 620 }, droppedQuotes: 1 });
});
