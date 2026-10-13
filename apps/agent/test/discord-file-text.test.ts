import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { attachment } from "./support/images";
import { pdf, docx } from "./support/documents";

const FILES = "guilds/guild-1/channels/channel-1/files";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const turnOf = (s: any, call = 0) => s.model.calls[call]!.at(-2)!.content as string;

discordScenario("a filed PDF yields report.md beside it and searchFiles finds a word from it", async (s) => {
  const report = attachment(s, "report.pdf", pdf(["Quarterly report", "The Q3 budget is 12 million."]), { contentType: "application/pdf" });
  s.model.script("Filed.", { tool: "searchFiles", args: { query: "budget", path: "channel/files" } }, (turn) => turn.toolResults[0].matches.map((m: any) => `${m.path}:${m.line} ${m.text}`).join("; "));
  await s.discord.send(`${s.discord.mention} here is the report`, { attachments: [report] });
  expect(turnOf(s)).toBe("Alice: here is the report [file: report.pdf saved as channel/files/report.pdf; text in channel/files/report.md]");
  expect(await s.workspace.list(FILES)).toEqual([`${FILES}/report.md`, `${FILES}/report.pdf`]);
  expect(await s.workspace.read(`${FILES}/report.md`)).toBe("Quarterly report\nThe Q3 budget is 12 million.\n");
  await s.discord.send(`${s.discord.mention} which file mentions the budget?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("channel/files/report.md:2 The Q3 budget is 12 million.");
});

discordScenario("a filed DOCX yields minutes.md with one paragraph per block", async (s) => {
  const minutes = attachment(s, "minutes.docx", docx(["Meeting notes", "Budget approved for Q3."]), { contentType: DOCX });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} minutes attached`, { attachments: [minutes] });
  expect(turnOf(s)).toBe("Alice: minutes attached [file: minutes.docx saved as channel/files/minutes.docx; text in channel/files/minutes.md]");
  expect(await s.workspace.list(FILES)).toEqual([`${FILES}/minutes.docx`, `${FILES}/minutes.md`]);
  expect(await s.workspace.read(`${FILES}/minutes.md`)).toBe("Meeting notes\n\nBudget approved for Q3.\n");
});

discordScenario("a PDF whose text cannot be extracted is kept and the turn says so", async (s) => {
  const scan = attachment(s, "scan.pdf", new TextEncoder().encode("%PDF-1.4\n".padEnd(2048, "x")), { contentType: "application/pdf" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} the scan`, { attachments: [scan] });
  expect(turnOf(s)).toBe("Alice: the scan [file: scan.pdf saved as channel/files/scan.pdf: its text could not be extracted]");
  expect(await s.workspace.list(FILES)).toEqual([`${FILES}/scan.pdf`]);
  expect((await s.workspace.read(`${FILES}/scan.pdf`))?.length).toBe(2048);
});

discordScenario("a CSV is stored as is, without a sibling Markdown file", async (s) => {
  const data = attachment(s, "data.csv", new TextEncoder().encode("item,budget\nQ3,12\n"), { contentType: "text/csv" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} the numbers`, { attachments: [data] });
  expect(turnOf(s)).toBe("Alice: the numbers [file: data.csv saved as channel/files/data.csv]");
  expect(await s.workspace.list(FILES)).toEqual([`${FILES}/data.csv`]);
});

discordScenario("the extracted text stops at 200 KB", async (s) => {
  const lines = Array.from({ length: 6000 }, (_, i) => `Line ${i + 1} of the long report, with enough words to fill a page.`);
  const long = attachment(s, "long.pdf", pdf(lines), { contentType: "application/pdf" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} the long one`, { attachments: [long] });
  expect(turnOf(s)).toBe("Alice: the long one [file: long.pdf saved as channel/files/long.pdf; text in channel/files/long.md]");
  const text = (await s.workspace.read(`${FILES}/long.md`))!;
  expect(text.startsWith("Line 1 of the long report")).toBe(true);
  expect(text).toContain("Line 3000 of the long report");
  expect(text).not.toContain("Line 6000 of the long report");
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(200 * 1024 + 1);
});
