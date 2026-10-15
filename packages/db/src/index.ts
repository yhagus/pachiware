import * as schema from "./schema/index.js";
import { activeDialect } from "./schema/index.js";
import { getInfraConfig } from "./runtime-store.js";
import { resolveSqlitePath, type DbDialect } from "./dialect.js";
import { assertDatabaseEngine } from "./engine.js";

// Database driver initialization, once per process: the engine never changes
// at runtime (ADR 0010).
//
// We export two bindings:
//   - `db`         Drizzle instance (postgres-js or bun-sqlite flavour)
//   - `queryClient` Low-level driver client used by health probes

type AnyDrizzle = any;
type AnyClient = any;

export let db: AnyDrizzle;
export let queryClient: AnyClient;

function initDriver(dialect: DbDialect, connectionString: string): { db: AnyDrizzle; client: AnyClient } {
  if (dialect === "sqlite") {
    // Use Bun's native sqlite driver (zero npm deps, zero-config).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Database } = require("bun:sqlite");
    const { drizzle } = require("drizzle-orm/bun-sqlite");

    const dbPath = resolveSqlitePath(connectionString);
    const sqliteClient = new Database(dbPath);

    // Pragmas: WAL for better concurrency, foreign keys ON to match pg semantics
    try {
      sqliteClient.exec("PRAGMA journal_mode = WAL;");
      sqliteClient.exec("PRAGMA foreign_keys = ON;");
    } catch {
      // Non-fatal
    }

    const drizzleInstance = drizzle(sqliteClient, { schema });
    return { db: drizzleInstance, client: sqliteClient };
  }

  // PostgreSQL path (unchanged behaviour)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const postgres = require("postgres").default || require("postgres");
  const { drizzle } = require("drizzle-orm/postgres-js");

  const pgClient = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 5,
  });
  const drizzleInstance = drizzle(pgClient, { schema });
  return { db: drizzleInstance, client: pgClient };
}

// Initial boot: the engine lock is checked before any connection opens.
{
  const { databaseUrl } = getInfraConfig();
  assertDatabaseEngine(databaseUrl);
  const { db: initialDb, client: initialClient } = initDriver(activeDialect, databaseUrl);
  db = initialDb;
  queryClient = initialClient;
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
export * from "./persona.js";
export { eq, desc, asc, sql, and, or } from "drizzle-orm";
export default db;
