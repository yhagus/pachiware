import { MAX_BLOB_BYTES, workspaceStore } from "./store.js";
import { placeRoot, resolvePath, visibleRoots } from "./paths.js";
import { documentText, extensionOf, extractsText } from "./extract.js";
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
export async function fileDocument(tenantId: string, where: Where, doc: Document, { taken, givenBy, complete }: { taken?: Set<string>; givenBy?: Giver; complete?: Completion } = {}): Promise<Filed | NotFiled> {
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
  const text = await extractInto(tenantId, where, root, name, bytes, names);
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

async function extractInto(tenantId: string, where: Where, root: string, name: string, bytes: Uint8Array, names: Set<string>): Promise<Extracted> {
  const text = await documentText(name, bytes);
  if (!text) return { failed: true };
  const path = `${root}/files/${freeName(textName(name), names)}`;
  try { await workspaceStore().write(tenantId, resolvePath(where, path), text); } catch { return { failed: true }; }
  return { path };
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
