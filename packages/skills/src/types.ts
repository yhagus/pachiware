import type { Language } from "./language.js";
import type { SkillCategory } from "./categories.js";
import type { ServiceFailed } from "./serviceFailure.js";

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
  /** For the host, never the model: a service the call read that failed for good, and how (#359). */
  failure?: ServiceFailed;
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

  pinMessage(args: { channelId: string; messageId: string }): Promise<{ id: string; channelId: string }>;

  /** Discord's member search: people whose username or nickname starts with `query`; no privileged intent. */
  listMembers(args: { query: string; limit: number }): Promise<DiscordMemberInfo[]>;
  /** One member of the guild by user id; null when they are not in it. */
  getMember(userId: string): Promise<DiscordMemberInfo | null>;

  /**
   * Whether a user can view a channel or thread of any guild the bot is in, whichever guild the adapter is bound to.
   * A channel the bot cannot resolve, a DM, or a user outside the channel's guild is never viewable.
   */
  channelView(channelId: string, userId: string): Promise<ChannelView>;
  /**
   * The text channels a person means by `text`: a `<#id>` mention, or a name with or without `#` in any letter case (spaces read as hyphens).
   * Searched in every guild the bot serves that `userId` is a member of, each with whether they can view it; threads are never returned.
   */
  findChannels(text: string, userId: string): Promise<FoundChannel[]>;
  /** The guilds the bot serves that `userId` is a member of. */
  sharedGuilds(userId: string): Promise<{ id: string; name: string }[]>;
  /** The same adapter bound to another guild of the bot, so member search and lookups happen there. */
  forGuild(guildId: string): DiscordClientAdapter;
  /** Whether the bot may post in a channel and the requester may see it; "unknown" covers a channel outside this guild or a DM. */
  postAccess(channelId: string, requesterId: string): Promise<PostAccess>;
  /** Posts plain text with no pings. */
  sendMessage(args: { channelId: string; content: string }): Promise<{ id: string; channelId: string; url: string }>;
  /** One message of a channel with its attachments' metadata; null when the channel or the message is unknown. */
  fetchMessage(args: { channelId: string; messageId: string }): Promise<DiscordMessageInfo | null>;
  /**
   * One message of a guild channel or thread, after the asker passes readChannelHistory's check (View Channel and Read Message History,
   * membership of a private thread); throws that refusal. `gone` when the channel or the message no longer exists.
   */
  readLinkedMessage(args: { channelId: string; messageId: string; requesterId: string; language?: Language }): Promise<LinkedMessage>;
  /** A channel's last 24 hours after the access check minutes use; throws the refusal text when the asker or the bot may not read it. */
  readChannelHistory(args: {
    channelId: string;
    requesterId: string;
    /** ISO 8601; messages before it are left out. */
    since?: string;
    /** Keeps the latest `limit` messages, 500 at most. */
    limit?: number;
    language?: Language;
    /** Also return each message with its id, for links (recall's today's talk); the tool never asks for it. */
    withMessages?: boolean;
  }): Promise<ChannelHistory>;
}

/**
 * A message opened from its link: speaker, UTC time, text and attachment placeholders, and the place it sits in, which the Source rules
 * read: whether it is a Public channel, the parent when it is a thread, and whether that thread is private.
 */
export type LinkedMessage = { gone: true } | {
  gone?: false; channelId: string; author: string; at: string; text: string; files: string[];
  place: { public: boolean; parentId: string | null; privateThread: boolean };
};

/** Numbered lines "[n] YYYY-MM-DD HH:MM Speaker: text", oldest first, in the shape minutes read; `note` says what was cut. */
export interface ChannelHistory {
  channelId: string;
  count: number;
  from: string | null;
  to: string | null;
  transcript: string;
  note?: string;
  /** With `withMessages`: each message as read, oldest first; `own` marks the bot's. */
  messages?: { id: string; channelId: string; at: number; authorId: string; speaker: string; own: boolean; text: string }[];
}

export interface DiscordMemberInfo { id: string; displayName: string; username?: string; roles: string[] }

export interface DiscordAttachmentInfo { id: string; name: string; url: string; size: number; contentType: string | null }
/** `authorName` is the name the author goes by in that place: their server nickname, else their username. `content` is as written, without the bot's own mention. */
export interface DiscordMessageInfo { id: string; channelId: string; authorId: string; authorName: string; content: string; attachments: DiscordAttachmentInfo[] }

/**
 * A guild channel as the bot resolved it (null when it could not), and whether the user asked about can view it.
 * `public`: the guild's @everyone role can view it, so it is a Public channel; a thread is its parent's, and a private thread never is.
 */
export interface ChannelView { channel: { id: string; name: string; guildId: string; public: boolean } | null; canView: boolean }
/** A guild text channel found by name or mention, and whether the person who named it can view it. */
export interface FoundChannel { id: string; name: string; guildId: string; guildName: string; canView: boolean }

export type PostAccess = { ok: true } | { ok: false; who: "requester" | "bot" | "unknown"; missing: string[] };

/** What calling a tool can do; EFFECT_MEANING says what each covers. */
export type Effect = "read" | "write" | "danger";
/** The one wording of each effect on the server, as the model reads it. */
export const EFFECT_MEANING: Record<Effect, string> = {
  read: "anything that only reads, such as listing tasks or reading a file",
  write: "changes that can be changed back, such as creating a task or writing a file",
  danger: "actions that cannot be undone or that change access, security or settings, such as deleting a repository or archiving a channel",
};
/** What a tool needs from the context: the identifier must be present and is the only data it may touch. */
export type SkillScope = "tenant" | "guild" | "channel" | "user";

/** Roles and Discord permission names of the person asking, read by the host from the gateway. */
export interface MemberAuth { roleIds: string[]; permissions: string[] }
export interface AuthorizationContext extends MemberAuth {
  tenantId: string; botId?: string; userId?: string; guildId?: string; channelId?: string; parentChannelId?: string;
}

export interface ToolPolicy {
  /** A tool with several actions carries its riskiest one. */ effect: Effect;
  /** Default: true for write and danger. */ requiresConfirmation?: boolean;
  /** Calls are capped by a playbook's own budget, so they skip the per-user rate limit and the per-tool write limit (the tenant limit still applies). */ metered?: boolean;
  /** One of the skill's groups; set for every tool of a skill that declares groups. */ group?: string;
  /** The playbook this tool serves; it is available exactly when that playbook is. */ playbook?: string;
  /** Replaces the skill's requiredPermissions for this tool; empty means anyone may ask. */ requiredPermissions?: string[];
  /** Administration (settings, members, secrets, transfer…): off for the tenant until a tenant rule says on, so its schema is not sent on every call (#251, ADR 0005). */ defaultOff?: true;
  /** The tool queues and checks its own Confirm, as a skill that confirms internally does, while the rest of its skill leaves that to the registry. */ confirmsInternally?: true;
  /** The same call again changes nothing more (it resumes or replaces), so the duplicate guard lets it repeat; the rate limits still apply. */ repeatable?: true;
  /** The most characters its arguments may hold, in place of MAX_ARGS: a tool that writes one whole document part a call, such as an OpenAPI operation. */ maxArgs?: number;
}

export interface SkillContext {
  tenantId: string;
  botId?: string;
  discord?: DiscordClientAdapter;
  guildId?: string;
  channelId?: string;
  /** Set when channelId is a thread: the channel it lives in, used for channel-level scope rules. */
  parentChannelId?: string;
  /** Set by the host when channelId is a private thread: what is kept there goes to its own folder, the `thread` root (ADR 0009). */
  privateThread?: boolean;
  userId?: string;
  /** Display names, used only to label Workspace folders for people. */
  guildName?: string;
  channelName?: string;
  userName?: string;
  /** Set only by the host after a person pressed Confirm; never comes from model arguments. */
  confirmed?: boolean;
  /** Set only by the host for a task write the user approved as part of a bulk change; it skips the per-tool write limit so the bulk does not half-apply. */
  bulkApproved?: boolean;
  /** Set by the host; the registry refuses it when its ids disagree with this context. */
  auth?: AuthorizationContext;
  /** The place's configured zone and language (the guild's, else the tenant's), for dates and for text the tool writes on its own. */
  timezone?: string;
  language?: "id" | "en";
  /** The language the asker wrote this turn in, for text they read now (a question back); `language` stays the place's, for what is kept. */
  askerLanguage?: "id" | "en";
  /**
   * Set by the Discord host: the asker's own lines, this turn's and those of the conversation so far, without the lines they reply to.
   * A schedule's `said` quotes are checked against them, so the model cannot make up the words a time is read from.
   */
  askerWords?: () => Promise<string[]>;
  /** One tool-free call to the bot's own model, set by the host; null when the provider failed or the turn's deadline passed (#265). Memory compaction uses it. */
  complete?: Completion;
  /**
   * Set by the host for one turn: when the tool call now running must have answered (epoch ms), at its ceiling or the turn's
   * deadline, whichever comes first; for a call another tool runs (recall's parts), the ceiling of the call running it. A tool
   * that spends model time on its own (readFile's reader) plans within it.
   */
  callDeadline?: () => number;
  /**
   * Set by the host for one turn: the names of the tools the model may call at this place (after Availability rules, playbook
   * closures and hidden tools), and `run`, which calls one of them through the registry with every check a model's call gets.
   * A tool that combines others (`recall`) reaches only what they reach.
   */
  tools?: { here: ReadonlySet<string>; run(name: string, args: Record<string, unknown>): Promise<ToolResult> };
  /**
   * Set by the host for a turn of a `budget: long` playbook, or one with an open Changelog draft in its place: work that reads many files.
   * The git skill's reads then skip the per-person limit; the tenant's still holds (#352).
   */
  longWork?: boolean;
  metadata?: Record<string, any>;
}

/** `deadline` (epoch ms) is the caller's own cut, before the turn's when it is earlier: a call made past it gets null without reaching the provider, and one in flight is cut there. */
export type Completion = (request: { system: string; user: string; deadline?: number }) => Promise<string | null>;

export type ToolHandler = (args: any, context: SkillContext) => Promise<any>;

export interface SkillModule {
  id: string;
  name: string;
  description: string;
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
  /** Runs before Confirm is offered and again when the confirmed run starts; throws to refuse the call. */
  checks?: Record<string, ToolHandler>;
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
  /** Where the console lists the skill; none puts it under Other. */
  category?: SkillCategory;
  /**
   * Tools of this skill that the place does not support although Availability rules allow them (git and Plane tools where no scope
   * opens an account, Plane's workspace tools where the Plane scope names specific Plane projects). They are not offered to the model,
   * and a call to one is refused with `hiddenReason`, or as unavailable.
   */
  hiddenTools?: (ctx: SkillContext) => Promise<string[]>;
  /** What the refusal of a hidden tool says, so the model can tell the person who can open it. */
  hiddenReason?: (ctx: SkillContext, tool: string) => Promise<string>;
  /**
   * Other skills' tools whose successful results this skill takes note of, by tool name: the openapi skill notes which changed files a
   * changelog's reads covered. Called after the tool succeeded; a failure here never changes the tool's result.
   */
  observes?: Record<string, (args: any, data: unknown, ctx: SkillContext) => Promise<void>>;
}

export interface CatalogueTool { name: string; description: string; effect?: Effect; group?: string; playbook?: string; defaultOff?: true }
export interface CatalogueSkill { id: string; name: string; description: string; category: string; groups: string[]; tools: CatalogueTool[] }
