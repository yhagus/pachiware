import { resolvePath } from "./paths.js";
import { WorkspaceConflict, workspaceStore } from "./store.js";
import { extensionOf, extractsText } from "./extract.js";
import { filesRoot, provenanceOf } from "./files.js";
import { DEFAULT_TIMEZONE, isoInZone } from "../clock.js";
import { textIn } from "../language.js";
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

/** The text of the Document at `path`, as filed: an MD, TXT or CSV as it is, a PDF's or DOCX's extracted Markdown. */
export async function keptDocument(ctx: SkillContext, path: unknown): Promise<KeptText> {
  const t = textIn(ctx.language), store = workspaceStore();
  const document = under(ctx, path, "files");
  if (!document) throw new Error(t.keepNotDocument(filesRoot(ctx)!));
  const full = resolvePath(ctx, document);
  if (!(await store.list(ctx.tenantId, full.slice(0, full.lastIndexOf("/")))).some((e) => e.path === full && e.type === "file")) throw new Error(t.keepNoDocument(document));
  const given = await provenanceOf(ctx.tenantId, ctx, document);
  const textPath = extractsText(document) ? given?.text ?? document.replace(/\.[^.]+$/, ".md") : TEXT_TYPES.includes(extensionOf(document)) ? document : null;
  const file = textPath ? await store.read(ctx.tenantId, resolvePath(ctx, textPath)) : null;
  if (!file) throw new Error(t.keepNoText(document));
  return { text: file.content, source: document, ...(given && { author: given.name }) };
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
