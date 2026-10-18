import type { Message } from "discord.js";
import { textIn, jumpLink, fileDocument, takenNames, type Completion, type Filed, type Language, type Strings } from "@pachiware/skills";
import type { ImagePart } from "../llm/types.js";
import { placeOfChannel, speakerName } from "./routing.js";

const MAX_IMAGES = 4;
const MAX_EDGE = 2000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DOWNLOAD = 25 * 1024 * 1024;
// Refuses a small file that claims a huge canvas before any pixel buffer is allocated.
const MAX_PIXELS = 50_000_000;
const MEDIA: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const IMAGE_NAME = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif|svg)$/i;
const SUPPORTED_NAME = /\.(png|jpe?g|webp|gif)$/i;


type Attachment = { id: string; name: string; url: string; contentType?: string | null; size: number; width?: number | null; height?: number | null };
/** An image of the turn and the message holding it; `sent` when its bytes went to the model. */
export type TurnShot = { id: string; name: string; link: string; sent: boolean };
export type TurnImages = { images: ImagePart[]; context: string; notes: string[]; blind: boolean; shots: TurnShot[] };

const attachmentsOf = (m: Message | null | undefined): Attachment[] => (m?.attachments?.size ? [...m.attachments.values()] as Attachment[] : []);
const isImage = (a: Attachment) => !!a.contentType?.startsWith("image/") || IMAGE_NAME.test(a.name);
const isSupported = (a: Attachment) => a.contentType ? /^image\/(png|jpeg|webp|gif)$/.test(a.contentType) : SUPPORTED_NAME.test(a.name);
const placeholder = (a: Attachment, label: string) => `[${label}: ${a.name}${a.width && a.height ? `, ${a.width}×${a.height}` : ""}]`;
// A file placeholder carries its message id so a later `saveAttachment` can find it.
const filePlaceholder = (a: Attachment, msg: Message, note?: string) => `[file: ${a.name} (message ${msg.id})${note ? `: ${note}` : ""}]`;
const textNote = (filed: Filed, t: Strings) => !filed.text ? "" : "path" in filed.text ? `; text in ${filed.text.path}` : `: ${t.textNotExtracted}`;
/** What the turn says per filed or refused attachment, by attachment id. */
export type FiledNotes = Map<string, string>;

/** The message text plus a placeholder per attachment, which is what conversation history keeps. */
export function withPlaceholders(text: string, msg: Message, filed?: FiledNotes) {
  return [text, ...attachmentsOf(msg).map((a) => isImage(a) ? placeholder(a, "image") : filed?.get(a.id) ?? filePlaceholder(a, msg))].filter(Boolean).join(" ");
}

/**
 * Files the documents of the messages that address the bot into the turn's `files/` folder before the turn runs,
 * and says per attachment where it landed or why it did not. Attachments of other messages keep their placeholder.
 */
export async function fileTurnDocuments(tenantId: string, items: { msg: Message; direct?: boolean }[], language?: Language, complete?: Completion): Promise<FiledNotes> {
  const t = textIn(language), notes: FiledNotes = new Map();
  const taken = new Map<string, Set<string>>();
  for (const { msg, direct } of items) {
    if (direct === false) continue;
    const where = { guildId: msg.guildId ?? undefined, ...placeOfChannel(msg.channel), userId: msg.author.id };
    const key = `${where.guildId ?? "dm"}:${where.privateThread ? where.channelId : where.parentChannelId ?? where.channelId}:${where.userId}`;
    for (const a of attachmentsOf(msg).filter((a) => !isImage(a))) {
      const names = taken.get(key) ?? (await takenNames(tenantId, where).catch(() => new Set<string>()));
      taken.set(key, names);
      const outcome = await fileDocument(tenantId, where, a, { taken: names, givenBy: { name: speakerName(msg), id: msg.author.id }, complete }).catch(() => ({ reason: "download" as const }));
      notes.set(a.id, "path" in outcome ? `[file: ${a.name} saved as ${outcome.path}${textNote(outcome, t)}]` : filePlaceholder(a, msg, t.notFiled[outcome.reason]));
    }
  }
  return notes;
}

/**
 * Images for the turn: attachments of the answered messages and of the message each one replies to, checked by
 * metadata, downloaded, and reduced to provider limits. Whatever is not sent is named in `notes`.
 */
export async function gatherTurnImages(messages: Message[], acceptsImages: () => Promise<boolean>, language?: Language): Promise<TurnImages> {
  const t = textIn(language);
  const holding = new Map<string, Message>();
  const of = (m: Message | null) => attachmentsOf(m).map((a) => (holding.set(a.id, holding.get(a.id) ?? m!), a));
  const own = messages.flatMap(of);
  const referenced = (await Promise.all(messages.filter((m) => m.reference?.messageId).map((m) => m.fetchReference().catch(() => null))))
    .flatMap(of).filter(isImage);
  const seen = new Set<string>();
  const candidates = [...own, ...referenced].filter((a) => isImage(a) && !seen.has(a.id) && !!seen.add(a.id));
  const context = referenced.map((a) => placeholder(a, "image in the replied-to message")).join(" ");
  const result: TurnImages = { images: [], context, notes: [], blind: false, shots: [] };
  if (!candidates.length) return result;
  const blind = !(await acceptsImages());
  const skipped: string[] = [];
  for (const a of candidates) {
    const from = holding.get(a.id)!;
    const shot = isImage(a) ? { id: a.id, name: a.name, link: jumpLink(from.guildId, from.channelId, from.id), sent: false } : null;
    if (shot) result.shots.push(shot);
    if (blind && isImage(a)) { result.blind = true; continue; }
    if (!isSupported(a)) { skipped.push(`${a.name} (${t.skip.format})`); continue; }
    if (result.images.length >= MAX_IMAGES) { skipped.push(`${a.name} (${t.skip.tooMany(MAX_IMAGES)})`); continue; }
    if (a.size > MAX_DOWNLOAD) { skipped.push(`${a.name} (${t.skip.tooLarge})`); continue; }
    const fitted = await download(a.url).then((bytes) => bytes ? fit(bytes) : "download" as const);
    if (typeof fitted === "string") skipped.push(`${a.name} (${t.skip[fitted]})`);
    else { result.images.push(fitted); if (shot) shot.sent = true; }
  }
  if (result.blind) result.notes.push(t.blind);
  if (skipped.length) result.notes.push(t.skipped(skipped));
  return result;
}

async function download(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length <= MAX_DOWNLOAD ? bytes : null;
  } catch { return null; }
}

// Long edge at most MAX_EDGE and at most MAX_BYTES; a GIF becomes a PNG of its first frame, since OpenAI refuses animated ones.
type SkipReason = Exclude<keyof Strings["skip"], "tooMany">;
async function fit(bytes: Uint8Array): Promise<ImagePart | SkipReason> {
  let meta: Bun.Image.Metadata;
  try { meta = await new Bun.Image(bytes, { maxPixels: MAX_PIXELS }).metadata(); } catch { return "unreadable"; }
  if (!MEDIA[meta.format]) return "format";
  const part = (data: Uint8Array, format: string): ImagePart => ({ type: "image", mediaType: MEDIA[format]!, data: Buffer.from(data).toString("base64") });
  if (meta.format !== "gif" && Math.max(meta.width, meta.height) <= MAX_EDGE && bytes.length <= MAX_BYTES) return part(bytes, meta.format);
  const same = meta.format === "gif" ? "png" : meta.format;
  for (const [edge, format] of [[MAX_EDGE, same], [MAX_EDGE, "jpeg"], [MAX_EDGE * 0.75, "jpeg"]] as const) {
    try {
      const out = await new Bun.Image(bytes, { maxPixels: MAX_PIXELS }).resize(edge, edge, { fit: "inside", withoutEnlargement: true })[format as "png" | "jpeg" | "webp"]().bytes();
      if (out.length <= MAX_BYTES) return part(out, format);
    } catch { return "unreadable"; }
  }
  return "tooBig";
}
