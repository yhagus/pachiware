import { zipSync } from "fflate";
import { workspaceStore } from "./store.js";
import { keptTextBeside } from "./files.js";
import { holdOutgoing, type OutgoingAttachment } from "../outbox.js";
import { DEFAULT_TIMEZONE, isoInZone } from "../clock.js";
import { textIn } from "../language.js";
import type { SkillContext } from "../types.js";

/** At most this many files go in one reply, and at most this many bytes: what Discord takes in one upload in a server without boosts. */
export const MAX_SEND_FILES = 50, MAX_SEND_BYTES = 10 * 1024 * 1024;

/** A path the asker named, already checked: where it is in the store, and the path the agent named it by. */
export type NamedPath = { full: string; shown: string };
/** Leaves out the files of a walked folder the asker may not have shown here (private threads' folders). */
export type Shown = <T extends { path: string }>(entries: T[]) => Promise<T[]>;

type Picked = { full: string; shown: string; named: boolean; bytes?: Uint8Array };

/** The folder a zip is named after, unless it is a place's own root; then "files". */
const ROOTS = new Set(["tenant", "guild", "channel", "thread", "dm"]);
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

/**
 * Builds what `sendFiles` attaches: one file as it is, or several (a folder's, or several named) as one zip whose entries keep their
 * folders below the folder they share. The text the bot kept beside a Document or an image goes only when it is named itself.
 * The file waits in the outbox for the host; the result says only its name, size and what it holds.
 */
export async function sendWorkspaceFiles(ctx: SkillContext, named: NamedPath[], shownHere: Shown): Promise<{ attachment: OutgoingAttachment }> {
  const t = textIn(ctx.language), store = workspaceStore();
  const picked = new Map<string, Picked>();
  for (const p of named) {
    const file = await store.readBytes(ctx.tenantId, p.full);
    if (file) { picked.set(p.full, { ...p, named: true, bytes: file.bytes }); continue; }
    const walked = await shownHere(await store.files(ctx.tenantId, p.full));
    if (!walked.length) throw new Error(t.sendNothing(p.shown));
    for (const f of walked) if (!picked.has(f.path)) picked.set(f.path, { full: f.path, shown: p.shown + f.path.slice(p.full.length), named: false });
  }
  const kept = new Set((await Promise.all([...picked.keys()].map((full) => keptTextBeside(ctx.tenantId, full)))).filter(Boolean));
  const files = [...picked.values()].filter((f) => f.named || !kept.has(f.full));
  if (files.length > MAX_SEND_FILES) throw new Error(t.sendTooMany(files.length, MAX_SEND_FILES));

  const read = await Promise.all(files.map(async (f) => ({ ...f, bytes: f.bytes ?? (await store.readBytes(ctx.tenantId, f.full))!.bytes })));
  const shown = files.map((f) => f.shown);
  let name = read[0]!.shown.split("/").pop()!, bytes = read[0]!.bytes;
  if (read.length > 1) {
    const folder = sharedFolder(shown), below = folder.length ? folder.join("/").length + 1 : 0, last = folder.at(-1);
    bytes = zipSync(Object.fromEntries(read.map((f) => [f.shown.slice(below).replace(/^<#([\w-]+)>/, "$1").replace(/^#/, ""), f.bytes])));
    name = `${last && !ROOTS.has(last) && !/^<?#/.test(last) ? last : "files"}-${isoInZone(ctx.timezone ?? DEFAULT_TIMEZONE).slice(0, 10)}.zip`;
  }
  if (bytes.byteLength > MAX_SEND_BYTES) throw new Error(t.sendTooLarge(megabytes(bytes.byteLength), megabytes(MAX_SEND_BYTES).replace(/\.0$/, "")));
  return { attachment: { id: holdOutgoing({ name, bytes }), name, bytes: bytes.byteLength, files: shown } };
}

/** The folders every path lies under, as segments; empty when they share none. */
function sharedFolder(paths: string[]) {
  const dirs = paths.map((p) => p.split("/").slice(0, -1));
  const shared: string[] = [];
  for (let i = 0; dirs.every((d) => i < d.length && d[i] === dirs[0]![i]); i++) shared.push(dirs[0]![i]!);
  return shared;
}
