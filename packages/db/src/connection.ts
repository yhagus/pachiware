import { resolveSqlitePath } from "./sqlite-path.js";
import { detectEngine, type SqlEngine } from "./engine.js";
import { openMongoConnection, type MongoConnection } from "./mongo/connection.js";
import * as pgSchema from "./schema/pg/index.js";
import * as sqliteSchema from "./schema/sqlite/index.js";

/** Both SQL schemas share column names and shapes, so code written against one set of tables runs on either. */
export type SqlTables = typeof pgSchema;

/** An open SQL database: the Drizzle instance, the raw driver client, and the tables of its engine. */
export type SqlConnection = {
  engine: SqlEngine;
  db: any;
  client: any;
  tables: SqlTables;
  close(): Promise<void>;
};

export type { MongoConnection };

/** Every engine's open connection. */
export type Connection = SqlConnection | MongoConnection;

/** Opens the database a URL names. Nothing global is touched, so tests can hold several engines at once. */
export function openConnection(url: string): Connection {
  const engine = detectEngine(url);
  if (engine === "mongodb") return openMongoConnection(url);
  if (engine === "sqlite") {
    const { Database } = require("bun:sqlite");
    const { drizzle } = require("drizzle-orm/bun-sqlite");
    const client = new Database(resolveSqlitePath(url));
    try {
      client.exec("PRAGMA journal_mode = WAL;");
      client.exec("PRAGMA foreign_keys = ON;");
    } catch {}
    return {
      engine,
      client,
      db: drizzle(client, { schema: sqliteSchema }),
      tables: sqliteSchema as unknown as SqlTables,
      async close() { client.close(); },
    };
  }
  const postgres = require("postgres").default || require("postgres");
  const { drizzle } = require("drizzle-orm/postgres-js");
  const client = postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 5, onnotice: () => {} });
  return {
    engine,
    client,
    db: drizzle(client, { schema: pgSchema }),
    tables: pgSchema,
    async close() { await client.end({ timeout: 2 }); },
  };
}
