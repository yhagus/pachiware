import { resolvePath } from "./paths.js";
import { WorkspaceConflict, workspaceStore } from "./store.js";
import { extensionOf, isBinaryDocument } from "./extract.js";
import { filesRoot, provenanceOf } from "./files.js";
import { DEFAULT_TIMEZONE, isoInZone } from "../clock.js";
import { textIn } from "../language.js";
import { jumpLink } from "../playbooks.js";
import type { SkillContext } from "../types.js";

/** One piece of text a person asked to keep, word for word, and where it came from; a Note joins its pieces in order. */
export type KeptText = { text: string; source: string; author?: string };

const TEXT_TYPES = ["md", "txt", "csv"];

/** The place's folder (`channel` or `dm`) and the path inside it, when `path` lies under that folder's `top/`. */
function under(ctx: SkillContext, path: unknown, top: string) {
  const root = filesRoot(ctx);
  if (!root) throw new Error(textIn(ctx.language).keepNoPlace);
  return typeof path === "string" && path.startsWith(`${root}/${top}/`) && path.length > root.length + top.length + 2 ? path : null;
}

/** The text of the Document at `path`, as filed: an MD, TXT or CSV as it is, a PDF's, DOCX's or XLSX's extracted Markdown. */
export async function keptDocument(ctx: SkillContext, path: unknown): Promise<KeptText> {
  const t = textIn(ctx.language), store = workspaceStore();
  const document = under(ctx, path, "files");
  if (!document) throw new Error(t.keepNotDocument(filesRoot(ctx)!));
  const full = resolvePath(ctx, document);
  if (!(await store.list(ctx.tenantId, full.slice(0, full.lastIndexOf("/")))).some((e) => e.path === full && e.type === "file")) throw new Error(t.keepNoDocument(document));
  const given = await provenanceOf(ctx.tenantId, ctx, document);
  const textPath = isBinaryDocument(document) ? given?.text ?? document.replace(/\.[^.]+$/, ".md") : TEXT_TYPES.includes(extensionOf(document)) ? document : null;
  const file = textPath ? await store.read(ctx.tenantId, resolvePath(ctx, textPath)) : null;
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
  const note = under(ctx, path, "notes");
  if (!note) throw new Error(t.keepNotNotes(filesRoot(ctx)!));
  const full = resolvePath(ctx, note);
  if (await store.read(ctx.tenantId, full).catch(() => true)) throw new Error(t.keepTaken(note));
  const one = <T>(items: T[]) => (items.length === 1 ? items[0] : items);
  const authors = [...new Set(pieces.flatMap((p) => (p.author ? [p.author] : [])))];
  const head = {
    source: one(pieces.map((p) => p.source)),
    ...(authors.length && { author: one(authors) }),
    askedBy: ctx.userName || ctx.userId || "unknown",
    date: isoInZone(ctx.timezone || DEFAULT_TIMEZONE).slice(0, 10),
  };
  // Same frontmatter shape as task files: one `key: JSON value` per line, which is also valid YAML.
  const content = `---\n${Object.entries(head).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n${pieces.map((p) => p.text).join("\n\n")}`;
  try { await store.write(ctx.tenantId, full, content); } catch (e) { throw e instanceof WorkspaceConflict ? new Error(t.keepTaken(note)) : e; }
  return { path: note };
}
