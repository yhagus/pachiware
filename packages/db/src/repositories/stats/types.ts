/** The repository interface for platform stats and health of the database itself. Every engine implements it. */

export interface StatsRepository {
  /** Whether the database answers. Never throws. */
  ping(): Promise<boolean>;
  /** How many bytes the database takes; null when that cannot be known, such as for an in-memory database. Never throws. */
  databaseBytes(): Promise<number | null>;
}
