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
export type { Profile, NewProfile, ProfileUpdate, ProfileRepository, AgentConfig, AgentConfigUpdate, AgentLanguage, AgentConfigRepository, UsageEvent, NewUsageEvent, UsageTotal, UsageRepository, StatsRepository } from "./repositories/index.js";
export { openConnection, type Connection } from "./connection.js";
export * from "./persona.js";
export { eq, desc, asc, sql, and, or } from "drizzle-orm";
export default db;
