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
  type ChannelView,
  type DiscordClientAdapter,
  type FoundChannel,
  type DiscordChannelInfo,
  type DiscordMemberInfo,
  type DiscordMessageInfo,
  type Language,
  type LinkedMessage,
  type PostAccess,
  listOf,
  now as clockNow,
  permissionName,
  textIn,
} from "@pachiware/skills";
import { speakerName, withoutMention } from "./routing.js";

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
/** Why reading stopped early; `limit` is how many messages a count cut stopped at, when not the usual 500. */
export type HistoryCut = { reason: "count" | "time"; keptFrom: number; limit?: number };
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

const PROJECT_CHANNELS = new Set<number>([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

export class DiscordJSAdapter implements DiscordClientAdapter {
  /** `allowedGuildIds`: the guilds this bot serves (empty = every guild it is in); channel lookups by name stay inside them. */
  constructor(private client: Client, private guildId?: string, private allowedGuildIds: string[] = []) {}

  forGuild(guildId: string): DiscordClientAdapter {
    return new DiscordJSAdapter(this.client, guildId, this.allowedGuildIds);
  }

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

  /** Whether a user may see into `channel` as a thread member: always for anything but a private thread, which they must have been added to. */
  private inThread(channel: any, userId: string): Promise<boolean> {
    return channel.type !== ChannelType.PrivateThread ? Promise.resolve(true) : channel.members.fetch(userId).then(() => true, () => false);
  }

  /** The guild's member with this user id, or null when they are not in it (fetching a non-member throws). */
  private memberOf(guild: any, userId: string): Promise<any | null> {
    return guild.members.fetch(userId).catch(() => null);
  }

  async getMember(userId: string): Promise<DiscordMemberInfo | null> {
    const guild = await this.getGuild();
    const m = await this.memberOf(guild, userId);
    return m ? memberInfo(m, guild.id) : null;
  }

  /** Whether the guild's @everyone role can view a channel (a thread answers for its parent); a private thread admits only its members, so never. */
  private everyoneViews(channel: any): boolean {
    if (channel.type === ChannelType.PrivateThread) return false;
    const everyone = channel.guild.roles?.everyone;
    return !!everyone && !!channel.permissionsFor(everyone)?.has("ViewChannel");
  }

  async channelView(channelId: string, userId: string): Promise<ChannelView> {
    const channel: any = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.guild || channel.isDMBased?.()) return { channel: null, canView: false };
    const found = { id: channel.id, name: channel.name ?? channel.id, guildId: channel.guild.id, public: this.everyoneViews(channel) };
    const member = await this.memberOf(channel.guild, userId);
    if (!member || !channel.permissionsFor(member)?.has("ViewChannel")) return { channel: found, canView: false };
    // Seeing a private thread's parent is not enough: the user must have been added to the thread.
    const inThread = await this.inThread(channel, userId);
    return { channel: found, canView: inThread };
  }

  async findChannels(text: string, userId: string): Promise<FoundChannel[]> {
    const key = String(text ?? "").trim(), mentioned = /^<#(\w[\w-]*)>$/.exec(key)?.[1];
    const name = key.replace(/^#/, "").trim().toLowerCase().replace(/\s+/g, "-");
    if (!mentioned && !name) return [];
    const served = (c: any) => c?.guild && !c.isThread?.() && !c.isDMBased?.() && PROJECT_CHANNELS.has(c.type) && (!this.allowedGuildIds.length || this.allowedGuildIds.includes(c.guild.id));
    const candidates: any[] = mentioned
      ? [await this.client.channels.fetch(mentioned).catch(() => null)].filter(served)
      : [...this.client.channels.cache.values()].filter((c: any) => served(c) && c.name?.toLowerCase() === name);
    const members = new Map<string, Promise<unknown>>();
    const memberIn = (guild: any) => members.get(guild.id) ?? members.set(guild.id, this.memberOf(guild, userId)).get(guild.id)!;
    const found = await Promise.all(candidates.map(async (c): Promise<FoundChannel | null> => {
      if (!(await memberIn(c.guild))) return null; // a guild the person is not in stays unknown to them
      const view = await this.channelView(c.id, userId);
      return { id: c.id, name: c.name ?? c.id, guildId: c.guild.id, guildName: c.guild.name ?? c.guild.id, canView: view.canView };
    }));
    return found.filter((c): c is FoundChannel => !!c);
  }

  async sharedGuilds(userId: string): Promise<{ id: string; name: string }[]> {
    const served = [...this.client.guilds.cache.values()].filter((g: any) => !this.allowedGuildIds.length || this.allowedGuildIds.includes(g.id));
    const isMember = await Promise.all(served.map(async (g: any) => !!(await this.memberOf(g, userId))));
    return served.filter((_, i) => isMember[i]).map((g: any) => ({ id: g.id, name: g.name ?? g.id }));
  }

  /** A text channel or thread of this guild that both the bot and the requester are allowed to see and post in. */
  async postAccess(channelId: string, requesterId: string): Promise<PostAccess> {
    const channel: any = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.guild || channel.isDMBased?.() || !channel.isTextBased?.() || (this.guildId && channel.guildId !== this.guildId)) return { ok: false, who: "unknown", missing: [] };
    const [member, me] = await Promise.all([requesterId, this.client.user?.id ?? ""].map((id) => this.memberOf(channel.guild, id)));
    const missingFor = (who: unknown, needs: string[]): string[] => (who && channel.permissionsFor(who)?.missing(needs)) ?? needs;
    const inThread = await this.inThread(channel, requesterId);
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
      id: message.id, channelId: message.channelId ?? channel.id, authorId: message.author?.id ?? "", authorName: speakerName(message), content: withoutMention(message.content ?? "", this.client.user?.id),
      attachments: [...(message.attachments?.values() ?? [])].map((a: any) => ({ id: a.id, name: a.name ?? "attachment", url: a.url, size: a.size ?? 0, contentType: a.contentType ?? null })),
    };
  }

  /** Checks a requester may read a channel's history and the bot may read it and post minutes there. */
  async historyAccess(channelId: string, requesterId: string): Promise<HistoryAccess> {
    const channel: any = await this.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.guild || channel.isDMBased?.()) return { ok: false, who: "dm" };
    const [member, me] = await Promise.all([requesterId, this.client.user?.id ?? ""].map((id) => this.memberOf(channel.guild, id)));
    const missingFor = (who: unknown, needs: string[]): string[] => (who && channel.permissionsFor(who)?.missing(needs)) ?? needs;
    const requesterMissing = missingFor(member, READ_HISTORY);
    // Seeing a private thread's parent is not enough: the requester must have been added to the thread.
    const inThread = await this.inThread(channel, requesterId);
    if (requesterMissing.length || !inThread) return { ok: false, who: "requester", missing: requesterMissing };
    const botMissing = missingFor(me, [...READ_HISTORY, channel.isThread() ? "SendMessagesInThreads" : "SendMessages", "EmbedLinks"]);
    return botMissing.length ? { ok: false, who: "bot", missing: botMissing } : { ok: true };
  }

  /**
   * Reads a channel or thread backwards, 100 messages per call, at most `pages` calls (5 unless a caller such as Minutes reads more) and 24 hours back.
   * Other bots and system messages are skipped; a whole thread includes its starter message.
   */
  async readHistory(channelId: string, range: HistoryRange = {}, now = clockNow(), pages = HISTORY_PAGES): Promise<{ messages: HistoryMessage[]; cut: HistoryCut | null }> {
    const channel: any = await this.client.channels.fetch(channelId);
    const inRange = (m: Message) => (!range.startId || BigInt(m.id) >= BigInt(range.startId)) && m.createdTimestamp >= (range.since ?? 0);
    const read: Message[] = [];
    let before: string | undefined, cut: HistoryCut | null = null, done = false;
    for (let page = 0; page < pages && !done; page++) {
      const batch: Message[] = [...(await channel.messages.fetch({ limit: HISTORY_PAGE, before, cache: false })).values()];
      for (const m of batch) {
        if (!inRange(m)) { done = true; break; }
        if (m.createdTimestamp < now - HISTORY_SPAN_MS) { done = true; cut = { reason: "time", keptFrom: now - HISTORY_SPAN_MS }; break; }
        read.push(m);
      }
      if (batch.length < HISTORY_PAGE) done = true;
      before = batch.at(-1)?.id;
    }
    if (!done) cut = { reason: "count", keptFrom: read.at(-1)?.createdTimestamp ?? now, ...(pages !== HISTORY_PAGES ? { limit: pages * HISTORY_PAGE } : {}) };
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

  /**
   * People's and webhooks' messages of a channel and its public threads from `since` up to `until`, oldest first; other bots, the bot itself,
   * system messages and private threads are left out. Reading stops at `most` messages, and `stoppedAt` is the time of the last one read.
   */
  async readSpan(channelId: string, span: { since: number; until: number }, most: number): Promise<{ messages: HistoryMessage[]; stoppedAt: number | null }> {
    const channel: any = await this.client.channels.fetch(channelId);
    const botId = this.client.user?.id;
    const wanted = (m: Message) => !m.system && m.author.id !== botId && (!m.author.bot || !!m.webhookId);
    const read: HistoryMessage[] = [];
    let stopped = false;
    for (const place of [channel, ...(await publicThreads(channel, span.since))]) {
      let after = String(BigInt(snowflakeAt(span.since)) - 1n), kept = 0, done = false;
      while (!done) {
        const batch: Message[] = [...(await place.messages.fetch({ limit: HISTORY_PAGE, after, cache: false })).values()].sort(byTime);
        done = batch.length < HISTORY_PAGE;
        for (const m of batch) {
          if (m.createdTimestamp >= span.until) { done = true; break; }
          const said = historyMessage(m, botId);
          if (m.createdTimestamp >= span.since && wanted(m) && (said.text || said.attachments.length)) { read.push(said); kept++; }
          if (kept >= most) { done = stopped = true; break; }
        }
        after = batch.at(-1)?.id ?? after;
      }
    }
    read.sort((a, b) => a.at - b.at || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    if (read.length > most) { stopped = true; read.splice(most); }
    return { messages: read, stoppedAt: stopped ? read.at(-1)!.at : null };
  }

  async readLinkedMessage(args: { channelId: string; messageId: string; requesterId: string; language?: Language }): Promise<LinkedMessage> {
    const channel: any = await this.client.channels.fetch(args.channelId).catch(() => null);
    if (!channel) return { gone: true };
    if (!channel.guild || channel.isDMBased?.()) refuseUnless({ ok: false, who: "dm" }, args.language);
    // readChannelHistory's check for the asker; the bot only needs to read, since nothing is posted.
    const [member, me] = await Promise.all([args.requesterId, this.client.user?.id ?? ""].map((id) => this.memberOf(channel.guild, id)));
    const missingFor = (who: unknown): string[] => (who && channel.permissionsFor(who)?.missing(READ_HISTORY)) ?? READ_HISTORY;
    const requesterMissing = missingFor(member);
    if (requesterMissing.length || !(await this.inThread(channel, args.requesterId))) refuseUnless({ ok: false, who: "requester", missing: requesterMissing }, args.language);
    const botMissing = missingFor(me);
    if (botMissing.length) refuseUnless({ ok: false, who: "bot", missing: botMissing }, args.language);
    const found = await channel.messages.fetch(args.messageId).catch(() => null);
    if (!found) return { gone: true };
    const m = historyMessage(found, this.client.user?.id);
    return {
      channelId: m.channelId, author: m.speaker, at: `${stamp(m.at)} UTC`, text: m.text, files: m.attachments,
      place: { public: this.everyoneViews(channel), parentId: channel.isThread?.() ? channel.parentId : null, privateThread: channel.type === ChannelType.PrivateThread },
    };
  }

  async readChannelHistory(args: { channelId: string; requesterId: string; since?: string; limit?: number; language?: Language; withMessages?: boolean }, now = clockNow()): Promise<ChannelHistory> {
    const t = textIn(args.language);
    if (!(await this.client.channels.fetch(args.channelId).catch(() => null))) throw new Error(t.historyNoChannel);
    refuseUnless(await this.historyAccess(args.channelId, args.requesterId), args.language);
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
    return {
      channelId: args.channelId, count: kept.length, from: kept[0] ? stamp(kept[0].at) : null, to: kept.at(-1) ? stamp(kept.at(-1)!.at) : null, transcript: transcript(kept), ...(note ? { note } : {}),
      ...(args.withMessages ? { messages: kept.map(({ id, channelId, at, authorId, speaker, own, text }) => ({ id, channelId, at, authorId, speaker, own, text })) } : {}),
    };
  }
}

/** Throws readChannelHistory's refusal, in `language`, unless `access` is ok. */
function refuseUnless(access: HistoryAccess, language?: Language) {
  if (access.ok) return;
  const t = textIn(language);
  if (access.who === "dm") throw new Error(t.historyDm);
  const names = listOf(access.missing.map(permissionName), language);
  if (access.who === "requester") throw new Error(access.missing.length ? t.historyNeedPermission(names) : t.historyNotMember);
  throw new Error(t.historyBotMissing(names, access.missing.length > 1));
}

const byTime = (a: Message, b: Message) => a.createdTimestamp - b.createdTimestamp || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
/** The lowest message id Discord could give at `at`: the time since Discord's epoch (2015) in the id's top bits. */
const snowflakeAt = (at: number) => String((BigInt(Math.max(at, DISCORD_EPOCH)) - BigInt(DISCORD_EPOCH)) << 22n);
const DISCORD_EPOCH = 1_420_070_400_000;

/** A channel's public threads, active ones and those archived since `since`; a private thread is never among them. */
async function publicThreads(channel: any, since: number): Promise<any[]> {
  if (!channel.threads) return [];
  const found = new Map<string, any>();
  const active = await channel.threads.fetchActive().catch(() => null);
  for (const t of active?.threads?.values() ?? []) if (t.parentId === channel.id) found.set(t.id, t);
  let before: string | Date | undefined;
  for (;;) {
    const page = await channel.threads.fetchArchived({ type: "public", before, limit: 100 }).catch(() => null);
    const threads: any[] = [...(page?.threads?.values() ?? [])];
    for (const t of threads) if ((t.archiveTimestamp ?? Infinity) >= since) found.set(t.id, t);
    const oldest = threads.at(-1);
    if (!page?.hasMore || !oldest || (oldest.archiveTimestamp ?? 0) < since) break;
    before = new Date(oldest.archiveTimestamp);
  }
  return [...found.values()].filter((t) => t.type === ChannelType.PublicThread || t.type === ChannelType.AnnouncementThread);
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
