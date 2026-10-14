import {
  ChannelType,
  type Client,
  type Guild,
  type GuildTextBasedChannel,
  PermissionFlagsBits,
} from "discord.js";
import type { Message } from "discord.js";
import {
  type ChannelHistory,
  type DiscordClientAdapter,
  type DiscordChannelInfo,
  type DiscordMemberInfo,
  type DiscordMessageInfo,
  type Language,
  type PostAccess,
  listOf,
  now as clockNow,
  permissionName,
  textIn,
} from "@pachiware/skills";

/** One message of a channel's history, as minutes need it. */
export interface HistoryMessage {
  id: string;
  /** Where the message lives; a thread's starter message sits in the parent channel. */
  channelId: string;
  at: number;
  authorId: string;
  speaker: string;
  own: boolean;
  text: string;
  replyTo?: string;
  /** Placeholders such as "image: chart.png"; attachment contents are never read. */
  attachments: string[];
}
/** Where the stretch to read starts: a message (inclusive), a time, or neither for a whole thread. */
export type HistoryRange = { startId?: string; since?: number; skipIds?: string[] };
/** Why the read stopped before the start of the range, and the oldest time it kept. */
export type HistoryCut = { reason: "count" | "time"; keptFrom: number };
export type HistoryAccess = { ok: true } | { ok: false; who: "requester" | "bot"; missing: string[] } | { ok: false; who: "dm" };

export const HISTORY_PAGE = 100;
export const HISTORY_PAGES = 5;
export const HISTORY_SPAN_MS = 24 * 3600_000;
const READ_HISTORY = ["ViewChannel", "ReadMessageHistory"];
const IMAGE = /\.(png|jpe?g|gif|webp|avif|heic)$/i;

export const stamp = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
/** History as the model reads it, one numbered line per message: time, speaker, what it replied to, text, attachment placeholders. */
export function transcript(messages: HistoryMessage[]) {
  const number = new Map(messages.map((m, i) => [m.id, i + 1]));
  return messages.map((m, i) => {
    const reply = m.replyTo && number.has(m.replyTo) ? ` (reply to [${number.get(m.replyTo)}])` : "";
    const files = m.attachments.map((a) => ` [${a}]`).join("");
    return `[${i + 1}] ${stamp(m.at)} ${m.speaker}${m.own ? " (this bot)" : ""}${reply}: ${m.text}${files}`;
  }).join("\n");
}

const memberInfo = (m: any, guildId: string): DiscordMemberInfo => ({
  id: m.id,
  displayName: m.displayName ?? m.user?.globalName ?? m.user?.username ?? m.id,
  username: m.user?.username,
  roles: [...(m.roles?.cache?.values() ?? [])].filter((r: any) => r.id !== guildId).map((r: any) => r.name),
});

export class DiscordJSAdapter implements DiscordClientAdapter {
  constructor(private client: Client, private guildId?: string) {}

  private async getGuild(): Promise<Guild> {
    if (this.guildId) {
      const g = await this.client.guilds.fetch(this.guildId).catch(() => null);
      if (g) return g;
      throw new Error("Configured Discord guild is unavailable to this bot.");
    }

    const firstGuild = this.client.guilds.cache.first();
    if (!firstGuild) {
      throw new Error("Discord client is not connected to any guild/server.");
    }
    return firstGuild;
  }

  async createChannel(args: {
    channelName: string;
    type?: "text" | "voice" | "announcement";
    topic?: string;
    categoryName?: string;
  }): Promise<{ id: string; name: string; type: string; category?: string }> {
    const guild = await this.getGuild();

    let channelType = ChannelType.GuildText;
    if (args.type === "voice") channelType = ChannelType.GuildVoice;
    else if (args.type === "announcement") channelType = ChannelType.GuildAnnouncement;

    // Optional category lookup
    let parentId: string | undefined;
    if (args.categoryName) {
      const category = guild.channels.cache.find(
        (c) =>
          c.type === ChannelType.GuildCategory &&
          c.name.toLowerCase() === args.categoryName?.toLowerCase()
      );
      if (category) {
        parentId = category.id;
      }
    }

    const sanitizedName = args.channelName
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/g, "");

    const channel = await guild.channels.create({
      name: sanitizedName,
      type: channelType as any,
      topic: args.topic,
      parent: parentId,
    });

    return {
      id: channel.id,
      name: channel.name,
      type: args.type || "text",
      category: args.categoryName,
    };
  }

  async archiveChannel(args: {
    channelId: string;
    reason?: string;
  }): Promise<{ id: string; archived: boolean; message: string }> {
    const guild = await this.getGuild();
    const channel = await guild.channels.fetch(args.channelId).catch(() => null);

    if (!channel || !channel.isTextBased() || !("permissionOverwrites" in channel)) {
      throw new Error(`Channel "${args.channelId}" was not found or is not a text channel.`);
    }

    // Archive by making channel read-only for @everyone
    await channel.permissionOverwrites.edit(
      guild.roles.everyone,
      {
        SendMessages: false,
        AddReactions: false,
      },
      { reason: args.reason || "Archived by Pachiware Agent" }
    );

    return {
      id: channel.id,
      archived: true,
      message: `Channel #${channel.name} has been set to read-only (archived).`,
    };
  }

  async listChannels(args?: {
    filterType?: "text" | "voice" | "category" | "all";
  }): Promise<DiscordChannelInfo[]> {
    const guild = await this.getGuild();
    const channels = await guild.channels.fetch();

    const result: DiscordChannelInfo[] = [];

    for (const [id, c] of channels) {
      if (!c) continue;

      let typeStr = "other";
      if (c.type === ChannelType.GuildText) typeStr = "text";
      else if (c.type === ChannelType.GuildVoice) typeStr = "voice";
      else if (c.type === ChannelType.GuildCategory) typeStr = "category";
      else if (c.type === ChannelType.GuildAnnouncement) typeStr = "announcement";

      if (args?.filterType && args.filterType !== "all" && args.filterType !== typeStr) {
        continue;
      }

      result.push({
        id,
        name: c.name,
        type: typeStr,
        topic: (c as any).topic || null,
        category: c.parent?.name || null,
      });
    }

    return result;
  }

  async setChannelTopic(args: {
    channelId: string;
    topic: string;
  }): Promise<{ id: string; topic: string; success: boolean }> {
    const guild = await this.getGuild();
    const channel = await guild.channels.fetch(args.channelId).catch(() => null);

    if (!channel || !("setTopic" in channel)) {
      throw new Error(`Channel "${args.channelId}" does not support setting a topic.`);
    }

    await (channel as any).setTopic(args.topic);

    return {
      id: channel.id,
      topic: args.topic,
      success: true,
    };
  }

  async pinMessage(args: { channelId: string; messageId: string }): Promise<{ id: string; channelId: string }> {
    const channel: any = await this.client.channels.fetch(args.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) throw new Error(`Channel "${args.channelId}" was not found or is not a text channel.`);
    const message = await channel.messages.fetch(args.messageId).catch(() => null);
    if (!message) throw new Error(`Message "${args.messageId}" was not found in that channel.`);
    await message.pin();
    return { id: message.id, channelId: channel.id };
  }

  async listMembers(args: { query: string; limit: number }): Promise<DiscordMemberInfo[]> {
    const guild = await this.getGuild();
    const found = await guild.members.search({ query: args.query, limit: args.limit });
    return [...found.values()].map((m: any) => memberInfo(m, guild.id));
  }

  async getMember(userId: string): Promise<DiscordMemberInfo | null> {
    const guild = await this.getGuild();
    const m = await guild.members.fetch(userId).catch(() => null);
    return m ? memberInfo(m, guild.id) : null;
  }

  /** A text channel or thread of this guild that both the bot and the requester are allowed to see and post in. */
  async postAccess(channelId: string, requesterId: string): Promise<PostAccess> {
    const channel: any = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.guild || channel.isDMBased?.() || !channel.isTextBased?.() || (this.guildId && channel.guildId !== this.guildId)) return { ok: false, who: "unknown", missing: [] };
    const [member, me] = await Promise.all([requesterId, this.client.user?.id ?? ""].map((id) => channel.guild.members.fetch(id).catch(() => null)));
    const missingFor = (who: unknown, needs: string[]): string[] => (who && channel.permissionsFor(who)?.missing(needs)) ?? needs;
    const inThread = channel.type !== ChannelType.PrivateThread || await channel.members.fetch(requesterId).then(() => true, () => false);
    const requesterMissing = missingFor(member, ["ViewChannel"]);
    if (requesterMissing.length || !inThread) return { ok: false, who: "requester", missing: requesterMissing };
    const botMissing = missingFor(me, ["ViewChannel", channel.isThread() ? "SendMessagesInThreads" : "SendMessages"]);
    return botMissing.length ? { ok: false, who: "bot", missing: botMissing } : { ok: true };
  }

  async sendMessage(args: { channelId: string; content: string }): Promise<{ id: string; channelId: string; url: string }> {
    const channel: any = await this.client.channels.fetch(args.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) throw new Error(`Channel "${args.channelId}" was not found or is not a text channel.`);
    const posted = await channel.send({ content: args.content, allowedMentions: { parse: [] } });
    return { id: posted.id, channelId: posted.channelId ?? channel.id, url: posted.url };
  }

  async fetchMessage(args: { channelId: string; messageId: string }): Promise<DiscordMessageInfo | null> {
    const channel: any = await this.client.channels.fetch(args.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return null;
    const message = await channel.messages.fetch(args.messageId).catch(() => null);
    if (!message) return null;
    return {
      id: message.id, channelId: message.channelId ?? channel.id, authorId: message.author?.id ?? "",
      attachments: [...(message.attachments?.values() ?? [])].map((a: any) => ({ id: a.id, name: a.name ?? "attachment", url: a.url, size: a.size ?? 0, contentType: a.contentType ?? null })),
    };
  }

  /** Checks a requester may read a channel's history and the bot may read it and post minutes there. */
  async historyAccess(channelId: string, requesterId: string): Promise<HistoryAccess> {
    const channel: any = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.guild || channel.isDMBased?.()) return { ok: false, who: "dm" };
    const [member, me] = await Promise.all([requesterId, this.client.user?.id ?? ""].map((id) => channel.guild.members.fetch(id).catch(() => null)));
    const missingFor = (who: unknown, needs: string[]): string[] => (who && channel.permissionsFor(who)?.missing(needs)) ?? needs;
    const requesterMissing = missingFor(member, READ_HISTORY);
    // Seeing a private thread's parent is not enough: the requester must have been added to the thread.
    const inThread = channel.type !== ChannelType.PrivateThread || await channel.members.fetch(requesterId).then(() => true, () => false);
    if (requesterMissing.length || !inThread) return { ok: false, who: "requester", missing: requesterMissing };
    const botMissing = missingFor(me, [...READ_HISTORY, channel.isThread() ? "SendMessagesInThreads" : "SendMessages", "EmbedLinks"]);
    return botMissing.length ? { ok: false, who: "bot", missing: botMissing } : { ok: true };
  }

  /**
   * Reads a channel or thread backwards, 100 messages per call, at most 5 calls and 24 hours back.
   * Other bots and system messages are skipped; a whole thread includes its starter message.
   */
  async readHistory(channelId: string, range: HistoryRange = {}, now = clockNow()): Promise<{ messages: HistoryMessage[]; cut: HistoryCut | null }> {
    const channel: any = await this.client.channels.fetch(channelId);
    const inRange = (m: Message) => (!range.startId || BigInt(m.id) >= BigInt(range.startId)) && m.createdTimestamp >= (range.since ?? 0);
    const read: Message[] = [];
    let before: string | undefined, cut: HistoryCut | null = null, done = false;
    for (let page = 0; page < HISTORY_PAGES && !done; page++) {
      const batch: Message[] = [...(await channel.messages.fetch({ limit: HISTORY_PAGE, before, cache: false })).values()];
      for (const m of batch) {
        if (!inRange(m)) { done = true; break; }
        if (m.createdTimestamp < now - HISTORY_SPAN_MS) { done = true; cut = { reason: "time", keptFrom: now - HISTORY_SPAN_MS }; break; }
        read.push(m);
      }
      if (batch.length < HISTORY_PAGE) done = true;
      before = batch.at(-1)?.id;
    }
    if (!done) cut = { reason: "count", keptFrom: read.at(-1)?.createdTimestamp ?? now };
    if (!cut && channel.isThread() && !range.startId && !range.since) {
      const starter = await channel.fetchStarterMessage?.().catch(() => null);
      if (starter && !read.some((m) => m.id === starter.id)) read.push(starter);
    }
    const botId = this.client.user?.id;
    const messages = read.reverse()
      .filter((m) => !m.system && !(m.author.bot && m.author.id !== botId) && !range.skipIds?.includes(m.id))
      .map((m) => historyMessage(m, botId))
      .filter((m) => m.text || m.attachments.length);
    return { messages, cut };
  }

  async readChannelHistory(args: { channelId: string; requesterId: string; since?: string; limit?: number; language?: Language }, now = clockNow()): Promise<ChannelHistory> {
    const t = textIn(args.language);
    if (!(await this.client.channels.fetch(args.channelId).catch(() => null))) throw new Error(t.historyNoChannel);
    const access = await this.historyAccess(args.channelId, args.requesterId);
    if (!access.ok) {
      if (access.who === "dm") throw new Error(t.historyDm);
      const names = listOf(access.missing.map(permissionName), args.language);
      if (access.who === "requester") throw new Error(access.missing.length ? t.historyNeedPermission(names) : t.historyNotMember);
      throw new Error(t.historyBotMissing(names, access.missing.length > 1));
    }
    const since = args.since === undefined ? undefined : Date.parse(args.since);
    if (since !== undefined && Number.isNaN(since)) throw new Error("since must be an ISO 8601 date-time");
    const most = HISTORY_PAGE * HISTORY_PAGES;
    const limit = Math.min(Math.max(1, Math.floor(args.limit ?? most)), most);
    const { messages, cut } = await this.readHistory(args.channelId, since === undefined ? {} : { since }, now);
    const kept = messages.slice(-limit);
    const when = (at: number) => `${stamp(at)} UTC`;
    const note = kept.length < messages.length ? t.minutesCutCount(limit, when(kept[0]!.at))
      : cut?.reason === "count" ? t.minutesCutCount(most, when(cut.keptFrom))
      : cut ? t.minutesCutHours(HISTORY_SPAN_MS / 3600_000, when(cut.keptFrom)) : undefined;
    return { channelId: args.channelId, count: kept.length, from: kept[0] ? stamp(kept[0].at) : null, to: kept.at(-1) ? stamp(kept.at(-1)!.at) : null, transcript: transcript(kept), ...(note ? { note } : {}) };
  }
}

function historyMessage(m: Message, botId?: string): HistoryMessage {
  // Mentions read as names so the minutes can name owners; people not in the cache keep the raw mention.
  const text = (m.content ?? "").replace(/<@!?(\d+)>/g, (raw, id) => {
    const name = (m.mentions?.members as any)?.get?.(id)?.displayName ?? m.mentions?.users?.get(id)?.globalName ?? m.mentions?.users?.get(id)?.username;
    return name ? `@${name}` : raw;
  }).trim() || (m.embeds?.[0]?.title ? `[embed: ${m.embeds[0].title}]` : "");
  return {
    id: m.id, channelId: m.channelId, at: m.createdTimestamp, authorId: m.author.id,
    speaker: m.member?.displayName || m.author.globalName || m.author.username,
    own: m.author.id === botId, text,
    replyTo: m.reference?.messageId ?? undefined,
    attachments: [...(m.attachments?.values() ?? [])].map((a: any) => `${a.contentType?.startsWith("image/") || IMAGE.test(a.name ?? "") ? "image" : "file"}: ${a.name ?? "attachment"}`),
  };
}
