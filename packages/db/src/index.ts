import { activeDialect } from "./schema/index.js";
import { getInfraConfig } from "./runtime-store.js";
import { assertDatabaseEngine } from "./engine.js";
import { openConnection, type Connection } from "./connection.js";
import { createRepositories, type Repositories } from "./repositories/index.js";

// The process-wide connection, opened once: the engine never changes at runtime (ADR 0010),
// and the engine lock is checked before it opens.
// `db` and `queryClient` stay exported until every module reads records through repositories.

type AnyDrizzle = any;
type AnyClient = any;

export const connection: Connection = (() => {
  const { databaseUrl } = getInfraConfig();
  assertDatabaseEngine(databaseUrl);
  return openConnection(databaseUrl);
})();
export const db: AnyDrizzle = connection.db;
export const queryClient: AnyClient = connection.client;

let cached: Repositories | undefined;
/** The repositories of the configured database, for whichever engine it is. */
export function repositories(): Repositories {
  return (cached ??= createRepositories(connection));
}

/**
 * Dialect-agnostic liveness probe. Returns true if the active database
 * responds to a simple SELECT 1.
 */
export async function pingDatabase(): Promise<boolean> {
  try {
    if (activeDialect === "sqlite") {
      const row = queryClient.query("SELECT 1 as alive").get();
      return Boolean(row);
    }
    const res = await queryClient`SELECT 1 as alive`;
    return Array.isArray(res) ? res.length > 0 : Boolean(res);
  } catch {
    return false;
  }
}

export * from "./schema/index.js";
export * from "./migrate.js";
export * from "./seed.js";
export * from "./runtime-store.js";
export * from "./dialect.js";
export * from "./engine.js";
export * from "./crypto.js";
export * from "./tenancy.js";
export { createRepositories } from "./repositories/index.js";
export type { Repositories, Tenant, TenantStatus, NewTenant, TenantUpdate, ApiKey, ApiKeyListing, IssuedApiKey, TenantRepository } from "./repositories/index.js";
export type { Schedule, NewSchedule, ScheduleUpdate, ScheduleFilter, ScheduleKind, ScheduleRecurrence, ScheduleStatus, ScheduleRepository, TaskRow, NewTaskRow, TaskRowRepository } from "./repositories/index.js";
export type { Bot, NewBot, BotUpdate, BotWithToken, BotSearch, GuildConfig, GuildConfigInput, BotRepository } from "./repositories/index.js";
export type { Skill, SkillDefinition, TenantSkill, TenantSkillListing, SkillRepository } from "./repositories/index.js";
export type { RuleLevel, RuleTargetKind, RuleValue, RuleScope, RuleTarget, AvailabilityRuleRecord, AvailabilityRuleRepository } from "./repositories/index.js";
export type { Conversation, NewConversation, ConversationListing, Message, NewMessage, ConversationRepository } from "./repositories/index.js";
export { openConnection, type Connection } from "./connection.js";
export { ReplicaSetRequiredError } from "./mongo/connection.js";
export * from "./persona.js";
export { eq, desc, asc, sql, and, or } from "drizzle-orm";
export default db;
