import * as fs from "fs";
import { resolve } from "path";
import * as dotenv from "dotenv";
import postgres from "postgres";

// Load fallback environment
dotenv.config({ path: resolve(process.cwd(), "../../.env") });
dotenv.config({ path: resolve(process.cwd(), ".env") });

export interface InfraConfig {
  databaseUrl: string;
  redisUrl: string;
  isFromRuntimeStore?: boolean;
  updatedAt?: string;
}

function findRuntimeConfigFile(): string {
  // Check common monorepo root locations
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

  // Default to project root based on import.meta.dir
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
    "postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent";

  const redisUrl =
    stored.redisUrl ||
    process.env.REDIS_URL ||
    "redis://localhost:6380";

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
 * Validates a PostgreSQL connection string by running a simple ping query.
 */
export async function testPostgresConnection(url: string): Promise<{ success: boolean; message: string; latencyMs?: number }> {
  const startTime = Date.now();
  let client: postgres.Sql | null = null;
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
      latencyMs,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to connect to PostgreSQL: ${err.message || String(err)}`,
    };
  } finally {
    if (client) {
      await client.end({ timeout: 2 }).catch(() => {});
    }
  }
}
