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
| GET, PUT | `/api/admin/tenants/:id/settings` | `{timezone, language}`: the tenant's defaults (seeded `Asia/Jakarta`, `id`). PUT is partial; `timezone` must be an IANA name, `language` `id` or `en` |
| POST | `/api/admin/api-keys` | `{name?}` -> raw key once |
| GET | `/api/admin/api-keys` | `{apiKeys}` (prefix, metadata, `tenantCount`) |
| DELETE | `/api/admin/api-keys/:keyId` | Revoke key |
| POST | `/api/admin/tenants/:id/profiles` | `{name, provider: openai, anthropic or custom, model, baseUrl? (required for custom), apiKey?, acceptsImages?, apiFormat?}` -> `{profile}`. `apiFormat` (`chat_completions` default, `responses` or `messages`) is the request shape a `custom` (BYOK) profile speaks: `<baseUrl>/chat/completions`, `<baseUrl>/responses` (stateless, `store: false`, function tools with `strict: false`) or `<baseUrl>/messages` (sent with both `x-api-key` and `Authorization: Bearer`). OpenAI profiles always use Chat Completions and Anthropic ones Messages (key never returned, `hasApiKey` only). `acceptsImages` (boolean, default false) lets the bot send attached images to this profile |
| GET | `/api/admin/tenants/:id/profiles` | `{profiles}`, each with `acceptsImages` and `apiFormat` |
| POST | `/api/admin/profiles/models` | `{provider, apiFormat?, baseUrl?, apiKey?, profileId?}` -> `{models}` from `<baseUrl>/models`; a blank key reuses the saved profile key; 502 on provider failure |
| POST | `/api/admin/profiles/test` | `{provider, apiFormat?, model, baseUrl?, apiKey?, profileId?}` -> `{success, checks: {url, key, model, text, image}}`, each `{status: ok, warning, failed or skipped, message, reply?}`. In order: `GET <baseUrl>/models` (reachable, key refused on 401/403, model listed or not), a text request asking for `OK`, then a tiny red PNG in the provider's image shape whose named colour is checked. It stops at an unreachable host or a refused key; with no model list, the text request confirms the key and model. A 200 that is not in the API format's response shape fails the text step, naming the other format when the answer has a known shape, or the content type and first characters otherwise. `success` is true when text replied. A blank key reuses the saved profile key |
| POST | `/api/admin/profiles/playground` | `{provider, apiFormat?, model, baseUrl?, apiKey?, profileId?, system?, prompt}` -> `{success: true, reply, finishReason, usage: {input, output} or null, ms}` or `{success: false, status?, error, ms}`. One user message (1024 max tokens, 60 s timeout), no history; `prompt` and `system` together at most 20000 characters |
| PATCH | `/api/admin/profiles/:profileId` | Profile fields, `acceptsImages` included; blank or masked `apiKey` keeps the current one |
| DELETE | `/api/admin/profiles/:profileId` | Delete; integrations using it fall back to the tenant default |
| POST | `/api/admin/tenants/:id/bots` | `{name?, token, clientId?, guildIds?, profileId?, gitAccountIds?, planeAccountIds?, isEnabled?}` -> `{bot}`; the profile and accounts must belong to the tenant. Attaching a Plane account switches the `plane` skill on; Plane stays off in a guild until it has a rule |
| GET | `/api/admin/tenants/:id/bots` | `{bots}` |
| PATCH | `/api/admin/bots/:botId` | Bot fields; token encrypted on write |
| POST | `/api/admin/bots/:botId/restart` | Restart this gateway |
| DELETE | `/api/admin/bots/:botId` | Stop and remove bot from active listings |
| GET | `/api/admin/tenants/:id/plane-accounts` | `{planeAccounts}`, each `{id, name, baseUrl (null for Plane's cloud), workspaceSlug, planeUserId, planeUserName, hasApiKey, apiKey: "••••••••", bots}`. The key is never returned |
| POST | `/api/admin/tenants/:id/plane-accounts` | `{name, baseUrl?, workspaceSlug, apiKey}` -> 201 `{planeAccount}`. Plane's `users/me/` and the workspace's projects are called first; a bad key, a wrong slug, a redirect, plain http on a host not on Allowed hosts, or a host outside a non-empty Allowed hosts gives 400 naming which. 409 for a taken name |
| PATCH | `/api/admin/plane-accounts/:accountId` | Account fields; a blank or masked `apiKey` keeps the saved one. A new `baseUrl` needs the key again; a new key, slug or URL is checked with Plane again |
| DELETE | `/api/admin/plane-accounts/:accountId` | Delete; 409 with `{bots}` while an integration uses it |
| GET | `/api/admin/plane-accounts/:accountId/projects` | `{projects}`, each `{id, name, identifier}`, as the account's Plane user sees them; 502 when Plane fails |
| GET | `/api/admin/bots/:botId/guilds/:guildId/plane` | `{accounts, guild, channels}`: the bot's Plane accounts, the guild's Plane scope rules, and each channel's |
| PUT | `/api/admin/bots/:botId/guilds/:guildId/plane` | `{rules: [{planeAccountId, projectIds}]}`; `projectIds` are Plane project ids, or `["*"]` for all. Replaces the guild rules and prunes channel rules that no longer fit |
| PUT | `/api/admin/bots/:botId/guilds/:guildId/channels/:channelId/plane` | Same body; a channel rule must sit inside the guild rule. Threads follow their channel |
| GET | `/api/admin/tenants/:id/skills` | `{skills, playbooks}`. `skills`: each `{id, name, description, isEnabled, groups, tools, toolCount}`. `tools` come from the code registry: `{name, description, effect: read, write or danger, group?, playbook?}`. `groups` lists the skill's groups in display order (git and Plane); `playbook` marks a tool that only serves that playbook. `{playbooks}` lists the tenant's playbooks (built-in and its own), each `{name, description, requires}` with `requires` the skill ids it needs |
| PATCH | `/api/admin/tenants/:id/skills/:skillId` | `{isEnabled}` turns the skill on or off for the tenant |
| GET, PUT, DELETE | `/api/admin/tenants/:id/availability` | Tenant-level availability rules (see below) |
| GET, PUT, DELETE | `/api/admin/bots/:botId/availability` | Bot-level availability rules |
| GET, PUT, DELETE | `/api/admin/bots/:botId/guilds/:guildId/availability` | Rules for one guild of that bot |
| GET, PUT, DELETE | `/api/admin/bots/:botId/guilds/:guildId/channels/:channelId/availability` | Rules for one channel of that guild; its threads follow them |
| GET | `/api/admin/bots/:botId/reminders` | `{reminders}`: the bot's active Reminders, soonest first, each `{id, ownerId, ownerName, guildId, channelId, text, withTasks, mentions, recurrence, weekdays, dayOfMonth, timeOfDay, timezone, until, nextAt, lastFiredAt, createdAt}`. Reminders are set from chat; nothing creates one here |
| DELETE | `/api/admin/bots/:botId/reminders/:reminderId` | Marks the Reminder cancelled (the row stays) -> `{reminder}`; 404 when it is not an active Reminder of that bot |
| GET | `/api/admin/tenants/:id/usage?from=&to=` | `{usage}` grouped by tenant/type/provider/model |
| GET | `/api/admin/usage?from=&to=` | Platform usage aggregation |
| GET | `/api/admin/tenants/:id/workspace/tree?path=` | `{entries}` of one folder. The root also lists a read-only `playbooks` folder; listing it shows the built-in playbooks, each with `overridden` true when the tenant has its own copy |
| GET | `/api/admin/tenants/:id/workspace/file?path=` | `{content, version}`; a file under `playbooks/` returns `version: "builtin"` and `readOnly: true` |
| PUT | `/api/admin/tenants/:id/workspace/file` | `{path, content, version?}`; `version` is required to replace an existing file, 409 when it changed. Paths under `playbooks/` return 403 |
| POST | `/api/admin/tenants/:id/workspace/move` | `{from, to}`; 403 under `playbooks/` |
| DELETE | `/api/admin/tenants/:id/workspace/file?path=` | Delete a file; 403 under `playbooks/` |
| POST | `/api/admin/tenants/:id/workspace/playbooks/:name/override` | Copies built-in playbook `:name` to `shared/playbooks/:name`, where the tenant can edit it -> `{path}`; 404 for an unknown name, 409 when an override exists |
| DELETE | `/api/admin/tenants/:id/workspace/playbooks/:name` | Deletes the tenant's `shared/playbooks/:name` folder; the built-in of the same name applies again. 404 when there is none |
| GET | `/api/admin/infrastructure` | `{databaseEngine, databaseHost, redisUrl, ...}`; the host has no credentials and is null for SQLite |
| PUT | `/api/admin/infrastructure` | `{redisUrl}`. A `databaseUrl` is rejected with 400: the database engine is fixed at setup and its address changes only on the server (ADR 0010) |
| POST | `/api/admin/infrastructure/test-redis` | Redis connection test |
| GET, PUT | `/api/admin/infrastructure/allowed-hosts` | `{hosts}`: Allowed hosts, the self-hosted git and Plane servers accounts may use (empty = unrestricted). `/infrastructure/git-hosts` is its older path |

Usage ranges accept ISO dates, including both boundaries. Invalid or reversed ranges return 400. Each aggregate row carries `events`, `promptTokens`, `completionTokens`, and `cachedTokens` (the prompt tokens the provider served from its cache). Events include `llm_tokens` (successful completions with prompt/completion token counts; `metadata` holds `cachedTokens` and `latencyMs`, the provider's response time in milliseconds), `tool_call` (tool name/success), and `discord_message` (accepted inbound requests). Guardrail audit events (`guardrail_denied`, `tool_denied`, `confirmation_requested`, `confirmation_accepted`, `prompt_injection_detected` and the `thread_confirmation_*` ones) count here by type; their `metadata` holds categories and ids only. `confirmation_requested` holds `{tool, effect, confirmationId}`; rows written before effects replaced risk levels hold `risk` (`read`, `write` or `destructive`) instead of `effect`. Bot deletion retains a disabled tombstone to preserve historical usage/conversation references and erases its token.

All `/api/v1/*` requests require `Authorization: Bearer <API key>`. Except `/api/v1/tenants`, they also require `X-Tenant-Id` (id or slug): missing header returns 400, a tenant that does not exist or is not under the key returns 404. Missing/revoked keys return 401; suspended tenants and insufficient scopes return 403.

| Method | Key Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/tenants` | Tenants under this key |
| POST | `/api/v1/tenants` | `{name, slug?}` -> `{tenant}` owned by this key |

| Method | Tenant Endpoint | Purpose |
| --- | --- | --- |
| GET, PUT | `/api/v1/config` | Prompt, model, settings, provider credentials, `timezone` (IANA) and `language` (`id` or `en`) |
| POST | `/api/v1/config/test/llm` | `{provider, apiKey?, baseUrl?}`; masked key uses saved tenant credential |
| POST | `/api/v1/chat` | `{message, conversationId?}` -> reply, steps, tools, conversation ID. A `message` over 50,000 characters is not run: `reply` is the refusal, in the language the message was written in, with `iterations` 0 |
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
| GET | `/api/v1/bots/:id/reminders` | Active Reminders of an owned bot, as the admin endpoint returns them |
| DELETE | `/api/v1/bots/:id/reminders/:reminderId` | Cancels one; another tenant's bot or Reminder returns 404 |

**Availability rules.** A rule turns something off at one level: the tenant, a bot, a guild of that bot, or a channel of that guild. A level without a rule inherits what the level above allows, so a tenant with no rules is offered every tool of its enabled skills. A tool is offered, and runs, only when its skill, the tool itself, and its effect are available at the place the message came from; a thread uses its parent channel. An effect rule (`name` is `read`, `write` or `danger`) covers every tool with that effect, including multi-action tools, playbook tools and tools added later; a tool whose effect is off stays off whatever its own rules say below. A playbook starts only where the playbook and every skill it requires are available; the tools that serve it are available exactly where it is (and its effect allows them), and a thread bound to it ends with a short note on its next message once it is not. `GET` returns `{rules, inherited}` of that level. `rules` are the level's own, each `{kind, name, value}`. `inherited` is what the levels above leave it: one `{kind, name, available, off?, optIn?}` per target that a level above has a rule on, plus each skill the tenant switch turned off (as `off: "tenant"`). `available` is whether the target reaches this level, `off` names the highest level above that turns it off, and `optIn` the lowest level above that made it opt-in (with `available: false` and no `off`, it waits for an `on` here or below). A target not listed is available from above; the tenant level inherits nothing. `PUT {kind, name, value}` sets one rule and `DELETE ?kind=&name=` clears one (the target then follows `inherited` again); both return the level's `{rules, inherited}`. `kind` is `playbook`, `skill`, `tool` or `effect`, `value` is `off`, `opt_in` or `on`. `opt_in` (bot or guild only) keeps the target available at that level but off at each level below until one says `on`, so a guild opt-in reaches only the channels that say `on`, and a channel seen later does not get it. `on` (guild or channel only) answers an `opt_in` on the same target at a level above. A rule cannot turn back on what is off above: 400 for an `opt_in` or `on` on a target that a level above turns off, and for a tool also when its skill or its effect is off above; an `off` written above later still wins over an `on` below. Writing the same target twice replaces its value. 400 with `{error}` for `on` without an `opt_in` above, `opt_in` at the tenant or a channel, `on` at the tenant or a bot, an unknown playbook (built-in or the tenant's own), skill, tool or effect, a tool that serves a playbook (it follows its playbook), or a skill rule at the tenant level (use the skill switch). Deleting a bot removes its rules.

Credential config fields are `openaiApiKeyEncrypted`, `anthropicApiKeyEncrypted`, and `customApiKeyEncrypted`. On writes these accept **plaintext** and encrypt server-side; reads return `••••••••` or null. Omitted/masked values preserve the existing key; null or empty clears it. Bot responses expose `hasToken` rather than a token. Old unauthenticated `/api/agent/*`, `/api/tasks`, and `/api/skills` endpoints are removed.


## Discord server config (platform admin, `X-Platform-Key`)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/bots/:botId/guilds/:guildId/config` | `{systemPrompt, useThreads, alwaysChannelIds, timezone, language, digestChannels}`; defaults when unset (`timezone` and `language` null mean the tenant's) |
| PUT | `/api/admin/bots/:botId/guilds/:guildId/config` | Partial update. `systemPrompt` ≤ 8000 chars (empty clears), `useThreads` boolean, `alwaysChannelIds` string[] (max 50), `timezone` IANA name or null, `language` `id`, `en` or null, `digestChannels` `[{channelId, hour}]` (hour 0 to 23, one entry per channel, max 50). Saving keeps one daily `digest` schedule row per entry in the guild's zone and cancels the rows of entries removed |

`systemPrompt` is appended to the tenant prompt under "Server instructions" for that server only. The bot answers DMs, its own threads, `alwaysChannelIds` channels, and @mentions or replies to it. With `useThreads`, a mention opens a thread and the conversation continues there without mentions. Guild conversations are shared per channel or thread, and turns are prefixed with the speaker's name.
