import type { Message } from "discord.js";
import type { ImagePart } from "../llm/types.js";

const MAX_IMAGES = 4;
const MAX_EDGE = 2000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DOWNLOAD = 25 * 1024 * 1024;
// Refuses a small file that claims a huge canvas before any pixel buffer is allocated.
const MAX_PIXELS = 50_000_000;
const MEDIA: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const IMAGE_NAME = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif|svg)$/i;
const SUPPORTED_NAME = /\.(png|jpe?g|webp|gif)$/i;

export const BLIND_NOTE = "I can't see images with this profile.";
export const BLIND_ONLY_NOTE = `${BLIND_NOTE} Describe the image in words and I'll work from that.`;
export const REJECTED_NOTE = "This profile rejected the image; an admin can turn image input off for it.";

type Attachment = { id: string; name: string; url: string; contentType?: string | null; size: number; width?: number | null; height?: number | null };
export type TurnImages = { images: ImagePart[]; context: string; notes: string[]; blind: boolean };

const attachmentsOf = (m: Message | null | undefined): Attachment[] => (m?.attachments?.size ? [...m.attachments.values()] as Attachment[] : []);
const isImage = (a: Attachment) => !!a.contentType?.startsWith("image/") || IMAGE_NAME.test(a.name);
const isSupported = (a: Attachment) => a.contentType ? /^image\/(png|jpeg|webp|gif)$/.test(a.contentType) : SUPPORTED_NAME.test(a.name);
const placeholder = (a: Attachment, label: string) => `[${label}: ${a.name}${a.width && a.height ? `, ${a.width}×${a.height}` : ""}]`;

/** The message text plus a placeholder per attachment, which is what conversation history keeps. */
export function withPlaceholders(text: string, msg: Message) {
  return [text, ...attachmentsOf(msg).map((a) => placeholder(a, isImage(a) ? "image" : "file"))].filter(Boolean).join(" ");
}

/**
 * Images for the turn: attachments of the answered messages and of the message each one replies to, checked by
 * metadata, downloaded, and reduced to provider limits. Whatever is not sent is named in `notes`.
 */
export async function gatherTurnImages(messages: Message[], acceptsImages: () => Promise<boolean>): Promise<TurnImages> {
  const own = messages.flatMap(attachmentsOf);
  const referenced = (await Promise.all(messages.filter((m) => m.reference?.messageId).map((m) => m.fetchReference().catch(() => null))))
    .flatMap(attachmentsOf).filter(isImage);
  const seen = new Set<string>();
  const candidates = [...own, ...referenced].filter((a) => !seen.has(a.id) && !!seen.add(a.id));
  const context = referenced.map((a) => placeholder(a, "image in the replied-to message")).join(" ");
  const result: TurnImages = { images: [], context, notes: [], blind: false };
  if (!candidates.length) return result;
  const blind = candidates.some(isImage) && !(await acceptsImages());
  const skipped: string[] = [];
  for (const a of candidates) {
    if (blind && isImage(a)) { result.blind = true; continue; }
    if (!isSupported(a)) { skipped.push(`${a.name} (not a PNG, JPEG, WebP or GIF)`); continue; }
    if (result.images.length >= MAX_IMAGES) { skipped.push(`${a.name} (over the ${MAX_IMAGES}-image limit)`); continue; }
    if (a.size > MAX_DOWNLOAD) { skipped.push(`${a.name} (too large to download)`); continue; }
    const fitted = await download(a.url).then((bytes) => bytes ? fit(bytes) : "could not be downloaded");
    if (typeof fitted === "string") skipped.push(`${a.name} (${fitted})`);
    else result.images.push(fitted);
  }
  if (result.blind) result.notes.push(BLIND_NOTE);
  if (skipped.length) result.notes.push(`Skipped ${skipped.join(", ")}.`);
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
async function fit(bytes: Uint8Array): Promise<ImagePart | string> {
  let meta: Bun.Image.Metadata;
  try { meta = await new Bun.Image(bytes, { maxPixels: MAX_PIXELS }).metadata(); } catch { return "could not be read as an image"; }
  if (!MEDIA[meta.format]) return "not a PNG, JPEG, WebP or GIF";
  const part = (data: Uint8Array, format: string): ImagePart => ({ type: "image", mediaType: MEDIA[format]!, data: Buffer.from(data).toString("base64") });
  if (meta.format !== "gif" && Math.max(meta.width, meta.height) <= MAX_EDGE && bytes.length <= MAX_BYTES) return part(bytes, meta.format);
  const same = meta.format === "gif" ? "png" : meta.format;
  for (const [edge, format] of [[MAX_EDGE, same], [MAX_EDGE, "jpeg"], [MAX_EDGE * 0.75, "jpeg"]] as const) {
    try {
      const out = await new Bun.Image(bytes, { maxPixels: MAX_PIXELS }).resize(edge, edge, { fit: "inside", withoutEnlargement: true })[format as "png" | "jpeg" | "webp"]().bytes();
      if (out.length <= MAX_BYTES) return part(out, format);
    } catch { return "could not be read as an image"; }
  }
  return "could not be reduced under 5 MB";
}
