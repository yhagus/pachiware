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
/** The person who gave a Document to the bot; a Note kept from it names them as its author. */
export type Giver = { name: string; id: string };
/** What the place remembers about a filed Document: who gave it, and for a PDF or DOCX where its text went. */
export type Provenance = Giver & { text?: string };
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
export async function fileDocument(tenantId: string, where: Where, doc: Document, { taken, givenBy }: { taken?: Set<string>; givenBy?: Giver } = {}): Promise<Filed | NotFiled> {
  const reason = documentReason(doc);
  if (reason) return { reason };
  const root = filesRoot(where);
  if (!root) return { reason: "place" };
  const names = taken ?? await takenNames(tenantId, where);
  const bytes = await download(doc.url);
  if (!bytes || bytes.byteLength > MAX_DOCUMENT_BYTES) return { reason: bytes ? "tooLarge" : "download" };
  const name = freeName(safeName(doc.name), names), path = `${root}/files/${name}`;
  await workspaceStore().writeBytes(tenantId, resolvePath(where, path), bytes);
  if (!extractsText(name, bytes.byteLength)) {
    if (givenBy) await recordProvenance(tenantId, where, path, givenBy);
    return { path, bytes };
  }
  const text = await extractInto(tenantId, where, root, name, bytes, names);
  if (givenBy) {
    await recordProvenance(tenantId, where, path, { ...givenBy, ...("path" in text && { text: text.path }) });
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
    return typeof record?.name === "string" && typeof record.id === "string" ? { name: record.name, id: record.id, ...(typeof record.text === "string" && { text: record.text }) } : null;
  } catch { return null; }
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
