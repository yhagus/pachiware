import type { SkillModule, SkillContext, PostAccess } from "../types.js";
import { listOf, replyLanguage, textIn } from "../language.js";

/** "<#123>" or "123" → "123". */
const channelIdOf = (input: string) => /^<#([^>\s]+)>$/.exec(input.trim())?.[1] ?? input.trim();
const permissionName = (flag: string) => flag.replace(/([a-z])([A-Z])/g, "$1 $2");

/** Throws the refusal, in the announcement's language, when the bot cannot post there or the asker cannot see it. */
async function assertCanPost(args: { channelId: string; content: string }, ctx: SkillContext): Promise<string> {
  const channelId = channelIdOf(args.channelId);
  if (!ctx.discord) return channelId;
  const access: PostAccess = await ctx.discord.postAccess(channelId, ctx.userId ?? "");
  if (access.ok) return channelId;
  const language = replyLanguage(args.content), t = textIn(language);
  if (access.who === "unknown") throw new Error(t.postNoChannel);
  if (access.who === "requester") throw new Error(t.postNeedView);
  throw new Error(t.postBotMissing(listOf(access.missing.map(permissionName), language), access.missing.length > 1));
}

const MEMBER_LIMIT_DEFAULT = 10, MEMBER_LIMIT_MAX = 50;

export const discordManagementSkill: SkillModule = {
  id: "discord_management",
  name: "Discord Management",
  description: "Manage Discord guild channels, topics, archiving, and permissions.",
  capabilities: ["discord_channels"],
  allowedScopes: ["tenant", "guild", "channel", "user"],
  requiredPermissions: ["ManageChannels"],
  toolPolicy: {
    createChannel: { effect: "write", requiresConfirmation: true },
    archiveChannel: { effect: "danger", requiresConfirmation: true },
    listChannels: { effect: "read" },
    setChannelTopic: { effect: "write", requiresConfirmation: false },
    pinMessage: { effect: "write", requiresConfirmation: false, requiredPermissions: ["ManageMessages"] },
    listMembers: { effect: "read" },
    readChannelHistory: { effect: "read" },
    sendMessage: { effect: "write", requiresConfirmation: true, requiredPermissions: [] },
  },
  checks: {
    sendMessage: async (args: { channelId: string; content: string }, ctx: SkillContext) => { await assertCanPost(args, ctx); },
  },
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
    {
      name: "pinMessage",
      description: "Pins a message in a channel so it stays at the top. The person asking needs Manage Messages.",
      parameters: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "Discord message ID" },
          channelId: { type: "string", description: "Channel the message is in (default: the current channel)" },
        },
        required: ["messageId"],
      },
    },
    {
      name: "listMembers",
      description: "Finds server members whose username or nickname starts with the query; returns id, display name, and roles.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Start of a username or nickname" },
          limit: { type: "number", description: `Most results to return (default ${MEMBER_LIMIT_DEFAULT}, at most ${MEMBER_LIMIT_MAX})` },
        },
        required: ["query"],
      },
    },
    {
      name: "sendMessage",
      description: "Posts a message in another channel of this server, after the person who asked presses Confirm. Nothing in it pings anyone.",
      parameters: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "The target channel as a mention (<#id>) or its id" },
          content: { type: "string", description: "The message to post, at most 2000 characters" },
        },
        required: ["channelId", "content"],
      },
    },
    {
      name: "readChannelHistory",
      description: "Reads what was said in a channel or thread during the last 24 hours (500 messages at most), oldest first, with speaker and time. Only channels the person asking can read themselves. Defaults to the channel the conversation is in.",
      parameters: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "The channel or thread to read, as an id or a <#id> mention; omit for the current channel" },
          since: { type: "string", description: "Only messages at or after this ISO 8601 date-time; never earlier than 24 hours ago" },
          limit: { type: "number", description: "Keep only the latest N messages (default and maximum 500)" },
        },
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

    pinMessage: async (args: { messageId: string; channelId?: string }, context: SkillContext) => {
      const channelId = args.channelId || context.channelId;
      if (!channelId) throw new Error("Say which channel the message is in.");
      if (!context.discord) throw new Error("Discord client is not connected.");
      const pinned = await context.discord.pinMessage({ channelId, messageId: args.messageId });
      return { success: true, message: `Pinned message ${pinned.id} in channel ${pinned.channelId}.`, ...pinned };
    },

    listMembers: async (args: { query: string; limit?: number }, context: SkillContext) => {
      const query = args.query?.trim();
      if (!query) throw new Error("Give the start of a username or nickname to search for.");
      if (!context.discord) throw new Error("Discord client is not connected.");
      const limit = Math.min(MEMBER_LIMIT_MAX, Math.max(1, Math.floor(Number(args.limit) || MEMBER_LIMIT_DEFAULT)));
      const members = await context.discord.listMembers({ query, limit });
      return { success: true, count: members.length, members };
    },

    sendMessage: async (args: { channelId: string; content: string }, context: SkillContext) => {
      const channelId = await assertCanPost(args, context);
      if (!context.discord) {
        return { success: false, simulated: true, message: `Discord client is not connected. [Simulated] Would post in channel ${channelId}.` };
      }
      const posted = await context.discord.sendMessage({ channelId, content: args.content });
      return { success: true, message: `Posted in <#${posted.channelId}>.`, messageId: posted.id, url: posted.url };
    },

    readChannelHistory: async (
      args: { channelId?: string; since?: string; limit?: number },
      context: SkillContext
    ) => {
      const channelId = args.channelId?.trim().replace(/^<#([^>]+)>$/, "$1") || context.channelId;
      if (!channelId) throw new Error("Name a channel to read: this conversation is not in one.");
      if (!context.discord || !context.userId) throw new Error("Channel history can only be read from Discord.");
      return context.discord.readChannelHistory({ channelId, requesterId: context.userId, since: args.since, limit: args.limit, language: context.language });
    },
  },
};
