export type Trigger = {
  authorIsBot: boolean;
  guildId: string | null;
  allowedGuildIds: string[];
  mentioned: boolean;
  repliedToBot: boolean;
  inOwnThread: boolean;
  channelId: string;
  alwaysChannelIds: string[];
};

// Why the bot answers; "direct" covers DMs, owned threads and always-on channels (no thread is started for them).
export type Reason = "direct" | "mention" | null;

export function respondReason(t: Trigger): Reason {
  if (t.authorIsBot) return null;
  if (!t.guildId) return "direct";
  if (t.allowedGuildIds.length && !t.allowedGuildIds.includes(t.guildId)) return null;
  if (t.inOwnThread || t.alwaysChannelIds.includes(t.channelId)) return "direct";
  return t.mentioned || t.repliedToBot ? "mention" : null;
}

export function threadName(text: string) {
  return (text.replace(/\s+/g, " ").trim().slice(0, 60) || "Conversation");
}

// Guild conversations are shared by everyone in the channel/thread, so turns carry the speaker.
export function speakerTurn(guildId: string | null, name: string, text: string) {
  return guildId ? `${name}: ${text}` : text;
}
