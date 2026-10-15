import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import type { SqlConnection } from "../../connection.js";
import type { AvailabilityRuleRecord, AvailabilityRuleRepository, RuleScope, RuleTarget } from "./types.js";

/** Availability rules on SQLite and PostgreSQL. */
export function createSqlAvailabilityRuleRepository({ db, tables: t }: SqlConnection): AvailabilityRuleRepository {
  const r = t.availabilityRules;
  const atScope = (s: RuleScope) => and(eq(r.tenantId, s.tenantId), eq(r.level, s.level), s.botId === null ? isNull(r.botId) : eq(r.botId, s.botId), eq(r.guildId, s.guildId), eq(r.channelId, s.channelId));
  const atTarget = (s: RuleScope, target: RuleTarget) => and(atScope(s), eq(r.targetKind, target.kind), eq(r.targetName, target.name));

  return {
    async list(scope) {
      return (await db.select().from(r).where(atScope(scope)).orderBy(asc(r.targetKind), asc(r.targetName))).map(toRule);
    },
    async listForBot(tenantId, botId) {
      return (await db.select().from(r).where(and(eq(r.tenantId, tenantId), botId ? or(isNull(r.botId), eq(r.botId, botId)) : isNull(r.botId)))).map(toRule);
    },
    async set(scope, target, value) {
      // Insert-or-update in one statement each, so two writes of one target never both insert; the unique key is an expression index, hence no conflict target.
      const updatedAt = new Date();
      const inserted = await db.insert(r).values({ id: randomUUID(), ...scope, targetKind: target.kind, targetName: target.name, value, updatedAt }).onConflictDoNothing().returning();
      if (!inserted.length) await db.update(r).set({ value, updatedAt }).where(atTarget(scope, target));
    },
    async clear(scope, target) {
      return (await db.delete(r).where(atTarget(scope, target)).returning()).length > 0;
    },
    async removeForBot(botId) {
      await db.delete(r).where(eq(r.botId, botId));
    },
  };
}

function toRule(row: any): AvailabilityRuleRecord {
  return { tenantId: row.tenantId, level: row.level, botId: row.botId ?? null, guildId: row.guildId, channelId: row.channelId, kind: row.targetKind, name: row.targetName, value: row.value, updatedAt: row.updatedAt };
}
