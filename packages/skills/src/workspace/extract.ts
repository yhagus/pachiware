import { extractImages, extractText, getDocumentProxy } from "unpdf";
import type { Cell, Row } from "exceljs";
import { createDocument } from "@mixmark-io/domino";
import { turndown } from "../htmlMarkdown.js";
import { MAX_FILE_BYTES } from "./store.js";
// mammoth and exceljs load on first use: together they add ~140 ms to every process start.

export const MAX_TEXT_BYTES = 200 * 1024;
// Caps the wait, not the parse: pdf.js keeps working on the main thread, but the turn moves on.
const EXTRACT_TIMEOUT_MS = 20000;
const CLIPPED = `[Clipped at ${MAX_TEXT_BYTES / 1024} KB: the rows after this line are not in this text.]`;

/** "pdf" from "Report.PDF"; empty without an extension. */
export const extensionOf = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
/** A Document never read or searched as it is, only through its sibling Markdown file (`throughMarkdown` in TYPES). */
export const readsThroughMarkdown = (name: string) => TYPES[extensionOf(name)]?.throughMarkdown ?? false;
/** Whether the file's text gets a sibling Markdown file: a Document read through it always, a CSV only when too large for `readFile`. */
export const extractsText = (name: string, size: number) => {
  const type = TYPES[extensionOf(name)];
  return !!type && (type.throughMarkdown || size > MAX_FILE_BYTES);
};

/** The text of a PDF or DOCX, an XLSX's sheets as Markdown tables, an HTML page as Markdown, or a CSV as it is, trimmed to MAX_TEXT_BYTES; null when the file is unreadable or has no text layer. */
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

/**
 * A page of a scanned PDF as an image, with its page number in the PDF. pdf.js gives gray, RGB and RGBA images; a 1-bit fax-style scan
 * (CCITT, JBIG2) or an image mask yields none, so such a page is skipped and the PDF may still read as having no text.
 */
export type ScannedPage = { page: number; png: Uint8Array };
/** The most pages of a scanned PDF read through a model that sees images, and the longest edge each page image is sent at. */
export const MAX_SCANNED_PAGES = 10;
const PAGE_EDGE = 2000;

/**
 * A PDF with no text layer as one PNG per page (#246): the largest image pdf.js finds on each of its first MAX_SCANNED_PAGES pages, reduced to
 * PAGE_EDGE. A scan is one picture per page, so this is the page; a page without an image is skipped. Empty when the PDF cannot be read.
 */
export async function scannedPages(bytes: Uint8Array): Promise<ScannedPage[]> {
  try {
    const doc = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 }), pages: ScannedPage[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_SCANNED_PAGES); n++) {
      const images = await extractImages(doc, n).catch(() => []);
      const largest = images.sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (!largest || largest.width < 100 || largest.height < 100) continue;
      const png = await new Bun.Image(bmpOf(largest.data, largest.width, largest.height, largest.channels)).resize(PAGE_EDGE, PAGE_EDGE, { fit: "inside", withoutEnlargement: true }).png().bytes().catch(() => null);
      if (png) pages.push({ page: n, png });
    }
    return pages;
  } catch { return []; }
}

/** Raw pixels (gray, RGB or RGBA, top row first) as a 24-bit BMP, the one uncompressed format Bun.Image reads. */
export function bmpOf(data: Uint8ClampedArray | Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const row = Math.ceil((width * 3) / 4) * 4, size = 54 + row * height, out = new Uint8Array(size), view = new DataView(out.buffer);
  out.set([0x42, 0x4d]); view.setUint32(2, size, true); view.setUint32(10, 54, true);
  view.setUint32(14, 40, true); view.setInt32(18, width, true); view.setInt32(22, -height, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, row * height, true);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels, o = 54 + y * row + x * 3;
    const [r, g, b] = channels >= 3 ? [data[i]!, data[i + 1]!, data[i + 2]!] : [data[i]!, data[i]!, data[i]!];
    out[o] = b; out[o + 1] = g; out[o + 2] = r;
  }
  return out;
}

async function fromPdf(bytes: Uint8Array) {
  const doc = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  return (await extractText(doc, { mergePages: false })).text.join("\n\n");
}

async function fromDocx(bytes: Uint8Array) {
  const { default: mammoth } = await import("mammoth");
  return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
}

/** Each sheet as a heading and a Markdown table whose header is the sheet's first row; empty sheets are left out. */
async function fromXlsx(bytes: Uint8Array) {
  const { default: ExcelJS } = await import("exceljs");
  const formula = ExcelJS.ValueType.Formula;
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(bytes).buffer);
  const sheets: string[] = [];
  let size = 0;
  for (const sheet of book.worksheets) {
    const rows: Row[] = [];
    let first = Infinity, last = 0;
    sheet.eachRow((row) => { rows.push(row); row.eachCell((cell) => { first = Math.min(first, Number(cell.col)); last = Math.max(last, Number(cell.col)); }); });
    if (!rows.length) continue;
    const line = (row: Row) => `| ${Array.from({ length: last - first + 1 }, (_, i) => cellText(row.getCell(first + i), formula)).join(" | ")} |`;
    const lines = [`## ${sheet.name}`, "", line(rows[0]!), `|${" --- |".repeat(last - first + 1)}`];
    // Stops once past the cap, so a huge sheet is not turned into text only to be clipped.
    for (const row of rows.slice(1)) { if (size > MAX_TEXT_BYTES) break; const l = line(row); lines.push(l); size += l.length; }
    sheets.push(lines.join("\n"));
    if (size > MAX_TEXT_BYTES) break;
  }
  return sheets.join("\n\n");
}

const fromCsv = async (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const NOT_TEXT = "script, style, noscript, template, svg, iframe";

/** An HTML page, decoded as UTF-8, as Markdown: its body without what is not text, headed by its title when the body has no h1. */
async function fromHtml(bytes: Uint8Array) {
  const doc = createDocument(new TextDecoder().decode(bytes));
  for (const node of Array.from(doc.querySelectorAll(NOT_TEXT))) node.remove();
  const body = doc.body ?? doc.documentElement;
  if (doc.title.trim() && !body.querySelector("h1")) {
    const heading = doc.createElement("h1");
    heading.textContent = doc.title;
    body.insertBefore(heading, body.firstChild);
  }
  return turndown.turndown(body);
}

/** Per extension: how its text is read, whether the file is read only through its Markdown, and whether the text is rows, clipped on a whole row. */
const TYPES: Record<string, { read: (bytes: Uint8Array) => Promise<string>; throughMarkdown: boolean; rows: boolean }> = {
  pdf: { read: fromPdf, throughMarkdown: true, rows: false },
  docx: { read: fromDocx, throughMarkdown: true, rows: false },
  xlsx: { read: fromXlsx, throughMarkdown: true, rows: true },
  html: { read: fromHtml, throughMarkdown: true, rows: false },
  htm: { read: fromHtml, throughMarkdown: true, rows: false },
  csv: { read: fromCsv, throughMarkdown: false, rows: true },
};

/** What a cell shows: a formula's cached result, a date as ISO; pipes and line breaks escaped for the table. */
function cellText(cell: Cell, formula: Cell["type"]) {
  const value = cell.type === formula ? cell.result ?? `=${cell.formula}` : cell.value;
  // A date cell holds its wall-clock time as UTC; read in the server's zone it can fall on another day.
  const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString().replace(/T00:00:00\.000Z$/, "").replace(/^(.{10})T(.{8}).*/, "$1 $2")
    : typeof value === "object" && "error" in value ? value.error : cell.type === formula ? String(value) : cell.text;
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
