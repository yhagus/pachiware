import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

export const EXTRACTED_TYPES = ["pdf", "docx"] as const;
export const MAX_TEXT_BYTES = 200 * 1024;
// Caps the wait, not the parse: pdf.js keeps working on the main thread, but the turn moves on.
const EXTRACT_TIMEOUT_MS = 20000;

/** "pdf" from "Report.PDF"; empty without an extension. */
export const extensionOf = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
/** Whether the file's text gets a sibling Markdown file: PDF and DOCX; XLSX and CSV are stored as is. */
export const extractsText = (name: string) => (EXTRACTED_TYPES as readonly string[]).includes(extensionOf(name));

/** The text of a PDF or DOCX, trimmed to MAX_TEXT_BYTES; null when the file is unreadable or has no text layer. */
export async function documentText(name: string, bytes: Uint8Array): Promise<string | null> {
  const read = extensionOf(name) === "pdf" ? fromPdf : fromDocx;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const text = await Promise.race([read(bytes), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("extraction timed out")), EXTRACT_TIMEOUT_MS); })]);
    const clean = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return clean ? `${clip(clean)}\n` : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

async function fromPdf(bytes: Uint8Array) {
  const doc = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  return (await extractText(doc, { mergePages: false })).text.join("\n\n");
}

const fromDocx = async (bytes: Uint8Array) => (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;

function clip(text: string) {
  if (Buffer.byteLength(text) <= MAX_TEXT_BYTES) return text;
  return Buffer.from(text).toString("utf8", 0, MAX_TEXT_BYTES).replace(/�$/, "");
}
