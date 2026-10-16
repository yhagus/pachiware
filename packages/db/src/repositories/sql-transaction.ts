import type { SqlConnection } from "../connection.js";

/** A transaction body that yields each query and gets its rows back. */
export type SqlWork<T> = (tx: any) => Generator<any, T, any>;

/**
 * Runs `work` in one transaction on either SQL engine, all or nothing. Bun SQLite rolls back only a synchronous
 * transaction, so there each yielded query runs at once; PostgreSQL awaits it.
 */
export async function sqlTransaction<T>({ engine, db }: SqlConnection, work: SqlWork<T>): Promise<T> {
  if (engine === "sqlite") {
    return db.transaction((tx: any) => {
      const steps = work(tx);
      let step = steps.next();
      while (!step.done) step = steps.next(step.value.all());
      return step.value;
    });
  }
  return db.transaction(async (tx: any) => {
    const steps = work(tx);
    let step = steps.next();
    while (!step.done) step = steps.next(await step.value);
    return step.value;
  });
}
