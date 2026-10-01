import type { db } from "@pachiware/db";

export interface ToolPropertySchema {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolPropertySchema;
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
}

export interface ToolParametersSchema {
  type: "object";
  properties: Record<string, ToolPropertySchema>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  success: boolean;
  data?: any;
  error?: string;
}

export interface DiscordChannelInfo {
  id: string;
  name: string;
  type: string;
  topic?: string | null;
  category?: string | null;
}

export interface DiscordClientAdapter {
  createChannel(args: {
    channelName: string;
    type?: "text" | "voice" | "announcement";
    topic?: string;
    categoryName?: string;
  }): Promise<{ id: string; name: string; type: string; category?: string }>;

  archiveChannel(args: {
    channelId: string;
    reason?: string;
  }): Promise<{ id: string; archived: boolean; message: string }>;

  listChannels(args: {
    filterType?: "text" | "voice" | "category" | "all";
  }): Promise<DiscordChannelInfo[]>;

  setChannelTopic(args: {
    channelId: string;
    topic: string;
  }): Promise<{ id: string; topic: string; success: boolean }>;
}

export interface SkillContext {
  db: typeof db;
  discord?: DiscordClientAdapter;
  guildId?: string;
  channelId?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export type ToolHandler = (args: any, context: SkillContext) => Promise<any>;

export interface SkillModule {
  id: string;
  name: string;
  description: string;
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
}
