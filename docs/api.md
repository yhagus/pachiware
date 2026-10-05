# API Reference

Base URL lokal: `http://localhost:3001`.

## Provision a Tenant and API Key

```bash
curl -X POST http://localhost:3001/api/admin/tenants \
  -H "X-Platform-Key: $PLATFORM_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Example Team","slug":"example"}'

# Use the tenant ID returned above:
curl -X POST http://localhost:3001/api/admin/tenants/TENANT_ID/api-keys \
  -H "X-Platform-Key: $PLATFORM_ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Operator","scopes":[]}'
```

The issue response contains `{success, raw, keyPrefix, keyId}`. `raw` is returned once; key-list endpoints expose metadata and prefixes only. Empty scopes or `*` grant full tenant access. Otherwise scopes use `resource:read` or `resource:write`, where resource is `config`, `chat`, `conversations`, `skills`, `tasks`, or `bots`. GET uses `read`; other methods use `write`.

```bash
curl http://localhost:3001/api/v1/tasks -H "Authorization: Bearer $PACHIWARE_API_KEY"
```

## API Contract

`GET /api/health` is public: readiness, data-store health, and an array of active bot runtime statuses. A database with no tenants reports `setupRequired: true`.

All `/api/admin/*` requests require `X-Platform-Key`. JSON mutations require `Content-Type: application/json`.

| Method | Admin Endpoint | Input / Result |
| --- | --- | --- |
| POST | `/api/admin/tenants` | `{name, slug?, metadata?}` -> `{tenant}` |
| GET | `/api/admin/tenants` | `{tenants}` (excludes deleted) |
| GET | `/api/admin/tenants/:id` | `{tenant}` |
| PATCH | `/api/admin/tenants/:id` | `{name?, status?: active or suspended, metadata?}`; slug immutable |
| DELETE | `/api/admin/tenants/:id` | Soft delete; stops tenant bots |
| POST | `/api/admin/tenants/:id/api-keys` | `{name?, scopes?}` -> raw key once |
| GET | `/api/admin/tenants/:id/api-keys` | `{apiKeys}` (prefix and metadata) |
| DELETE | `/api/admin/api-keys/:keyId` | Revoke key |
| POST | `/api/admin/tenants/:id/bots` | `{name?, token, clientId?, guildIds?, isEnabled?}` -> `{bot}` |
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

All `/api/v1/*` requests require `Authorization: Bearer <tenant API key>`. Missing/revoked/deleted keys return 401; suspended tenants and insufficient scopes return 403.

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

