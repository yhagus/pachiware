# Agent data lives in Workspace files, not the database

The agent's tasks, notes, and memory are Markdown files in a per-tenant **Workspace**, not rows in PostgreSQL. Agents read and write Markdown better than they query tables, and a folder tree gives free grouping that rows need extra columns for. PostgreSQL keeps platform configuration and conversation history only.

## Considered options

- **Keep tasks in PostgreSQL and add notes tables.** Rejected: every new kind of agent memory becomes a schema change, and the agent cannot browse or reorganise it.
- **A git repository per tenant.** Rejected: merge and push failures for no present need. Version history can come later.

## Consequences

- Storage sits behind a driver chosen by global config: `local` first, `s3` later. Tenants are separated by a path or key prefix.
- Concurrent writes need atomic writes plus a version check, since there is no database transaction to lean on.
- The `tasks` table is exported to files once, then dropped in a later release.
