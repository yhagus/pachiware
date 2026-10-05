import * as fs from "fs";
import { resolve } from "path";
import * as dotenv from "dotenv";
import { detectDialect, resolveSqlitePath } from "./dialect.js";

// Load fallback environment
dotenv.config({ path: resolve(process.cwd(), "../../.env") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

export interface InfraConfig {
  databaseUrl: string;
  redisUrl: string;
  isFromRuntimeStore?: boolean;
  updatedAt?: string;
}

/**
 * SQLite is the zero-config default so new users can `pachiware start` without
 * provisioning any external services. PostgreSQL is opt-in via DATABASE_URL
 * or the Web GUI (runtime-config.json).
 */
export const DEFAULT_SQLITE_URL = "sqlite:./data/pachiware.db";
export const DEFAULT_REDIS_URL = "redis://localhost:6380";

function findRuntimeConfigFile(): string {
  const candidates = [
    resolve(process.cwd(), "runtime-config.json"),
    resolve(process.cwd(), "../../runtime-config.json"),
    resolve(process.cwd(), "../runtime-config.json"),
    resolve(import.meta.dir, "../../../runtime-config.json"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  return resolve(import.meta.dir, "../../../runtime-config.json");
}

export function getInfraConfig(): InfraConfig {
  const filePath = findRuntimeConfigFile();

  let stored: Partial<InfraConfig> = {};
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      stored = JSON.parse(content);
    } catch {
      // Ignore corrupt runtime file, fall back to process.env
    }
  }

  const databaseUrl =
    stored.databaseUrl ||
    process.env.DATABASE_URL ||
    DEFAULT_SQLITE_URL;

  const redisUrl =
    stored.redisUrl ||
    process.env.REDIS_URL ||
    DEFAULT_REDIS_URL;

  return {
    databaseUrl,
    redisUrl,
    isFromRuntimeStore: Boolean(stored.databaseUrl || stored.redisUrl),
    updatedAt: stored.updatedAt,
  };
}

export function saveInfraConfig(updates: { databaseUrl?: string; redisUrl?: string }): InfraConfig {
  const filePath = findRuntimeConfigFile();
  const current = getInfraConfig();

  const nextConfig: InfraConfig = {
    databaseUrl: updates.databaseUrl?.trim() || current.databaseUrl,
    redisUrl: updates.redisUrl?.trim() || current.redisUrl,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(filePath, JSON.stringify(nextConfig, null, 2), "utf-8");
  return { ...nextConfig, isFromRuntimeStore: true };
}

/**
 * Dialect-agnostic connection probe. Works for both PostgreSQL and SQLite
 * URLs (anything `detectDialect` recognises).
 */
export async function testDatabaseConnection(url: string): Promise<{
  success: boolean;
  message: string;
  dialect: "sqlite" | "postgres";
  latencyMs?: number;
}> {
  const dialect = detectDialect(url);
  const startTime = Date.now();

  if (dialect === "sqlite") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Database } = require("bun:sqlite");
      const dbPath = resolveSqlitePath(url);
      const probe = new Database(dbPath);
      try {
        const row = probe.query("SELECT 1 as ping").get();
        const latencyMs = Date.now() - startTime;
        return {
          success: Boolean(row),
          message: `Successfully opened SQLite database at ${dbPath} (${latencyMs}ms)`,
          dialect,
          latencyMs,
        };
      } finally {
        probe.close();
      }
    } catch (err: any) {
      return {
        success: false,
        message: `Failed to open SQLite database: ${err.message || String(err)}`,
        dialect,
      };
    }
  }

  // Postgres path
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const postgres = require("postgres").default || require("postgres");
  let client: any = null;
  try {
    client = postgres(url, {
      max: 1,
      connect_timeout: 4,
      idle_timeout: 4,
    });
    await client`SELECT 1 as ping`;
    const latencyMs = Date.now() - startTime;
    return {
      success: true,
      message: `Successfully connected to PostgreSQL (${latencyMs}ms)`,
      dialect,
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to connect to PostgreSQL: ${err.message || String(err)}`,
      dialect,
    };
  } finally {
    if (client) {
      await client.end({ timeout: 2 }).catch(() => {});
    }
  }
}

/**
 * Backwards-compatible alias. Prefer `testDatabaseConnection`.
 */
export const testPostgresConnection = testDatabaseConnection;
