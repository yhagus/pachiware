# Agent logs are kept in day files, not the database

The console's Console page shows what the agent process writes to its terminal, so an admin need not keep a terminal open, and `pachiware start --daemon` keeps its output at all. Every `console` call of the agent process still goes to the terminal; `installAgentLog` (`apps/agent/src/logs/agentLog.ts`) also keeps it as an Agent log line with its time, level, source (its leading tag) and text, after masking text shaped like a key or token. The newest 5,000 lines stay in memory for the live tail, and every line is appended to one JSON-lines file per UTC day under `LOG_DIR` (`data/logs`), kept `LOG_RETENTION_DAYS` (7) days. The page reads history from the files with the filters applied on the server, then follows a server-sent event stream from the cursor the history returned.

## Considered options

- **A table in the database.** Rejected: it would need a repository on all three Database engines for data nobody queries by relation; every request would write a row, and the lines that matter most, about the database failing or not being ready, could not be written.
- **Memory only.** Rejected: a crash or restart loses the lines that explain it, which is when they are wanted.
- **A logging library (pino and the like).** Rejected for now: the agent logs through `console` in some forty places; capturing `console` keeps them all without touching each one.

## Consequences

- A line's source is its leading tag (`[HTTP]`, `[llm]`, `[discord]`, `[turn]`); untagged lines are `agent`. New log lines should start with a tag.
- An HTTP request is kept as a warning for 4xx and an error for 5xx (`logAt`), so the level filter finds them, while the terminal still gets every request line on standard output. The Console page's own requests are left out.
- Masking is a safety net, not a licence: code still must not log secrets.
- Only the agent process is captured. The web dev server and the Docker database containers keep their own logs (`pachiware logs`).
- A regular-expression search runs on the server against up to seven days of lines; only the platform admin can ask for one.
