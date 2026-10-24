# Extension reference

The validator behind `finishChangelog` holds the JSON Schema for these extensions; the OpenAPI Schema Viewer relies on it. The tools fill in the summary and each operation's x-impact.

## `info.x-changelog`

`startChangelog` writes it; `putChangelogNotes` sets its lists.

```json
{
  "date": "2026-10-22",
  "base": { "ref": "main before 2026-10-01", "commit": "9f8e7d6" },
  "head": { "ref": "main through 2026-10-22", "commit": "a1b2c3d" },
  "summary": { "breaking": 4, "deprecated": 1, "non-breaking": 2 },
  "globalChanges": [],
  "removedOperations": [],
  "unverified": [],
  "setAside": [{ "pattern": "**/*.spec.ts", "reason": "Tests; they are not served" }]
}
```

- The summary counts every change entry (each operation's x-changes plus `x-changelog.globalChanges`), and each item of `x-changelog.removedOperations` counts as breaking.
- `x-changelog.setAside` names the changed files left unmapped, by pattern, each with why they cannot change what the frontend sees (tests, docs, CI, lockfiles). `**` crosses folders, `*` and `?` stay in one, and a pattern without a slash matches a file name at any depth. It is optional and stays in the written changelog, so a reader sees what was not read. A pattern covering every changed file, or every file not yet mapped while those are most of them, is refused.
- A removed operation is `{ "method": "delete", "path": "/api/v1/sessions", "replacedBy": "POST /api/v2/sessions/revoke", "note": "..." }`; replacedBy and note are optional. Endpoints that exist only in base go there. A moved endpoint (same behavior, new URL or method) is recorded once, on its new operation as an `in: url` change, not there as well.

## On each operation

x-impact (the most severe impact among its changes, set by `putChangelogOperation`), x-changes (at least one entry), and optionally x-unverified.

**Change entry**

| Key | Meaning |
|---|---|
| `status` | `NEW`, `CHANGED`, `RENAMED`, `DEPRECATED`, `REMOVED` |
| `impact` | `breaking`, `deprecated`, `non-breaking` |
| `in` | `operation`, `url`, `path`, `query`, `header`, `cookie`, `body`, `security`, `envelope`, or `response.<status>` (`response.201`, `response.4XX`, `response.default`) |
| `field` | parameter name, or a dotted path into the body: `data.items[].price` (`[]` steps into array items). Required for parameter locations. Omit it when the entry is about the whole response or operation. |
| `code` | application error code, for error responses |
| `from` | old name; required for `RENAMED` |
| `before` / `after` | only the facets that changed, e.g. `{ "required": false }` → `{ "required": true }`; required for `CHANGED` and for `in: url` |
| `removal` | when a deprecated item goes away (version or date) |
| `note` | short factual note |

A new endpoint gets `{ "status": "NEW", "impact": "non-breaking", "in": "operation" }`. A method change is an `in: url` change such as `"before": "POST /api/users", "after": "PUT /api/users"`.

**Unverified entry:** `{ "in": "response.200", "field": "data.metadata", "reason": "Passed through unchanged from the payment gateway; its shape is not defined in this codebase" }`

## Example operation

Sent with `putChangelogOperation` as method `post`, path `/api/v2/users`, and this operation:

```json
{
  "operationId": "createUser",
  "summary": "Create user",
  "x-changes": [
    { "status": "CHANGED", "impact": "breaking", "in": "url", "before": "POST /api/v1/users", "after": "POST /api/v2/users" },
    { "status": "RENAMED", "impact": "breaking", "in": "body", "field": "full_name", "from": "name" },
    { "status": "CHANGED", "impact": "breaking", "in": "body", "field": "phone", "before": { "required": false }, "after": { "required": true, "format": "E.164" } },
    { "status": "NEW", "impact": "non-breaking", "in": "response.409", "code": "PHONE_ALREADY_USED" }
  ],
  "security": [{ "bearerAuth": [] }],
  "requestBody": { "...": "full schema and example" },
  "responses": { "...": "201, 409, 422 with schemas and examples" }
}
```
