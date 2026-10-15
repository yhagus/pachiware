import type { Connection } from "../connection.js";
import { createSqlTenantRepository } from "./tenants/sql.js";
import type { TenantRepository } from "./tenants/types.js";
import { createSqlBotRepository } from "./bots/sql.js";
import type { BotRepository } from "./bots/types.js";
import { createSqlGitRepository } from "./git/sql.js";
import type { GitRepository } from "./git/types.js";

// One folder per kind of record: `types.ts` holds its domain types and interface, `sql.ts` serves SQLite
// and PostgreSQL, and a MongoDB file will sit beside them. Its contract suite lives in
// packages/db/test/contract/<name>.contract.test.ts and runs on every engine through `contract()`.
export type * from "./tenants/types.js";
export type * from "./bots/types.js";
export type * from "./git/types.js";

/** Every repository, one per kind of record. Code outside the database package reads and writes records only through these. */
export type Repositories = {
  tenants: TenantRepository;
  bots: BotRepository;
  git: GitRepository;
};

/** The repositories of one open database, implemented for its engine. */
export function createRepositories(connection: Connection): Repositories {
  switch (connection.engine) {
    case "sqlite":
    case "postgres":
      return {
        tenants: createSqlTenantRepository(connection),
        bots: createSqlBotRepository(connection),
        git: createSqlGitRepository(connection),
      };
  }
}
