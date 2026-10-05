# Pachiware Agent

A self-hosted, tenant-aware AI agent engine built with Bun, Hono, Drizzle, SQLite/PostgreSQL, and Discord.js. Each tenant owns an agent configuration, provider credentials, skills, tasks, conversations, usage events, and any number of Discord bots.

## Architecture

Pachiware is the **data plane**: it runs agents, tools, and bots. Your external SaaS **control plane** owns users, signup, billing, plans, and quotas. No signup or billing application is included here.

```text
External SaaS control plane -- X-Platform-Key --> /api/admin/*
Operator console / API client -- Bearer API key --> /api/v1/*
DiscordBotManager -- botId --> tenantId --> ReAct loop --> tools / LLM
                                         |
                                SQLite or PostgreSQL
                                  + optional Redis
```

API keys identify tenants without becoming the tenant identity. They can be scoped, rotated, and revoked independently. Tenant ownership is checked on queries and tool execution; composite database foreign keys prevent linking messages or bots across tenants. Cache and rate-limit keys include tenant IDs.

## Setup

Requires Bun (tested with 1.4.0). SQLite and the native memory cache work without Docker. PostgreSQL 18 and Redis are optional.

```bash
bun install
cp .env.example .env
bun run db:migrate
bun run db:seed
bun run dev:agent
# In another terminal:
bun run dev:web
```

API: `http://localhost:3001`. Operator console: `http://localhost:3000`.

For bundled PostgreSQL and Redis, configure `DATABASE_URL` and run `docker compose up -d`, or use `pachiware start --docker`. The one-line installer remains available:

```bash
curl -fsSL https://raw.githubusercontent.com/yhagus/pachiware/main/install.sh | bash
```

The console is an operator/debug panel. Enter a tenant API key to manage that tenant. Enter a platform key to initialize a tenant or change host infrastructure. Tenant keys are stored in browser localStorage; platform keys remain in sessionStorage. Use the console only on trusted operator devices. `VITE_PACHIWARE_API_KEY` is an optional development default bundled into the GUI; do not place platform keys in frontend env variables.

### First-Run Database Choice

The setup flow makes the database choice explicit:

1. **SQLite** is the zero-config recommendation for a single server. It creates `data/pachiware.db` and needs no Docker, PostgreSQL, or Redis.
2. **PostgreSQL external** accepts an existing PostgreSQL 18 connection URL (local, cloud, or managed).
3. **PostgreSQL 18 Docker** uses the bundled `postgres:18-alpine` and Redis containers. Start them with `pachiware start --docker`; a browser wizard cannot start Docker on the server.

The same choices are available from `pachiware init`, which writes only `DATABASE_URL` to `.env` and explains the next command. The curl installer uses the interactive terminal when available. Piped or automated installs default to SQLite, and can be controlled without prompts using `PACHIWARE_DATABASE=sqlite|postgres|docker` and `PACHIWARE_POSTGRES_URL`.

### Host Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:./data/pachiware.db` | SQLite file, `sqlite::memory:` for tests, or `postgresql://...` |
| `REDIS_URL` | `redis://localhost:6380` | Optional cache; unreachable Redis uses memory fallback |
| `AGENT_PORT`, `AGENT_HOST` | `3001`, `0.0.0.0` | API bind address |
| `AGENT_SECRET_KEY` | Development placeholder | Platform key fallback and development encryption derivation |
| `PLATFORM_ADMIN_KEY` | `AGENT_SECRET_KEY` | Protects all `/api/admin/*` routes |
| `PLATFORM_ENCRYPTION_KEY` | Development derivation only | Canonical base64-encoded 32-byte AES key; required with `NODE_ENV=production` |
| `VITE_API_URL` | Same-origin `/api` | GUI backend URL; Vite dev server proxies to port 3001 |
| `PACHIWARE_API_KEY` | Unset | Tenant credential for `pachiware chat` |

Generate independent platform and encryption credentials before production:

```bash
openssl rand -hex 32
openssl rand -base64 32
```

Store the first output as `PLATFORM_ADMIN_KEY` and the second as `PLATFORM_ENCRYPTION_KEY` in your server environment. Keep the encryption key stable and backed up with your database. Changing it requires decrypting and re-encrypting existing secrets with the old/new keys; it is not an automatic key rotation. AES-256-GCM encrypts provider keys and bot tokens. API keys use 192 random bits and are stored only as SHA-256 hashes plus display prefixes. Responses never return stored hashes, encrypted secrets, or decrypted credentials.

Infrastructure settings can be changed through the admin API or console; changes persist in gitignored `runtime-config.json`. `.env` is not mutated at runtime.

### Bootstrap and Migration

Fresh databases without legacy credentials start with no tenants. Use the console Setup Wizard with your platform key, or provision a tenant through the Admin API below.

An existing single-tenant database is migrated transactionally to `slug: default`. Existing config, skills, tasks, conversations, and messages retain their data and gain tenant ownership. Provider keys are encrypted and the Discord configuration becomes a bot row. SQLite tables are rebuilt to enforce NOT NULL and foreign keys; PostgreSQL columns/primary keys are altered and backfilled. On a fresh database, legacy credential env vars can also create this default tenant.

`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `CUSTOM_LLM_API_KEY`, their URLs/models, and `DEFAULT_LLM_PROVIDER`/`DEFAULT_MODEL` are read **only during the initial bootstrap migration**. Re-running migrations or seeds never imports env credentials into an existing tenant. Runtime provider calls require that tenant's stored credentials; there is no simulated LLM or env fallback.

The bootstrap API key is printed **once after the migration commits**. Save it then. If it is lost, issue another key through the Admin API. Migration requires a configured encryption key or development `AGENT_SECRET_KEY` when importing secrets. Back up an existing database before upgrading.

### Provision a Tenant and API Key

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

## Discord and ReAct

The bot manager runs a separate Discord client per enabled bot under an active tenant. Configure Message Content Intent in the Discord developer portal and invite the bot with channel permissions. Bots respond to mentions, DMs, and their own threads, show typing indicators, split long replies, and send action summaries. Optional `guildIds` restrict accepted guild messages; tool adapters use the incoming guild. Suspending or deleting a tenant stops its bots and rejects subsequent tenant API requests.

Built-in tools include task creation/list/status/assignment and channel creation/list/topic/archive. Disabling all tenant skills leaves no tools available, and direct tool execution checks tenant enablement too. The ReAct loop persists tenant-owned history and never accepts another tenant's conversation ID.

## CLI

`pachiware --help` lists lifecycle commands: `init`, `start [--docker] [--daemon] [--no-gui]`, `stop`, `restart`, `status`, `doctor`, `logs`, `update`, `uninstall`, `db:migrate`, `db:seed`, and `chat`.

```bash
PACHIWARE_API_KEY=pk_live_example pachiware chat 'List my tasks'
```

Provider/bot credentials are managed via tenant APIs or the console, not CLI environment settings.

## Verification

```bash
bun test
bun run typecheck
bun run build
```

Tests use isolated temporary SQLite databases and mocked LLM/Discord integrations; no live credentials, server, or production database are required. PostgreSQL migration verification uses a disposable instance when available. The DB package supports both dialects with matching schema exports.

## Layout

```text
apps/agent/       Hono API, tenant middleware, bot manager, ReAct, LLM router
apps/web/         React/Vite operator console
packages/db/      Dual-dialect schema, migration, seed, crypto, tenancy
packages/skills/  Tool definitions and handlers
packages/cli/     Lifecycle CLI
PROGRESS.md       Implementation status and verification evidence
```
