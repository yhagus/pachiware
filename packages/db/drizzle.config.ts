import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../../.env") });

/**
 * Dialect detection mirrors packages/db/src/dialect.ts (kept inline here so
 * drizzle-kit CLI doesn't need to load the full runtime module).
 */
function detectDialect(url: string): "sqlite" | "postgres" {
  if (!url) return "sqlite";
  const n = url.trim().toLowerCase();
  if (n.startsWith("postgres://") || n.startsWith("postgresql://")) return "postgres";
  if (n.startsWith("sqlite:") || n.startsWith("sqlite3:") || n.startsWith("file:")) return "sqlite";
  if (/\.(db|sqlite|sqlite3)$/.test(n)) return "sqlite";
  return "sqlite";
}

function resolveSqlitePath(url: string): string {
  let p = url.trim();
  for (const prefix of ["sqlite://", "sqlite3://", "sqlite:", "sqlite3:", "file://", "file:"]) {
    if (p.startsWith(prefix)) {
      p = p.slice(prefix.length);
      break;
    }
  }
  if (p === ":memory:" || p === "") return ":memory:";
  return p.startsWith("/") ? p : resolve(__dirname, "../../", p);
}

const url = process.env.DATABASE_URL || "sqlite:./data/pachiware.db";
const dialect = detectDialect(url);

export default dialect === "sqlite"
  ? defineConfig({
      schema: "./src/schema/sqlite/index.ts",
      out: "./drizzle/sqlite",
      dialect: "sqlite",
      dbCredentials: {
        url: resolveSqlitePath(url),
      },
    })
  : defineConfig({
      schema: "./src/schema/pg/index.ts",
      out: "./drizzle/pg",
      dialect: "postgresql",
      dbCredentials: {
        url,
      },
    });
