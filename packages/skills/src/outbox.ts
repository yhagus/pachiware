import { randomUUID } from "node:crypto";

/** A file a tool built for the reply. Its bytes stay here: the model reads only the `OutgoingAttachment` the tool returns. */
export interface OutgoingFile { name: string; bytes: Uint8Array }
/** What a tool result carries for the host to attach (see `attachmentOf` in the Discord gateway). */
export interface OutgoingAttachment { id: string; name: string; bytes: number; files: string[] }

const TTL_MS = 10 * 60 * 1000, MAX = 50;
// ponytail: in memory, like waiting confirmations; the reply that attaches a file is sent in the same process within seconds.
const held = new Map<string, OutgoingFile & { expires: number }>();

function sweep() {
  const now = Date.now();
  for (const [id, f] of held) if (f.expires <= now) held.delete(id);
  while (held.size >= MAX) held.delete(held.keys().next().value!);
}

/** Keeps a built file for the host to attach to the reply; returns its id. */
export function holdOutgoing(file: OutgoingFile): string {
  sweep();
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  held.set(id, { ...file, expires: Date.now() + TTL_MS });
  return id;
}

/** The file held under `id`, once: a second take finds nothing. */
export function takeOutgoing(id: string): OutgoingFile | null {
  const f = held.get(id);
  held.delete(id);
  return f && f.expires > Date.now() ? { name: f.name, bytes: f.bytes } : null;
}
