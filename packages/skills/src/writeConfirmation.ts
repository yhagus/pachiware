import type { SkillContext } from "./types.js";
import { queueAction } from "./gitConfirm.js";
import { hasThreadConfirmation, isTrustedMember } from "./threadConfirmation.js";
import { actionKey, isDone, markDone } from "./guardrails.js";

export interface WriteRequest {
  /** The tool's own name and its arguments as the model sent them: Confirm re-runs exactly this call. */
  tool: string;
  args: Record<string, any>;
  /** "trusted": only a Trusted member may ask, checked again when the confirmed call runs. Default "anyone". */
  access?: "anyone" | "trusted";
  /** Only the asker's own Confirm runs it: a thread grant neither covers it nor can be given from it. */
  ownConfirmation?: boolean;
}
/** What the skill checked (account, scope, arguments) and will do; `prepare` throws to refuse the call. */
export interface PreparedWrite<T> { summary: string; run: () => Promise<T> }
/** The tool result that makes the Discord host post Confirm/Cancel buttons for the asker. */
export interface PendingWrite { pending: true; confirmationId: string; summary: string; ownConfirmation?: true; note: string }

/**
 * Write confirmation for a skill that confirms internally (`confirmsInternally`). The first call only describes the change and
 * queues it; the host calls the tool again with ctx.confirmed set once the asker pressed Confirm, so `prepare` re-checks
 * everything before `run`. A Trusted member's thread grant runs it straight away unless it needs its own Confirm.
 */
export async function confirmWrite<T>(ctx: SkillContext, req: WriteRequest, prepare: () => PreparedWrite<T> | Promise<PreparedWrite<T>>): Promise<T | PendingWrite> {
  if (req.access === "trusted" && !isTrustedMember(ctx)) throw new Error("This action is limited to Trusted members (Discord ids in TRUSTED_DISCORD_IDS). Tell the user they are not allowed to request it.");
  const { summary, run } = await prepare();
  if (!ctx.botId || !ctx.userId || !ctx.guildId || !ctx.channelId) throw new Error("Write actions need a person to confirm them, which only works in a Discord channel");
  const key = actionKey(req.tool, req.args, ctx);
  if (isDone(key)) throw new Error("That exact action just ran. It was not repeated.");
  if (ctx.confirmed || (!req.ownConfirmation && hasThreadConfirmation(ctx))) {
    const result = await run();
    markDone(key);
    return result;
  }
  const q = queueAction({ tenantId: ctx.tenantId, botId: ctx.botId, userId: ctx.userId, guildId: ctx.guildId, channelId: ctx.channelId, parentChannelId: ctx.parentChannelId, privateThread: ctx.privateThread, tool: req.tool, args: req.args, summary, auth: ctx.auth, ...(req.ownConfirmation ? { ownConfirmation: true } : {}) });
  return req.ownConfirmation
    ? { pending: true, ownConfirmation: true, confirmationId: q.id, summary, note: "Nothing has changed yet. Tell the person who asked to press Confirm or Cancel on the message that appears; a thread grant does not cover this. Do not call this tool again." }
    : { pending: true, confirmationId: q.id, summary, note: "Nothing has changed yet. Tell the user to press Confirm or Cancel on the message that appears in the channel. Do not call this tool again." };
}
