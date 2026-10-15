import { randomUUID } from "node:crypto";
import { ensureCollection, type MongoConnection, type MongoMigration } from "../../mongo/connection.js";
import type { AvailabilityRuleRecord, AvailabilityRuleRepository, RuleScope, RuleTarget } from "./types.js";

type RuleDoc = AvailabilityRuleRecord & { _id: string };

export const availabilityMigrations: MongoMigration[] = [
  {
    id: "0210-availability-rules",
    async up(db) {
      const rules = await ensureCollection(db, "availability_rules");
      // A tenant rule has botId null, and null takes part in a unique index, so one target has one rule per scope.
      await rules.createIndex({ tenantId: 1, level: 1, botId: 1, guildId: 1, channelId: 1, kind: 1, name: 1 }, { unique: true, name: "availability_rules_key_unique" });
      await rules.createIndex({ botId: 1 }, { name: "availability_rules_bot_idx" });
    },
  },
];

/** Availability rules on MongoDB. */
export function createMongoAvailabilityRuleRepository({ db }: MongoConnection): AvailabilityRuleRepository {
  const rules = db.collection<RuleDoc>("availability_rules");
  const atScope = (s: RuleScope) => ({ tenantId: s.tenantId, level: s.level, botId: s.botId, guildId: s.guildId, channelId: s.channelId });
  const atTarget = (s: RuleScope, target: RuleTarget) => ({ ...atScope(s), kind: target.kind, name: target.name });

  return {
    async list(scope) {
      return (await rules.find(atScope(scope)).sort({ kind: 1, name: 1 }).toArray()).map(toRule);
    },
    async listForBot(tenantId, botId) {
      return (await rules.find({ tenantId, botId: botId ? { $in: [null, botId] } : null }).toArray()).map(toRule);
    },
    async set(scope, target, value) {
      // One upsert on the unique key, so two writes of one target never both insert.
      await rules.updateOne(atTarget(scope, target), { $set: { value, updatedAt: new Date() }, $setOnInsert: { _id: randomUUID() } }, { upsert: true });
    },
    async clear(scope, target) {
      return (await rules.deleteOne(atTarget(scope, target))).deletedCount > 0;
    },
    async removeForBot(botId) {
      await rules.deleteMany({ botId });
    },
  };
}

function toRule(doc: RuleDoc): AvailabilityRuleRecord {
  return { tenantId: doc.tenantId, level: doc.level, botId: doc.botId ?? null, guildId: doc.guildId, channelId: doc.channelId, kind: doc.kind, name: doc.name, value: doc.value, updatedAt: doc.updatedAt };
}
