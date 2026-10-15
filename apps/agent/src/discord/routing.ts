import { ChannelType } from "discord.js";

export type Trigger = {
  authorIsBot: boolean;
  guildId: string | null;
  allowedGuildIds: string[];
  mentioned: boolean;
  repliedToBot: boolean;
  inOwnThread: boolean;
  channelId: string;
  alwaysChannelIds: string[];
  lastMessageFromBot: boolean;
  addressesOthers: boolean;
};

// Why the bot answers; "direct" covers DMs, owned threads and always-on channels (no thread is started for them).
export type Reason = "direct" | "mention" | null;

export function respondReason(t: Trigger): Reason {
  if (t.authorIsBot) return null;
  if (!t.guildId) return "direct";
  if (t.allowedGuildIds.length && !t.allowedGuildIds.includes(t.guildId)) return null;
  const always = t.alwaysChannelIds.includes(t.channelId);
  if (t.inOwnThread || always) {
    if (t.mentioned || t.repliedToBot) return "direct";
    if (t.addressesOthers) return null;
    // Threads are shared with humans, so only a follow-up to the bot's own message counts; always-on channels answer everything not aimed elsewhere.
    return always || t.lastMessageFromBot ? "direct" : null;
  }
  return t.mentioned || t.repliedToBot ? "mention" : null;
}

/** A mention, a reply to the bot, or a DM: these always get a response, never silence. */
export function addressed(t: Pick<Trigger, "guildId" | "mentioned" | "repliedToBot">) {
  return !t.guildId || t.mentioned || t.repliedToBot;
}

export function threadName(text: string) {
  return (text.replace(/\s+/g, " ").trim().slice(0, 60) || "Conversation");
}

/** Where a channel keeps things: a thread names its parent, and a private thread also keeps its own folder (ADR 0009). */
export function placeOfChannel(channel: { id: string; type: number; parentId?: string | null; isThread(): boolean }) {
  const thread = channel.isThread();
  return { channelId: channel.id, parentChannelId: thread ? channel.parentId ?? undefined : undefined, privateThread: thread && channel.type === ChannelType.PrivateThread ? true : undefined };
}

/** The name someone goes by here: their server nickname, else their username. */
export const speakerName = (m: { member?: { displayName?: string } | null; author?: { username: string } | null }) => m.member?.displayName || m.author?.username || "";

/**
 * `text` without the bot's own mention (`<@id>` or `<@!id>`) and the spaces around it; a mention between words leaves one space.
 * Everything else stays as written, so a message kept as a Note reads as the person wrote it.
 */
export function withoutMention(text: string, botUserId: string | undefined) {
  if (!botUserId) return text;
  return text.replace(new RegExp(`[ \\t]*<@!?${botUserId}>[ \\t]*`, "g"), (match, at: number) => {
    const end = at + match.length;
    return at === 0 || text[at - 1] === "\n" || end === text.length || text[end] === "\n" ? "" : " ";
  });
}

/** Text longer than this is too long for the model to copy into a tool call, so its turn line names the message for keepAsNote. */
export const LONG_TEXT = 2000;

/** The message id a turn line shows for `text`: only for long text, which keepAsNote keeps by id. */
export const keepableId = (text: string, messageId: string) => (text.length > LONG_TEXT ? messageId : undefined);

// Guild conversations are shared by everyone in the channel/thread, so turns carry the speaker.
export function speakerTurn(guildId: string | null, name: string, text: string, messageId?: string) {
  const ref = messageId ? `(message ${messageId})` : "";
  if (!guildId) return ref ? `${ref}: ${text}` : text;
  return `${ref ? `${name} ${ref}` : name}: ${text}`;
}

// Emoji, stickers-as-text, punctuation and whitespace alone carry nothing to answer.
export function isNoise(text: string, hasAttachments = false) {
  if (hasAttachments) return false;
  return !text.replace(/<a?:\w+:\d+>|\p{Extended_Pictographic}|\p{Emoji_Modifier}|[\u200d\ufe0f]|[\s\p{P}\p{S}]/gu, "");
}
