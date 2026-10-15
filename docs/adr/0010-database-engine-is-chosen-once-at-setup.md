# The database engine is chosen once, at setup

An installation keeps its records in SQLite, PostgreSQL or MongoDB. The platform admin picks the engine with `pachiware init` (or `install.sh`). The first successful migration records it as `databaseEngine` in `runtime-config.json`, and from then on the agent refuses to boot against any other engine. Moving records between engines is not supported until there is a cross-engine backup and restore. Without that, a switch either silently starts on an empty database or loses everything that was kept, and neither failure is visible until people notice their bots, keys and reminders are gone.

## Considered options

- **Switch engines from the Web GUI, then migrate and seed the new one (the old behaviour).** Rejected: the new database starts empty, and the old one is left behind without a word.
- **Record the engine inside the database itself.** Rejected: pointing at a different engine finds an empty database, so the marker lives outside every engine.
- **Translate Drizzle queries to MongoDB.** Rejected: joins, correlated subqueries and raw `sql` fragments do not translate faithfully. Every engine instead sits behind one set of repositories, with one SQL implementation and one MongoDB implementation.

## Consequences

- The address of the same engine may still change, through `.env` or the CLI on the server: a moved host, a rotated password, a switch from self-hosted MongoDB to Atlas. The Web GUI only shows the engine and host.
- An unknown URL scheme is an error. It no longer falls back to a SQLite file named after the URL.
- Starting over on another engine has no command. The admin removes `databaseEngine` from `runtime-config.json` by hand, and the old records are neither moved nor deleted.
- MongoDB must run as a replica set, because tenant creation and cascading deletes need multi-document transactions. Ids are UUID strings on every engine, so a future cross-engine restore needs no id mapping.
