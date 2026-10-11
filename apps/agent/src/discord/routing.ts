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

// Guild conversations are shared by everyone in the channel/thread, so turns carry the speaker.
export function speakerTurn(guildId: string | null, name: string, text: string) {
  return guildId ? `${name}: ${text}` : text;
}

// Emoji, stickers-as-text, punctuation and whitespace alone carry nothing to answer.
export function isNoise(text: string, hasAttachments = false) {
  if (hasAttachments) return false;
  return !text.replace(/<a?:\w+:\d+>|\p{Extended_Pictographic}|\p{Emoji_Modifier}|[\u200d\ufe0f]|[\s\p{P}\p{S}]/gu, "");
}
