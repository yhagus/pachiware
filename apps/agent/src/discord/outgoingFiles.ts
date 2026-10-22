import { takeOutgoing, type ToolResult } from "@pachiware/skills";

/** A discord.js file to post. */
export type OutgoingDiscordFile = { attachment: Buffer; name: string };

/**
 * The files this turn's tools built for the reply (`sendFiles`), taken from the outbox in the order they were asked for. A result whose
 * file is gone (taken already, or held past its 10 minutes) gives nothing.
 */
export function outgoingFiles(calls: { result: ToolResult }[]): OutgoingDiscordFile[] {
  return calls.flatMap(({ result }) => {
    const id = result.success ? result.data?.attachment?.id : undefined;
    const file = typeof id === "string" ? takeOutgoing(id) : null;
    return file ? [{ attachment: Buffer.from(file.bytes), name: file.name }] : [];
  });
}
