import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { db } from "@pachiware/db";
import { skillRegistry, peekAction, dropAction, takeExpired, payloadIntact, audit, redact } from "@pachiware/skills";

const PREFIX = "gitconfirm";
/** The tool result shape that asks for a person's confirmation (see packages/skills/src/gitConfirm.ts). */
export const pendingOf = (data: any): { confirmationId: string; summary: string } | null =>
  data?.pending === true && typeof data.confirmationId === "string" ? { confirmationId: data.confirmationId, summary: String(data.summary ?? "") } : null;

export function confirmMessage(p: { confirmationId: string; summary: string }, userId: string) {
  const embed = new EmbedBuilder().setTitle("Confirm action").setColor(0xfee75c).setDescription(p.summary.slice(0, 3500)).setFooter({ text: "Only the person who asked can confirm. Expires in 10 minutes." });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}:ok:${p.confirmationId}`).setLabel("Confirm").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}:no:${p.confirmationId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  return { content: `<@${userId}>`, embeds: [embed], components: [row], allowedMentions: { users: [userId] } };
}

// The slice of a discord.js ButtonInteraction this needs, so tests can fake it.
export interface ButtonLike {
  customId: string; user: { id: string };
  reply(o: { content: string; ephemeral: boolean }): Promise<unknown>;
  update(o: { content?: string; embeds: unknown[]; components: unknown[] }): Promise<unknown>;
}
/** Returns true when the click belonged to a confirmation (handled or refused). */
export async function handleConfirmButton(i: ButtonLike, botId: string, discordFor?: (guildId: string) => unknown): Promise<boolean> {
  const [prefix, verb, id] = i.customId.split(":");
  if (prefix !== PREFIX || !id) return false;
  const action = peekAction(id);
  if (!action || action.botId !== botId) { takeExpired(id); await i.update({ embeds: [new EmbedBuilder().setTitle("Action expired").setColor(0x99aab5).setDescription("Ask again if you still want it.")], components: [] }); return true; }
  if (i.user.id !== action.userId) { await i.reply({ content: "Only the person who asked for this can confirm or cancel it.", ephemeral: true }); return true; }
  dropAction(id); // single use: a double click cannot run it twice
  const base = { db, tenantId: action.tenantId, botId: action.botId };
  if (!payloadIntact(action)) { await audit(base, "tool_denied", { tool: action.tool, reason: "payload_changed" }); await i.update({ content: "", embeds: [new EmbedBuilder().setTitle("Action refused").setColor(0xed4245).setDescription("The request changed after it was queued. Ask again.")], components: [] }); return true; }
  if (verb !== "ok") { await i.update({ content: "", embeds: [new EmbedBuilder().setTitle("Action cancelled").setColor(0x99aab5).setDescription(action.summary.slice(0, 3500))], components: [] }); return true; }
  await audit(base, "confirmation_accepted", { tool: action.tool, confirmationId: id });
  const result = await skillRegistry.executeTool({ id: `confirm-${id}`, name: action.tool, arguments: action.args },
    { db, tenantId: action.tenantId, botId: action.botId, guildId: action.guildId, channelId: action.channelId, parentChannelId: action.parentChannelId, userId: action.userId, auth: action.auth, discord: discordFor?.(action.guildId) as any, confirmed: true });
  const detail = redact(result.success ? JSON.stringify(result.data) : String(result.error)).slice(0, 1500);
  await i.update({ content: "", embeds: [new EmbedBuilder().setTitle(result.success ? "Action done" : "Action failed").setColor(result.success ? 0x57f287 : 0xed4245).setDescription(`${action.summary.slice(0, 1800)}\n\n\`\`\`json\n${detail}\n\`\`\``)], components: [] });
  return true;
}
