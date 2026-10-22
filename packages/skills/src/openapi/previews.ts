import { repositories } from "@pachiware/db";
import { workspaceStore } from "../workspace/store.js";
import type { NamedPath } from "../workspace/send.js";
import { publicUrl } from "../publicUrl.js";
import { textIn } from "../language.js";
import type { SkillContext } from "../types.js";

/** An API preview holds at most this much JSON. */
export const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const ON_THIS_MACHINE = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i;

export const previewUrl = (id: string) => `${publicUrl()}/open-api/${id}`;

/** The channel or DM a preview belongs to: a thread's is its channel's, so it is listed where the work was asked for. */
const channelOf = (ctx: SkillContext) => ctx.parentChannelId ?? ctx.channelId;

/**
 * Publishes the OpenAPI JSON at `file` (already checked as readable here) as an API preview: a snapshot of the file as it is now, which
 * anyone with its link may open. The file must be an OpenAPI 3 document with paths, at most MAX_PREVIEW_BYTES, and not a changelog draft.
 */
export async function publishPreview(ctx: SkillContext, { full, shown }: NamedPath, title?: unknown) {
  const t = textIn(ctx.language);
  if (!ctx.botId || !channelOf(ctx)) throw new Error(t.previewNotHere);
  if (/\.draft\.json$/.test(shown)) throw new Error(t.previewDraft);
  const file = await workspaceStore().readBytes(ctx.tenantId, full);
  if (!file) throw new Error(`File "${shown}" not found.`);
  if (file.bytes.byteLength > MAX_PREVIEW_BYTES) throw new Error(t.previewTooLarge((file.bytes.byteLength / 1024 / 1024).toFixed(1), MAX_PREVIEW_BYTES / 1024 / 1024));
  const text = new TextDecoder().decode(file.bytes);
  let doc: any;
  try { doc = JSON.parse(text); } catch { doc = null; }
  if (!doc || typeof doc !== "object" || !/^3\.\d+\.\d+/.test(String(doc.openapi ?? "")) || !doc.paths || typeof doc.paths !== "object") {
    throw new Error(t.previewNotOpenApi(shown));
  }
  const named = typeof title === "string" && title.trim() ? title.trim().slice(0, 200) : typeof doc.info?.title === "string" && doc.info.title.trim() ? doc.info.title.trim().slice(0, 200) : shown.split("/").pop()!;
  const preview = await repositories().apiPreviews.create({
    tenantId: ctx.tenantId, botId: ctx.botId, guildId: ctx.guildId ?? null, channelId: channelOf(ctx)!, sourcePath: shown, title: named,
    version: typeof doc.info?.version === "string" ? doc.info.version : null, document: text, createdById: ctx.userId ?? null, createdByName: ctx.userName ?? null,
  });
  return {
    url: previewUrl(preview.id), title: named,
    note: "Anyone with the link can open it. It shows the file as it is now; publishing again makes a new link, and the console revokes one.",
    // PUBLIC_URL names a loopback address: the warning is the sentence the person reads, in their language.
    ...(ON_THIS_MACHINE.test(publicUrl()) ? { warning: textIn(ctx.askerLanguage ?? ctx.language).previewOnlyHere } : {}),
  };
}

/** The previews this bot published in this place (a channel with its threads, or a DM), newest first, at most 20. */
export async function listPreviews(ctx: SkillContext) {
  if (!ctx.botId || !channelOf(ctx)) return { previews: [] };
  const rows = await repositories().apiPreviews.list(ctx.tenantId, { botId: ctx.botId, channelId: channelOf(ctx)! });
  return {
    previews: rows.slice(0, 20).map((p) => ({ title: p.title, url: previewUrl(p.id), source: p.sourcePath, by: p.createdByName, at: p.createdAt.toISOString() })),
    ...(rows.length > 20 ? { more: rows.length - 20 } : {}),
  };
}
