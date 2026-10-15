import { MAX_BLOB_BYTES, workspaceStore } from "./store.js";
import { resolvePath, visibleRoots } from "./paths.js";
import { documentText, extensionOf, extractsText } from "./extract.js";
import type { SkillContext } from "../types.js";

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
type Where = Pick<SkillContext, "guildId" | "channelId" | "parentChannelId" | "userId">;

export const isDocument = (name: string) => (DOCUMENT_TYPES as readonly string[]).includes(extensionOf(name));

/** Why a document cannot be filed, known from its metadata alone; null when it can. */
export function documentReason(doc: Pick<Document, "name" | "size">): NotFiledReason | null {
  if (!isDocument(doc.name)) return "type";
  if (doc.size > MAX_DOCUMENT_BYTES) return "tooLarge";
  return null;
}

/** The folder documents are filed in: the channel's (a thread uses its parent's), or the DM's. Null outside both. */
export function filesRoot(where: Where) {
  const roots = visibleRoots(where);
  return roots.channel ? "channel" : roots.dm ? "dm" : null;
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

/**
 * Fetches one allowed document and writes it into `files/` under the turn's folder, never over an existing file.
 * The text of a PDF, DOCX, XLSX or large CSV then goes to a sibling `<name>.md` for `readFile` and `searchFiles`; `saveAttachment` calls this for a named message.
 */
export async function fileDocument(tenantId: string, where: Where, doc: Document, taken?: Set<string>): Promise<Filed | NotFiled> {
  const reason = documentReason(doc);
  if (reason) return { reason };
  const root = filesRoot(where);
  if (!root) return { reason: "place" };
  const names = taken ?? await takenNames(tenantId, where);
  const bytes = await download(doc.url);
  if (!bytes || bytes.byteLength > MAX_DOCUMENT_BYTES) return { reason: bytes ? "tooLarge" : "download" };
  const name = freeName(safeName(doc.name), names), path = `${root}/files/${name}`;
  await workspaceStore().writeBytes(tenantId, resolvePath(where, path), bytes);
  return extractsText(name, bytes.byteLength) ? { path, bytes, text: await extractInto(tenantId, where, root, name, bytes, names) } : { path, bytes };
}

async function extractInto(tenantId: string, where: Where, root: string, name: string, bytes: Uint8Array, names: Set<string>): Promise<Extracted> {
  const text = await documentText(name, bytes);
  if (!text) return { failed: true };
  const path = `${root}/files/${freeName(name.replace(/\.[^.]+$/, ".md"), names)}`;
  try { await workspaceStore().write(tenantId, resolvePath(where, path), text); } catch { return { failed: true }; }
  return { path };
}

/** The names already in the turn's `files/` folder, so several documents of one turn number themselves consistently. */
export async function takenNames(tenantId: string, where: Where) {
  const root = filesRoot(where);
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
