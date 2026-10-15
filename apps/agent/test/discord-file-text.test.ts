import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { attachment } from "./support/images";
import { pdf, docx, xlsx } from "./support/documents";

const FILES = "guilds/guild-1/channels/channel-1/files";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
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

discordScenario("a filed XLSX yields laporan.md with one table per sheet, formulas as their result and dates as ISO", async (s) => {
  const book = xlsx({
    Budget: [["Item", "Amount"], ["Rent | office", 1200], ["Travel", 300], ["Total", { formula: "SUM(B2:B3)", result: 1500 }]],
    Staff: [["Name", "Days", "Since"], ["Ani", 5, { date: "2026-10-15" }]],
  });
  const laporan = attachment(s, "laporan.xlsx", book, { contentType: XLSX });
  s.model.script("Filed.", { tool: "searchFiles", args: { query: "total", path: "channel/files" } }, (turn) => turn.toolResults[0].matches.map((m: any) => `${m.path}:${m.line} ${m.text}`).join("; "));
  await s.discord.send(`${s.discord.mention} laporan bulan ini`, { attachments: [laporan] });
  expect(turnOf(s)).toBe("Alice: laporan bulan ini [file: laporan.xlsx saved as channel/files/laporan.xlsx; text in channel/files/laporan.md]");
  expect(await s.workspace.list(FILES)).toEqual([`${FILES}/laporan.md`, `${FILES}/laporan.xlsx`]);
  expect(await s.workspace.read(`${FILES}/laporan.md`)).toBe([
    "## Budget", "", "| Item | Amount |", "| --- | --- |", "| Rent \\| office | 1200 |", "| Travel | 300 |", "| Total | 1500 |", "",
    "## Staff", "", "| Name | Days | Since |", "| --- | --- | --- |", "| Ani | 5 | 2026-10-15 |", "",
  ].join("\n"));
  await s.discord.send(`${s.discord.mention} what is the total?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("channel/files/laporan.md:7 | Total | 1500 |");
});

discordScenario("a filed CSV up to 256 KB is read and searched as it is", async (s) => {
  const data = attachment(s, "absen.csv", new TextEncoder().encode("name,days\nAni,5\nBudi,3\n"), { contentType: "text/csv" });
  s.model.script(
    { tool: "readFile", args: { path: "channel/files/absen.csv" } }, (turn) => turn.toolResults[0].content.trim(),
    { tool: "searchFiles", args: { query: "budi", path: "channel/files" } }, (turn) => turn.toolResults[0].matches.map((m: any) => `${m.path}:${m.line} ${m.text}`).join("; "),
  );
  await s.discord.send(`${s.discord.mention} attendance`, { attachments: [data] });
  expect(s.discord.botMessages.at(-1)?.content).toBe("name,days\nAni,5\nBudi,3");
  await s.discord.send(`${s.discord.mention} who is Budi?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("channel/files/absen.csv:3 Budi,3");
});

discordScenario("a CSV over 256 KB yields a sibling Markdown file that readFile and searchFiles reach", async (s) => {
  const rows = Array.from({ length: 9000 }, (_, i) => `INV-${String(i + 1).padStart(5, "0")},PT Sumber Makmur,${(i + 1) * 1000}`);
  const big = new TextEncoder().encode(["invoice,customer,amount", ...rows, ""].join("\n"));
  expect(big.byteLength).toBeGreaterThan(256 * 1024);
  const sales = attachment(s, "sales.csv", big, { contentType: "text/csv" });
  s.model.script(
    // The result passes the turn's tool result cap, so it arrives as clipped JSON text.
    { tool: "readFile", args: { path: "channel/files/sales.md" } }, (turn) => String(turn.toolResults[0]).includes(String.raw`"content":"invoice,customer,amount\nINV-00001,PT Sumber Makmur,1000\n`) ? "read the head" : String(turn.toolResults[0]).slice(0, 200),
    { tool: "searchFiles", args: { query: "inv-00042", path: "channel/files" } }, (turn) => turn.toolResults[0].matches.map((m: any) => `${m.path}:${m.line} ${m.text}`).join("; "),
  );
  await s.discord.send(`${s.discord.mention} sales export`, { attachments: [sales] });
  expect(turnOf(s)).toBe("Alice: sales export [file: sales.csv saved as channel/files/sales.csv; text in channel/files/sales.md]");
  expect(await s.workspace.list(FILES)).toEqual([`${FILES}/sales.csv`, `${FILES}/sales.md`]);
  expect(s.discord.botMessages.at(-1)?.content).toBe("read the head");
  await s.discord.send(`${s.discord.mention} find INV-00042`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("channel/files/sales.md:43 INV-00042,PT Sumber Makmur,42000");
});

const CLIPPED = "[Clipped at 200 KB: the rows after this line are not in this text.]";

discordScenario("a large CSV's text stops at 200 KB on a whole row and says it was clipped", async (s) => {
  const rows = Array.from({ length: 9000 }, (_, i) => `INV-${String(i + 1).padStart(5, "0")},PT Sumber Makmur,${(i + 1) * 1000}`);
  const sales = attachment(s, "sales.csv", new TextEncoder().encode(["invoice,customer,amount", ...rows].join("\n")), { contentType: "text/csv" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} sales export`, { attachments: [sales] });
  const text = (await s.workspace.read(`${FILES}/sales.md`))!;
  const lines = text.split("\n");
  expect(lines.at(-1)).toBe("");
  expect(lines.at(-2)).toBe(CLIPPED);
  expect(lines.at(-3)).toMatch(/^INV-(\d{5}),PT Sumber Makmur,\d+000$/);
  expect(Number(lines.at(-3)!.slice(4, 9)) * 1000).toBe(Number(lines.at(-3)!.split(",")[2]));
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(200 * 1024);
});

discordScenario("a large XLSX's text stops at 200 KB on a whole table row and says it was clipped", async (s) => {
  const rows = Array.from({ length: 7000 }, (_, i) => [`Employee ${i + 1}`, "Finance and administration", i + 1]);
  const book = attachment(s, "staff.xlsx", xlsx({ Staff: [["Name", "Unit", "No"], ...rows], Later: [["Never", "shown"]] }), { contentType: XLSX });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} staff list`, { attachments: [book] });
  const text = (await s.workspace.read(`${FILES}/staff.md`))!;
  const lines = text.split("\n");
  expect(lines.slice(0, 4)).toEqual(["## Staff", "", "| Name | Unit | No |", "| --- | --- | --- |"]);
  expect(lines.at(-2)).toBe(CLIPPED);
  const last = lines.at(-3)!.match(/^\| Employee (\d+) \| Finance and administration \| (\d+) \|$/);
  expect(last?.[1]).toBe(last?.[2]);
  expect(text).not.toContain("## Later");
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(200 * 1024);
});
