# Schedules live in the database, not the Workspace

Reminders and digest runs are rows in a `schedules` table that the agent polls once a minute, while every other thing the agent keeps stays a Workspace file (ADR 0003). A schedule is runtime state indexed by time: the scheduler needs "everything due before now" cheaply, must survive a restart, and must run on one process with SQLite and no Redis. The text a reminder posts is a column of the row, not a file.

## Considered options

- **Reminder files in the Workspace, scanned every minute.** Rejected: a tenant with hundreds of reminders is a full tree walk per minute, and a hand-edited file can silently stop a reminder.
- **Redis delayed jobs (BullMQ).** Rejected: Redis is optional and SQLite installs have none.
- **Cron strings written by the model.** Rejected: people cannot read them, and the model gets them wrong; the row stores daily, weekly on days, or monthly on a date.

## Consequences

- The scheduler is a loop inside the agent process; two agent processes against one database would double-post until a lease column is added.
- A reminder that fires while the agent is down is posted late when less than six hours late, with a note, and skipped otherwise; a repeating one moves on to its next time.
- A reminder is the only place the bot pings people. Every other reply keeps `allowedMentions: { parse: [] }`.
