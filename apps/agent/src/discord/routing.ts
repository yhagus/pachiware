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

/** How much of a replied-to message its line quotes; a longer one is also named by id, so keepAsNote can keep it whole. */
export const REPLY_QUOTE = 500;

type Replied = { id: string; content: string; author: { id: string; username: string }; member?: { displayName?: string } | null; embeds?: { title?: string | null; description?: string | null }[] };

/**
 * The line before a turn line saying what it replies to: `(replying to Bob: "...")`, or `(replying to you: "...")` for the bot's own
 * message, quoted on one line and clipped. A message posted as embeds alone, such as Minutes, is quoted by their titles and
 * descriptions (#245). Empty for a message that could not be fetched or has no text.
 */
export function replyLine(ref: Replied | null | undefined, botUserId: string | undefined) {
  const content = ref ? withoutMention(ref.content, botUserId).trim() : "";
  const text = content || (ref?.embeds ?? []).flatMap((e) => [e.title, e.description]).filter(Boolean).join("\n").trim();
  if (!ref || !text) return "";
  const who = ref.author.id === botUserId ? "you" : speakerName(ref);
  // keepAsNote keeps a message's own text, so only long content names the message.
  const id = keepableId(content, ref.id);
  const flat = text.replace(/\s+/g, " ");
  const quote = flat.length > REPLY_QUOTE ? `${flat.slice(0, REPLY_QUOTE)}…` : flat;
  return `(replying to ${id ? `${who} (message ${id})` : who}: "${quote}")`;
}

/** Words a short request may hold around an in-place playbook's trigger word, in Indonesian and English. */
const REQUEST_WORDS = new Set(("tolong minta mohon bikin bikinin buat buatin buatkan tulis tulisin tuliskan catat catatin catatkan dong donk ya yah yuk ayo deh sih nih "
  + "rapat tadi ini please pls plz can could you make write take do draft the a some now of this for meeting call").split(" "));

/**
 * The one word of a short request that is not a request word, as in "notulen dong" or "tolong bikinin notulen ya!" (#245), where
 * an in-place playbook's trigger word stands without the colon a trigger needs; null for anything else.
 */
export function requestedWord(text: string): string | null {
  const words = text.toLowerCase().replace(/[.,!?]+/g, " ").split(/\s+/).filter(Boolean);
  const others = words.filter((w) => !REQUEST_WORDS.has(w));
  return words.length <= 6 && others.length === 1 ? others[0]! : null;
}

// Emoji, stickers-as-text, punctuation and whitespace alone carry nothing to answer.
export function isNoise(text: string, hasAttachments = false) {
  if (hasAttachments) return false;
  return !text.replace(/<a?:\w+:\d+>|\p{Extended_Pictographic}|\p{Emoji_Modifier}|[\u200d\ufe0f]|[\s\p{P}\p{S}]/gu, "");
}
