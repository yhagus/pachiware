import { activeDialect, switchSchema } from "./schema/index.js";
import { getInfraConfig } from "./runtime-store.js";
import { detectDialect } from "./dialect.js";
import { openConnection, type Connection } from "./connection.js";
import { createRepositories, type Repositories } from "./repositories/index.js";

// The process-wide connection, chosen from the configured database URL.
// `db` and `queryClient` stay exported until every module reads records through repositories.

type AnyDrizzle = any;
type AnyClient = any;

export let connection: Connection = openConnection(getInfraConfig().databaseUrl);
export let db: AnyDrizzle = connection.db;
export let queryClient: AnyClient = connection.client;

export function reconnectDatabase(newConnectionString?: string) {
  const conn = newConnectionString || getInfraConfig().databaseUrl;

  // Tear down the previous client politely (postgres-js has .end, bun:sqlite has .close)
  try {
    if (queryClient?.end) {
      queryClient.end({ timeout: 2 }).catch(() => {});
    } else if (queryClient?.close) {
      queryClient.close();
    }
  } catch {}

  switchSchema(detectDialect(conn));
  connection = openConnection(conn);
  db = connection.db;
  queryClient = connection.client;
  return { queryClient, db };
}

let cached: { connection: Connection; repositories: Repositories } | undefined;
/** The repositories of the configured database, for whichever engine it is. */
export function repositories(): Repositories {
  if (cached?.connection !== connection) cached = { connection, repositories: createRepositories(connection) };
  return cached.repositories;
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
export * from "./crypto.js";
export * from "./tenancy.js";
export { createRepositories } from "./repositories/index.js";
export type { Repositories, Tenant, TenantStatus, NewTenant, TenantUpdate, ApiKey, ApiKeyListing, IssuedApiKey, TenantRepository } from "./repositories/index.js";
export { openConnection, type Connection } from "./connection.js";
export * from "./persona.js";
export { eq, desc, asc, sql, and, or } from "drizzle-orm";
export default db;
