/** How a brief's thread shows what its tools did: rounds in place of the model's text, drafts as embeds, created issues as links. */
import type { Client } from "discord.js";
import { readBinding, briefState, draftEmbed, draftsFile, recordDraftMessages, revisionNote, DRAFTS_FILE_NOTE, briefIssuesOf, createdEmbed, issuesReport, batchOutcome, roundMessagesOf, draftsWrittenOf, MESSAGE_LIMIT, type BindingPlace, type ToolResult } from "@pachiware/skills";
import { splitReply, type ReplyPlan } from "./replyStyle.js";
import type { QueuedAction } from "./gitConfirm.js";

type Written = { n: number; note?: string }[];

/** A turn that posted a round or wrote drafts, or null. Its layout is decided in code, so the model's own text does not go out with it. */
export function briefTurn(calls: { call: { name: string }; result: ToolResult }[]): { plan: ReplyPlan; written: Written } | null {
  const round = roundMessagesOf(calls), written = draftsWrittenOf(calls);
  return round.length || written.length ? { plan: { messages: round }, written } : null;
}

/** Posts each written draft as an embed, or edits its embed in place with a one-line note, then refreshes drafts.md. */
export async function showDrafts(tenantId: string, target: any, place: BindingPlace, written: Written) {
  const found = await readBinding(tenantId, place);
  if (!found) return;
  const state = briefState(found.binding), ids: Record<number, string> = {};
  const fetch = (id?: string) => (id ? target.messages.fetch(id).catch(() => null) : null);
  for (const { n, note } of written) {
    const d = state.drafts[n - 1];
    if (!d) continue;
    const embed = draftEmbed(state, found.binding, n), shown = await fetch(d.messageId);
    if (shown) await shown.edit({ embeds: [embed] });
    else ids[n] = (await target.send({ embeds: [embed], allowedMentions: { parse: [] } })).id;
    if (note) await target.send({ content: revisionNote(found.binding, { ...d, messageId: ids[n] ?? d.messageId }, note), allowedMentions: { parse: [] } });
  }
  const file = draftsFile(state, found.binding);
  let fileMessageId: string | undefined;
  if (file) {
    const files = [{ attachment: Buffer.from(file.content), name: file.name }], shown = await fetch(state.draftsFileMessageId);
    if (shown) await shown.edit({ files, attachments: [] });
    else fileMessageId = (await target.send({ content: DRAFTS_FILE_NOTE, files, allowedMentions: { parse: [] } })).id;
  }
  await recordDraftMessages(tenantId, place, ids, fileMessageId);
}

/**
 * After a brief's batch: each created draft's embed becomes its link, and one message lists every link, or what is
 * left after a failure with drafts.md. Returns the confirmation's new text; undefined for any other action.
 */
export async function afterBriefConfirm(client: Client, tenantId: string, action: QueuedAction, result: ToolResult) {
  const batch = briefIssuesOf(action.tool, result);
  if (!batch || !action.parentChannelId) return;
  const thread: any = await client.channels.fetch(action.channelId).catch(() => null);
  if (!thread?.isSendable?.()) return;
  const found = await readBinding(tenantId, { guildId: action.guildId, channelId: action.parentChannelId, threadId: action.channelId }).catch(() => null);
  const state = found && briefState(found.binding);
  for (const c of batch.created) {
    const id = state?.drafts[c.n - 1]?.messageId, shown = id && await thread.messages.fetch(id).catch(() => null);
    if (shown) await shown.edit({ embeds: [createdEmbed(c, batch.language)] }).catch(() => {});
  }
  const file = batch.failed && state ? draftsFile(state, found!.binding, batch.notCreated.map((d) => d.n)) : null;
  const parts = splitReply(issuesReport(batch), MESSAGE_LIMIT);
  for (const [k, content] of parts.entries())
    await thread.send({ content, allowedMentions: { parse: [] }, ...(file && k === parts.length - 1 ? { files: [{ attachment: Buffer.from(file.content), name: file.name }] } : {}) });
  return batchOutcome(batch);
}
