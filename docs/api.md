# API Reference

Base URL lokal: `http://localhost:3001`.

## API Keys and Tenants

API keys are global. A key may act only on tenants created under it; a tenant's `apiKeyId` is `null` when it is not under any key (for example, created from the console without choosing one).

```bash
# Create a key (raw value is returned once):
curl -X POST http://localhost:3001/api/admin/api-keys \
  -H "X-Platform-Key: $PLATFORM_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Production"}'

# Create a tenant under that key:
curl -X POST http://localhost:3001/api/v1/tenants \
  -H "Authorization: Bearer $PACHIWARE_API_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Example Team","slug":"example"}'

# Act on it (tenant id or slug in X-Tenant-Id):
curl http://localhost:3001/api/v1/tasks \
  -H "Authorization: Bearer $PACHIWARE_API_KEY" -H "X-Tenant-Id: example"
```

The issue response contains `{success, raw, keyPrefix, keyId}`. `raw` is returned once; key-list endpoints expose metadata and prefixes only. Keys currently get scope `*` (full access); the middleware already enforces `resource:read` / `resource:write` scopes for when custom scopes are added.

## API Contract

`GET /api/health` is public: readiness, data-store health, and an array of active bot runtime statuses. A database with no tenants reports `setupRequired: true`.

All `/api/admin/*` requests require `X-Platform-Key`. JSON mutations require `Content-Type: application/json`.

| Method | Admin Endpoint | Input / Result |
| --- | --- | --- |
| POST | `/api/admin/tenants` | `{name, slug?, apiKeyId?, metadata?}` -> `{tenant}`; duplicate slug returns 409 |
| GET | `/api/admin/tenants` | `{tenants}` (excludes deleted) |
| GET | `/api/admin/tenants/:id` | `{tenant}` |
| PATCH | `/api/admin/tenants/:id` | `{name?, status?: active or suspended, metadata?}`; slug immutable |
| DELETE | `/api/admin/tenants/:id` | Soft delete; stops tenant bots |
| POST | `/api/admin/api-keys` | `{name?}` -> raw key once |
| GET | `/api/admin/api-keys` | `{apiKeys}` (prefix, metadata, `tenantCount`) |
| DELETE | `/api/admin/api-keys/:keyId` | Revoke key |
| POST | `/api/admin/tenants/:id/profiles` | `{name, provider: openai or custom, model, baseUrl? (required for custom), apiKey?}` -> `{profile}` (key never returned, `hasApiKey` only) |
| GET | `/api/admin/tenants/:id/profiles` | `{profiles}` |
| POST | `/api/admin/profiles/models` | `{provider, baseUrl?, apiKey?, profileId?}` -> `{models}` from `<baseUrl>/models`; a blank key reuses the saved profile key; 502 on provider failure |
| PATCH | `/api/admin/profiles/:profileId` | Profile fields; blank or masked `apiKey` keeps the current one |
| DELETE | `/api/admin/profiles/:profileId` | Delete; integrations using it fall back to the tenant default |
| POST | `/api/admin/tenants/:id/bots` | `{name?, token, clientId?, guildIds?, profileId?, isEnabled?}` -> `{bot}`; `profileId` must belong to the tenant |
| GET | `/api/admin/tenants/:id/bots` | `{bots}` |
| PATCH | `/api/admin/bots/:botId` | Bot fields; token encrypted on write |
| POST | `/api/admin/bots/:botId/restart` | Restart this gateway |
| DELETE | `/api/admin/bots/:botId` | Stop and remove bot from active listings |
| GET | `/api/admin/tenants/:id/usage?from=&to=` | `{usage}` grouped by tenant/type/provider/model |
| GET | `/api/admin/usage?from=&to=` | Platform usage aggregation |
| GET, PUT | `/api/admin/infrastructure` | Host database/Redis settings |
| POST | `/api/admin/infrastructure/test-db` | `{databaseUrl?}` -> connection test |
| POST | `/api/admin/infrastructure/test-redis` | Redis connection test |

Usage ranges accept ISO dates, including both boundaries. Invalid or reversed ranges return 400. Events include `llm_tokens` (successful completions with prompt/completion token counts), `tool_call` (tool name/success), and `discord_message` (accepted inbound requests). Bot deletion retains a disabled tombstone to preserve historical usage/conversation references and erases its token.

All `/api/v1/*` requests require `Authorization: Bearer <API key>`. Except `/api/v1/tenants`, they also require `X-Tenant-Id` (id or slug): missing header returns 400, a tenant that does not exist or is not under the key returns 404. Missing/revoked keys return 401; suspended tenants and insufficient scopes return 403.

| Method | Key Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/tenants` | Tenants under this key |
| POST | `/api/v1/tenants` | `{name, slug?}` -> `{tenant}` owned by this key |

| Method | Tenant Endpoint | Purpose |
| --- | --- | --- |
| GET, PUT | `/api/v1/config` | Prompt, model, settings, provider credentials |
| POST | `/api/v1/config/test/llm` | `{provider, apiKey?, baseUrl?}`; masked key uses saved tenant credential |
| POST | `/api/v1/chat` | `{message, conversationId?}` -> reply, steps, tools, conversation ID |
| GET | `/api/v1/conversations` | Tenant conversations |
| GET | `/api/v1/conversations/:id/messages` | Tenant-owned history |
| GET, POST | `/api/v1/tasks` | Filter/search/counts or create task |
| PATCH, DELETE | `/api/v1/tasks/:id` | Update/delete owned task |
| GET | `/api/v1/skills` | Platform definitions plus tenant state |
| PATCH | `/api/v1/skills/:id/toggle` | Toggle tenant skill |
| PUT | `/api/v1/skills/:id` | `{config}` tenant skill settings |
| POST | `/api/v1/skills/test` | `{toolName, arguments?}` execute enabled tenant tool |
| GET, POST | `/api/v1/bots` | List/add tenant bots |
| PATCH, DELETE | `/api/v1/bots/:id` | Update/delete tenant bot |
| POST | `/api/v1/bots/:id/test` | `{token?}` test provided or stored token |
| POST | `/api/v1/bots/:id/restart` | Restart owned gateway |

Credential config fields are `openaiApiKeyEncrypted`, `anthropicApiKeyEncrypted`, and `customApiKeyEncrypted`. On writes these accept **plaintext** and encrypt server-side; reads return `••••••••` or null. Omitted/masked values preserve the existing key; null or empty clears it. Bot responses expose `hasToken` rather than a token. Old unauthenticated `/api/agent/*`, `/api/tasks`, and `/api/skills` endpoints are removed.


## Discord server config (platform admin, `X-Platform-Key`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/bots/:botId/guilds/:guildId/config` | `{systemPrompt, useThreads, alwaysChannelIds}`; defaults when unset |
| PUT | `/api/admin/bots/:botId/guilds/:guildId/config` | Partial update. `systemPrompt` ≤ 8000 chars (empty clears), `useThreads` boolean, `alwaysChannelIds` string[] (max 50) |

`systemPrompt` is appended to the tenant prompt under "Server instructions" for that server only. The bot answers DMs, its own threads, `alwaysChannelIds` channels, and @mentions or replies to it. With `useThreads`, a mention opens a thread and the conversation continues there without mentions. Guild conversations are shared per channel or thread, and turns are prefixed with the speaker's name.
