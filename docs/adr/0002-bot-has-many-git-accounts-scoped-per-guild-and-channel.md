# A bot has many git accounts, scoped per guild and channel

Supersedes [0001](0001-git-account-is-tenant-data-bot-points-to-one.md). One bot now holds several git accounts through a join table, and each guild, and each channel inside it, chooses which of them are usable and for which repositories. The assistant can then work across accounts (a work GitHub and a personal GitLab) while a public channel never reaches a private repo.

## Decisions

- **Default is none.** A guild with no rule has git off. Access is switched on per guild, never inherited from the bot, so adding an account to a bot opens nothing by itself.
- **Channels only narrow.** A channel rule must sit inside its guild rule (an account the guild enabled, patterns the guild's patterns cover). Narrowing a guild rule prunes channel rules that no longer fit. A thread uses its parent channel's rule.
- **Repositories are patterns, not a list.** `org/*`, `org/api`, `*`; lowercase, `*` is the only wildcard. Repos are not stored, so a list would go stale as repositories are created.
- **Reading is free, changing needs a person.** Every git change is queued and runs only after the asker presses Confirm in Discord; the confirmed run re-checks scope.

## Considered options

- **Channel rules override the guild rule**: rejected, a channel could reach accounts or repos the guild never allowed.
- **Default all accounts on**: rejected, adding a token to a bot would silently expose it in every server.
- **Run writes straight away, limited only by scope**: rejected, a model acting on a chat message should not merge or close without a human saying so.
- **Keep `bots.git_account_id` as the default account**: rejected, two sources of truth. The column stays in the table (SQLite cannot drop it cleanly) but is no longer read; migration copies it into the join table.

## Consequences

- A bot can still do whatever its tokens allow inside the scope it is given, so tokens should be limited to the repositories needed.
- Deleting a git account is refused while any bot has it attached; detaching an account removes its scopes.
- Pending confirmations live in memory and are lost on restart.
- Any Discord user who can talk to the bot can read what the scope allows; only the asker can confirm a change. There is no per-user permission.
