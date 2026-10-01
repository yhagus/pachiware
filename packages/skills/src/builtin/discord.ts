import type { SkillModule, SkillContext } from "../types.js";

export const discordManagementSkill: SkillModule = {
  id: "discord_management",
  name: "Discord Management",
  description: "Manage Discord guild channels, topics, archiving, and permissions.",
  tools: [
    {
      name: "createChannel",
      description: "Creates a new text or voice channel in the Discord guild.",
      parameters: {
        type: "object",
        properties: {
          channelName: { type: "string", description: "Name of the channel to create (kebab-case recommended)" },
          type: {
            type: "string",
            enum: ["text", "voice", "announcement"],
            description: "Type of channel (default: text)",
          },
          topic: { type: "string", description: "Topic/purpose for the channel" },
          categoryName: { type: "string", description: "Category under which to place the channel" },
        },
        required: ["channelName"],
      },
    },
    {
      name: "archiveChannel",
      description: "Archives a channel by locking permissions or moving to an archive category.",
      parameters: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "The ID or name of the Discord channel to archive" },
          reason: { type: "string", description: "Reason for archiving" },
        },
        required: ["channelId"],
      },
    },
    {
      name: "listChannels",
      description: "Lists all active channels in the connected Discord server.",
      parameters: {
        type: "object",
        properties: {
          filterType: {
            type: "string",
            enum: ["text", "voice", "category", "all"],
            description: "Filter channels by type",
          },
        },
      },
    },
    {
      name: "setChannelTopic",
      description: "Updates the topic/description of a Discord channel.",
      parameters: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Discord channel ID" },
          topic: { type: "string", description: "The new topic text" },
        },
        required: ["channelId", "topic"],
      },
    },
  ],
  handlers: {
    createChannel: async (
      args: {
        channelName: string;
        type?: "text" | "voice" | "announcement";
        topic?: string;
        categoryName?: string;
      },
      context: SkillContext
    ) => {
      if (!context.discord) {
        return {
          success: false,
          simulated: true,
          message: `Discord client is not connected. [Simulated] Would create channel "#${args.channelName}" (${args.type || "text"})`,
          channel: {
            id: `sim-${Date.now()}`,
            name: args.channelName.toLowerCase().replace(/\s+/g, "-"),
            type: args.type || "text",
            category: args.categoryName,
          },
        };
      }

      const result = await context.discord.createChannel(args);
      return {
        success: true,
        message: `Successfully created channel #${result.name} (ID: ${result.id}).`,
        channel: result,
      };
    },

    archiveChannel: async (
      args: { channelId: string; reason?: string },
      context: SkillContext
    ) => {
      if (!context.discord) {
        return {
          success: false,
          simulated: true,
          message: `Discord client is not connected. [Simulated] Would archive channel "${args.channelId}". Reason: ${args.reason || "None specified"}.`,
        };
      }

      const result = await context.discord.archiveChannel(args);
      return {
        success: true,
        message: result.message,
        channelId: result.id,
      };
    },

    listChannels: async (
      args: { filterType?: "text" | "voice" | "category" | "all" },
      context: SkillContext
    ) => {
      if (!context.discord) {
        return {
          success: true,
          simulated: true,
          message: "Discord client is not connected. Returning default server channels.",
          channels: [
            { id: "1001", name: "general", type: "text", category: "General" },
            { id: "1002", name: "announcements", type: "announcement", category: "General" },
            { id: "1003", name: "tasks", type: "text", category: "Project" },
            { id: "1004", name: "voice-lounge", type: "voice", category: "Voice" },
          ],
        };
      }

      const channels = await context.discord.listChannels(args);
      return {
        success: true,
        count: channels.length,
        channels,
      };
    },

    setChannelTopic: async (
      args: { channelId: string; topic: string },
      context: SkillContext
    ) => {
      if (!context.discord) {
        return {
          success: true,
          simulated: true,
          message: `Discord client is not connected. [Simulated] Updated topic for channel ${args.channelId} to: "${args.topic}"`,
        };
      }

      const result = await context.discord.setChannelTopic(args);
      return {
        success: true,
        message: `Updated topic for channel ${result.id} successfully.`,
        topic: result.topic,
      };
    },
  },
};
