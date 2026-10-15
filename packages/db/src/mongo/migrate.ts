import { randomUUID } from "node:crypto";
import { tenantMigrations } from "../repositories/tenants/mongo.js";
import { botMigrations } from "../repositories/bots/mongo.js";
import { assertReplicaSet, type MongoConnection, type MongoMigration } from "./connection.js";

/** Every step, in the order they run. Each repository's `mongo.ts` exports its own steps; add them here. */
export const MONGO_MIGRATIONS: MongoMigration[] = [
  ...tenantMigrations,
  ...botMigrations,
];

type Applied = { _id: string; appliedAt: Date };
type Lock = { _id: string; owner: string; expiresAt: Date };

/** A crashed holder's lock is taken over once its lease runs out; a live holder renews it after every step. */
const LEASE_MS = 60_000;
const WAIT_MS = 2 * LEASE_MS;

/**
 * Applies every step the database has not recorded yet. Requires a replica set, and holds a lock while it runs,
 * so processes that start together apply each step once: the others wait, then find nothing left to do.
 */
export async function migrateMongo(connection: MongoConnection, steps: MongoMigration[] = MONGO_MIGRATIONS): Promise<string[]> {
  await assertReplicaSet(connection);
  const { db } = connection;
  const owner = randomUUID();
  const locks = db.collection<Lock>("_migrations_lock");
  const lease = () => new Date(Date.now() + LEASE_MS);
  const giveUpAt = Date.now() + WAIT_MS;
  for (;;) {
    try {
      // Matches only a lock whose lease ran out. While another process holds a live one, the upsert collides on _id.
      await locks.updateOne({ _id: "migrations", expiresAt: { $lt: new Date() } }, { $set: { owner, expiresAt: lease() } }, { upsert: true });
      break;
    } catch (err) {
      if ((err as { code?: number })?.code !== 11000) throw err;
      if (Date.now() > giveUpAt) throw new Error("Timed out waiting for another process to finish migrating MongoDB.");
      await Bun.sleep(100);
    }
  }
  const applied: string[] = [];
  try {
    const records = db.collection<Applied>("_migrations");
    const done = new Set((await records.find({}, { projection: { _id: 1 } }).toArray()).map((r) => r._id));
    for (const step of steps) {
      if (done.has(step.id)) continue;
      await step.up(db);
      await records.insertOne({ _id: step.id, appliedAt: new Date() });
      await locks.updateOne({ _id: "migrations", owner }, { $set: { expiresAt: lease() } });
      applied.push(step.id);
    }
  } finally {
    await locks.deleteOne({ _id: "migrations", owner });
  }
  return applied;
}
