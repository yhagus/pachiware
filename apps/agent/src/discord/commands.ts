import { playbooksListedIn, type Playbook } from "@pachiware/skills";

export const MESSAGE_COMMAND = 3; // ApplicationCommandType.Message
/** Discord's cap on message context-menu commands per scope. */
export const MENU_LIMIT = 15;

export type CommandData = { name: string; type: number };

/**
 * Everything one bot offers in one guild, sent there as a single bulk overwrite: a message command for each listed playbook that names a menu label.
 * A bulk overwrite replaces every command type in its scope, so slash commands belong in this same list.
 */
export async function guildCommands(place: { tenantId: string; botId: string; guildId: string }, playbooks: Playbook[]): Promise<CommandData[]> {
  const listed = new Set(await playbooksListedIn(place, playbooks));
  const menus = [...new Set(playbooks.filter((p) => listed.has(p.name)).map((p) => p.menu).filter((m): m is string => !!m))].slice(0, MENU_LIMIT);
  return menus.map((name) => ({ name, type: MESSAGE_COMMAND }));
}
