/** Domain types and the repository interface for Availability rules. Every engine implements it. */

export type RuleLevel = "tenant" | "bot" | "guild" | "channel";
export type RuleTargetKind = "playbook" | "skill" | "tool" | "effect";
export type RuleValue = "off" | "opt_in" | "on";

/** Where a rule sits. `botId` is null at the tenant; `guildId` and `channelId` are "" above the level that names them. */
export type RuleScope = { tenantId: string; level: RuleLevel; botId: string | null; guildId: string; channelId: string };
/** What a rule is about. */
export type RuleTarget = { kind: RuleTargetKind; name: string };

export type AvailabilityRuleRecord = RuleScope & RuleTarget & { value: RuleValue; updatedAt: Date };

export interface AvailabilityRuleRepository {
  /** The rules at exactly this scope, by kind, then name. */
  list(scope: RuleScope): Promise<AvailabilityRuleRecord[]>;
  /** Every rule of the tenant that can apply at a bot's places: the tenant's own and, given a bot, that bot's at every level. */
  listForBot(tenantId: string, botId?: string): Promise<AvailabilityRuleRecord[]>;
  /** Writes the target's value at this scope, replacing the value it had there; two writes of one target never make two rules. */
  set(scope: RuleScope, target: RuleTarget, value: RuleValue): Promise<void>;
  /** Removes the target's rule at this scope; false when there was none. */
  clear(scope: RuleScope, target: RuleTarget): Promise<boolean>;
  /** Removes every rule of a bot, at every level. */
  removeForBot(botId: string): Promise<void>;
}
