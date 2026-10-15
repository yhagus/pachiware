import type { ClientSession, Db, MongoClient } from "mongodb";

/** An open MongoDB database. Repositories reach collections through `db` and write across them with `inTransaction`. */
export type MongoConnection = {
  engine: "mongodb";
  client: MongoClient;
  db: Db;
  close(): Promise<void>;
};

/** The database a MongoDB URL names in its path, or `pachiware` when it names none. */
export function mongoDatabaseName(url: string): string {
  const path = url.trim().match(/^mongodb(?:\+srv)?:\/\/[^/?]*\/([^?]*)/i)?.[1];
  return path ? decodeURIComponent(path) : "pachiware";
}

/** Connects lazily: the first command opens the connection, so a bad address surfaces where migrations run. */
export function openMongoConnection(url: string): MongoConnection {
  const { MongoClient } = require("mongodb") as typeof import("mongodb");
  const client = new MongoClient(url.trim(), { serverSelectionTimeoutMS: 5000 });
  return { engine: "mongodb", client, db: client.db(mongoDatabaseName(url)), close: () => client.close() };
}

/** Thrown against a server that cannot run multi-document transactions. The agent stops instead of starting in setup mode. */
export class ReplicaSetRequiredError extends Error {
  constructor() {
    super("MongoDB must run as a replica set: tenant creation and cascading deletes need multi-document transactions, which a standalone server cannot run. Start mongod with --replSet (the compose `mongo` service does) or use Atlas.");
    this.name = "ReplicaSetRequiredError";
  }
}

/** Replica set members report a set name; the mongos router of a sharded cluster runs transactions too. */
export async function assertReplicaSet({ db }: MongoConnection): Promise<void> {
  const hello = await db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") throw new ReplicaSetRequiredError();
}

/**
 * Runs `work` in one multi-document transaction, committed all or nothing. Pass `session` to every
 * operation inside it and run them one after another; the driver may run `work` again on a transient error.
 */
export function inTransaction<T>({ client }: MongoConnection, work: (session: ClientSession) => Promise<T>): Promise<T> {
  return client.withSession((session) => session.withTransaction(() => work(session)));
}

/** Names of the collections whose documents may belong to a tenant: every one but the runner's own and the server's. */
export async function dataCollections({ db }: MongoConnection): Promise<string[]> {
  const listed = await db.listCollections({}, { nameOnly: true }).toArray();
  return listed.map((c) => c.name).filter((name) => !name.startsWith("_") && !name.startsWith("system."));
}

/**
 * One versioned migration step. It runs once per database, and its id is recorded in `_migrations` when it
 * succeeds. Write it to be safe to run again: a crash between the step and its record runs it a second time.
 */
export type MongoMigration = { id: string; up(db: Db): Promise<void> };

/** Creates a collection unless it exists. `createIndex` with the same keys and options is already a no-op. */
export async function ensureCollection(db: Db, name: string) {
  const existing = await db.listCollections({ name }, { nameOnly: true }).toArray();
  if (!existing.length) await db.createCollection(name);
  return db.collection(name);
}
