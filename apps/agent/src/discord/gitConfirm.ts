import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { db } from "@pachiware/db";
import { skillRegistry, peekAction, dropAction, takeExpired, payloadIntact, audit, redact } from "@pachiware/skills";
import { grantThreadApproval, isThreadApprovalOwner } from "@pachiware/skills";

const PREFIX = "gitconfirm";
/** The tool result shape that asks for a person's confirmation (see packages/skills/src/gitConfirm.ts). */
export const pendingOf = (data: any): { confirmationId: string; summary: string } | null =>
  data?.pending === true && typeof data.confirmationId === "string" ? { confirmationId: data.confirmationId, summary: String(data.summary ?? "") } : null;

export function confirmMessage(p: { confirmationId: string; summary: string }, userId: string) {
  const embed = new EmbedBuilder().setTitle("Sensitive action waiting").setColor(0xfee75c).setDescription(p.summary.slice(0, 3500)).setFooter({ text: "Confirm this action, or approve sensitive actions for this thread. Expires in 10 minutes." });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:ok:${p.confirmationId}`).setLabel("Confirm").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:no:${p.confirmationId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}:grant:${p.confirmationId}`).setLabel("Approve thread").setStyle(ButtonStyle.Primary),
  );
  return { content: `<@${userId}>`, embeds: [embed], components: [row], allowedMentions: { users: [userId] } };
}

// The slice of a discord.js ButtonInteraction this needs, so tests can fake it.
export interface ButtonLike {
  customId: string; user: { id: string }; channelId?: string; guildId?: string | null;
  reply(o: { content: string; ephemeral: boolean }): Promise<unknown>;
  update(o: { content?: string; embeds?: unknown[]; components: unknown[] }): Promise<unknown>;
}

const actionContext = (action: NonNullable<ReturnType<typeof peekAction>>) => ({
  db, tenantId: action.tenantId, botId: action.botId, guildId: action.guildId, channelId: action.channelId,
  parentChannelId: action.parentChannelId, userId: action.userId, auth: action.auth,
});

function resultText(summary: string, success: boolean, detail: string) {
  const status = success ? "Completed" : "I couldn't complete that";
  return `${summary.slice(0, 700)}\n\n${status}.\n${detail.slice(0, 1100)}`.slice(0, 1900);
}
/** Returns true when the click belonged to a confirmation (handled or refused). */
export async function handleConfirmButton(i: ButtonLike, botId: string, discordFor?: (guildId: string) => unknown): Promise<boolean> {
  const [prefix, verb, id] = i.customId.split(":");
  if (prefix !== PREFIX || !id) return false;
  const action = peekAction(id);
  if (!action || action.botId !== botId) { takeExpired(id); await i.update({ content: "That request has expired. Ask again if you still want it.", components: [] }); return true; }
  if (verb === "grant") {
    if ((i.channelId && i.channelId !== action.channelId) || (i.guildId && i.guildId !== action.guildId)) {
      await i.reply({ content: "This approval belongs to a different conversation. Ask again in the current thread.", ephemeral: true }); return true;
    }
    if (!isThreadApprovalOwner({ userId: i.user.id })) { await audit(actionContext(action), "thread_approval_denied", { tool: action.tool, reason: "not_owner" }); await i.reply({ content: "Only a configured owner can approve sensitive actions for this thread.", ephemeral: true }); return true; }
    if (!payloadIntact(action)) { await audit(actionContext(action), "thread_approval_denied", { tool: action.tool, reason: "payload_changed" }); await i.update({ content: "The request changed before approval. Ask again in this thread.", components: [] }); return true; }
    if (!grantThreadApproval({ ...actionContext(action), userId: i.user.id })) { await audit(actionContext(action), "thread_approval_denied", { tool: action.tool, reason: "context_mismatch" }); await i.reply({ content: "This approval belongs to a different conversation. Ask again in the current thread.", ephemeral: true }); return true; }
    dropAction(id);
    await audit(actionContext(action), "thread_approval_granted", { tool: action.tool, confirmationId: id });
    await audit(actionContext(action), "confirmation_accepted", { tool: action.tool, confirmationId: id, kind: "thread_grant" });
    const result = await skillRegistry.executeTool({ id: `confirm-${id}`, name: action.tool, arguments: action.args },
      { ...actionContext(action), discord: discordFor?.(action.guildId) as any, confirmed: true });
    const detail = redact(result.success ? JSON.stringify(result.data) : String(result.error)).slice(0, 1500);
    await i.update({ content: result.success ? `Approved for this thread.\n${resultText(action.summary, true, detail)}` : `Thread approval was granted, but the action failed.\n${resultText(action.summary, false, detail)}`, components: [] });
    return true;
  }
  if (i.user.id !== action.userId) { await i.reply({ content: "Only the person who asked for this can confirm or cancel it.", ephemeral: true }); return true; }
  dropAction(id); // single use: a double click cannot run it twice
  const base = { db, tenantId: action.tenantId, botId: action.botId };
  if (!payloadIntact(action)) { await audit(base, "tool_denied", { tool: action.tool, reason: "payload_changed" }); await i.update({ content: "I couldn't run that because the request changed after it was queued. Ask again.", components: [] }); return true; }
  if (verb !== "ok") { await i.update({ content: `Cancelled: ${action.summary.slice(0, 1800)}`, components: [] }); return true; }
  await audit(base, "confirmation_accepted", { tool: action.tool, confirmationId: id });
  const result = await skillRegistry.executeTool({ id: `confirm-${id}`, name: action.tool, arguments: action.args },
    { db, tenantId: action.tenantId, botId: action.botId, guildId: action.guildId, channelId: action.channelId, parentChannelId: action.parentChannelId, userId: action.userId, auth: action.auth, discord: discordFor?.(action.guildId) as any, confirmed: true });
  const detail = redact(result.success ? JSON.stringify(result.data) : String(result.error)).slice(0, 1500);
  await i.update({ content: resultText(action.summary, result.success, detail), components: [] });
  return true;
}
