import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";
import { getInfraConfig } from "./runtime-store.js";

const { databaseUrl: connectionString } = getInfraConfig();

// Connection instance for queries
export const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });

export * from "./schema/index.js";
export * from "./migrate.js";
export * from "./runtime-store.js";
export { eq, desc, asc, sql, and, or } from "drizzle-orm";
export default db;


