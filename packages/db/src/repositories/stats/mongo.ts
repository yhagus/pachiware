import type { MongoConnection } from "../../mongo/connection.js";
import type { StatsRepository } from "./types.js";

/** Platform stats and health on MongoDB. */
export function createMongoStatsRepository({ db }: MongoConnection): StatsRepository {
  return {
    async ping() {
      try { return (await db.command({ ping: 1 })).ok === 1; } catch { return false; }
    },
    async databaseBytes() {
      try {
        // Collections and their indexes on disk, as pg_database_size counts them. Servers before 4.4 lack totalSize.
        const stats = await db.stats();
        return Number(stats.totalSize ?? stats.storageSize + stats.indexSize);
      } catch { return null; }
    },
  };
}
