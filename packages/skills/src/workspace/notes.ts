import { resolvePath } from "./paths.js";
import { WorkspaceConflict, workspaceStore } from "./store.js";
import { extensionOf, extractsText } from "./extract.js";
import { filesRoot, provenanceOf, unrecordedTextPath } from "./files.js";
import { DEFAULT_TIMEZONE, isoInZone } from "../clock.js";
import { textIn } from "../language.js";
import { jumpLink, renderFrontmatter } from "../playbooks.js";
import type { SkillContext } from "../types.js";

/** One piece of text a person asked to keep, word for word, and where it came from; a Note joins its pieces in order. */
export type KeptText = { text: string; source: string; author?: string };

const TEXT_TYPES = ["md", "txt", "csv"];

/** `path` when it names something inside `<place>/<folder>/` (`channel/notes/...` or `dm/notes/...`), else null; refuses where the turn has no place. */
function pathInPlaceFolder(ctx: SkillContext, path: unknown, folder: string) {
  const root = filesRoot(ctx);
  if (!root) throw new Error(textIn(ctx.language).keepNoPlace);
  const prefix = `${root}/${folder}/`;
  return typeof path === "string" && path.startsWith(prefix) && path.length > prefix.length ? path : null;
}

/** The text of the Document at `path`, as filed: an MD, TXT or CSV as it is, the extracted Markdown of a PDF, DOCX, XLSX or CSV too large to read. */
export async function keptDocument(ctx: SkillContext, path: unknown): Promise<KeptText> {
  const t = textIn(ctx.language), store = workspaceStore();
  const document = pathInPlaceFolder(ctx, path, "files");
  if (!document) throw new Error(t.keepNotDocument(filesRoot(ctx)!));
  const full = resolvePath(ctx, document), folder = full.slice(0, full.lastIndexOf("/"));
  const entries = await store.list(ctx.tenantId, folder);
  const entry = entries.find((e) => e.path === full && e.type === "file");
  if (!entry) throw new Error(t.keepNoDocument(document));
  const given = await provenanceOf(ctx.tenantId, ctx, document);
  const siblings = entries.map((e) => e.path.slice(folder.length + 1));
  const textPath = !extractsText(document, entry.size ?? 0) ? (TEXT_TYPES.includes(extensionOf(document)) ? document : null)
    : given ? given.textPath ?? null : unrecordedTextPath(document, siblings);
  const file = textPath ? await store.read(ctx.tenantId, resolvePath(ctx, textPath)).catch(() => null) : null;
  if (!file) throw new Error(t.keepNoText(document));
  return { text: file.content, source: document, ...(given && { author: given.name }) };
}

/** How many messages one Note may join. */
export const MAX_KEPT_MESSAGES = 20;

/** The texts of messages in this channel or thread, as written, in the order given, each with its author and its link as the source. */
export async function keptMessages(ctx: SkillContext, messageIds: unknown): Promise<KeptText[]> {
  const t = textIn(ctx.language);
  const ids = Array.isArray(messageIds) ? messageIds.map((id) => (typeof id === "string" ? id.trim() : "")) : [];
  if (!ids.length || ids.some((id) => !id)) throw new Error(t.keepMessageIds);
  if (ids.length > MAX_KEPT_MESSAGES) throw new Error(t.keepTooManyMessages(MAX_KEPT_MESSAGES));
  const { discord, channelId } = ctx;
  if (!discord || !channelId) throw new Error(t.keepNoMessage(ids[0]!));
  // A thread opened from a message shares its id, and that starter message sits in the parent channel.
  const placeOf = (messageId: string) => (messageId === channelId && ctx.parentChannelId ? ctx.parentChannelId : channelId);
  const messages = await Promise.all(ids.map((messageId) => discord.fetchMessage({ channelId: placeOf(messageId), messageId })));
  return messages.map((message, i) => {
    if (!message) throw new Error(t.keepNoMessage(ids[i]!));
    const source = jumpLink(ctx.guildId, message.channelId, message.id);
    if (!message.content) throw new Error(t.keepNoText(source));
    return { text: message.content, source, ...(message.authorName && { author: message.authorName }) };
  });
}

/**
 * Writes a new Note at `path` under the place's `notes/`: a head naming the source(s), author(s), who asked and the date,
 * then the pieces' text unchanged, joined in order. Never replaces a file.
 */
export async function keepNote(ctx: SkillContext, path: unknown, pieces: KeptText[]): Promise<{ path: string }> {
  const t = textIn(ctx.language), store = workspaceStore();
  const note = pathInPlaceFolder(ctx, path, "notes");
  if (!note) throw new Error(t.keepNotNotes(filesRoot(ctx)!));
  if (!note.endsWith(".md")) throw new Error(t.keepNotMarkdown);
  const full = resolvePath(ctx, note);
  if (await store.read(ctx.tenantId, full).catch(() => true)) throw new Error(t.keepTaken(note));
  // One source stays a scalar; several messages give parallel lists, one source and one author per message, in order.
  const [single] = pieces;
  const origin = pieces.length === 1
    ? { source: single!.source, author: single!.author }
    : { source: pieces.map((p) => p.source), author: pieces.map((p) => p.author || "unknown") };
  const head = { ...origin, askedBy: ctx.userName || ctx.userId || "unknown", date: isoInZone(ctx.timezone || DEFAULT_TIMEZONE).slice(0, 10) };
  const content = renderFrontmatter(head, pieces.map((p) => p.text).join("\n\n"));
  try { await store.write(ctx.tenantId, full, content); } catch (e) { throw e instanceof WorkspaceConflict ? new Error(t.keepTaken(note)) : e; }
  return { path: note };
}
