import { repositories } from "@pachiware/db";
import type { BulkApproval, BulkItem } from "@pachiware/skills";

/** What the conversation keeps of the messages that left the history window; `coversMessages` is the window offset it was written for. */
export type ConversationSummary = { text: string; coversMessages: number; updatedAt: string };

export const summaryOf = (metadata: unknown): ConversationSummary | null => {
  const summary = (metadata as { summary?: ConversationSummary } | null)?.summary;
  return summary && typeof summary.text === "string" && summary.text ? summary : null;
};

/** The bulk refused on the asker's previous turn, which this turn of theirs may run; empty for anyone else. */
export const bulkApprovalOf = (metadata: unknown, userId?: string): BulkItem[] => {
  const approval = (metadata as { bulkApproval?: BulkApproval } | null)?.bulkApproval;
  return approval && userId && approval.userId === userId && Array.isArray(approval.items) ? approval.items : [];
};

/**
 * Whether a channel's latest conversation goes on: not when it was ended from the console (`endedAt`), nor when its last turn
 * (`lastTurnAt`, on the business clock) is `idleMs` or more before `at`. A playbook thread keeps its conversation however long it
 * waits, and one with no turn recorded yet goes on. `idleMs` 0 never ends one.
 */
export function continuesConversation(metadata: unknown, { idleMs, at, playbook = false }: { idleMs: number; at: number; playbook?: boolean }) {
  const { endedAt, lastTurnAt } = (metadata ?? {}) as { endedAt?: unknown; lastTurnAt?: unknown };
  if (endedAt) return false;
  if (playbook || idleMs <= 0 || typeof lastTurnAt !== "string") return true;
  return at - Date.parse(lastTurnAt) < idleMs;
}

/**
 * Writes `patch` over the conversation's metadata and keeps its other keys; an undefined value removes the key.
 * Pass `current` only when it was read just now: otherwise the row is read again here, so a write after a model call never restores a key changed meanwhile.
 */
export async function patchConversationMetadata(tenantId: string, conversationId: string, patch: { summary?: ConversationSummary; bulkApproval?: BulkApproval; lastTurnAt?: string; endedAt?: string }, current?: unknown) {
  const { conversations } = repositories();
  const base = current !== undefined ? current : (await conversations.get(tenantId, conversationId))?.metadata;
  const metadata: Record<string, unknown> = { ...((base as Record<string, unknown> | null) ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete metadata[key];
    else metadata[key] = value;
  }
  await conversations.setMetadata(tenantId, conversationId, metadata);
}
