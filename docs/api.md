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
| POST | `/api/admin/tenants/:id/profiles` | `{name, provider: openai, anthropic or custom, model, baseUrl? (required for custom), apiKey?, acceptsImages?}` -> `{profile}` (key never returned, `hasApiKey` only). `acceptsImages` (boolean, default false) lets the bot send attached images to this profile |
| GET | `/api/admin/tenants/:id/profiles` | `{profiles}`, each with `acceptsImages` |
| POST | `/api/admin/profiles/models` | `{provider, baseUrl?, apiKey?, profileId?}` -> `{models}` from `<baseUrl>/models`; a blank key reuses the saved profile key; 502 on provider failure |
| POST | `/api/admin/profiles/test` | `{provider, model, baseUrl?, apiKey?, profileId?}` -> `{success, text: {ok, message}, image: {ok, message}}`: a text request, then a tiny PNG in the provider's image shape. The image is not tried when text fails; `success` is the text result. A blank key reuses the saved profile key |
| PATCH | `/api/admin/profiles/:profileId` | Profile fields, `acceptsImages` included; blank or masked `apiKey` keeps the current one |
| DELETE | `/api/admin/profiles/:profileId` | Delete; integrations using it fall back to the tenant default |
| POST | `/api/admin/tenants/:id/bots` | `{name?, token, clientId?, guildIds?, profileId?, isEnabled?}` -> `{bot}`; `profileId` must belong to the tenant |
| GET | `/api/admin/tenants/:id/bots` | `{bots}` |
| PATCH | `/api/admin/bots/:botId` | Bot fields; token encrypted on write |
| POST | `/api/admin/bots/:botId/restart` | Restart this gateway |
| DELETE | `/api/admin/bots/:botId` | Stop and remove bot from active listings |
| GET | `/api/admin/tenants/:id/skills` | `{skills}`: each `{id, name, description, isEnabled, groups, tools, toolCount}`. `tools` come from the code registry: `{name, description, effect: read, write or danger, group?, playbook?}`. `groups` lists the skill's groups in display order (Git only); `playbook` marks a tool that only serves that playbook |
| PATCH | `/api/admin/tenants/:id/skills/:skillId` | `{isEnabled}` turns the skill on or off for the tenant |
| GET, PUT, DELETE | `/api/admin/tenants/:id/availability` | Tenant-level availability rules (see below) |
| GET, PUT, DELETE | `/api/admin/bots/:botId/availability` | Bot-level availability rules |
| GET, PUT, DELETE | `/api/admin/bots/:botId/guilds/:guildId/availability` | Rules for one guild of that bot |
| GET, PUT, DELETE | `/api/admin/bots/:botId/guilds/:guildId/channels/:channelId/availability` | Rules for one channel of that guild; its threads follow them |
| GET | `/api/admin/tenants/:id/usage?from=&to=` | `{usage}` grouped by tenant/type/provider/model |
| GET | `/api/admin/usage?from=&to=` | Platform usage aggregation |
| GET | `/api/admin/tenants/:id/workspace/tree?path=` | `{entries}` of one folder. The root also lists a read-only `playbooks` folder; listing it shows the built-in playbooks, each with `overridden` true when the tenant has its own copy |
| GET | `/api/admin/tenants/:id/workspace/file?path=` | `{content, version}`; a file under `playbooks/` returns `version: "builtin"` and `readOnly: true` |
| PUT | `/api/admin/tenants/:id/workspace/file` | `{path, content, version?}`; `version` is required to replace an existing file, 409 when it changed. Paths under `playbooks/` return 403 |
| POST | `/api/admin/tenants/:id/workspace/move` | `{from, to}`; 403 under `playbooks/` |
| DELETE | `/api/admin/tenants/:id/workspace/file?path=` | Delete a file; 403 under `playbooks/` |
| POST | `/api/admin/tenants/:id/workspace/playbooks/:name/override` | Copies built-in playbook `:name` to `shared/playbooks/:name`, where the tenant can edit it -> `{path}`; 404 for an unknown name, 409 when an override exists |
| DELETE | `/api/admin/tenants/:id/workspace/playbooks/:name` | Deletes the tenant's `shared/playbooks/:name` folder; the built-in of the same name applies again. 404 when there is none |
| GET, PUT | `/api/admin/infrastructure` | Host database/Redis settings |
| POST | `/api/admin/infrastructure/test-db` | `{databaseUrl?}` -> connection test |
| POST | `/api/admin/infrastructure/test-redis` | Redis connection test |

Usage ranges accept ISO dates, including both boundaries. Invalid or reversed ranges return 400. Events include `llm_tokens` (successful completions with prompt/completion token counts; `metadata` holds `cachedTokens` and `latencyMs`, the provider's response time in milliseconds), `tool_call` (tool name/success), and `discord_message` (accepted inbound requests). Bot deletion retains a disabled tombstone to preserve historical usage/conversation references and erases its token.

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
| GET, PUT, DELETE | `/api/v1/availability` | Tenant-level availability rules |
| GET, PUT, DELETE | `/api/v1/bots/:id/availability`, `.../guilds/:guildId/availability`, `.../guilds/:guildId/channels/:channelId/availability` | Bot, guild and channel rules of an owned bot; another tenant's bot returns 404 |

**Availability rules.** A rule turns something off at one level: the tenant, a bot, a guild of that bot, or a channel of that guild. A level without a rule inherits what the level above allows, so a tenant with no rules is offered every tool of its enabled skills. A tool is offered, and runs, only when its skill and the tool itself are available at the place the message came from; a thread uses its parent channel. `GET` returns `{rules}` of that level, each `{kind, name, value}`. `PUT {kind, name, value}` sets one rule and `DELETE ?kind=&name=` clears one; both return the level's `{rules}`. `kind` is `skill` or `tool` (`playbook` and `effect` are reserved and refused for now), `value` is `off`, `opt_in` or `on`. `opt_in` (bot or guild only) keeps the target available at that level but off at each level below until one says `on`, so a guild opt-in reaches only the channels that say `on`, and a channel seen later does not get it. `on` (guild or channel only) answers an `opt_in` on the same target at a level above; an `off` anywhere above still wins. 400 with `{error}` for `on` without an `opt_in` above, `opt_in` at the tenant or a channel, `on` at the tenant or a bot, an unknown skill or tool, a tool that serves a playbook (it follows its playbook), or a skill rule at the tenant level (use the skill switch). Deleting a bot removes its rules.

Credential config fields are `openaiApiKeyEncrypted`, `anthropicApiKeyEncrypted`, and `customApiKeyEncrypted`. On writes these accept **plaintext** and encrypt server-side; reads return `••••••••` or null. Omitted/masked values preserve the existing key; null or empty clears it. Bot responses expose `hasToken` rather than a token. Old unauthenticated `/api/agent/*`, `/api/tasks`, and `/api/skills` endpoints are removed.


## Discord server config (platform admin, `X-Platform-Key`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/bots/:botId/guilds/:guildId/config` | `{systemPrompt, useThreads, alwaysChannelIds}`; defaults when unset |
| PUT | `/api/admin/bots/:botId/guilds/:guildId/config` | Partial update. `systemPrompt` ≤ 8000 chars (empty clears), `useThreads` boolean, `alwaysChannelIds` string[] (max 50) |

`systemPrompt` is appended to the tenant prompt under "Server instructions" for that server only. The bot answers DMs, its own threads, `alwaysChannelIds` channels, and @mentions or replies to it. With `useThreads`, a mention opens a thread and the conversation continues there without mentions. Guild conversations are shared per channel or thread, and turns are prefixed with the speaker's name.
