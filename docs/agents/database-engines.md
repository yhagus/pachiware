# Database engines: adding records

Read this before adding a kind of record, a field, or a repository method. Terms follow `GLOSSARY.md` (**Database engine**, **Tenant**); ADR 0010 explains why every engine sits behind one set of repositories instead of one translated query layer.

An installation keeps its records on one Database engine: SQLite, PostgreSQL or MongoDB. Code outside `packages/db` reads and writes records only through `repositories()` from `@pachiware/db`, so every repository method behaves the same on all three, and the contract suites prove it.

## Code map (`packages/db/src/`)

| Path | What it holds |
| --- | --- |
| `repositories/<name>/types.ts` | Domain types, the repository interface, and the defaults every engine shares. |
| `repositories/<name>/sql.ts` | `createSql<Name>Repository(conn)`, one implementation for SQLite and PostgreSQL, querying `conn.tables`. |
| `repositories/<name>/mongo.ts` | `createMongo<Name>Repository(conn)` and `<name>Migrations`, the repository's MongoDB steps. |
| `repositories/index.ts` | The `Repositories` type and `createRepositories(connection)`, which picks the implementation by `connection.engine`. |
| `repositories/sql-transaction.ts` | `sqlTransaction`, all or nothing on both SQL engines. |
| `mongo/connection.ts` | `inTransaction`, `ensureCollection` and the `MongoMigration` type. |
| `mongo/migrate.ts` | `MONGO_MIGRATIONS` (every MongoDB step, in run order) and the runner. |
| `migrate.ts` | The SQL schema: `SQL_TABLES`, the DDL in `definitions()`, guarded `ALTER TABLE` upgrades, and indexes. |
| `schema/pg/index.ts`, `schema/sqlite/index.ts` | The Drizzle table bindings behind `conn.tables`. Both use the same column names. |
| `index.ts` | The public entry: `repositories()` plus an explicit list of exported domain types. |

## Worked example: Profiles

Profiles use every piece. Read them in this order:

- `repositories/profiles/types.ts`: the interface, `PROFILE_DEFAULTS` and `definedProfileFields`. Both implementations import them, so a default is written once.
- `repositories/profiles/sql.ts`: `create` sets `id: randomUUID()` and stamps `createdAt` and `updatedAt` from one `new Date()`. `getForBot` joins only within the tenant. `remove` leans on the foreign key's `ON DELETE SET NULL`.
- `repositories/profiles/mongo.ts`: step `0101-profiles`. `create` checks the tenant exists inside `inTransaction`, the rule SQL's foreign key gives for free. `remove` clears `profileId` on the bots in the same transaction, matching `ON DELETE SET NULL`. `toProfile` reads a missing `baseUrl` as null and a missing `acceptsImages` as false.
- `migrate.ts`: the `profiles` DDL, and the `accepts_images` and `api_format` `ADD COLUMN` lines that upgrade older installs. `test/migration.test.ts` ("adds the accepts-images flag to existing profiles") covers the upgrade.
- `test/contract/profiles.contract.test.ts`: the behaviour both implementations must match.

For a same-tenant rule a foreign key cannot express, see `requireProfile` in `repositories/bots/sql.ts` and `repositories/bots/mongo.ts`: a bot may only name a profile of its own tenant, checked inside the create transaction on every engine.

## Adding a repository method

1. Declare it on the interface in `types.ts`. Its doc comment states the order, the null or `false` cases, and which tenant it is scoped to.
2. Implement it in both `sql.ts` and `mongo.ts`.
3. Add a contract test in `test/contract/<name>.contract.test.ts`.

Done when the contract suite passes on all three engines (see Testing).

## Adding a kind of record

1. Create `repositories/<name>/types.ts`, `sql.ts` and `mongo.ts`, shaped like Profiles.
2. SQL: add the table to `SQL_TABLES` (parents before children), its DDL to `definitions()`, any index after the `CREATE INDEX` lines, and a Drizzle binding to both schema files. A tenant-owned table also goes in `ownedTables` in `repositories/tenants/sql.ts` (children before parents), so `tenants.purge` removes its rows.
3. MongoDB: export `<name>Migrations` from `mongo.ts` and append it to `MONGO_MIGRATIONS`.
4. Wire it in `repositories/index.ts` (the `Repositories` type, both branches of `createRepositories`, an `export type *` line), then name the domain types in the `export type` lists of `src/index.ts`.
5. Write `test/contract/<name>.contract.test.ts`.

## Adding a field

- SQL: the column goes in both Drizzle bindings, in `definitions()` for new installs, and in a guarded `ALTER TABLE ... ADD COLUMN` for existing ones, with a `test/migration.test.ts` case.
- MongoDB: a field needs a step only when it needs an index. Older documents lack it, so the repository's `to<Name>` mapper supplies the default.

## Rules

- **Ids are UUID strings the repository makes** with `randomUUID()`, on every engine; on MongoDB the id is `_id`. A future cross-engine restore then needs no id mapping (ADR 0010).
- **Dates are `Date` values** on every engine. A SQL insert stamps `createdAt` and `updatedAt` from one host `new Date()`; messages keep the database clock so their order holds.
- **A MongoDB document mirrors its SQL row.** The collection takes the SQL table name, fields take the camelCase domain names, JSON columns become embedded documents, and every tenant-owned document carries `tenantId`. `tenants.purge` and the contract harness find a tenant's documents by `tenantId` in every collection.
- **A MongoDB step is numbered and safe to run twice**: `ensureCollection`, then `createIndex` with a `name`. Each step runs once per database, in `MONGO_MIGRATIONS` order, and is recorded in `_migrations`. Change an existing collection with a new step under a new id; a shipped step stays as it is. Related steps share a hundred (`0100` bots, `0101` profiles, `0102` usage).
- **What a SQL foreign key enforces, MongoDB enforces inside `inTransaction`**: a missing parent, another tenant's record, a cascade, a set-null. A same-tenant check is `findOne({ _id, tenantId }, { session })`. Pass `session` to every operation in the body and run them one after another; the driver may run the body again on a transient error.
- **A SQL rule that spans queries runs in `sqlTransaction`.** The body is a generator that yields each query, because Bun SQLite rolls back only a synchronous transaction. An older SQLite file may lack some foreign keys, so a cascade that matters is written as explicit deletes (`ConversationRepository.remove`, `tenants.purge`).
- **Every list has an explicit order, the same on both implementations**, with the id as tie-break where the sort key can repeat.
- **A refusal throws the same message on every engine** ("Tenant not found", "Profile not found"). Contract tests may assert it.
- **Raw query access stays inside `packages/db`.** `packages/db/test/public-surface.test.ts` fails when the public entry exports a Drizzle instance, table or operator, or when code outside the package imports Drizzle, a deep `@pachiware/db/...` path, or an internal module. The open connection lives in `src/internal.ts`. When a caller needs a new query, it gets a new repository method.

## Testing

`contract("Name", (use) => ...)` from `packages/db/test/contract/engines.ts` registers the suite once per engine. Each test starts from an empty, migrated and seeded database.

- SQLite always runs. PostgreSQL runs when `TEST_POSTGRES_URL` is set, MongoDB when `TEST_MONGODB_URL` is set, for example `mongodb://localhost:27017/pachiware_test?replicaSet=rs0&directConnection=true` against the compose `mongo` profile. The harness drops every table or collection, so it refuses a URL whose database name does not contain `test`.
- The pre-push hook blanks both URLs, so a push proves SQLite only. Run `bun run test:engines` before calling a repository change done: it starts the compose `postgres`, `mongo` and `mongo-standalone` services if needed, creates `pachiware_test`, and runs the db, CLI and `database-engine` tests with `TEST_POSTGRES_URL`, `TEST_MONGODB_URL` and `TEST_MONGODB_STANDALONE_URL` set (a URL already in the environment wins). The runner and its test list are in `packages/db/test/engines-run.ts`. CI (`.github/workflows/ci.yml`) runs the same command on every push to `main`.
- PostgreSQL keeps microseconds, so compare dates with `>=` and never filter on an exact JS `Date`.
- The shared test preload (`packages/db/test/preload.ts`) sets a fixed `PLATFORM_ENCRYPTION_KEY`, so a suite that creates bots needs no key of its own.
- `use().ownedRecords(tenantId)` counts everything a tenant owns on any engine, for purge tests.
