import {
  ChannelType,
  type Client,
  type Guild,
  type GuildTextBasedChannel,
  PermissionFlagsBits,
} from "discord.js";
import type {
  DiscordClientAdapter,
  DiscordChannelInfo,
} from "@pachiware/skills";

export class DiscordJSAdapter implements DiscordClientAdapter {
  constructor(private client: Client, private guildId?: string) {}

  private async getGuild(): Promise<Guild> {
    if (this.guildId) {
      const g = await this.client.guilds.fetch(this.guildId).catch(() => null);
      if (g) return g;
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

    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel "${args.channelId}" was not found or is not a text channel.`);
    }

    // Archive by making channel read-only for @everyone
    await (channel as GuildTextBasedChannel).permissionOverwrites.edit(
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
}
