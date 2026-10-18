import { MAX_BLOB_BYTES, workspaceStore } from "./store.js";
import { placeRoot, resolvePath, visibleRoots } from "./paths.js";
import { documentText, extensionOf, extractsText, scannedPages } from "./extract.js";
import { addKeywords } from "./keywords.js";
import type { Completion, SkillContext } from "../types.js";

export const DOCUMENT_TYPES = ["pdf", "docx", "xlsx", "csv", "md", "txt"] as const;
export const MAX_DOCUMENT_BYTES = MAX_BLOB_BYTES;
const DOWNLOAD_TIMEOUT_MS = 15000;
const MAX_NAME = 100;

export type Document = { name: string; url: string; size: number };
export type NotFiledReason = "type" | "tooLarge" | "download" | "place";
/** The sibling Markdown holding a PDF's, DOCX's, XLSX's or large CSV's text, or that none could be extracted. */
export type Extracted = { path: string } | { failed: true };
/** `path` is the agent-facing path (`channel/files/report.pdf`), which `readFile` and `searchFiles` accept; `text` is set for a PDF, DOCX, XLSX, or a CSV too large for `readFile`. */
export type Filed = { path: string; bytes: Uint8Array; text?: Extracted };
/** Reads the text of page images through a model that sees images (#246); null when it cannot. Given only where the bot's Profile accepts images. */
export type PageReader = (pages: Uint8Array[]) => Promise<string | null>;
export type NotFiled = { reason: NotFiledReason };
/** The person who gave a Document to the bot; a Note kept from it names them as its author. */
export type Giver = { name: string; id: string };
/** What the place remembers about a filed Document: who gave it, and where its extracted text went when it has one. */
export type Provenance = Giver & { textPath?: string };
type Where = Pick<SkillContext, "guildId" | "channelId" | "parentChannelId" | "userId" | "privateThread">;

export const isDocument = (name: string) => (DOCUMENT_TYPES as readonly string[]).includes(extensionOf(name));

/** Why a document cannot be filed, known from its metadata alone; null when it can. */
export function documentReason(doc: Pick<Document, "name" | "size">): NotFiledReason | null {
  if (!isDocument(doc.name)) return "type";
  if (doc.size > MAX_DOCUMENT_BYTES) return "tooLarge";
  return null;
}

/** A Discord attachment name reduced to one safe path segment, extension kept. */
export function safeName(name: string) {
  const ext = extensionOf(name), stem = ext ? name.slice(0, -ext.length - 1) : name;
  const clean = stem.normalize("NFKC").replace(/[^\p{L}\p{N}._ -]+/gu, "-").replace(/^[^\p{L}\p{N}_-]+/u, "").replace(/[. ]+$/u, "").trim();
  return `${(clean || "file").slice(0, MAX_NAME - ext.length - 1)}${ext ? `.${ext}` : ""}`;
}

/** `report.pdf`, then `report-2.pdf`, `report-3.pdf`: whatever is not yet taken in `taken` (names already in the folder, plus those claimed in this turn). */
export function freeName(name: string, taken: Set<string>) {
  const ext = extensionOf(name), stem = ext ? name.slice(0, -ext.length - 1) : name;
  for (let i = 1; ; i++) {
    const candidate = `${i === 1 ? stem : `${stem}-${i}`}${ext ? `.${ext}` : ""}`;
    if (!taken.has(candidate)) { taken.add(candidate); return candidate; }
  }
}

/** The name a Document's extracted text is filed under before `freeName` numbers it: `report.pdf` → `report.md`. */
const textName = (name: string) => name.replace(/\.[^.]+$/, ".md");

/**
 * Where the extracted text of the Document `path` went, read from the names beside it, for a Document filed without a record of it:
 * `<stem>.md`, unless a `<stem>-N.md` sibling means `freeName` may have numbered the text away from it; then null.
 */
export function unrecordedTextPath(path: string, siblings: string[]) {
  const text = textName(path), stem = text.slice(text.lastIndexOf("/") + 1, -".md".length);
  return siblings.some((name) => name.startsWith(`${stem}-`) && /^\d+\.md$/.test(name.slice(stem.length + 1))) ? null : text;
}

/**
 * Fetches one allowed document and writes it into `files/` under the turn's folder, never over an existing file.
 * The text of a PDF, DOCX, XLSX or large CSV then goes to a sibling `<name>.md` for `readFile` and `searchFiles`; `saveAttachment` calls this for a named message.
 */
export async function fileDocument(tenantId: string, where: Where, doc: Document, { taken, givenBy, complete, readPages }: { taken?: Set<string>; givenBy?: Giver; complete?: Completion; readPages?: PageReader } = {}): Promise<Filed | NotFiled> {
  const reason = documentReason(doc);
  if (reason) return { reason };
  const root = placeRoot(where);
  if (!root) return { reason: "place" };
  const names = taken ?? await takenNames(tenantId, where);
  const bytes = await download(doc.url);
  if (!bytes || bytes.byteLength > MAX_DOCUMENT_BYTES) return { reason: bytes ? "tooLarge" : "download" };
  const name = freeName(safeName(doc.name), names), path = `${root}/files/${name}`;
  await workspaceStore().writeBytes(tenantId, resolvePath(where, path), bytes);
  if (!extractsText(name, bytes.byteLength)) {
    if (givenBy) await recordProvenance(tenantId, where, path, givenBy);
    // A Markdown Document can carry a head; a TXT or CSV is left exactly as given.
    if (extensionOf(name) === "md") await addKeywords(tenantId, resolvePath(where, path), complete);
    return { path, bytes };
  }
  const text = await extractInto(tenantId, where, root, name, bytes, names, readPages);
  if ("path" in text) await addKeywords(tenantId, resolvePath(where, text.path), complete);
  if (givenBy) {
    await recordProvenance(tenantId, where, path, { ...givenBy, ...("path" in text && { textPath: text.path }) });
    if ("path" in text) await recordProvenance(tenantId, where, text.path, givenBy);
  }
  return { path, bytes, text };
}

/** Kept in a hidden `.documents/` folder of the place, outside `files/`, so listing `files/` shows only Documents. */
function provenancePath(where: Where, path: string) {
  const [root, ...rest] = path.split("/");
  const dir = visibleRoots(where)[root!];
  return dir && rest.length ? `${dir}/.documents/${rest.join("/")}.json` : null;
}

/** Best effort: a Document is filed even when this fails, and a stale record of an earlier file of the same name is replaced. */
async function recordProvenance(tenantId: string, where: Where, path: string, record: Provenance) {
  const at = provenancePath(where, path);
  if (!at) return;
  try { await workspaceStore().write(tenantId, at, JSON.stringify(record), (await workspaceStore().read(tenantId, at))?.version); } catch {}
}

/** Who gave the Document at `path` (agent-facing), when it was filed with a giver; null for a file filed otherwise. */
export async function provenanceOf(tenantId: string, where: Where, path: string): Promise<Provenance | null> {
  const at = provenancePath(where, path);
  const file = at ? await workspaceStore().read(tenantId, at).catch(() => null) : null;
  try {
    const record = file && JSON.parse(file.content);
    return typeof record?.name === "string" && typeof record.id === "string" ? { name: record.name, id: record.id, ...(typeof record.textPath === "string" && { textPath: record.textPath }) } : null;
  } catch { return null; }
}

async function extractInto(tenantId: string, where: Where, root: string, name: string, bytes: Uint8Array, names: Set<string>, readPages?: PageReader): Promise<Extracted> {
  // A scanned PDF has no text layer: its page images are read by a model that sees them, when there is one (#246).
  const scanned = async () => {
    const pages = extensionOf(name) === "pdf" && readPages ? await scannedPages(bytes) : [];
    const read = pages.length ? await readPages!(pages).catch(() => null) : null;
    return read?.trim() ? `${SCANNED_NOTE}\n\n${read.trim()}\n` : null;
  };
  const text = (await documentText(name, bytes)) ?? (await scanned());
  if (!text) return { failed: true };
  const path = `${root}/files/${freeName(textName(name), names)}`;
  try { await workspaceStore().write(tenantId, resolvePath(where, path), text); } catch { return { failed: true }; }
  return { path };
}

/** The head of a scanned PDF's text, which a model read from its page images. */
export const SCANNED_NOTE = "_Read from the scanned pages by the model: check names and numbers against the PDF._";

/** An image the bot was given (#246), as its Profile saw it: a name, the bytes, and their media type. */
export type GivenImage = { name: string; bytes: Uint8Array; mediaType: string };
const IMAGE_EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/**
 * Files an image someone sent the bot into `files/`, never over an existing file, so it can be found and named later (#246); the extension
 * follows the bytes as kept, a GIF reduced to PNG included. Null when the place keeps no files.
 */
export async function fileImage(tenantId: string, where: Where, image: GivenImage, { taken, givenBy }: { taken?: Set<string>; givenBy?: Giver } = {}): Promise<{ path: string } | null> {
  const root = placeRoot(where);
  if (!root || image.bytes.byteLength > MAX_DOCUMENT_BYTES) return null;
  const ext = IMAGE_EXTENSION[image.mediaType] ?? extensionOf(image.name);
  const stem = safeName(image.name).replace(/\.[^.]+$/, "");
  const names = taken ?? await takenNames(tenantId, where), path = `${root}/files/${freeName(`${stem}.${ext}`, names)}`;
  await workspaceStore().writeBytes(tenantId, resolvePath(where, path), image.bytes);
  if (givenBy) await recordProvenance(tenantId, where, path, givenBy);
  return { path };
}

/** Writes what a model saw in a filed image beside it, as `<name>.md` with a keyword head, so search finds the image by what it shows. */
export async function describeImageInto(tenantId: string, where: Where, path: string, description: string, { taken, complete }: { taken?: Set<string>; complete?: Completion } = {}): Promise<{ path: string } | null> {
  const root = path.split("/")[0]!, name = path.split("/").pop()!, names = taken ?? await takenNames(tenantId, where);
  const text = `# ${name}\n\n_What the model saw in the image ${path}._\n\n${description.trim()}\n`;
  const at = `${root}/files/${freeName(textName(name), names)}`;
  try { await workspaceStore().write(tenantId, resolvePath(where, at), text); } catch { return null; }
  await addKeywords(tenantId, resolvePath(where, at), complete);
  const given = await provenanceOf(tenantId, where, path);
  if (given) { await recordProvenance(tenantId, where, path, { ...given, textPath: at }); await recordProvenance(tenantId, where, at, { name: given.name, id: given.id }); }
  return { path: at };
}

/** The names already in the turn's `files/` folder, so several documents of one turn number themselves consistently. */
export async function takenNames(tenantId: string, where: Where) {
  const root = placeRoot(where);
  if (!root) return new Set<string>();
  const folder = resolvePath(where, `${root}/files`, true);
  return new Set((await workspaceStore().list(tenantId, folder)).map((e) => e.path.slice(folder.length + 1)));
}

async function download(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch { return null; }
}
