# A git account is tenant data; a bot points to at most one

Repository credentials live in their own tenant-scoped table, and a bot holds a single nullable pointer to one of them. One pointer makes "two accounts per bot" impossible by construction, while several bots can share an account so rotating a token is one edit.

## Considered options

- **On the bot** (credentials as columns on the bot): strictest, but the same token is copied per bot and rotation needs N updates.
- **On the profile**: rejected, a profile is model configuration and is already shared by many bots, which would leak one git identity across them.
- **On the tenant** (one account for everything): rejected, a tenant could not give two bots different identities.
- **Global master account**: rejected, breaks tenant isolation.

## Consequences

- A bot can do whatever its token allows, so tokens should be scoped to the repositories needed.
- Deleting a git account is refused while any bot uses it.
- The tenant match is enforced by a composite foreign key on new databases; upgraded SQLite databases rely on the API check because SQLite cannot add that key afterwards.
