# A Plane account holds one key and a list of Plane workspaces

A Plane API key acts as its Plane user in every Plane workspace that user belongs to. Plane v1.3.1's `APIKeyAuthentication` returns `api_token.user`, and the token's own `workspace` field is never checked. A Plane account used to hold a single `workspace_slug`, so reaching a second workspace meant entering the same key again as a second account. A Plane account is now one Plane server, one API key and one Plane version, and it lists Plane workspaces by slug, each switched on or off. Integrations can use only the ones switched on.

Plane's public API cannot list the workspaces a key opens. This was checked in v1.3.1, v1.4.2 and `preview`: `/api/v1/` has `users/me/` and paths under `workspaces/<slug>/`, nothing more. `/api/users/me/workspaces/` exists, but it accepts only a browser session, not `X-Api-Key`, and Plane's own MCP server requires `PLANE_WORKSPACE_SLUG` for the same reason. So the admin types the slugs, and saving checks each switched-on one by listing its projects.

## Considered options

- **One account per Plane workspace, as before.** Rejected at the user's request: the same key is stored once per workspace, and must be replaced once per workspace too.
- **List the workspaces through a session login.** Rejected: it needs the Plane user's password, and the session endpoints are Plane's web app, not its API.
- **Pass the workspace as a new argument on every Plane tool.** Rejected: every tool definition would grow by one argument that one workspace never needs. The model passes it inside `account` instead, as `account/workspace`.

## Consequences

- To the bot, each usable (account, Plane workspace) pair is one entry. An entry is named by the account alone when that account has one workspace usable in the place, and `account/workspace` when it has several. The full form is always accepted, and the entry a call picks is passed on in that form. A write waiting for Confirm therefore runs in the Plane workspace it was asked for, or is refused if that workspace was switched off in the meantime; it never moves to another.
- A Plane scope rule names its account and its Plane workspace (`plane_scopes.workspace_slug`), and a channel rule narrows the guild rule of the same workspace.
- Switching a workspace off keeps its rules: the bot stops seeing it, and switching it back on restores them. A channel whose only rules are for switched-off workspaces gets no Plane, rather than falling back to its guild's rules. Removing a slug deletes its rules on every bot.
- Saving asks Plane only what the save could change. A new key, base URL or Plane version is checked with every switched-on workspace; otherwise only workspaces newly added or switched on are checked. Switching off a workspace Plane now refuses still saves.
- The Plane version stays per account, since one key talks to one Plane server.
