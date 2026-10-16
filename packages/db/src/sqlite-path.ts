import { resolve, isAbsolute, dirname } from "path";
import { mkdirSync, existsSync } from "fs";
import { sqlitePathOf } from "./engine.js";

/**
 * Resolve a sqlite connection string into an absolute filesystem path and
 * ensure the parent directory exists.
 *
 * `:memory:` is passed through unchanged.
 */
export function resolveSqlitePath(url: string, workspaceRoot?: string): string {
  if (!url) throw new Error("Empty sqlite connection string");
  const p = sqlitePathOf(url);

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
