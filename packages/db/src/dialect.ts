import { resolve, isAbsolute, dirname } from "path";
import { mkdirSync, existsSync } from "fs";

export type DbDialect = "sqlite" | "postgres";

/**
 * Detect the database dialect from a connection URL / path.
 *
 * Accepted formats:
 *   - sqlite:./data/pachiware.db        → sqlite relative path
 *   - sqlite:/abs/path/to/pachiware.db  → sqlite absolute path
 *   - sqlite://./data/pachiware.db      → sqlite URL style
 *   - file:./data/pachiware.db          → sqlite (libsql-compatible)
 *   - ./something.db / /abs/foo.sqlite  → sqlite (by extension)
 *   - postgresql://... / postgres://... → postgres
 */
export function detectDialect(url: string): DbDialect {
  if (!url) return "sqlite";
  const normalized = url.trim().toLowerCase();

  if (normalized.startsWith("postgres://") || normalized.startsWith("postgresql://")) {
    return "postgres";
  }
  if (
    normalized.startsWith("sqlite:") ||
    normalized.startsWith("sqlite3:") ||
    normalized.startsWith("file:")
  ) {
    return "sqlite";
  }
  if (/\.(db|sqlite|sqlite3)$/.test(normalized)) {
    return "sqlite";
  }

  // Default fallback — treat anything else as sqlite because that's the new default
  return "sqlite";
}

/**
 * Resolve a sqlite connection string into an absolute filesystem path and
 * ensure the parent directory exists.
 *
 * `:memory:` is passed through unchanged.
 */
export function resolveSqlitePath(url: string, workspaceRoot?: string): string {
  if (!url) throw new Error("Empty sqlite connection string");
  let p = url.trim();

  // Strip common URI prefixes
  if (p.startsWith("sqlite://")) p = p.slice("sqlite://".length);
  else if (p.startsWith("sqlite3://")) p = p.slice("sqlite3://".length);
  else if (p.startsWith("sqlite:")) p = p.slice("sqlite:".length);
  else if (p.startsWith("sqlite3:")) p = p.slice("sqlite3:".length);
  else if (p.startsWith("file://")) p = p.slice("file://".length);
  else if (p.startsWith("file:")) p = p.slice("file:".length);

  if (p === ":memory:" || p === "") {
    return ":memory:";
  }

  // Resolve relative paths against the workspace root (so the db lives in the
  // repo, not inside whatever cwd the agent happens to run under).
  const base = workspaceRoot || process.env.PACHIWARE_DIR || process.cwd();
  const absolute = isAbsolute(p) ? p : resolve(base, p);

  // Ensure parent directory exists
  const parent = dirname(absolute);
  if (!existsSync(parent)) {
    try {
      mkdirSync(parent, { recursive: true });
    } catch {
      // Non-fatal — sqlite will complain more helpfully if it still fails
    }
  }

  return absolute;
}
