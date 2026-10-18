import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { attachment } from "./support/images";
import { pdf } from "./support/documents";

discordScenario("an answer near line 1,500 of a 120 KB Document is found by searchFiles and read with a line range", async (s) => {
  const lines = Array.from({ length: 1600 }, (_, i) => i === 1499
    ? "Clause 14.2: the vendor contract renews automatically on 3 March 2027 unless cancelled."
    : `Section ${i + 1} of the master agreement, ordinary terms about delivery and invoicing.`);
  const contract = attachment(s, "contract.pdf", pdf(lines), { contentType: "application/pdf" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} the contract`, { attachments: [contract] });
  const text = (await s.workspace.read("guilds/guild-1/channels/channel-1/files/contract.md"))!;
  expect(text.length).toBeGreaterThan(120_000);

  s.model.script(
    { tool: "searchFiles", args: { query: "vendor contract renews", path: "channel/files" } },
    (turn) => {
      const at = turn.toolResults[0].matches[0].lines[0].line;
      return { tool: "readFile", args: { path: "channel/files/contract.md", fromLine: at - 20, toLine: at + 60 } };
    },
    (turn) => {
      const r = turn.toolResults.at(-1);
      const hit = r.lines.find((l: any) => l.text.includes("renews"));
      return `${r.fromLine}-${r.toLine} of ${r.totalLines}: ${hit.line} ${hit.text}`;
    },
  );
  await s.discord.send(`${s.discord.mention} when does the vendor contract renew?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("1480-1560 of 1600: 1500 Clause 14.2: the vendor contract renews automatically on 3 March 2027 unless cancelled.");
});

discordScenario("a large file read without a range returns its first lines within 10,000 characters, with totalLines and nextLine", async (s) => {
  const lines = Array.from({ length: 2000 }, (_, i) => `Entry ${i + 1}: "quoted" notes from the long log, kept for the record.`);
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/log.md", lines.join("\n") + "\n");
  s.model.script(
    { tool: "readFile", args: { path: "channel/notes/log.md" } },
    (turn) => {
      const r = turn.toolResults.at(-1);
      if (typeof r === "string") return `clipped by the loop: ${r.slice(0, 100)}`;
      return { tool: "readFile", args: { path: "channel/notes/log.md", fromLine: r.nextLine, toLine: r.nextLine } };
    },
    (turn) => {
      const [head, next] = turn.toolResults.slice(-2);
      const shown = head.content.split("\n").filter(Boolean);
      return [JSON.stringify(head.content).length <= 10_000, head.totalLines, shown[0], shown.length + 1 === head.nextLine, next.lines[0].text, typeof head.version].join(" | ");
    },
  );
  await s.discord.send(`${s.discord.mention} what is in the log?`);
  const reply = s.discord.botMessages.at(-1)!.content.split(" | ");
  expect(reply[0]).toBe("true");
  expect(reply[1]).toBe("2000");
  expect(reply[2]).toBe(`Entry 1: "quoted" notes from the long log, kept for the record.`);
  expect(reply[3]).toBe("true");
  expect(reply[4]).toMatch(/^Entry \d+: "quoted" notes from the long log, kept for the record\.$/);
  expect(reply[5]).toBe("string");
});

discordScenario("a reversed or out-of-range line range is refused with a clear message", async (s) => {
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/short.md", "one\ntwo\nthree\n");
  s.model.script(
    [{ tool: "readFile", args: { path: "channel/notes/short.md", fromLine: 3, toLine: 1 } }, { tool: "readFile", args: { path: "channel/notes/short.md", fromLine: 9 } }, { tool: "readFile", args: { path: "channel/notes/short.md", fromLine: 0 } }],
    (turn) => turn.toolResults.map((r: any) => r.error).join(" / "),
  );
  await s.discord.send(`${s.discord.mention} read it`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("toLine 1 is before fromLine 3. / fromLine 9 is past the end: the file has 3 lines. / fromLine must be a line number, 1 or more.");
});

discordScenario("a range past the end of the file stops at its last line", async (s) => {
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/short.md", "one\ntwo\nthree\n");
  s.model.script(
    { tool: "readFile", args: { path: "channel/notes/short.md", fromLine: 2, toLine: 50 } },
    (turn) => JSON.stringify(turn.toolResults[0].lines) + ` ${turn.toolResults[0].toLine}/${turn.toolResults[0].totalLines} ${turn.toolResults[0].nextLine}`,
  );
  await s.discord.send(`${s.discord.mention} read it`);
  expect(s.discord.botMessages.at(-1)?.content).toBe(`[{"line":2,"text":"two"},{"line":3,"text":"three"}] 3/3 undefined`);
});
