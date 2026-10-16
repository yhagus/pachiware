import * as fs from "fs";
import { resolve } from "path";
import * as dotenv from "dotenv";

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
 * provisioning any external services. PostgreSQL is chosen at setup through
 * DATABASE_URL (ADR 0010).
 */
export const DEFAULT_SQLITE_URL = "sqlite:./data/pachiware.db";
export const DEFAULT_REDIS_URL = "redis://localhost:6380";

function findRuntimeConfigFile(): string {
  // Lets the CLI and tests point at one installation's file, whatever the working directory.
  if (process.env.PACHIWARE_RUNTIME_CONFIG) return resolve(process.env.PACHIWARE_RUNTIME_CONFIG);
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

function readRuntimeConfig(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(findRuntimeConfigFile(), "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

/** Merges into the raw file, so a writer keeps what the others stored and never pins env-derived values. */
function mergeRuntimeConfig(updates: Record<string, unknown>): void {
  fs.writeFileSync(findRuntimeConfigFile(), JSON.stringify({ ...readRuntimeConfig(), ...updates }, null, 2), "utf-8");
}

export function getInfraConfig(): InfraConfig {
  const stored = readRuntimeConfig() as Partial<InfraConfig>;

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

/** The Database engine this installation's records are in, once a migration has succeeded (ADR 0010). */
export function getRecordedDatabaseEngine(): string | undefined {
  const engine = readRuntimeConfig().databaseEngine;
  return typeof engine === "string" && engine ? engine : undefined;
}

/** Records the engine after a successful migration; an engine already recorded is never replaced. */
export function recordDatabaseEngine(engine: string): void {
  if (!getRecordedDatabaseEngine()) mergeRuntimeConfig({ databaseEngine: engine });
}

/**
 * Allowed hosts: the self-hosted servers git accounts and Plane accounts may point at (platform-wide). Empty means no restriction.
 * Kept under the key the git-only list used, `gitAllowedHosts`, so a list saved before the rename keeps working.
 */
export function getAllowedHosts(): string[] {
  const hosts = readRuntimeConfig().gitAllowedHosts;
  return Array.isArray(hosts) ? hosts.filter((h): h is string => typeof h === "string") : [];
}
export function saveAllowedHosts(hosts: string[]): string[] {
  mergeRuntimeConfig({ gitAllowedHosts: hosts });
  return hosts;
}
/** True when the URL's host (with its port, if any) is listed by name; an empty list lists nothing. */
export function isListedHost(baseUrl: string): boolean {
  return getAllowedHosts().includes(new URL(baseUrl).host.toLowerCase());
}
/** Throws unless the host is listed, or the list is empty. A null URL is a platform's public host, which the list never limits. */
export function assertHostAllowed(baseUrl: string | null): void {
  if (!baseUrl || getAllowedHosts().length === 0) return;
  if (!isListedHost(baseUrl)) throw new Error(`Host ${new URL(baseUrl).host} is not in Allowed hosts`);
}

/** The database is never changed at runtime (ADR 0010); only the Redis URL is. */
export function saveRedisUrl(redisUrl: string): InfraConfig {
  mergeRuntimeConfig({ redisUrl: redisUrl.trim(), updatedAt: new Date().toISOString() });
  return getInfraConfig();
}
