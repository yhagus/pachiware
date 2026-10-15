import { getRecordedDatabaseEngine } from "./runtime-store.js";

/** The Database engine an installation keeps its records in (ADR 0010). */
export type DatabaseEngine = "sqlite" | "postgres";

interface EngineUrls {
  name: string;
  prefixes: string[];
  /** File paths given without a scheme, recognised by extension. */
  extensions?: RegExp;
}

const ENGINES: Record<DatabaseEngine, EngineUrls> = {
  sqlite: { name: "SQLite", prefixes: ["sqlite:", "sqlite3:", "file:"], extensions: /\.(db|sqlite|sqlite3)$/ },
  postgres: { name: "PostgreSQL", prefixes: ["postgres://", "postgresql://"] },
};

/** Engines recognised by their URL but not available in this version. */
const NOT_YET_SUPPORTED: EngineUrls[] = [{ name: "MongoDB", prefixes: ["mongodb://", "mongodb+srv://"] }];

const matches = (url: string, engine: EngineUrls) =>
  engine.prefixes.some((prefix) => url.startsWith(prefix)) || Boolean(engine.extensions?.test(url));

export function databaseEngineName(engine: string): string {
  return ENGINES[engine as DatabaseEngine]?.name ?? engine;
}

/** An empty URL means the SQLite default; a URL no engine recognises is an error, never a SQLite file. */
export function detectEngine(url: string): DatabaseEngine {
  const normalized = (url ?? "").trim().toLowerCase();
  if (!normalized) return "sqlite";
  for (const [engine, urls] of Object.entries(ENGINES) as [DatabaseEngine, EngineUrls][]) {
    if (matches(normalized, urls)) return engine;
  }
  const unsupported = NOT_YET_SUPPORTED.find((urls) => matches(normalized, urls));
  if (unsupported) throw new Error(`${unsupported.name} is not supported yet. Use a SQLite or PostgreSQL DATABASE_URL.`);
  const scheme = normalized.match(/^[a-z][a-z0-9+.-]*:/)?.[0];
  const accepted = Object.values(ENGINES).flatMap((urls) => urls.prefixes).join(", ");
  throw new Error(`${scheme ? `Unknown database URL scheme "${scheme}"` : "Unrecognised DATABASE_URL"}. Use one of ${accepted}, or a path ending in .db, .sqlite or .sqlite3.`);
}

/** Host and port of a networked engine's URL, without credentials or database name; null for a SQLite file. */
export function redactedDatabaseHost(url: string): string | null {
  if (detectEngine(url) === "sqlite") return null;
  try { return new URL(url.trim()).host || null; } catch { return null; }
}

/**
 * The engine of the URL, once it is known to be the one this installation's records are in.
 * Called before any connection opens, so a URL of another engine never boots into an empty database.
 */
export function assertDatabaseEngine(url: string): DatabaseEngine {
  const requested = detectEngine(url);
  const recorded = getRecordedDatabaseEngine();
  if (recorded && recorded !== requested) {
    throw new Error(
      `This installation keeps its records in ${databaseEngineName(recorded)}, but the database URL points at ${databaseEngineName(requested)}. ` +
        "Moving between database engines is not supported. Point the database URL at the " +
        `${databaseEngineName(recorded)} database, or see "Start Over on Another Database Engine" in the README.`,
    );
  }
  return requested;
}
