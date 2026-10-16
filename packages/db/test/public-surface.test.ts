import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

// The database package hands out repositories, domain types and start-up functions only, so code
// outside it cannot write a query that works on SQL and not on MongoDB.

const workspace = process.cwd();
const entry = join(workspace, "packages/db/src/index.ts");

test("the public entry exports no Drizzle instance, table binding or query operator", () => {
  const directory = mkdtempSync(join(tmpdir(), "pachiware-surface-"));
  try {
    const result = Bun.spawnSync({
      cmd: ["bun", "--eval", `
        import * as drizzle from "drizzle-orm";
        const surface = await import(${JSON.stringify(entry)});
        const operators = new Set(Object.values(drizzle));
        const isTable = (value) => drizzle.is(value, drizzle.Table);
        const raw = (value) => operators.has(value) || isTable(value)
          || (value && typeof value === "object" && (Object.values(value).some(isTable) || (typeof value.select === "function" && typeof value.insert === "function")));
        console.log(JSON.stringify(Object.keys(surface).filter((name) => ["db", "queryClient", "connection", "openConnection", "default"].includes(name) || raw(surface[name]))));
      `],
      // Drizzle resolves from the database package's own dependencies.
      cwd: join(workspace, "packages/db"),
      env: { ...process.env, DATABASE_URL: `sqlite:${join(directory, "surface.db")}`, NODE_ENV: "test" },
    });
    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(result.stdout).trim().split("\n").at(-1)!)).toEqual([]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Start-up modules a test script or the CLI may still load by path; everything else stays inside the package.
const STARTUP_MODULES = new Set(["index", "migrate", "seed", "setup", "crypto"]);
const RAW_NAMES = /[{,]\s*(?:type\s+)?(db|queryClient|connection|eq|ne|and|or|not|sql|asc|desc|inArray|isNull|isNotNull)\s*(?:as\s+\w+\s*)?[,}]/;

function sources(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    if (["node_modules", "dist", ".claude", ".git"].includes(name)) continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) found.push(path);
  }
  return found;
}

test("no code outside the database package imports Drizzle, a table binding or a query operator", () => {
  const outside = [...sources(join(workspace, "apps")), ...sources(join(workspace, "packages"))]
    .filter((path) => !relative(workspace, path).startsWith(join("packages", "db") + "/"));
  const offences: string[] = [];
  for (const path of outside) {
    readFileSync(path, "utf8").split("\n").forEach((line, index) => {
      const where = `${relative(workspace, path)}:${index + 1}`;
      if (/["'`]drizzle-(orm|kit)/.test(line)) offences.push(`${where} imports Drizzle`);
      if (/@pachiware\/db\//.test(line)) offences.push(`${where} reaches past the public entry`);
      for (const [, module] of line.matchAll(/packages\/db\/src\/([\w./-]+?)\.(?:ts|js)\b/g)) {
        if (!STARTUP_MODULES.has(module)) offences.push(`${where} imports packages/db/src/${module}`);
      }
      if (/@pachiware\/db["']|packages\/db\/src\/index\./.test(line) && RAW_NAMES.test(line)) offences.push(`${where} takes raw access from the database package`);
    });
  }
  expect(offences).toEqual([]);
});
