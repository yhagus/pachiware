# A project is a channel, not an entity of its own

A task belongs to the channel it was created in, and that channel is its project: there is no project record, no project field on a task, and nothing to name when creating one. Teams on Discord already give each piece of work its own channel, tasks and the Digest are already kept per channel, and asking "which project?" on every new task would break the rule that a clear request just gets done. A view across projects is a view across the channels the asker can read.

A task stays in its channel but is changed from any channel whose tasks the asker can view (#260): a write by its id reaches the same channels `listTasks` scope `anywhere` reads, under the same rules on what may be shown where.

## Considered options

- **A Discord category as the project.** Rejected for storage: a category is a grouping the team changes freely, and moving a channel would move its tasks to another project. It may still group channels when tasks are shown.
- **An explicit project entity, several per channel or one across channels.** Rejected: one more thing every task needs, for teams that rarely run two projects in one channel.
