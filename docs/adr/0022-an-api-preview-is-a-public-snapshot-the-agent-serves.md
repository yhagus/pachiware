# An API preview is a public snapshot the agent serves, published without a Write confirmation

Until now nothing the bot kept left the installation: the console runs on localhost or behind an SSH tunnel, and the agent's only routes without a key were its health check and the OAuth callback. Decided with the user on 2026-10-22 (spec #285): a person may ask the bot to publish an OpenAPI document from the Workspace, such as an API changelog, and anyone with the link can open it. The link is `<PUBLIC_URL>/open-api/<id>`, served by the agent itself, and its random id is the only key. The page shows a copy of the file as it was when published, kept in the database until an admin revokes it in the console.

## Considered options

- **Behind a Write confirmation, like a git change.** Rejected by the user: a preview is asked for in the same breath as the changelog ("buat changelog lalu langsung preview"), and a card would break that chain. The asker can only publish a file they may read in that place, and the console lists and revokes every preview.
- **The link follows the file.** Rejected: a link already shared outside would change, or break, whenever the file did. A new changelog gets a new link instead.
- **Links that expire after some days.** Rejected by the user for now; revoking is the console's.
- **The console serves the page.** Rejected: the console is meant to stay private, and the agent already has `PUBLIC_URL` for the OAuth callback.
- **The viewer from a CDN.** Rejected: every visitor would be seen by a third party. Scalar's standalone bundle is served from the agent at a pinned version, and the page loads nothing from elsewhere.

## Consequences

- The id is the repository's UUID, 122 random bits. Finding previews without a link needs the console or the tenant's API key.
- One address gets 60 requests a minute. The forwarded address counts only behind a proxy on a private network, since anyone else could forge it.
- `PUBLIC_URL` must be reachable by whoever opens a preview. Behind a reverse proxy, only `/open-api/` (and the OAuth callback) needs to be forwarded to the agent.
- The page shows a changelog's changes, which Scalar does not draw, as its operation badges and as tables built from the x- extensions. The document itself is served unchanged beside it.
