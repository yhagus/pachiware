import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";
import { getInfraConfig } from "./runtime-store.js";

const { databaseUrl: connectionString } = getInfraConfig();

// Connection instance for queries
export let queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 5,
});

export let db = drizzle(queryClient, { schema });

export function reconnectDatabase(newConnectionString?: string) {
  const conn = newConnectionString || getInfraConfig().databaseUrl;
  try {
    queryClient.end({ timeout: 2 }).catch(() => {});
  } catch {}
  queryClient = postgres(conn, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 5,
  });
  db = drizzle(queryClient, { schema });
  return { queryClient, db };
}

export * from "./schema/index.js";
export * from "./migrate.js";
export * from "./seed.js";
export * from "./runtime-store.js";
export { eq, desc, asc, sql, and, or } from "drizzle-orm";
export default db;



