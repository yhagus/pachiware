import { goesOnWith, REPOSITORY_TOOLS, type OpenDraft } from "./changelog.js";
import type { ServiceFailed } from "../serviceFailure.js";
import type { ToolCall, ToolResult } from "../types.js";

/** A failure that pauses a Changelog draft, with the call it came from: the tool and the file it read, when it read one. */
export type FailedForGood = ServiceFailed & { tool: string; file?: string };

/** How many unavailable failures in a row from one service end the turn. */
const UNAVAILABLE_IN_A_ROW = 3;

/**
 * Watches one turn for a service that fails in a way that does not heal (#359): the first refused or gone failure, or the third
 * unavailable one in a row from one service, which a call to that service that succeeds starts over. Every other failure, such as a file
 * that does not exist or a single failed read, is the model's to handle.
 *
 * A turn that goes on with the draft by itself (`ownWork`) is the draft's own work, so a failure of any service it calls counts, git or
 * Plane. A person's turn counts only the reads of the place's Changelog draft's repository: a side question reading Plane never pauses the
 * draft. `draft` finds the place's open draft; a turn may start it, so it is looked for until found.
 */
export function serviceFailures(draft: () => Promise<Pick<OpenDraft, "draft" | "repo"> | undefined>, { ownWork = false } = {}) {
  const inARow = new Map<string, number>();
  /** Which service each kind of call answered for when it failed: the repository reads share one, any other tool is its own. */
  const serviceOf = new Map<string, string>();
  const kindOf = (call: ToolCall) => (REPOSITORY_TOOLS.has(call.name) ? "repository" : call.name);
  let open: Pick<OpenDraft, "draft" | "repo"> | undefined;
  const reads = (call: ToolCall) => !!open && REPOSITORY_TOOLS.has(call.name) && goesOnWith(open, call);
  return async ({ call, result }: { call: ToolCall; result: ToolResult }): Promise<FailedForGood | null> => {
    if (!ownWork && !REPOSITORY_TOOLS.has(call.name)) return null;
    if (result.success) {
      // A call that succeeds is its service answering. The draft's reads all go to its repository's one service.
      if (ownWork) { const service = serviceOf.get(kindOf(call)); if (service) inARow.delete(service); }
      else if (reads(call)) inARow.clear();
      return null;
    }
    const failed = result.failure;
    if (!failed) return null;
    if (!ownWork) {
      open ??= await draft().catch(() => undefined);
      if (!reads(call)) return null;
    }
    serviceOf.set(kindOf(call), failed.service);
    if (failed.kind === "unavailable") {
      const n = (inARow.get(failed.service) ?? 0) + 1;
      inARow.set(failed.service, n);
      if (n < UNAVAILABLE_IN_A_ROW) return null;
    }
    const file = (call.arguments as { path?: unknown } | undefined)?.path;
    return { ...failed, tool: call.name, ...(typeof file === "string" && file.trim() ? { file: file.trim() } : {}) };
  };
}
