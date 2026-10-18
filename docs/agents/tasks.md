# Tasks: code map and rules

Read this before changing anything about Tasks, Progress notes, Assignees, task lists, the Digest, or Reminders with tasks. Terms follow `GLOSSARY.md`; ADR 0008 explains why a Project is a channel.

## Where tasks live

A Task is a Markdown file in the Workspace: one-line JSON frontmatter values, then a body. The body holds the description (which may contain a `- [ ]` checklist), then, only once a note exists, a `## Progress notes` section with one `- YYYY-MM-DD <name>: <text>` line per note.

| Folder (tenant-relative) | What it holds |
| --- | --- |
| `guilds/<g>/channels/<c>/tasks/` | A Project's tasks. A thread's tasks live in its parent channel's folder. |
| `dms/<user>/tasks/` | That person's Personal tasks. A DM turn sees only these. |
| `guilds/<g>/shared/tasks/`, `shared/tasks/` | Older and web-GUI tasks. Listed under "Shared tasks" in `mine` and `delegated`. |

Files written before spec #120 (plain-text `assignedTo`, no notes section) still parse. Keep it that way.

## Modules (`packages/skills/src/builtin/`)

- `tasks.ts`: the `task_management` skill, meaning the tool schemas, the handlers, and `change()`, the one read-edit-write path for an existing task.
- `taskFile.ts`: the file format (`render`, `parseTask`), statuses, due dates, `taskLine`, `isOpen`, `isLate`, plus `loadTasks` and `readInFull`.
- `assignee.ts`: the Assignee value (a member id plus a name, or a name only), resolving one from a mention, "me", or a name (`resolveAssignee`), and matching one (`isAssignee`).
- `taskAccess.ts`: who may see or hold a task. This covers `canHold`/`mustHold`, finding a channel by name (`findProject`), and listing the channels a user can view (`viewableProjects`).
- `taskScopes.ts`: the scopes `here`, `mine`, `delegated` and `anywhere` (`scopeSources`, `anywhereSources`, `inScope`, `groupTasks`, `readGroups`). `anywhere` answers "is it done?": every task of the Sources the asker may read kept material from (`readableSources` in `packages/skills/src/workspace/sources.ts`), every status by default; a Source that is not quotable here has its tasks counted as `notShownHere`, never listed. Change who may see what in `sources.ts`, not here.
- `progressNotes.ts` and `checklist.ts`: the body's notes section and its checklist.

The Discord side is the adapter methods `channelView`, `findChannels`, `sharedGuilds` and `forGuild` (interface in `packages/skills/src/types.ts`). Each works across every guild the bot serves, and a channel it cannot resolve counts as not viewable.

## Rules when changing tasks

- **A new write tool goes in the skill's `toolPolicy` with `requiresConfirmation: false`.** A tool missing from the policy gets a Confirm button.
- **A new tool that creates or changes tasks also goes in `BULK_TASK_TOOLS`** (`packages/skills/src/guardrails.ts`). The ReAct loop checks each response's calls against it before any runs: more than three task writes in one turn are refused whole with `confirmation_required`, and the refused batch is let through on the asker's next turn only, for the same tasks with the same arguments (kept as `bulkApproval` in the conversation's metadata, written through `apps/agent/src/loop/conversationMetadata.ts`). Give the tool a `taskChange` label in both languages in `packages/skills/src/language.ts` too: a reply to a provider failure names the changes already made with it.
- **Print a task line only after `readInFull`.** `loadTasks` reads frontmatter alone, so the description, the checklist suffix and the notes are missing until then.
- **"Active" means `isOpen`** (not completed and not cancelled), everywhere: lists, late, the turn context, the Digest, Reminders.
- **Every write that sets or keeps a member Assignee passes `mustHold`.** A member must be able to view the Project's channel. A Personal task may hold only its person or a name-only Assignee.
- **A note that belongs to a write goes inside the same `change()` edit**, for example a cancel reason. That way the status and the note land in one write.

## Testing

Task behaviour is tested through the Discord scenario harness, `apps/agent/test/support/discordScenario.ts` (its API is documented at the top of that file). The `apps/agent/test/task-*.test.ts` files are the prior art.

- **Extra guilds:** `s.discord.joinGuild(id, name, { members })` adds one, and `s.discord.channel(id, { guild })` adds a channel in it. A guild given `members` rejects anyone else, while `guild-1` treats everyone as a member.
- **Access:** use `s.discord.deny(channel, user, ["ViewChannel"])`. A denied user can still send messages there.
- **Seeding Assignees:** use a non-member name such as "Dewi" when the Assignee must stay name-only. A name-only "Alice" or "Bob" gets linked to the harness member on the task's next change.
- **Tool results:** in a scripted step, `turn.toolResults` holds every result since the last user message, so the newest one is `.at(-1)`.

Model behaviour belongs to the daily-behaviour eval (`apps/agent/eval/README.md`). A new brief needs four things: its fixture folder, a dry-run scenario in `eval-assistant-dry-run.test.ts`, a recording (made with `EVAL_RECORD=1`), and its name in the required list in `eval-assistant-checks.test.ts`.

## Changing the default persona

Copy the current `DEFAULT_SYSTEM_PROMPT` byte for byte into a new frozen constant in `packages/db/src/persona.ts`, and append it to `OLD_DEFAULT_PROMPTS`. The migration then replaces only tenants who kept the default. `packages/db/test/persona-migration.test.ts` holds its own copies of the old defaults; add the new one there too and shift its indices.
