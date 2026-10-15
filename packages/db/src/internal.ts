import { getInfraConfig } from "./runtime-store.js";
import { assertDatabaseEngine } from "./engine.js";
import { openConnection, type Connection } from "./connection.js";
import { createRepositories, type Repositories } from "./repositories/index.js";

// The process-wide connection, opened once: the engine never changes at runtime (ADR 0010),
// and the engine lock is checked before it opens. It carries the raw driver client, so only the
// package's own migrations, seed and tests import this module; the public entry hands out `repositories()`.

export const connection: Connection = (() => {
  const { databaseUrl } = getInfraConfig();
  assertDatabaseEngine(databaseUrl);
  return openConnection(databaseUrl);
})();

/** The driver client of the configured database, for tests that fake an install from before an upgrade. */
export const queryClient: any = connection.client;

let cached: Repositories | undefined;
/** The repositories of the configured database, for whichever engine it is. */
export function repositories(): Repositories {
  return (cached ??= createRepositories(connection));
}
