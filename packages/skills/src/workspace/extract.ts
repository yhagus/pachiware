import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import { MAX_FILE_BYTES } from "./store.js";

export const MAX_TEXT_BYTES = 200 * 1024;
// Caps the wait, not the parse: pdf.js keeps working on the main thread, but the turn moves on.
const EXTRACT_TIMEOUT_MS = 20000;
const CLIPPED = `[Clipped at ${MAX_TEXT_BYTES / 1024} KB: the rows after this line are not in this text.]`;

/** "pdf" from "Report.PDF"; empty without an extension. */
export const extensionOf = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
/** PDF, DOCX and XLSX: bytes that are not text, read through their sibling Markdown file. */
export const isBinaryDocument = (name: string) => TYPES[extensionOf(name)]?.binary ?? false;
/** Whether the file's text gets a sibling Markdown file: a binary document always, a CSV only when too large for `readFile`. */
export const extractsText = (name: string, size: number) => {
  const type = TYPES[extensionOf(name)];
  return !!type && (type.binary || size > MAX_FILE_BYTES);
};

/** The text of a PDF or DOCX, an XLSX's sheets as Markdown tables, or a CSV as it is, trimmed to MAX_TEXT_BYTES; null when the file is unreadable or has no text layer. */
export async function documentText(name: string, bytes: Uint8Array): Promise<string | null> {
  const type = TYPES[extensionOf(name)];
  if (!type) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const text = await Promise.race([type.read(bytes), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("extraction timed out")), EXTRACT_TIMEOUT_MS); })]);
    const clean = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return clean ? `${type.rows ? clipRows(clean) : clip(clean)}\n` : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

async function fromPdf(bytes: Uint8Array) {
  const doc = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  return (await extractText(doc, { mergePages: false })).text.join("\n\n");
}

const fromDocx = async (bytes: Uint8Array) => (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;

/** Each sheet as a heading and a Markdown table whose header is the sheet's first row; empty sheets are left out. */
async function fromXlsx(bytes: Uint8Array) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(bytes).buffer);
  const sheets: string[] = [];
  let size = 0;
  for (const sheet of book.worksheets) {
    const rows: ExcelJS.Row[] = [];
    let first = Infinity, last = 0;
    sheet.eachRow((row) => { rows.push(row); row.eachCell((cell) => { first = Math.min(first, Number(cell.col)); last = Math.max(last, Number(cell.col)); }); });
    if (!rows.length) continue;
    const line = (row: ExcelJS.Row) => `| ${Array.from({ length: last - first + 1 }, (_, i) => cellText(row.getCell(first + i))).join(" | ")} |`;
    const lines = [`## ${sheet.name}`, "", line(rows[0]!), `|${" --- |".repeat(last - first + 1)}`];
    // Stops once past the cap, so a huge sheet is not turned into text only to be clipped.
    for (const row of rows.slice(1)) { if (size > MAX_TEXT_BYTES) break; const l = line(row); lines.push(l); size += l.length; }
    sheets.push(lines.join("\n"));
    if (size > MAX_TEXT_BYTES) break;
  }
  return sheets.join("\n\n");
}

const fromCsv = async (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Per extension: how its text is read, whether its bytes are not text, and whether the text is rows, clipped on a whole row. */
const TYPES: Record<string, { read: (bytes: Uint8Array) => Promise<string>; binary: boolean; rows: boolean }> = {
  pdf: { read: fromPdf, binary: true, rows: false },
  docx: { read: fromDocx, binary: true, rows: false },
  xlsx: { read: fromXlsx, binary: true, rows: true },
  csv: { read: fromCsv, binary: false, rows: true },
};

/** What a cell shows: a formula's cached result, a date as ISO; pipes and line breaks escaped for the table. */
function cellText(cell: ExcelJS.Cell) {
  const value = cell.type === ExcelJS.ValueType.Formula ? cell.result ?? `=${cell.formula}` : cell.value;
  // A date cell holds its wall-clock time as UTC; read in the server's zone it can fall on another day.
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString().replace(/T00:00:00\.000Z$/, "").replace(/^(.{10})T(.{8}).*/, "$1 $2")
    : typeof value === "object" && "error" in value ? value.error : cell.type === ExcelJS.ValueType.Formula ? String(value) : cell.text;
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function clip(text: string, max = MAX_TEXT_BYTES) {
  if (Buffer.byteLength(text) <= max) return text;
  return Buffer.from(text).toString("utf8", 0, max).replace(/�$/, "");
}

/** A spreadsheet ends on a whole row and says so, so a total over a column is not taken as the whole sheet. */
function clipRows(text: string) {
  if (Buffer.byteLength(text) <= MAX_TEXT_BYTES) return text;
  const head = clip(text, MAX_TEXT_BYTES - Buffer.byteLength(CLIPPED) - 2);
  return `${head.slice(0, head.lastIndexOf("\n"))}\n${CLIPPED}`;
}
