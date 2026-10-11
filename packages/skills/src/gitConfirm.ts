import { randomUUID } from "node:crypto";
import type { AuthorizationContext } from "./types.js";
import { payloadHash } from "./guardrails.js";

// Generic single-use confirmation for any write or destructive tool (git keeps its historical file name).
export interface PendingAction {
  id: string; tenantId: string; botId: string; userId: string; guildId: string; channelId: string; parentChannelId?: string;
  tool: string; args: Record<string, any>; summary: string; expires: number;
  /** Hash of tool + arguments taken when queued; a confirmation only runs a payload that still matches. */
  hash: string;
  /** Roles and permissions of the asker when the action was queued. */
  auth?: AuthorizationContext;
  /** Only its own Confirm runs it: a thread grant neither skips it nor can be given from it. */
  ownConfirmation?: boolean;
}
const TTL_MS = 10 * 60 * 1000, MAX = 200;
// ponytail: in memory, so a restart drops waiting confirmations (the user just asks again); move to Redis or the DB if that hurts.
const pending = new Map<string, PendingAction>();
/** Ids of confirmations that ran out before anyone pressed a button, so the handler can audit them once. */
const expiredIds = new Map<string, PendingAction>();

function sweep() {
  const now = Date.now();
  for (const [id, a] of pending) if (a.expires <= now) { pending.delete(id); expiredIds.set(id, a); }
  while (pending.size >= MAX) pending.delete(pending.keys().next().value!);
  while (expiredIds.size > 500) expiredIds.delete(expiredIds.keys().next().value!);
}
export function queueAction(a: Omit<PendingAction, "id" | "expires" | "hash">): PendingAction {
  sweep();
  const action = { ...a, id: randomUUID().replace(/-/g, "").slice(0, 16), expires: Date.now() + TTL_MS, hash: payloadHash(a.tool, a.args) };
  pending.set(action.id, action);
  return action;
}
export function peekAction(id: string): PendingAction | undefined {
  const a = pending.get(id);
  if (a && a.expires <= Date.now()) { pending.delete(id); expiredIds.set(id, a); return undefined; }
  return a;
}
export const dropAction = (id: string) => pending.delete(id);
/** True once for an id that expired while waiting. */
export const takeExpired = (id: string) => { const a = expiredIds.get(id); expiredIds.delete(id); return a; };
/** True while the stored payload still matches the hash it was queued with. */
export const payloadIntact = (a: PendingAction) => a.hash === payloadHash(a.tool, a.args);
