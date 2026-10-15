import type { Connection } from "../connection.js";
import { createSqlTenantRepository } from "./tenants/sql.js";
import type { TenantRepository } from "./tenants/types.js";
import { createSqlProfileRepository } from "./profiles/sql.js";
import type { ProfileRepository } from "./profiles/types.js";
import { createSqlAgentConfigRepository } from "./agent-config/sql.js";
import type { AgentConfigRepository } from "./agent-config/types.js";
import { createSqlUsageRepository } from "./usage/sql.js";
import type { UsageRepository } from "./usage/types.js";
import { createSqlStatsRepository } from "./stats/sql.js";
import type { StatsRepository } from "./stats/types.js";
import { createSqlBotRepository } from "./bots/sql.js";
import type { BotRepository } from "./bots/types.js";

// One folder per kind of record: `types.ts` holds its domain types and interface, `sql.ts` serves SQLite
// and PostgreSQL, and a MongoDB file will sit beside them. Its contract suite lives in
// packages/db/test/contract/<name>.contract.test.ts and runs on every engine through `contract()`.
export type * from "./tenants/types.js";
export type * from "./profiles/types.js";
export type * from "./agent-config/types.js";
export type * from "./usage/types.js";
export type * from "./stats/types.js";
export type * from "./bots/types.js";

/** Every repository, one per kind of record. Code outside the database package reads and writes records only through these. */
export type Repositories = {
  tenants: TenantRepository;
  profiles: ProfileRepository;
  agentConfig: AgentConfigRepository;
  usage: UsageRepository;
  stats: StatsRepository;
  bots: BotRepository;
};

/** The repositories of one open database, implemented for its engine. */
export function createRepositories(connection: Connection): Repositories {
  switch (connection.engine) {
    case "sqlite":
    case "postgres":
      return {
        tenants: createSqlTenantRepository(connection),
        profiles: createSqlProfileRepository(connection),
        agentConfig: createSqlAgentConfigRepository(connection),
        usage: createSqlUsageRepository(connection),
        stats: createSqlStatsRepository(connection),
        bots: createSqlBotRepository(connection),
      };
  }
}
