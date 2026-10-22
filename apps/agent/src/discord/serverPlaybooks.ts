import { skillRegistry, availabilityPlace, listPlaybooks, replyLanguage, textIn, SAVE_PLAYBOOK, DELETE_PLAYBOOK, type PlaybookCause, type Strings, type ToolResult } from "@pachiware/skills";
import { guildSlashStatus } from "./commands.js";
import type { QueuedAction } from "./gitConfirm.js";

/** Why a playbook cannot start, in the words people read. */
export function causeText(t: Strings, playbook: string, cause: PlaybookCause): string {
  switch (cause.off) {
    case "playbook": return t.playbookOff(playbook);
    case "loads": return t.loadsOff(playbook, cause.playbook);
    case "chain": return t.chainBroken(playbook, cause.problem);
    case "skills": return t.skillsOff(playbook, cause.skills.map((id) => skillRegistry.getAllSkills().find((s) => s.id === id)?.name ?? id));
  }
}

/**
 * What a confirmed save or delete of a server's own playbook says in place of the card (ADR 0021): how to start it, or why it cannot start
 * in this channel, or has no slash command here. In the card's language, since the confirmed run has no message to tell it by.
 */
export async function playbookReport(action: QueuedAction, result: ToolResult): Promise<string | undefined> {
  if (!result.success || (action.tool !== SAVE_PLAYBOOK && action.tool !== DELETE_PLAYBOOK)) return undefined;
  const t = textIn(replyLanguage(action.summary)), name = String(result.data?.name ?? "");
  if (action.tool === DELETE_PLAYBOOK) return t.playbookDeleted(name);
  const words: string[] = Array.isArray(result.data?.words) ? result.data.words : [];
  const playbooks = await listPlaybooks(action.tenantId, action.guildId);
  const cause = (await skillRegistry.availableAt(availabilityPlace(action), playbooks)).playbookCause(name);
  const status = (await guildSlashStatus({ tenantId: action.tenantId, botId: action.botId, guildId: action.guildId }, playbooks)).find((s) => s.playbook === name);
  return [
    result.data?.created ? t.playbookSaved(name, words) : t.playbookChanged(name),
    ...(cause ? [causeText(t, name, cause)] : status?.status === "not_registered" && status.reason === "limit" ? [t.playbookNoSlash] : []),
  ].join("\n");
}
