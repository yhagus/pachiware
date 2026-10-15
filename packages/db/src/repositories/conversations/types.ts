/** Domain types and the repository interface for Conversations and their messages. Every engine implements it. */

export type Conversation = {
  id: string;
  tenantId: string;
  /** The bot that handled it; null for a web chat. It always belongs to the same tenant. */
  botId: string | null;
  channelId: string | null;
  userId: string | null;
  platform: string;
  /** What the conversation keeps between turns, such as its summary or a held bulk approval. */
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
};

export type NewConversation = {
  tenantId: string;
  botId?: string | null;
  platform: string;
  channelId?: string | null;
  userId?: string | null;
  metadata?: Record<string, any>;
};

/** A conversation as a bot's admin view lists it. */
export type ConversationListing = {
  id: string;
  channelId: string | null;
  userId: string | null;
  createdAt: Date;
  messageCount: number;
  lastMessageAt: Date | null;
};

export type Message = {
  id: string;
  tenantId: string;
  conversationId: string;
  /** "system", "user", "assistant" or "tool". */
  role: string;
  content: string | null;
  /** The calls an assistant message made, as the model gave them. */
  toolCalls: any[] | null;
  /** The call a tool message answers. */
  toolCallId: string | null;
  tokensUsed: number | null;
  createdAt: Date;
};

export type NewMessage = {
  tenantId: string;
  conversationId: string;
  role: string;
  content?: string | null;
  toolCalls?: any[] | null;
  toolCallId?: string | null;
  tokensUsed?: number | null;
};

export interface ConversationRepository {
  /** Starts a conversation. A bot of another tenant rejects. */
  create(input: NewConversation): Promise<Conversation>;
  /** Reads a conversation of this tenant. */
  get(tenantId: string, id: string): Promise<Conversation | null>;
  /** The newest conversation a bot holds in a channel or thread. */
  latestInChannel(tenantId: string, botId: string, channelId: string): Promise<Conversation | null>;
  /** The tenant's conversations, newest first, at most 100. */
  listForTenant(tenantId: string): Promise<Conversation[]>;
  /** Reads a conversation the bot handled. */
  getForBot(botId: string, id: string): Promise<Conversation | null>;
  /**
   * The bot's conversations, newest first, with how many messages each holds and when the last one came.
   * `channelId` keeps those in that channel and in threads whose parent it is.
   */
  listForBot(botId: string, options: { channelId?: string; limit: number }): Promise<ConversationListing[]>;
  /** Replaces the conversation's metadata. */
  setMetadata(tenantId: string, id: string, metadata: Record<string, any>): Promise<void>;

  /** Adds a message to a conversation of the same tenant; any other conversation rejects. */
  addMessage(input: NewMessage): Promise<Message>;
  countMessages(tenantId: string, conversationId: string): Promise<number>;
  /** Messages oldest first, skipping the first `offset`. */
  listMessages(tenantId: string, conversationId: string, page: { offset: number; limit: number }): Promise<Message[]>;
  /**
   * The newest `limit` messages, returned oldest first.
   * `chatOnly` keeps user and assistant messages that have content.
   */
  latestMessages(tenantId: string, conversationId: string, options: { limit: number; chatOnly?: boolean }): Promise<Message[]>;
}
