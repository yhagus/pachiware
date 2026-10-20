# A Plane account is pinned to a Plane version

Plane changes its REST API between releases. It deprecated every `/api/v1/.../issues/` path in favour of `/work-items/`, with end of support on 31 March 2026, while a self-hosted v1.0.0 is reported to answer 404 on `/work-items/`. Self-hosted servers and Plane's cloud each upgrade on their own schedule, so one code path cannot serve every Plane a tenant connects. A Plane account therefore names a **Plane version**: an entry in a list hard-coded in `packages/skills/src/plane/versions.ts`. Each entry has the Plane releases it covers, the release its tools were checked against, the credential it takes, and the headers that carry it. An admin picks the version when connecting the account and changes it after upgrading Plane. Every account made before this is on the first entry, Plane 1.3.

## Considered options

- **Follow the newest Plane release only.** Rejected: the day the code moves to a new path, every self-hosted Plane that has not upgraded stops working.
- **Detect the release on every request and adapt.** Rejected: the release is not always readable (Plane's cloud, a proxy), and the bot's behaviour would change under an account without anyone choosing it. The release is read only to suggest a version and to warn when it falls outside the chosen one's range.
- **Let the console define versions.** Rejected: a version is tool code, so only a new build of the server can add one.

## Consequences

- Tool names and arguments do not change between versions, so Effect, Write confirmation, Availability rules and the audit, all keyed by tool name, need nothing per version. A tool whose meaning changes gets a new name.
- A version decides which Plane tools exist (`versions` in a tool's policy; none listed means every version) and how a request is sent (`PlaneConn.version`). Where releases differ, the module that owns a call branches on `conn.version.id`, as the git skill branches on provider.
- An entry that has shipped keeps its meaning. Supporting a new release means adding an entry, and accounts still on the older one keep working.
- An account on a version the server does not know, or without the tool asked for, refuses in plain words before any Confirm; the bot's other Plane accounts keep working.

## Amendment, 2026-10-20: the first entry is exactly Plane 1.3.1

The first entry shipped as "Plane 1.3", covering releases 1.3.0 up to 1.4.0, although its tools were checked against v1.3.1 alone. At the user's request it was renamed once to `1.3.1`, covering that release only (1.3.1 up to 1.3.2), and every stored `1.3` was migrated on every engine. A Plane on 1.3.0 or 1.3.2 now gets the mismatch note instead of passing silently. This was the only time a shipped entry changed its meaning. From here on, an entry that has shipped keeps its meaning.
