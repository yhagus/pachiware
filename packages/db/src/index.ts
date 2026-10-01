import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";
import * as dotenv from "dotenv";
import { resolve } from "path";

// Load environment variables if not already loaded
dotenv.config({ path: resolve(process.cwd(), "../../.env") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

const connectionString =
  process.env.DATABASE_URL || "postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent";

// Connection instance for queries
export const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });

export * from "./schema/index.js";
export * from "./migrate.js";
export default db;
