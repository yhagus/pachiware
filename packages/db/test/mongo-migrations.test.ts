import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { openConnection, type MongoConnection } from "../src/connection.ts";
import { MONGO_MIGRATIONS, migrateMongo } from "../src/mongo/migrate.ts";
import { createRepositories } from "../src/repositories/index.ts";
import type { MongoMigration } from "../src/mongo/connection.ts";
import { requireTestDatabase } from "./test-database.ts";

// Runs against TEST_MONGODB_URL's server, in a database of its own that is dropped before every test.
const url = process.env.TEST_MONGODB_URL ? requireTestDatabase("TEST_MONGODB_URL", process.env.TEST_MONGODB_URL) : undefined;
const standalone = process.env.TEST_MONGODB_STANDALONE_URL || undefined;
const opened: MongoConnection[] = [];

/** A connection with its own client, as a separate agent process would have. */
function connect(): MongoConnection {
  const connection = openConnection(url!) as MongoConnection;
  opened.push(connection);
  return { ...connection, db: connection.client.db(`${connection.db.databaseName}_migrations`) };
}

afterAll(async () => {
  for (const connection of opened) await connection.close();
});

(url ? describe : describe.skip)("MongoDB migrations", () => {
  beforeEach(async () => {
    await connect().db.dropDatabase();
  });

  test("two processes starting together apply each step once, and a later start applies none", async () => {
    const runs: Record<string, number> = {};
    const step = (id: string): MongoMigration => ({
      id,
      async up(db) {
        runs[id] = (runs[id] ?? 0) + 1;
        await Bun.sleep(150);
        await db.collection("probe").insertOne({ step: id });
      },
    });
    const steps = [step("0001-first"), step("0002-second"), step("0003-third")];

    const [a, b] = await Promise.all([migrateMongo(connect(), steps), migrateMongo(connect(), steps)]);
    expect(runs).toEqual({ "0001-first": 1, "0002-second": 1, "0003-third": 1 });
    expect([...a, ...b].sort()).toEqual(["0001-first", "0002-second", "0003-third"]);

    expect(await migrateMongo(connect(), [...steps, step("0004-fourth")])).toEqual(["0004-fourth"]);
    expect(await migrateMongo(connect(), steps)).toEqual([]);
    expect(runs["0001-first"]).toBe(1);
  });

  test("every step can run again after a crash between the step and its record", async () => {
    const { db } = connect();
    for (const step of MONGO_MIGRATIONS) {
      await step.up(db);
      await step.up(db);
    }
  });

  test("migrating twice at once leaves a working database", async () => {
    await Promise.all([migrateMongo(connect()), migrateMongo(connect())]);
    const { tenants } = createRepositories(connect());
    await tenants.create({ name: "Acme", slug: "acme" });
    await expect(tenants.create({ name: "Again", slug: "acme" })).rejects.toThrow();
  });
});

(standalone ? describe : describe.skip)("MongoDB standalone server", () => {
  test("is refused, saying a replica set is required", async () => {
    const connection = openConnection(standalone!) as MongoConnection;
    opened.push(connection);
    await expect(migrateMongo(connection)).rejects.toThrow("MongoDB must run as a replica set");
  });
});
