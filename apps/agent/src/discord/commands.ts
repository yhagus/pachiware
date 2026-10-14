import { playbooksListedIn, type Playbook } from "@pachiware/skills";

export const SLASH_COMMAND = 1; // ApplicationCommandType.ChatInput
export const MESSAGE_COMMAND = 3; // ApplicationCommandType.Message
const STRING_OPTION = 3, ATTACHMENT_OPTION = 11; // ApplicationCommandOptionType
/** Discord's cap on message context-menu commands per scope. */
export const MENU_LIMIT = 15;
/** Discord's cap on a string option, and so on a slash start's text. */
export const SLASH_TEXT_MAX = 6000;
/** What Discord accepts as a slash command name (its rule also allows other lowercase scripts; playbook names use these). */
const SLASH_NAME = /^[a-z0-9_-]{1,32}$/;

type Option = { type: number; name: string; description: string; maxLength?: number };
export type CommandData = { name: string; type: number; description?: string; options?: Option[] };

/** A reference playbook (`start: false`, from #108) is loaded by others and never started by a person. */
export const startable = (playbook: Playbook) => (playbook as { start?: unknown }).start !== false;

const slashCommand = (playbook: Playbook): CommandData => ({
  name: playbook.name, type: SLASH_COMMAND,
  description: (playbook.description.trim() || `Start the ${playbook.name} playbook`).slice(0, 100),
  options: [
    { type: STRING_OPTION, name: "text", description: "What the playbook starts from", maxLength: SLASH_TEXT_MAX },
    { type: ATTACHMENT_OPTION, name: "file", description: "A file for the playbook, as if attached to a message" },
  ],
});

/**
 * Everything one bot offers in one guild, sent there as a single bulk overwrite: a slash command for each listed playbook a person can start,
 * and a message command for each one that names a menu label. A bulk overwrite replaces every command type in its scope, so both go in one list.
 */
export async function guildCommands(place: { tenantId: string; botId: string; guildId: string }, playbooks: Playbook[]): Promise<CommandData[]> {
  const listed = new Set(await playbooksListedIn(place, playbooks.map((p) => p.name)));
  const offered = playbooks.filter((p) => listed.has(p.name) && startable(p));
  const menus = [...new Set(offered.map((p) => p.menu).filter((m): m is string => !!m))].slice(0, MENU_LIMIT);
  return [...offered.filter((p) => SLASH_NAME.test(p.name)).map(slashCommand), ...menus.map((name) => ({ name, type: MESSAGE_COMMAND }))];
}
