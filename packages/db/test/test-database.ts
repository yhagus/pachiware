import { detectEngine } from "../src/engine.ts";
import { mongoDatabaseName } from "../src/mongo/connection.ts";

// postgres.js reads the database from the path as written, without decoding it.
const POSTGRES_DATABASE = /^postgres(?:ql)?:\/\/[^/?#]*(?:\/([^?#]*))?/i;

/**
 * Returns `url` when the database it names contains `test`, and throws otherwise. Tests that drop tables
 * or databases check their TEST_*_URL with it before connecting, so a real database is never wiped.
 */
export function requireTestDatabase(variable: string, url: string): string {
  const engine = detectEngine(url);
  let name: string;
  if (engine === "mongodb") name = mongoDatabaseName(url);
  else if (engine === "postgres") name = url.trim().match(POSTGRES_DATABASE)?.[1] ?? "";
  else throw new Error(`${variable} is not a PostgreSQL or MongoDB URL.`);
  const why = `Tests drop every table or collection in it, so its name must contain "test", e.g. pachiware_test.`;
  if (!name) throw new Error(`${variable} names no database. ${why}`);
  if (!name.toLowerCase().includes("test")) throw new Error(`${variable} names the database "${name}", which is not a test database. ${why}`);
  return url;
}
