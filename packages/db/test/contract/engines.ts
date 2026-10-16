import { afterAll, beforeAll, beforeEach, describe } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openConnection, type MongoConnection, type SqlConnection } from "../../src/connection.ts";
import { dataCollections } from "../../src/mongo/connection.ts";
import { migrateDatabase, SQL_TABLES } from "../../src/migrate.ts";
import { builtInSkills, seedDatabase } from "../../src/seed.ts";
import { createRepositories, type Repositories } from "../../src/repositories/index.ts";
import { requireTestDatabase } from "../test-database.ts";

/** What a contract test sees of one engine: its repositories, plus a probe no repository offers yet. */
export type EngineUnderTest = {
  engine: string;
  repos: Repositories;
  /** How many records of any kind name this tenant as their owner. */
  ownedRecords(tenantId: string): Promise<number>;
  /** Stores a second key with the same value as this one, as a buggy or concurrent writer would. */
  storeKeyCopy(keyId: string): Promise<void>;
};

type Fixture = { subject: EngineUnderTest; reset(): Promise<void>; close(): Promise<void> };

type Engine = {
  name: string;
  /** The database to run against, or undefined to skip this engine. Throws when it is not a test database. */
  url(): string | undefined;
  /** Opens an empty, migrated and seeded database. */
  open(url: string): Promise<Fixture>;
};

let sqliteDir: string | undefined;

const ENGINES: Engine[] = [
  {
    name: "sqlite",
    url: () => `sqlite:${join((sqliteDir ??= mkdtempSync(join(tmpdir(), "pachiware-contract-"))), `${crypto.randomUUID()}.db`)}`,
    open: (url) => openSql(url),
  },
  {
    // Every table in this database is dropped.
    name: "postgres",
    url: () => testUrl("TEST_POSTGRES_URL"),
    open: (url) => openSql(url),
  },
  {
    // A replica set, e.g. the compose `mongo` service. This whole database is dropped.
    name: "mongodb",
    url: () => testUrl("TEST_MONGODB_URL"),
    open: (url) => openMongo(url),
  },
];

function testUrl(variable: string): string | undefined {
  const url = process.env[variable];
  return url ? requireTestDatabase(variable, url) : undefined;
}

/**
 * Registers one contract suite per engine. SQLite always runs; any other engine runs only when its
 * TEST_*_URL is set and is skipped otherwise. A TEST_*_URL naming a database without `test` in its name
 * stops the suite here, before anything connects. Each test starts from an empty, seeded database.
 */
export function contract(name: string, body: (use: () => EngineUnderTest) => void) {
  for (const engine of ENGINES) {
    const url = engine.url();
    (url ? describe : describe.skip)(`${name} [${engine.name}]`, () => {
      let fixture: Fixture | undefined;
      beforeAll(async () => { fixture = await engine.open(url!); });
      beforeEach(async () => { await fixture!.reset(); });
      afterAll(async () => { await fixture?.close(); });
      body(() => fixture!.subject);
    });
  }
}

afterAll(() => { if (sqliteDir) rmSync(sqliteDir, { recursive: true, force: true }); });

async function openSql(url: string): Promise<Fixture> {
  const connection = openConnection(url) as SqlConnection;
  const run = (sql: string, values: unknown[] = []) => query(connection, sql, values);
  const cleared = [...SQL_TABLES].reverse();
  if (connection.engine === "postgres") await run(`DROP TABLE IF EXISTS ${SQL_TABLES.join(", ")} CASCADE`);
  await migrateDatabase(connection);
  await seedDatabase(connection);
  const owners = connection.engine === "postgres"
    ? (await run("SELECT table_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'tenant_id'")).map((r) => r.name as string)
    : SQL_TABLES.filter((table) => connection.client.query(`PRAGMA table_info(${table})`).all().some((c: any) => c.name === "tenant_id"));
  const repos = createRepositories(connection);
  return {
    subject: {
      engine: connection.engine,
      repos,
      async ownedRecords(tenantId) {
        let total = 0;
        for (const table of owners) total += Number((await run(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ${connection.engine === "postgres" ? "$1" : "?"}`, [tenantId]))[0].n);
        return total;
      },
      async storeKeyCopy(keyId) {
        const p = connection.engine === "postgres" ? ["$1", "$2"] : ["?", "?"];
        await run(`INSERT INTO api_keys (id, key_prefix, key_hash, name) SELECT ${p[0]}, key_prefix, key_hash, name FROM api_keys WHERE id = ${p[1]}`, [crypto.randomUUID(), keyId]);
      },
    },
    async reset() {
      if (connection.engine === "postgres") await run(`TRUNCATE ${cleared.join(", ")} CASCADE`);
      else for (const table of cleared) await run(`DELETE FROM ${table}`);
      // Skills are platform definitions the seed writes; every test starts with the built-in ones only.
      for (const skill of builtInSkills()) await repos.skills.register(skill);
    },
    close: () => connection.close(),
  };
}

async function openMongo(url: string): Promise<Fixture> {
  const connection = openConnection(url) as MongoConnection;
  const { db } = connection;
  await db.dropDatabase();
  await migrateDatabase(connection);
  await seedDatabase(connection);
  // Everything a tenant owns carries its tenantId, whatever collection it sits in.
  const collections = () => dataCollections(connection);
  const repos = createRepositories(connection);
  return {
    subject: {
      engine: connection.engine,
      repos,
      async ownedRecords(tenantId) {
        let total = 0;
        for (const name of await collections()) total += await db.collection(name).countDocuments({ tenantId });
        return total;
      },
      async storeKeyCopy(keyId) {
        const keys = db.collection<{ _id: string }>("api_keys");
        const original = await keys.findOne({ _id: keyId });
        await keys.insertOne({ ...original!, _id: crypto.randomUUID() });
      },
    },
    async reset() {
      for (const name of await collections()) await db.collection(name).deleteMany({});
      for (const skill of builtInSkills()) await repos.skills.register(skill);
    },
    close: () => connection.close(),
  };
}

async function query(connection: SqlConnection, sql: string, values: unknown[]): Promise<any[]> {
  if (connection.engine === "postgres") return connection.client.unsafe(sql, values);
  return connection.client.query(sql).all(...values);
}
