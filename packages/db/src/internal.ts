import { getInfraConfig } from "./runtime-store.js";
import { assertDatabaseEngine } from "./engine.js";
import { openConnection, type Connection } from "./connection.js";
import { createRepositories, type Repositories } from "./repositories/index.js";

// Opened once, after the engine lock. It holds the raw driver client, so only migrations, the seed and tests import it.

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
