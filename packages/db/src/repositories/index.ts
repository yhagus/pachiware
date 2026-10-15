import type { Connection } from "../connection.js";
import { createMongoTenantRepository } from "./tenants/mongo.js";
import { createSqlTenantRepository } from "./tenants/sql.js";
import type { TenantRepository } from "./tenants/types.js";

// One folder per kind of record: `types.ts` holds its domain types and interface, `sql.ts` serves SQLite
// and PostgreSQL, and `mongo.ts` serves MongoDB. Its contract suite lives in
// packages/db/test/contract/<name>.contract.test.ts and runs on every engine through `contract()`.
export type * from "./tenants/types.js";

/** Every repository, one per kind of record. Code outside the database package reads and writes records only through these. */
export type Repositories = {
  tenants: TenantRepository;
};

/** The repositories of one open database, implemented for its engine. */
export function createRepositories(connection: Connection): Repositories {
  switch (connection.engine) {
    case "sqlite":
    case "postgres":
      return { tenants: createSqlTenantRepository(connection) };
    case "mongodb":
      return { tenants: createMongoTenantRepository(connection) };
  }
}
