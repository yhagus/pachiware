import { playbooksOffAbove, type AvailabilityLevel, type Playbook } from "@pachiware/skills";

export const SLASH_COMMAND = 1; // ApplicationCommandType.ChatInput
export const MESSAGE_COMMAND = 3; // ApplicationCommandType.Message
const STRING_OPTION = 3, ATTACHMENT_OPTION = 11; // ApplicationCommandOptionType
/** Discord's cap on message context-menu commands per scope. */
export const MENU_LIMIT = 15;
/** Discord's cap on a string option, and so on a slash start's text. */
export const SLASH_TEXT_MAX = 6000;
/** What Discord accepts as a slash command name (its rule also allows other lowercase scripts; playbook names use these). */
const SLASH_NAME = /^[a-z0-9_-]{1,32}$/;
export const slashNameUsable = (name: string) => SLASH_NAME.test(name);

type Option = { type: number; name: string; description: string; maxLength?: number };
export type CommandData = { name: string; type: number; description?: string; options?: Option[] };

const slashCommand = (playbook: Playbook): CommandData => ({
  name: playbook.name, type: SLASH_COMMAND,
  description: (playbook.description.trim() || `Start the ${playbook.name} playbook`).slice(0, 100),
  options: [
    { type: STRING_OPTION, name: "text", description: "What the playbook starts from", maxLength: SLASH_TEXT_MAX },
    { type: ATTACHMENT_OPTION, name: "file", description: "A file for the playbook, as if attached to a message" },
  ],
});

type GuildPlace = { tenantId: string; botId: string; guildId: string };

/** Whether a playbook has a slash command in a guild, and if not, why: it is a reference, Discord cannot use its name, or a level above the channel turns it off. */
export type SlashStatus = { playbook: string } & (
  | { status: "registered" }
  | { status: "not_registered"; reason: "reference" }
  | { status: "not_registered"; reason: "off"; level: AvailabilityLevel }
  | { status: "name_unusable" }
);

/** Each playbook's standing in one guild: whether the guild offers it (its menu counts then) and its slash status. */
async function guildOffer(place: GuildPlace, playbooks: Playbook[]) {
  const offAt = await playbooksOffAbove(place, playbooks);
  return playbooks.map((p) => {
    const off = offAt.get(p.name), playbook = p.name;
    const status: SlashStatus = !p.start ? { playbook, status: "not_registered", reason: "reference" }
      : !slashNameUsable(p.name) ? { playbook, status: "name_unusable" }
      : off ? { playbook, status: "not_registered", reason: "off", level: off }
      : { playbook, status: "registered" };
    return { playbook: p, offered: p.start && !off, status };
  });
}

/** The slash status of every playbook in one guild, from the same walk that builds the guild's command list. */
export async function guildSlashStatus(place: GuildPlace, playbooks: Playbook[]): Promise<SlashStatus[]> {
  return (await guildOffer(place, playbooks)).map((o) => o.status);
}

/**
 * Everything one bot offers in one guild, sent there as a single bulk overwrite: a slash command for each listed playbook a person can start whose name Discord accepts,
 * and a message command for each one that names a menu label. A bulk overwrite replaces every command type in its scope, so both go in one list.
 */
export async function guildCommands(place: GuildPlace, playbooks: Playbook[]): Promise<CommandData[]> {
  const offer = await guildOffer(place, playbooks);
  const menus = [...new Set(offer.filter((o) => o.offered).map((o) => o.playbook.menu).filter((m): m is string => !!m))].slice(0, MENU_LIMIT);
  return [...offer.filter((o) => o.status.status === "registered").map((o) => slashCommand(o.playbook)), ...menus.map((name) => ({ name, type: MESSAGE_COMMAND }))];
}
