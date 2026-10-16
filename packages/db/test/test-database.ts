import { detectEngine } from "../src/engine.ts";
import { mongoDatabaseName } from "../src/mongo/connection.ts";

/** The database a PostgreSQL test URL names, and the URL of the same server's `postgres` database to create it from. */
export function postgresTestDatabase(url: string): { name: string; serverUrl: string } {
  const [, server, name = "", rest] = url.trim().match(/^(postgres(?:ql)?:\/\/[^/?#]*)(?:\/([^?#]*))?(.*)$/i)!;
  // postgres.js reads the database from the path as written, without decoding it.
  return { name, serverUrl: `${server}/postgres${rest}` };
}

/**
 * Returns `url` when the database it names contains `test`, and throws otherwise. Tests that drop tables
 * or databases check their TEST_*_URL with it before connecting, so a real database is never wiped.
 */
export function requireTestDatabase(variable: string, url: string): string {
  const engine = detectEngine(url);
  let name: string;
  if (engine === "mongodb") name = mongoDatabaseName(url);
  else if (engine === "postgres") name = postgresTestDatabase(url).name;
  else throw new Error(`${variable} is not a PostgreSQL or MongoDB URL.`);
  const refusalReason = `Tests drop every table or collection in it, so its name must contain "test", e.g. pachiware_test.`;
  if (!name) throw new Error(`${variable} names no database. ${refusalReason}`);
  if (!name.toLowerCase().includes("test")) throw new Error(`${variable} names the database "${name}", which is not a test database. ${refusalReason}`);
  return url;
}
