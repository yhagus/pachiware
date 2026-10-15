import { randomUUID } from "node:crypto";
import type { Filter } from "mongodb";
import { ensureCollection, inTransaction, type MongoConnection, type MongoMigration } from "../../mongo/connection.js";
import type { Conversation, ConversationRepository, Message } from "./types.js";

/** `messageSeq` counts the messages ever added, so each message takes the next number in its conversation. */
type ConversationDoc = Omit<Conversation, "id"> & { _id: string; messageSeq?: number };
/** `seq` orders messages as they were added, even when two share a millisecond. */
type MessageDoc = Omit<Message, "id"> & { _id: string; seq: number };

export const conversationMigrations: MongoMigration[] = [
  {
    id: "0302-conversations-and-messages",
    async up(db) {
      const conversations = await ensureCollection(db, "conversations");
      await conversations.createIndex({ tenantId: 1, createdAt: -1 }, { name: "conversations_tenant_created_idx" });
      await conversations.createIndex({ botId: 1, channelId: 1, createdAt: -1 }, { name: "conversations_bot_channel_idx" });
      const messages = await ensureCollection(db, "messages");
      await messages.createIndex({ conversationId: 1, seq: 1 }, { unique: true, name: "messages_conversation_seq_unique" });
      await messages.createIndex({ tenantId: 1, createdAt: 1 }, { name: "messages_tenant_created_idx" });
    },
  },
];

const newest = { createdAt: -1, _id: -1 } as const;

/** Conversations and their messages on MongoDB. */
export function createMongoConversationRepository(connection: MongoConnection): ConversationRepository {
  const { db } = connection;
  const conversations = db.collection<ConversationDoc>("conversations");
  const messages = db.collection<MessageDoc>("messages");
  const one = async (filter: Filter<ConversationDoc>) => {
    const doc = await conversations.findOne(filter);
    return doc ? toConversation(doc) : null;
  };
  const inConversation = (tenantId: string, conversationId: string): Filter<MessageDoc> => ({ conversationId, tenantId });

  return {
    async create(input) {
      const now = new Date();
      const doc: ConversationDoc = {
        _id: randomUUID(), tenantId: input.tenantId, botId: input.botId ?? null, channelId: input.channelId ?? null, userId: input.userId ?? null,
        platform: input.platform, metadata: input.metadata ?? {}, createdAt: now, updatedAt: now, messageSeq: 0,
      };
      await inTransaction(connection, async (session) => {
        if (doc.botId !== null) {
          const bot = await db.collection<{ _id: string }>("bots").findOne({ _id: doc.botId, tenantId: doc.tenantId }, { session, projection: { _id: 1 } });
          if (!bot) throw new Error(`Bot ${doc.botId} does not belong to tenant ${doc.tenantId}.`);
        }
        await conversations.insertOne(doc, { session });
      });
      return toConversation(doc);
    },
    get: (tenantId, id) => one({ _id: id, tenantId }),
    async latestInChannel(tenantId, botId, channelId) {
      const [doc] = await conversations.find({ tenantId, botId, channelId }).sort(newest).limit(1).toArray();
      return doc ? toConversation(doc) : null;
    },
    async listForTenant(tenantId) {
      return (await conversations.find({ tenantId }).sort(newest).limit(100).toArray()).map(toConversation);
    },
    getForBot: (botId, id) => one({ _id: id, botId }),
    async listForBot(botId, { channelId, limit }) {
      if (limit <= 0) return [];
      const where: Filter<ConversationDoc> = channelId ? { botId, $or: [{ channelId }, { "metadata.parentChannelId": channelId }] } : { botId };
      const docs = await conversations.find(where, { projection: { channelId: 1, userId: 1, createdAt: 1 } }).sort(newest).limit(limit).toArray();
      const stats = docs.length
        ? await messages.aggregate<{ _id: string; n: number; last: Date }>([
          { $match: { conversationId: { $in: docs.map((d) => d._id) } } },
          { $group: { _id: "$conversationId", n: { $sum: 1 }, last: { $max: "$createdAt" } } },
        ]).toArray()
        : [];
      const byId = new Map(stats.map((s) => [s._id, s]));
      return docs.map((d) => {
        const s = byId.get(d._id);
        return { id: d._id, channelId: d.channelId ?? null, userId: d.userId ?? null, createdAt: d.createdAt, messageCount: s?.n ?? 0, lastMessageAt: s?.last ?? null };
      });
    },
    async setMetadata(tenantId, id, metadata) {
      await conversations.updateOne({ _id: id, tenantId }, { $set: { metadata } });
    },
    remove: (tenantId, id) => inTransaction(connection, async (session) => {
      if (!(await conversations.deleteOne({ _id: id, tenantId }, { session })).deletedCount) return false;
      await messages.deleteMany(inConversation(tenantId, id), { session });
      return true;
    }),

    async addMessage(input) {
      return inTransaction(connection, async (session) => {
        // Taking the next number also proves the conversation exists and belongs to this tenant.
        const conversation = await conversations.findOneAndUpdate(
          { _id: input.conversationId, tenantId: input.tenantId },
          { $inc: { messageSeq: 1 } },
          { session, returnDocument: "after", projection: { messageSeq: 1 } },
        );
        if (!conversation) throw new Error(`Conversation ${input.conversationId} does not belong to tenant ${input.tenantId}.`);
        const doc: MessageDoc = {
          _id: randomUUID(), tenantId: input.tenantId, conversationId: input.conversationId, seq: conversation.messageSeq!, role: input.role, content: input.content ?? null,
          toolCalls: input.toolCalls ?? null, toolCallId: input.toolCallId ?? null, tokensUsed: input.tokensUsed ?? null, createdAt: new Date(),
        };
        await messages.insertOne(doc, { session });
        return toMessage(doc);
      });
    },
    countMessages: (tenantId, conversationId) => messages.countDocuments(inConversation(tenantId, conversationId)),
    async listMessages(tenantId, conversationId, { offset, limit }) {
      if (limit <= 0) return []; // MongoDB reads a limit of 0 as no limit at all.
      return (await messages.find(inConversation(tenantId, conversationId)).sort({ seq: 1 }).skip(offset).limit(limit).toArray()).map(toMessage);
    },
    async latestMessages(tenantId, conversationId, { limit, chatOnly }) {
      if (limit <= 0) return [];
      const where: Filter<MessageDoc> = chatOnly
        ? { ...inConversation(tenantId, conversationId), role: { $in: ["user", "assistant"] }, content: { $ne: null } }
        : inConversation(tenantId, conversationId);
      return (await messages.find(where).sort({ seq: -1 }).limit(limit).toArray()).map(toMessage).reverse();
    },
  };
}

function toConversation({ _id, ...doc }: ConversationDoc): Conversation {
  return {
    id: _id, tenantId: doc.tenantId, botId: doc.botId ?? null, channelId: doc.channelId ?? null, userId: doc.userId ?? null,
    platform: doc.platform, metadata: doc.metadata ?? {}, createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  };
}

function toMessage({ _id, ...doc }: MessageDoc): Message {
  return {
    id: _id, tenantId: doc.tenantId, conversationId: doc.conversationId, role: doc.role, content: doc.content ?? null,
    toolCalls: doc.toolCalls ?? null, toolCallId: doc.toolCallId ?? null, tokensUsed: doc.tokensUsed ?? null, createdAt: doc.createdAt,
  };
}
