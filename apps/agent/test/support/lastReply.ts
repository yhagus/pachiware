import type { FakeMessage } from "./discordScenario";

/** The bot's latest message that is not a card it posts after a turn (a schedule's): its reply, or what the scheduler posted. */
export const lastReply = (s: { discord: { botMessages: FakeMessage[] } }) => s.discord.botMessages.filter((m) => !m.embeds.length).at(-1)!;
