import { stat } from "node:fs/promises";
import type { SqlConnection } from "../../connection.js";
import type { StatsRepository } from "./types.js";

/** Platform stats and health on SQLite and PostgreSQL. */
export function createSqlStatsRepository({ engine, client }: SqlConnection): StatsRepository {
  return {
    async ping() {
      try {
        if (engine === "sqlite") return Boolean(client.query("SELECT 1 as alive").get());
        const res = await client`SELECT 1 as alive`;
        return Array.isArray(res) ? res.length > 0 : Boolean(res);
      } catch { return false; }
    },
    async databaseBytes() {
      try {
        if (engine === "postgres") return Number((await client`select pg_database_size(current_database()) as n`)[0]?.n ?? 0);
        // The file, plus the write-ahead log and its index beside it.
        const path: string = client.filename;
        if (!path || path === ":memory:") return null;
        let total = 0;
        for (const f of [path, `${path}-wal`, `${path}-shm`]) total += await stat(f).then((x) => x.size, () => 0);
        return total;
      } catch { return null; }
    },
  };
}
