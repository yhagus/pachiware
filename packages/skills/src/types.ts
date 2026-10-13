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

/** What calling a tool can do; EFFECT_MEANING says what each covers. */
export type Effect = "read" | "write" | "danger";
/** The one wording of each effect on the server, as the model reads it. */
export const EFFECT_MEANING: Record<Effect, string> = {
  read: "anything that only reads, such as listing tasks or reading a file",
  write: "changes that can be changed back, such as creating a task or writing a file",
  danger: "actions that cannot be undone or that change access, security or settings, such as deleting a repository or archiving a channel",
};
/** What a tool needs from the context: the identifier must be present and is the only data it may touch. */
export type SkillScope = "tenant" | "guild" | "channel" | "user" | "role";

/** Roles and Discord permission names of the person asking, read by the host from the gateway. */
export interface MemberAuth { roleIds: string[]; permissions: string[] }
export interface AuthorizationContext extends MemberAuth {
  tenantId: string; botId?: string; userId?: string; guildId?: string; channelId?: string; parentChannelId?: string;
}

export interface ToolPolicy {
  /** A tool with several actions carries its riskiest one. */ effect: Effect;
  /** Default: true for write and danger. */ requiresConfirmation?: boolean;
  /** Calls are capped by a playbook's own read budget, so they skip the per-user rate limit (the tenant limit still applies). */ metered?: boolean;
  /** One of the skill's groups; set for every tool of a skill that declares groups. */ group?: string;
  /** The playbook this tool serves; it is available exactly when that playbook is. */ playbook?: string;
}

export interface SkillContext {
  tenantId: string;
  botId?: string;
  db: typeof db;
  discord?: DiscordClientAdapter;
  guildId?: string;
  channelId?: string;
  /** Set when channelId is a thread: the channel it lives in, used for channel-level scope rules. */
  parentChannelId?: string;
  userId?: string;
  /** Display names, used only to label Workspace folders for people. */
  guildName?: string;
  channelName?: string;
  userName?: string;
  /** Set only by the host after a person pressed Confirm; never comes from model arguments. */
  confirmed?: boolean;
  /** Set by the host; the registry refuses it when its ids disagree with this context. */
  auth?: AuthorizationContext;
  /** The place's configured zone and language (the guild's, else the tenant's), for dates and for text the tool writes on its own. */
  timezone?: string;
  language?: "id" | "en";
  metadata?: Record<string, any>;
}

export type ToolHandler = (args: any, context: SkillContext) => Promise<any>;

export interface SkillModule {
  id: string;
  name: string;
  description: string;
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
  /** What the skill lets the bot do, e.g. "tasks"; used to tell whether a request can be served at all. */
  capabilities?: string[];
  /** Default effect and confirmation for tools without an entry in toolPolicy. Default: read. */
  effect?: Effect;
  requiresConfirmation?: boolean;
  /** The skill queues and checks confirmation itself (git), so the registry gate and duplicate guard stay out of the way. */
  confirmsInternally?: boolean;
  allowedScopes?: SkillScope[];
  /** Any-of Discord permission names needed to run non-read tools ("Administrator" always passes). */
  requiredPermissions?: string[];
  toolPolicy?: Record<string, ToolPolicy>;
  /** Display order of the groups the tools sit in; large skills only. */
  groups?: string[];
}

export interface CatalogueTool { name: string; description: string; effect?: Effect; group?: string; playbook?: string }
export interface CatalogueSkill { id: string; name: string; description: string; groups: string[]; tools: CatalogueTool[] }
