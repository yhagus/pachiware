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

  test("a prompt still equal to an old default gets the current persona; an edited or custom prompt stays", async () => {
    const connection = connect();
    await migrateMongo(connection, MONGO_MIGRATIONS.filter((step) => !step.id.includes("default-persona")));
    const { tenants } = createRepositories(connection);
    const configs = connection.db.collection<{ _id: string; systemPrompt: string }>("agents_config");
    // The default before the first persona, as seeded by every engine.
    const prompts = ["You are Pachiware Agent, a helpful and precise assistant.", "You are Pachiware Agent, a helpful and precise assistant. Answer in Javanese.", "custom persona"];
    const ids: string[] = [];
    for (const prompt of prompts) {
      const tenant = await tenants.create({ name: `t${ids.length}`, slug: `t${ids.length}` });
      await configs.updateOne({ _id: tenant.id }, { $set: { systemPrompt: prompt } });
      ids.push(tenant.id);
    }

    await migrateMongo(connection);

    const read = async (id: string) => (await configs.findOne({ _id: id }))!.systemPrompt;
    const [moved, edited, custom] = await Promise.all(ids.map(read));
    expect(moved).toMatch(/^You are the administrative assistant of this server\./);
    expect(edited).toBe("You are Pachiware Agent, a helpful and precise assistant. Answer in Javanese.");
    expect(custom).toBe("custom persona");
  });

  test("a Plane account stored before Plane versions reads as Plane 1.3.1, with no server release", async () => {
    const connection = connect();
    await migrateMongo(connection);
    const { tenants, plane } = createRepositories(connection);
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const now = new Date();
    await connection.db.collection<{ _id: string; [field: string]: unknown }>("plane_accounts").insertOne({
      _id: "p1", tenantId: tenant.id, name: "main", baseUrl: null, workspaceSlug: "acme", apiKeyEncrypted: "enc", planeUserId: "u-1", planeUserName: "Pachi Bot", createdAt: now, updatedAt: now,
    });
    expect(await plane.getAccount("p1")).toMatchObject({ planeVersion: "1.3.1", planeServerVersion: null });
  });

  test("a Plane account stored as Plane 1.3 moves to Plane 1.3.1; another version is left alone", async () => {
    const connection = connect();
    await migrateMongo(connection, MONGO_MIGRATIONS.filter((step) => !step.id.includes("plane-version-1.3.1")));
    const { tenants, plane } = createRepositories(connection);
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const now = new Date();
    const row = (_id: string, name: string, planeVersion: string) => ({ _id, tenantId: tenant.id, name, baseUrl: null, workspaceSlug: "acme", apiKeyEncrypted: "enc", planeUserId: "u-1", planeUserName: "Pachi Bot", planeVersion, createdAt: now, updatedAt: now });
    await connection.db.collection<{ _id: string; [field: string]: unknown }>("plane_accounts").insertMany([row("p1", "main", "1.3"), row("p2", "lab", "9.9")]);
    await migrateMongo(connection);
    await migrateMongo(connection);
    expect(await plane.getAccount("p1")).toMatchObject({ planeVersion: "1.3.1" });
    expect(await plane.getAccount("p2")).toMatchObject({ planeVersion: "9.9" });
  });

  test("a Plane account's one Plane workspace becomes its list, each scope takes it, and an orphan scope goes", async () => {
    const connection = connect();
    await migrateMongo(connection, MONGO_MIGRATIONS.filter((step) => !step.id.includes("plane-workspaces")));
    const { tenants, plane } = createRepositories(connection);
    const tenant = await tenants.create({ name: "Acme", slug: "acme" });
    const now = new Date();
    const docs = (name: string) => connection.db.collection<{ _id: string; [field: string]: unknown }>(name);
    await docs("plane_accounts").insertOne({ _id: "p1", tenantId: tenant.id, name: "main", baseUrl: null, workspaceSlug: "acme", apiKeyEncrypted: "enc", planeUserId: "u-1", planeUserName: "Pachi Bot", planeVersion: "1.3.1", createdAt: now, updatedAt: now });
    const scope = (_id: string, channelId: string, planeAccountId: string) => ({ _id, tenantId: tenant.id, botId: "b1", guildId: "g1", channelId, planeAccountId, projectIds: ["*"], updatedAt: now });
    await docs("plane_scopes").insertMany([scope("s1", "", "p1"), scope("s2", "c1", "p1"), scope("s3", "", "gone")]);
    await migrateMongo(connection);
    await migrateMongo(connection);
    expect((await plane.getAccount("p1"))?.workspaces).toEqual([{ slug: "acme", enabled: true }]);
    expect(await docs("plane_accounts").findOne({ _id: "p1", workspaceSlug: { $exists: true } })).toBeNull();
    expect((await plane.listScopes("b1", "g1")).map((r) => [r.id, r.channelId, r.workspaceSlug])).toEqual([["s1", "", "acme"], ["s2", "c1", "acme"]]);
    await docs("plane_scopes").insertOne({ ...scope("s4", "", "p1"), workspaceSlug: "beta" });
    await expect(docs("plane_scopes").insertOne({ ...scope("s5", "", "p1"), workspaceSlug: "beta" })).rejects.toThrow();
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
