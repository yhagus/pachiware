# PROGRESS &amp; GOALS: pachiware-agent

## 🎯 End Goals

`pachiware-agent` is an intelligent, self-hosted AI agent platform built with TypeScript and Bun. It features:

- **No heavy frameworks:** Lightweight, explicit ReAct agent execution loop with native tool calling.
- **Multi-channel integration:** Modular messaging gateway (Discord active; WhatsApp, Telegram, Slack planned) providing chat interaction, task creation, conversation channels, and status tracking.
- **Management Web GUI (`apps/web`):** Clean, modern dashboard (Vite + React + Tailwind CSS + Lucide) for managing agent prompts, personality, active skills, tasks (Kanban/List), and LLM routing.
- **LLM Router Adapter:** Direct integration with OpenAI, Anthropic, and custom OpenAI-compatible proxies.
- **Robust Persistence &amp; Performance:** PostgreSQL for persistent entities (agents, skills, tasks, conversations, messages) via Drizzle ORM, with Redis for low-latency session caching, rate-limiting, and state synchronization. Runs with external instances by default or optional bundled local containers.

---

### Verification Evidence

- `bun run typecheck` -&gt; pass.
- `bun test` -&gt; 24 passed, 0 failed, 141 assertions.
- `bun run build` -&gt; Vite 6.4.3, 1,601 modules, exit 0.
- PostgreSQL 18.6 -&gt; `PostgreSQL 18.6 on aarch64-unknown-linux-musl`, fresh migration twice and legacy bootstrap migration plus rerun passed.
- Disposable PostgreSQL 18.6 verification container and volume were removed after the migration checks.

### Security and Architecture Decisions

- Encryption uses a versioned AES-256-GCM envelope with fresh 12-byte nonce and 16-byte tag. Production requires `PLATFORM_ENCRYPTION_KEY`; development can derive from `AGENT_SECRET_KEY`.
- API keys use 192 bits of entropy, SHA-256 storage, 12-character display prefixes, and optional `resource:read/write` scopes.
- Bot deletion retains an inactive tombstone and erases its token to preserve historical foreign-key references.
- Provider and bot credentials are database-only at runtime. Legacy env variables are consulted only during the first bootstrap migration.
- SQLite tenant creation is synchronous inside a transaction; PostgreSQL uses async transactions. Bootstrap keys print only after commit.

### Post-Phase 13 UX Follow-up

- [x] First-run database choice is explicit in `pachiware init`, `install.sh`, and the web Setup Wizard: SQLite, external PostgreSQL, or PostgreSQL 18 Docker.
- [x] Non-interactive curl installs default safely to SQLite and accept `PACHIWARE_DATABASE` / `PACHIWARE_POSTGRES_URL` overrides.

### CLI-to-Web Setup Completion

- [x] CLI initialization now runs migrations, seeds platform skills, creates/reuses the default tenant, and persists encrypted local console access with mode 0600.
- [x] Installer invokes the same CLI workflow, rejects unsupported Bun versions, and keeps the lockfile frozen.
- [x] Web console automatically connects through a localhost-only server endpoint before rendering tenant data.
- [x] Verify fresh/rerun/revoked-key CLI setup and handoff access controls: all 30 tests / 171 assertions pass.
- [x] Independent typecheck, web build, compiled CLI/help checks, installer syntax, and runtime handoff/API checks pass.
- [x] Verify complete operator setup twice on disposable PostgreSQL 18.6: one default tenant, stable operator key, healthy agent, and cleanup completed.

Regression note: an early CLI fixture exposed inherited `PACHIWARE_DIR` pointing setup at the development database. Setup now forces its requested workspace; regression fixtures use temporary directories, and the development database was preserved. No LLM/bot credentials were present in that database.

### README Installation Guide

- [x] Rewrite README in Indonesian around the project overview, one-command/clone installation, database selection, and localhost dashboard access.
- [x] Document end-to-end LLM setup, chat/task verification, optional Discord connection, daily commands, and backup guidance.
- [x] Move tenant provisioning examples and endpoint reference to `docs/api.md`.
- [x] Check documented commands and dashboard labels against source; verify the moved API reference is preserved and `git diff --check` passes. Documentation-only change; runtime code unchanged.

### Bilingual README

- [x] Provide the English guide in `README.md` and preserve the Indonesian guide in `README.id.md` with reciprocal language links.
- [x] Keep installation, database selection, dashboard setup, LLM/Discord usage, and daily commands equivalent in both languages.
- [x] Verify matching shell examples, valid local documentation links, and clean `git diff --check`. Documentation-only change.

- [x] shadcn/ui installed in `apps/web` (new-york, slate base, indigo theme via CSS vars, `@/` alias, `button` added); shadcn MCP server configured in `.mcp.json`.

---

## 🏗 System Architecture

```text
                                 +-------------------------------+
                                 |    Multi-Channel Gateway      |
                                 |  • Discord (Active)           |
                                 |  • Telegram / WhatsApp (Next) |
                                 +---------------+---------------+
                                                 |
                                                 v
+------------------------+       +---------------+---------------+       +------------------------+
|   Web Management GUI   | <---> |        Hono REST/API &        | <---> |      Redis Cache       |
|    (apps/web)          |       |       Agent ReAct Loop        |       | (Session, State, Rate) |
+------------------------+       |         (apps/agent)          |       | [External or Bundled]  |
                                 +---------------+---------------+       +------------------------+
                                                 |
                             +-------------------+-------------------+
                             |                                       |
                             v                                       v
                 +-----------+-----------+               +-----------+-----------+
                 |   Tool & Skill Harness|               |   LLM Router Adapter  |
                 |   (packages/skills)   |               | (OpenAI/Claude/custom |
                 +-----------+-----------+               +-----------------------+
                             |
                             v
                 +-----------+-----------+
                 |      PostgreSQL       |
                 |     (packages/db)     |
                 | [External or Bundled] |
                 +-----------------------+
```

### Component Structure

```text
pachiware-agent/
├── apps/
│   ├── agent/                 # Bun + Hono backend, ReAct loop, Discord bot, LLM Router
│   └── web/                   # Management dashboard (React + Tailwind + Lucide)
├── packages/
│   ├── db/                    # Drizzle ORM schema, migrations, connection, seed data
│   └── skills/                # Core tool definitions & handlers (Discord, Tasks, Custom)
├── docker-compose.yml          # PostgreSQL 18 & Redis services
├── PROGRESS.md                # Progress tracking & architectural blueprint
└── README.md                  # Project overview and run guides
```

---

## 📈 Current Progress Log

- **Phase 1: Completed ✅** (PostgreSQL 18, Redis, Drizzle Schema, Docker Compose)
- **Phase 2: Completed ✅** (Skill &amp; Tool Harness: Tasks, Discord, Simulation Mode)
- **Phase 3: Completed ✅** (Agent Engine, LLM Router for OpenAI/Claude/custom, ReAct Loop, Caching)
- **Phase 4: Completed ✅** (Discord.js Gateway, Mentions, Typing Feedback, Action Embeds)
- **Phase 5: Completed ✅** (Web Management GUI, Vite + React + Tailwind, Dark Console)
- **Phase 6: Completed ✅** (E2E Integration Testing with 10 passing tests, Monorepo Verification, Documentation)
- **Phase 7: Completed ✅** (Global CLI `pachiware`, `pachiware --help`, `pachiware update`, and Server Installer `install.sh`)
- **Phase 8: Completed ✅** (Web-Managed Dynamic Configuration without mutating `.env`)
- **Phase 9: Completed ✅** (Zero-Config Resilience, Native In-Memory Fallback, and Web Setup Wizard Mode)
- **Phase 10: Completed ✅** (CLI Uninstaller, `pachiware update` Workspace Detection Fix, and Git Remote Cleanup)
- **Phase 11: Completed ✅** (Linux/Ubuntu Global Path Resolution, Absolute Script Spawning, and install.sh Hardening)
- **Phase 12: Completed ✅** (SQLite as zero-config default; dual-dialect schemas, driver switching, dialect-aware migrations/CLI/health; `bun:sqlite` native, all tests green on SQLite)
- **Phase 13: Completed ✅** (Multi-tenant / SaaS-compatible)
- **Phase 14: In progress 🚧** (Console: apps/web rebuilt as platform-admin UI on React 19 + Tailwind v4 + shadcn + react-router)

---

## 📋 Granular Task Checklist

### Phase 1: Infrastructure &amp; Database Layer

- [x] Root monorepo configuration (`package.json`, `tsconfig.json`, `.gitignore`, `.env.example`)
- [x] Docker Compose setup with PostgreSQL 18 and Redis
- [x] Package `packages/db` setup with Drizzle ORM and Postgres driver
- [x] PostgreSQL Schema definition:
  - [x] `agents_config`: system prompt, default model, provider, temperature, base URL, API keys/refs
  - [x] `skills`: id, name, description, is\_enabled, tool\_definitions (JSONB), handler\_type, config (JSONB)
  - [x] `tasks`: id, title, description, status (`pending`, `in_progress`, `completed`), assigned\_to, discord\_channel\_id, metadata, timestamps
  - [x] `conversations`: id, channel\_id, user\_id, provider, metadata, timestamps
  - [x] `messages`: id, conversation\_id, role (`system`, `user`, `assistant`, `tool`), content, tool\_calls, tool\_call\_id, tokens\_used, timestamps
- [x] Database migration and automated seed script (default agent personality, built-in skills)
- [x] Verify database connection and queries with Bun

### Phase 2: Core Skills &amp; Tool Harness (`packages/skills`)

- [x] Skill abstraction and registry interface (metadata, JSON schema, execution handler)
- [x] Task Management Skill:
  - [x] `createTask`: Insert task into DB
  - [x] `listTasks`: Filter tasks by status, assignee, or channel
  - [x] `updateTaskStatus`: Update status (`pending`, `in_progress`, `completed`)
  - [x] `assignTask`: Reassign task
- [x] Discord Management Skill:
  - [x] `createChannel`: Provision text/voice channels in guild
  - [x] `archiveChannel`: Move or lock channel
  - [x] `listChannels`: Enumerate server channels with categories
  - [x] `setChannelTopic`: Update channel topic / description
- [x] Custom Tool execution engine (database-driven tool definitions)
- [x] Unit verification of skills execution against mock DB/Discord adapters

### Phase 3: Agent Engine &amp; ReAct Loop (`apps/agent`)

- [x] Bun + Hono HTTP server scaffold
- [x] LLM Router Adapter:
  - [x] Provider support: OpenAI, Anthropic, Custom (OpenAI-compatible)
  - [x] Unified tool call translation and streaming/non-streaming response format
- [x] Redis client &amp; cache layer:
  - [x] Session caching for active conversations
  - [x] Cached agent configuration &amp; active skills
  - [x] Rate-limiter helper for LLM/Discord calls
- [x] Dynamic System Prompt Builder:
  - [x] Base prompt assembly
  - [x] Dynamic injection of active tools &amp; schema
  - [x] Contextual awareness (Discord server info, active tasks context)
- [x] ReAct Execution Loop:
  - [x] Thought -&gt; Action (Tool Call) -&gt; Observation (Tool Result) -&gt; Answer cycle
  - [x] Max iterations safety guard &amp; error handling
  - [x] Persistence of conversation history in PostgreSQL
- [x] REST API Endpoints in Hono:
  - [x] `GET/PUT /api/agent/config`
  - [x] `GET/POST/PUT /api/skills` &amp; `PATCH /api/skills/:id/toggle`
  - [x] `GET/POST/PATCH/DELETE /api/tasks`
  - [x] `POST /api/agent/chat` (Direct testing endpoint)
  - [x] `GET /api/agent/status` &amp; `/api/health` (Health, Redis, DB, Discord status)

### Phase 4: Discord Gateway Integration (`apps/agent/src/discord`)

- [x] `discord.js` client lifecycle and authentication
- [x] Gateway event listeners:
  - [x] `ready`: bot presence, guild sync
  - [x] `messageCreate`: mention detection, DM handling, thread participation
- [x] Message to Agent ReAct pipeline:
  - [x] Channel typing indicator during agent execution
  - [x] ⏳ reaction on the messages being answered, removed when the turn ends (answered or failed); unaddressed messages get none. The rate-limit refusal still reacts ⏳ and leaves it on. Verification: `bun run typecheck` exits 0; `bun test` 702 pass, 0 fail across 124 files.
  - [x] Long response chunking (Discord 2000 char limit)
  - [x] Embed generation for task updates and tool notifications
- [x] Discord client adapter supporting both live Discord and simulation fallback modes

### Phase 5: Web Management GUI (`apps/web`)

- [x] Web application scaffold (Vite + React + Tailwind CSS + Lucide Icons)
- [x] Core Design System &amp; layout (sidebar navigation, dark/light theme, modern typography, glassmorphism)
- [x] Dashboard Overview:
  - [x] Real-time status cards (Agent, Discord Bot, Redis, Postgres)
  - [x] Recent agent logs &amp; token usage metrics
  - [x] Quick task summary stats
- [x] Agent Personality &amp; Prompts:
  - [x] Live System Prompt editor
  - [x] Temperature, Top-P, Model selector (GPT-4o, Claude 3.5 Sonnet, Custom)
  - [x] LLM Router configuration (Base URL, API keys)
- [x] Skills &amp; Harnesses Manager:
  - [x] Interactive toggle switch for enabling/disabling skills live
  - [x] Skill inspector &amp; JSON schema viewer
  - [x] Skill testing playground
- [x] Task Manager:
  - [x] Kanban Board &amp; List view (Pending, In Progress, Completed)
  - [x] Create / edit task modal with Discord channel linking
- [x] Live Chat / Agent Playground tab to test prompt &amp; tools directly from the browser

### Phase 6: End-to-End Verification &amp; Documentation

- [x] Integration test: Full agent ReAct cycle with DB and mock/live LLM
- [x] Verification of Discord tools and Task tools execution
- [x] Comprehensive `README.md` with setup instructions, environment guide, and deployment walk-through

### Phase 7: CLI Tool &amp; Server Installer (`pachiware`)

- [x] Create `packages/cli` with executable binary `pachiware`
- [x] Implement CLI commands:
  - [x] `pachiware --help` &amp; `pachiware --version`
  - [x] `pachiware init`: interactive / automatic environment initialization &amp; config setup
  - [x] `pachiware start [--daemon]`: start Docker infrastructure, migrations, agent, and web console
  - [x] `pachiware stop`: stop running agent, web console, and containers
  - [x] `pachiware restart`: restart all platform services
  - [x] `pachiware status`: inspect live status of DB, Redis, Agent API, and Discord Gateway
  - [x] `pachiware update`: automated pull, migration, rebuild, and restart workflow with robust directory detection and DB reachability check
  - [x] `pachiware uninstall`: completely remove CLI symlinks, stop running processes, with optional `--purge` and `--docker` options
  - [x] `pachiware doctor`: diagnostic tool checking ports, docker, dependencies, and environment
  - [x] `pachiware db:migrate` &amp; `pachiware db:seed`: database management shortcuts
- [x] One-line server installer script `install.sh` (`curl -fsSL ... | bash`)
- [x] Global executable setup via `npm install -g pachiware`, `bun add -g pachiware`, or `bun link`
- [x] Verify `pachiware --help` and core CLI subcommands

### Phase 8: Web-Managed Dynamic Configuration &amp; Persistent Runtime Store

- [x] Database Schema &amp; Integrations State:
  - [x] Add explicit provider fields to `agents_config` (OpenAI, Anthropic, Custom LLM, and Discord credentials)
  - [x] Update seed script to bootstrap from `.env` only if empty, treating `.env` as initial defaults
  - [x] Database migration for new configuration columns
- [x] Runtime Infrastructure Store (Non-Mutating `.env`):
  - [x] Create runtime config manager for PostgreSQL &amp; Redis (`runtime-config.json`, gitignored)
  - [x] Fallback chain: `runtime-config.json` -&gt; `process.env` -&gt; defaults
  - [x] Ensure `.env` is never mutated at runtime
- [x] Backend Dynamic Services &amp; API:
  - [x] Dynamic LLM Router (loads active credentials from DB/cache on every completion)
  - [x] Dynamic Discord Bot Manager (hot-reloads Gateway connection on token/guild update)
  - [x] Dynamic Redis/DB connection test endpoints (`POST /api/settings/test`)
  - [x] Infrastructure config endpoints (`GET/PUT /api/agent/infrastructure`)
- [x] Web Management GUI:
  - [x] Expand LLM Router tab for all providers (OpenAI, Anthropic, Custom) with masked keys and live connection tests
  - [x] Add Discord Gateway configuration tab with live connection status, bot tag, and restart action
  - [x] Add Infrastructure configuration tab (PostgreSQL &amp; Redis) with pre-flight test and runtime config persistence
- [x] Verification &amp; Build Integrity:
  - [x] Verify TypeScript compilation across monorepo (`bun run build` / type checks)
  - [x] Verify test suite (7/7 passing E2E tests) and update documentation

### Phase 9: Zero-Config Resilience, Native In-Memory Fallback &amp; Web Setup Wizard Mode

- [x] Redis Optionality &amp; Native In-Memory Engine:
  - [x] Built-in native in-memory caching and sliding-window rate limiter (zero external dependencies)
  - [x] Automatic and silent fallback when external Redis is not running or unreachable
  - [x] Health check status remains `healthy (in-memory fallback)` without reporting degraded
- [x] CLI `pachiware start` Resilience:
  - [x] Pre-flight socket check to avoid raw ECONNREFUSED migration stack traces when DB is absent
  - [x] Graceful transition to Setup Wizard Mode, starting both API and Web console smoothly
- [x] Web Management GUI Setup Wizard (`apps/web/src/components/SetupWizard.tsx`):
  - [x] Intercepts dashboard when PostgreSQL is uninitialized (`setupRequired: true`)
  - [x] Displays a dedicated, clean setup screen with connection testing and one-click initialization
  - [x] Automatically triggers `reconnectDatabase()`, `runMigrations()`, and `runSeed()` via backend `PUT /api/agent/infrastructure`
  - [x] Smooth transition that unlocks the full dashboard once database connection is established

### Phase 10: CLI Lifecycle Refinements, Global Execution Hardening &amp; Repository Hygiene

- [x] Global CLI Workspace Discovery:
  - [x] Update `findWorkspaceRoot()` to traverse upwards from `import.meta.dir` when invoked outside repository directory
  - [x] Guard `pachiware update` with directory validation preventing errors when `package.json` is missing
  - [x] Validate PostgreSQL availability before running migrations during updates
  - [x] Use `bun run --filter @pachiware/web build` syntax for monorepo frontend builds
  - [x] Automatically recompile CLI binary upon successful update
- [x] Complete Platform Uninstaller:
  - [x] Added `pachiware uninstall` command
  - [x] Cleans up symlinks across `/usr/local/bin`, `~/.bun/bin`, and `~/.local/bin`
  - [x] Supports `--purge` to delete installation directory and `--docker` to tear down containers
- [x] Repository Cleanliness:
  - [x] Removed compiled `bin/pachiware` artifact from git tracking index while respecting `.gitignore`

### Phase 11: Cross-Platform Linux / Ubuntu Global Path Resolution &amp; Workspace Hardening

- [x] Bulletproof Global Workspace Detection:
  - [x] Added `isValidWorkspace()` validation confirming presence of `apps/agent/src/index.ts` and `package.json`
  - [x] Multi-source candidate search: `process.cwd()`, `PACHIWARE_DIR`, `~/.config/pachiware/install_dir`, `~/.pachiware_root`, `/etc/pachiware/install_dir`, `SUDO_USER` configs, `process.execPath`, `process.argv[1]`, and default directories
  - [x] Added `requireWorkspaceRoot()` safeguard preventing partial boots and misleading "Agent is LIVE" outputs when executed outside workspace
- [x] Absolute Script Path Execution:
  - [x] Replaced relative paths (`apps/agent/src/index.ts`, `./packages/db/src/migrate.ts`) with resolved absolute paths (`join(wsRoot, ...)`)
- [x] Server Installer (`install.sh`) Resilience:
  - [x] Automated `git` installation / verification for Ubuntu/Debian (`apt-get`) and RHEL/CentOS (`yum`)
  - [x] Safe clone handling: avoids clobbering existing directories and automatically updates existing clones
  - [x] Global install path registration to `~/.config/pachiware/install_dir` and `~/.pachiware_root` (including `SUDO_USER` persistence)

### Phase 12: SQLite as Zero-Config Default Database (Dual-Dialect Support)

- [x] Dialect Detection &amp; Driver Layer (`packages/db/src/dialect.ts`):
  - [x] `detectDialect(url)` — classifies `sqlite:` / `sqlite://` / `file:` / `*.db` / `*.sqlite` as SQLite and `postgres://` / `postgresql://` as PostgreSQL
  - [x] `resolveSqlitePath(url, workspaceRoot?)` — strips URI prefixes, resolves relative paths against the workspace root, auto-creates parent directories, passes `:memory:` through
- [x] Dual Schema Organization (`packages/db/src/schema/`):
  - [x] Moved existing PostgreSQL schema to `schema/pg/index.ts` (unchanged)
  - [x] Added `schema/sqlite/index.ts` mirror with native SQLite types: `text({mode:'json'})` for JSONB, `integer({mode:'boolean'})` for booleans, `integer({mode:'timestamp_ms'})` with `$defaultFn(() => new Date())` for timestamps, `$defaultFn(crypto.randomUUID)` for UUID primary keys
  - [x] Column names identical across both dialects so application code is dialect-agnostic
  - [x] `schema/index.ts` is a dialect-aware barrel that re-exports the active dialect's tables plus `activeDialect`, `pgSchema`, and `sqliteSchema` for migration tooling
- [x] Driver Switching (`packages/db/src/index.ts`):
  - [x] Dynamic driver selection: `bun:sqlite` + `drizzle-orm/bun-sqlite` for SQLite, `postgres` + `drizzle-orm/postgres-js` for PostgreSQL
  - [x] SQLite boot pragmas: `PRAGMA journal_mode = WAL;` and `PRAGMA foreign_keys = ON;` for pg-equivalent semantics
  - [x] `reconnectDatabase()` tears down the previous client (`.end()` for pg, `.close()` for sqlite) and re-binds live ESM exports when the user changes the database URL via the Web GUI
  - [x] New `pingDatabase()` dialect-agnostic liveness probe
- [x] Migration &amp; Runtime Store:
  - [x] `migrate.ts` branches on `activeDialect` and emits dialect-native DDL (JSONB vs TEXT, TIMESTAMPTZ vs INTEGER unix-ms, `gen_random_uuid()` vs client-generated, `pgcrypto` extension skipped on SQLite)
  - [x] `runtime-store.ts` defaults `databaseUrl` to `sqlite:./data/pachiware.db` and renames `testPostgresConnection` → `testDatabaseConnection` (kept as backward-compat alias) with dialect-aware probing
  - [x] `drizzle.config.ts` switches `dialect` + `out` directory based on `DATABASE_URL`
- [x] CLI Integration (`packages/cli/src/index.ts`):
  - [x] `getDatabaseTarget()` returns `{dialect, host, port, url, sqlitePath}` and recognises SQLite URLs
  - [x] `pachiware start` skips the TCP port pre-flight check when the dialect is SQLite (file-based = always "connected"), prints `💾 Database: SQLite file (...)` in the startup banner
  - [x] `pachiware update` runs migrations unconditionally on SQLite (no port check)
  - [x] `pachiware doctor` reports the active dialect and resolved SQLite path; clarifies that PostgreSQL + Redis ports are optional
  - [x] `pachiware db:migrate` description updated — auto-detects dialect from `DATABASE_URL`
- [x] Agent Backend &amp; Health:
  - [x] `apps/agent/src/routes/health.ts` switched to the dialect-agnostic `pingDatabase()` helper and surfaces `databaseDialect` in `/api/health`
  - [x] `apps/agent/src/routes/agent.ts` `/api/agent/infrastructure` and `/api/agent/infrastructure/test-db` use `testDatabaseConnection` and return the active dialect
- [x] Repository Hygiene:
  - [x] `.gitignore` ignores `data/`, `*.db`, `*.sqlite`, `*.sqlite3`, and WAL/journal side-files
  - [x] `.env.example` reorganized: SQLite documented as the default with example formats; PostgreSQL settings commented out as opt-in
- [x] Verification:
  - [x] Fresh zero-config boot: `bun run packages/db/src/migrate.ts && bun run packages/db/src/seed.ts` on a non-existent `./data/pachiware.db` creates the file, applies all tables, inserts default agent config + skills + sample tasks
  - [x] Full agent boot on SQLite: `/api/health` returns `database: healthy`, `databaseDialect: sqlite`, `redis: healthy (in-memory fallback)`
  - [x] All 7 E2E tests (`apps/agent/test/e2e.test.ts`) and 5 skills tests (`packages/skills/test/skills.test.ts`) pass against the SQLite backend

---

## Phase 13: MULTI-TENANT / SaaS-COMPATIBLE REFACTOR - COMPLETE

### 13.1 Schema, Crypto, Bootstrap

- [x] AES-256-GCM secret encryption/decryption with strict 32-byte platform key validation.
- [x] SHA-256 API-key hashing, constant-time comparisons, and 192-bit key generation.
- [x] Tenant, API key, bot, usage event, tenant skill, and tenant-owned entity schemas for SQLite and PostgreSQL.
- [x] Transactional, idempotent SQLite rebuild and PostgreSQL backfill migration; legacy config, Discord credentials, tasks, conversations, messages, and skills preserved under bootstrap tenant.
- [x] `seedTenant`, built-in platform skills, and tenant persistence helpers exported from `@pachiware/db`.

### 13.2 Tenant API and Runtime Isolation

- [x] Bearer-key tenant middleware, suspended/deleted checks, API-key last-used tracking, scope enforcement, and constant-time platform admin middleware.
- [x] Authenticated `/api/v1/config`, `/chat`, `/conversations`, `/tasks`, `/skills`, and `/bots` routes with tenant filters on every read/write.
- [x] Tenant-namespaced cache and rate-limit keys; LLM keys decrypted only at call time with no runtime `.env` fallback.
- [x] ReAct input, prompt builder, tool context, message history, task tools, usage events, and conversation ownership all carry `tenantId`.

### 13.3 Multi-Bot Discord Runtime

- [x] `DiscordBotManager` runs one isolated Discord client per enabled bot, serializes lifecycle operations, dispatches tenant-scoped ReAct context, limits guilds, handles DMs/mentions/owned threads, chunks replies, and records message usage.
- [x] Bot token test, status updates, login error isolation, suspension/delete stopping, and encrypted token lifecycle implemented.

### 13.4 Admin API and Billing Events

- [x] Tenant CRUD, API-key issue/list/revoke, bot CRUD/restart, usage aggregation with date filters, infrastructure endpoints, and CORS platform header support.
- [x] Usage events emitted for successful LLM completions, tool calls, and accepted Discord messages.
- [x] Admin API contract documented in `README.md`; raw API keys are returned once and secret material is never logged or returned.

### 13.5 Operator GUI

- [x] GUI requests use localStorage/env tenant key and sessionStorage platform key; credential switch clears stale tenant state.
- [x] Config, LLM, skills, tasks, chat, infrastructure, and health calls use new routes and response shapes.
- [x] Bots manager replaces singleton Discord settings with tenant bot list/add/edit/test/restart/delete UI.
- [x] Setup wizard provisions the first tenant and API key through the Admin API; responsive mobile sidebar/header and masked credential fields implemented.
- [x] Optional tenant switcher remains intentionally outside v1; operators can paste an API key in the credentials panel.

### 13.6 Cleanup and Verification

- [x] `.env.example` contains host-only settings, platform keys, and an explicit legacy-bootstrap comment block.
- [x] `README.md` documents the control-plane/data-plane split, bootstrap, security model, Admin API, tenant API, Discord runtime, and CLI usage.
- [x] Isolated SQLite regression tests: 24 tests / 141 assertions pass, covering crypto, tenancy, migration rollback, legacy preservation, API isolation, ReAct usage, skills, and Discord manager behavior.
- [x] Full monorepo `bun run typecheck` passes.
- [x] Web production `bun run build` passes.
- [x] Fresh and legacy migrations verified on disposable PostgreSQL 18.6 Docker server; rerun is idempotent and does not issue another bootstrap key.

---

## Phase 14: ADMIN PORTAL (apps/web rebuild)

`apps/web` is the **platform console**, not a tenant/client console. Auth is the platform key only (`X-Platform-Key`, `/api/admin/*`); tenants have no UI access.

- [x] Stack: React 19, Tailwind v4 (`@tailwindcss/vite`, CSS-first), latest shadcn, react-router 8
- [x] Shell: shadcn Sidebar + routes (`/`, `/tenants`, `/tenants/:id/bots`)
- [x] Overview: DB engine, Redis mode, runtime, encryption key, Discord gateway, tenant count
- [x] Tenants: list, create, detail, suspend/activate
- [x] Tenant → Integrations (Discord is the first platform; create/edit/enable/restart/delete via admin routes)
- [x] Overview storage sizes: DB (SQLite file+WAL, or `pg_database_size`) and cache (Redis `used_memory`, or approximate in-memory JSON size) via `/api/admin/stats` → `storage`
- [x] Row/header actions are icon-only with tooltips (`components/IconButton.tsx`); route changes fade/slide in (`AppShell`, respects reduced motion)
- [x] Status badges show readable labels; instant actions (suspend/activate, restart, disable, delete) require confirmation via `components/ConfirmAction.tsx`, destructive ones styled red
- [x] New tenant form: slug auto-fills from name until edited by hand; duplicate slug blocked in the form and by a 409 from `POST /api/admin/tenants` (DB column is already unique)
- [x] Integrations page: card gallery, server-side pagination (12/page), search, platform select filter (always shown); platform-agnostic via registry `apps/web/src/lib/platforms.ts` (add an entry for a new platform). `GET /api/admin/tenants/:id/bots` takes `page`, `pageSize`, `q`, `platform` and returns `total`
- [x] API keys are global (not per tenant): sidebar **API Keys** page (create show-once, list with tenant count, revoke). Removed the per-tenant tab and `/api/admin/tenants/:id/api-keys`
- [x] `tenants.api_key_id` (nullable, `ON DELETE SET NULL`) = key that owns the tenant; a key acts only on its own tenants. `/api/v1/*` takes `X-Tenant-Id` (id or slug); `POST/GET /api/v1/tenants` for key-level create/list. Migration moves old per-tenant keys to global and links each tenant to its first live key. Keys default to scope `*`; custom scopes deferred
- [x] Operator console handoff (`operator-access.json`) now only carries the platform key; no tenant key is issued at setup
- [x] Tenant detail: only the tab content animates, the header stays still
- [x] Add integration is a two-step wizard: pick a platform (cards from the registry), then that platform's form; editing skips to the form
- [x] Global `cursor-pointer` for buttons, switches, tabs, selects, menu items and links (`index.css` base layer); disabled ones get `not-allowed`
- [x] Integration detail page (`/tenants/:id/integrations/:botId`): header + right sub-sidebar driven by `Platform.sections` in `lib/platforms.ts`. Discord has one section, **Servers** (guilds and channels from the live gateway cache via `GET /api/admin/bots/:id/guilds`, only while connected). `GET /api/admin/bots/:id` added
- [x] Servers: click a channel to open its conversations in a side sheet (list → chat transcript; only bot-handled conversations are stored). Channel ID is a click-to-copy button with a toast (`components/CopyId.tsx`). Admin routes `GET /api/admin/bots/:id/conversations?channelId=` and `.../conversations/:cid/messages`
- [x] Tenant → **Profiles** tab (after Integrations): a profile is one model from one provider, either OpenAI (ChatGPT) or a Custom provider (base URL required), with an optional write-only API key. `profiles` table, `bots.profile_id` (nullable, `ON DELETE SET NULL`), admin routes `/api/admin/tenants/:id/profiles` and `/api/admin/profiles/:id`
- [x] Profile form order: Name, Provider, Base URL, API key, then Model. A fetch button lists models from `<base URL>/models` using the typed key (or the saved one) via `POST /api/admin/profiles/models`; the key never reaches the browser. Model stays a free-text field with the fetched list as suggestions
- [x] Each integration picks a profile in its form (default: Tenant default). `LLMRouter.complete` uses the bot's profile (provider, model, base URL, key) for that bot only; profiles cannot be attached across tenants. Anthropic stays in the router for the tenant default but is not selectable in profiles
- [x] Profile **Test** is a five-step checklist (Base URL, API key, Model, Text reply, Image input) with the model's actual reply shown, instead of a text/image pass on HTTP 200 alone. A 200 that is not in the provider's response format now fails, an unlisted model or a reply that ignores the instruction is a warning, a 404 or 401 carries a hint, and the image step checks the named colour of the red test PNG. Logic moved from `LLMRouter.probeProfile` to `apps/agent/src/llm/probe.ts`
- [x] **Playground** per saved profile (flask button on the card, `ProfilePlayground.tsx`): runs the same checklist and sends one prompt with an optional system prompt through `POST /api/admin/profiles/playground`, showing reply, latency, tokens, and finish reason; the key stays server-side. Typecheck exits 0, `bun test` 641 pass. Not checked in a browser (Chrome extension not connected); endpoints smoke-tested against the running agent
- [x] A BYOK profile picks its **API format**: Chat Completions (default), Responses, or Messages (`profiles.api_format`, added by `migrate.ts`). The router answers through `<base URL>/responses` (stateless, `store: false`, flat function tools with `strict: false`) or `<base URL>/messages` (both `x-api-key` and Bearer) for such a profile; OpenAI stays on Chat Completions and Anthropic on Messages. Test and Playground send the same request shape and parameters as the router, and a reply in another format names the format to pick (or shows the content type and first characters, such as a `text/event-stream` answer). Profiles select labels `custom` **BYOK**. Typecheck exits 0, `bun test` 638 pass on `main` + this branch. Decision: Responses still sends the tenant temperature like Chat Completions, so a server that rejects it shows that error in Test
- [x] Profile Test checklist, Playground, and BYOK API format landed on main (`3c8d4a6`), fast-forwarded from `feat/profile-playground`
- [x] Every provider request (router, Test, Playground; all three API formats) sends `stream: false`. 9router streams unless a request says `stream: false` (`open-sse/handlers/chatCore.js`), so a Responses profile on `cc/claude-sonnet-5-5` failed Test with "not in the Responses format; the server sent text/event-stream". OpenAI and Anthropic accept the field. Typecheck exits 0, `bun test` 698 pass
- [x] A server that streams anyway is still read: `apps/agent/src/llm/answer.ts` assembles server-sent events into the body the same API returns without streaming (Chat Completions deltas and tool-call fragments, Responses items or text deltas when the completed event leaves the output out, Messages content blocks and partial tool input), for the router and for Test and Playground. Events of another API assemble to `{}`, so Test still says what came back. Decision: no Stream checkbox per profile, since nothing shows a reply token by token; add one on top of this reader if a server ever refuses `stream: false`. Typecheck exits 0, `bun test` 699 pass
- [x] Removed old single-tenant pages (personality, skills, tasks, LLM router, playground, infra editor) — recoverable from git history
- [x] **Console UI phase complete** with Profiles as its last tab
- [ ] Later phases (not started): usage, tenant default LLM config, skills, tasks, infrastructure editing, custom API key scopes
- [ ] Manual browser verification of the flows above

**Product framing (important):** Pachiware is a general-purpose AI assistant platform, **not a Discord project**. Discord is just one of several integrations (WhatsApp, Telegram, Slack are planned). Admin UI copy must stay platform-neutral: use "Integrations", not "Discord Bots", in nav, tab, metrics and card actions. Name Discord only inside the integration's own screen, as one platform among others. Route is `/tenants/:id/integrations`. Backend names (`bots`, `/api/admin/.../bots`) are unchanged for now.

Decisions: no admin "test bot token" route yet (restart reports status); dark theme default.

---

## Phase 15: DISCORD CONVERSATIONS + PER-SERVER INSTRUCTIONS

- [x] `guild_configs` table (both dialects, idempotent migration): `system_prompt`, `use_threads`, `always_channel_ids`, unique per `(bot_id, guild_id)`; helpers `getGuildConfig` / `upsertGuildConfig`
- [x] `discord/routing.ts`: `respondReason` (DM, owned thread, always-channel, mention or reply to bot; ignores bots and disallowed servers), `threadName`, `speakerTurn`
- [x] `handleMessage`: mention opens a thread when the server allows it (falls back to the channel without permission); conversations are keyed by channel/thread and shared by all participants; turns are serialized per conversation
- [x] `SystemPromptBuilder` appends "Server instructions" from the guild config (120 s cache, invalidated on save)
- [x] Admin routes `GET/PUT /api/admin/bots/:botId/guilds/:guildId/config`; documented in `docs/api.md`
- [x] Console: **Instructions** sheet per server in Integration → Servers (prompt, reply-in-threads switch, always-respond channels)
- [x] Tests: `apps/agent/test/conversations.test.ts`
- [x] `bun test`: 33 pass, 1 fail (`packages/cli/test/setup.test.ts` expects `keyId`, gets `platformKeyEncrypted`; from the earlier operator-handoff change, not this phase). Web `tsc` and `vite build` pass
- [ ] Manual check on a real Discord server (thread creation, shared context, server prompt)
- Out of scope: slash commands, loading channel history for threads the bot did not start, long-term memory/summaries, per-channel prompt overrides, attachments/images
- Known limit: existing conversations stored per `(channel, user)` are no longer matched; the first message after upgrade in a shared channel starts a fresh conversation

### 15.1 LLM prompt-cache hits (OpenAI + Custom provider)

Provider-side prompt caching only hits when the request starts with an identical prefix. Before this, the prefix changed on every turn.

- [x] System prompt is now static per tenant/server: user, channel, platform and active tasks moved out into `SystemPromptBuilder.buildDynamic`, sent as a trailing, never-stored `[Context ...]` user message after the real one
- [x] Tool list sorted by name in `skillRegistry.getActiveTools` (it leads the cached prefix and used to follow DB row order)
- [x] History window advances in steps of 10 (`loop/history.ts`) instead of sliding every turn; a leading orphan tool result is dropped so the window never starts mid tool-call
- [x] `cachedTokens` read from `prompt_tokens_details.cached_tokens` (OpenAI), `prompt_cache_hit_tokens` (DeepSeek-style), `cache_read_input_tokens` and `cached_tokens` (`llm/usage.ts`), stored in `usage_events.metadata.cachedTokens` for both OpenAI and Custom
- [x] `prompt_cache_key` = conversation id, sent only when the base URL host is `api.openai.com` (unknown hosts may reject the field)
- [x] Tests: `apps/agent/test/cache.test.ts`
- [ ] Measure the real hit rate on a live provider (`cachedTokens / promptTokens` from `usage_events`); not verified yet
- [ ] **Anthropic (deferred, own phase):** add `cache_control: { type: "ephemeral" }` on the system block and the last tool in `callAnthropic`, read `cache_read_input_tokens` / `cache_creation_input_tokens`. Anthropic stays out of Profiles for now, so this only matters for the tenant default
- Decision: cache behaviour for a Custom endpoint depends on that endpoint (automatic prefix caching on OpenAI-compatible servers, DeepSeek, vLLM, etc.). We only keep the prefix stable and report what it returns; we send no provider-specific cache parameters to hosts we do not know.
- Known limit: the window shifts by 10 messages at a time, so a conversation can carry up to 40 history messages instead of a strict 30.

## Phase 15.2 — Quieter Discord replies in shared threads

- [x] `isNoise` (`discord/routing.ts`): emoji-only, custom-emoji-only and punctuation-only messages are ignored unless they carry an attachment
- [x] Owned threads no longer answer everything: reply only on mention, reply-to-bot, or when the bot sent the previous message; skip messages that mention other users or reply to a human. Always-on channels answer everything not aimed elsewhere. DMs unchanged
- [x] Burst coalescing in guild channels (2.5 s debounce, `BURST_MS`): one reply for a batch, speakers kept as `Name: text` lines. DMs and a thread opened by a mention on that same turn reply per message; messages in an existing thread, playbook threads included, are coalesced like channel messages
- [x] Rate-limit hit now reacts with ⏳ instead of replying
- [x] Tests: `conversations.test.ts` (routing, noise), `discord.test.ts` (mock updated, waits out the debounce)
- [ ] Verify on a live server: emoji in thread, two humans talking, 5 rapid messages
- Known limit: the "previous message is the bot's" check costs one Discord API fetch per thread message. The check runs per message before the burst window, so in a shared thread a quick run of messages after a bot reply is answered for the first one only; the rest never reach the burst.
- Decision (#29, 2026-10-14): existing threads stay debounced; the earlier note that threads reply per message was wrong, not the code. Speaking rules already drop unaddressed thread messages before the burst, so coalescing only matters where every message is answered, such as a playbook thread, where an author's answer split over several quick messages should get one reply, not one per fragment.

## Phase 16 — Git accounts for repository access

Bots can read and change repositories (GitHub, GitLab, self-hosted GitLab) when a project name comes up in chat.

- [x] `git_accounts` table (tenant master data) + `bots.gitAccountId`, composite FK `(tenantId, gitAccountId)` so a bot can only use its own tenant's account (`schema/{pg,sqlite}`, `migrate.ts`)
- [x] Admin API: `/tenants/:id/git-accounts`, `/git-accounts/:id` (token checked against the provider `/user` endpoint, encrypted, never returned; provider immutable; delete blocked while bots use it)
- [x] Bots take `gitAccountId` on create/patch (`assertGitAccount` tenant check)
- [x] Skill `git_repositories` (`repoList`, `repoReadFile`, `repoWriteFile`, `repoOpenPullRequest`), default off per tenant; account resolved from the conversation's bot, never from model input; writes refuse the default branch (branch + PR only)
- [x] Platform-wide allowed git hosts (`runtime-config.json` `gitAllowedHosts`, `/api/admin/infrastructure/git-hosts`, editable in the Git accounts page); checked on save and again at tool-call time
- [x] Web: Git accounts section, "Git account" select in the integration form
- [x] Tests: `packages/db/test/git-accounts.test.ts`, `apps/agent/test/git-accounts.test.ts`, `packages/skills/test/git.test.ts`
- [x] Antislop audit 002 (`anti-slop/audit-002-2026-10-07.md`): all 6 findings closed
- [ ] Run `bun run db:seed`, then enable `git_repositories` per tenant (existing tenants are not auto-enabled)
- [ ] Verify against a real GitHub/GitLab token and a self-hosted GitLab
- Decision: account lives on the tenant (master data), the bot holds one nullable pointer. One column makes "two accounts per bot" unrepresentable; several bots may share an account so rotating a token is one edit.
- Known limit: upgraded SQLite databases cannot add the composite FK via ALTER, so the tenant check there relies on the API; new SQLite and PostgreSQL enforce it in the DB.
- Known limit: the bot can do whatever its token can; scope tokens to the repositories needed. An empty allowlist accepts any https host, including private IPs.
- Known limit: `repoReadFile` returns at most 20,000 characters.

## Phase 17 — One-click OAuth for git accounts

"Continue with GitHub / GitLab" buttons on the Git accounts page, including self-hosted hosts. The access-token form stays as a fallback.

- [x] `git_oauth_apps` table (provider, host, client id, encrypted client secret; one app per host) and `git_accounts.authType / refreshTokenEncrypted / tokenExpiresAt` (`schema/{pg,sqlite}`, `migrate.ts`, upgrade path for existing DBs)
- [x] Admin API `/git-oauth-apps` (secret never returned), `POST /tenants/:id/git-accounts/oauth/start` (authorize URL with state + PKCE S256), public `GET /api/oauth/git/callback` (single-use state, creates the account named after the provider login)
- [x] `packages/skills/src/gitOAuth.ts`: `getGitToken` refreshes expiring tokens (GitLab ~2h) before the git skill uses them; GitLab OAuth tokens sent as Bearer
- [x] Web: OAuth buttons inside the Connect account dialog (host field above them); success/error toast on return. Allowed git hosts and OAuth apps (with callback URL) moved to a new platform-wide Settings page (`/settings`, sidebar), since they are not per tenant
- [x] Env: `PUBLIC_URL` (callback base), optional `CONSOLE_URL` (where to land after login) in `.env.example`
- [x] Test: `apps/agent/test/git-oauth.test.ts`
- [ ] Verify with real OAuth apps on github.com, gitlab.com and a self-hosted GitLab
- Decision: OAuth apps are platform data in the DB, not env vars, because self-hosted hosts each need their own app.
- Known limit: pending OAuth states are in memory, so a restart during login (or several agent instances) invalidates them; the user just clicks again.
- Known limit: scopes are broad (`repo` / `api`). Editing an OAuth account's token by hand converts it to a token account.
- Known limit: `bun run typecheck` at the root already reports `@/` alias errors from `apps/web`; the web build itself passes.
- Known limit: `packages/cli` setup test (`platformKeyEncrypted` vs `keyId`) was already failing before this phase.

## Phase 18 — Browse repositories of a git account

Click a git account card to see its repositories (grouped by owner/namespace), then a repository for Members, Issues, Merge/Pull requests and Branches. Read-only.

- [x] `browseRepos / browseMembers / browseIssues / browseMergeRequests / browseBranches` in `packages/skills/src/git.ts`: one shape for GitHub and GitLab, 30 per page, `hasMore` when a page is full
- [x] Admin API: `GET /git-accounts/:id/repos` and `/git-accounts/:id/repo/:tab?repo=&page=&state=`; uses `getGitToken` (OAuth refresh), re-checks the host allowlist, provider errors come back as 502 with the message
- [x] Web: `pages/tenant/GitBrowse.tsx` (`GitRepos`, `GitRepoDetail`), routes `git-accounts/:accountId` and `.../repo`, account cards are links, "Load more" paging, loading / empty / error states
- [x] Tests: `packages/skills/test/git-browse.test.ts`
- [x] Antislop audit 003 (`anti-slop/audit-003-2026-10-07.md`): 7 findings, all closed; layout checked in headless Chrome at 360 / 768 / 1280 px against a faked GitHub
- [ ] Try it with a real GitHub and GitLab account (layout and states were checked only against faked provider data)
- Known limit: GitHub members need push access to list collaborators; otherwise contributors are shown. Counts and totals are not shown, only loaded pages.
- [x] Repo search is now server-side: `browseRepos(c, page, q)` uses GitLab `/projects?search=` and GitHub `/search/repositories` (`user:<login>`); the picker debounces 400 ms and sends `?q=`. Known limit: GitHub search covers the account's own repos, not org repos. Not yet tried against real providers.

## Phase 19 — Many git accounts per bot, git scope per server and channel (data + API)

Plan: `~/.claude/plans/calm-dazzling-quokka.md`. Phases 20 (resolver, read tools, prompt), 21 (write confirmation), 22 (web UI) follow.

- [x] Tables `bot_git_accounts` (bot ↔ account, many) and `git_scopes` (bot, guild, channel `""` = server, account, `repoPatterns`) in `schema/{pg,sqlite}`, `migrate.ts`; existing `bots.git_account_id` is backfilled into the join table and no longer read
- [x] `tenancy.ts`: `setBotGitAccounts`, `listBotGitAccounts`, `botsUsingGitAccount`, `listGitScopes`, `replaceGitScopes`, `patternCovers`. Rules: only attached accounts can be scoped; channel rules must sit inside the server rule; narrowing a server rule prunes channel rules; detaching an account removes its scopes; patterns lowercased, `*` is the only wildcard
- [x] API: bots take and return `gitAccountIds` (`v1/bots.ts`, `admin/bots.ts`); `GET/PUT /bots/:botId/guilds/:guildId/git` and `PUT .../channels/:channelId/git`; git account delete blocked by the join table
- [x] Tests: `packages/db/test/git-accounts.test.ts` and `apps/agent/test/git-accounts.test.ts` rewritten for many-to-many, backfill, scopes
- Decision: default is none. A server without rules has git off; channels can only narrow.
- Known limit: until Phase 20 the git skill (`builtin/git.ts`) still reads `bots.gitAccountId`, so it finds no account for bots configured after this phase. Until Phase 22 the web UI still sends `gitAccountId`, which the API now ignores.
- Known limit: SQLite upgraded DBs have no composite FKs on the new tables beyond what `CREATE TABLE` gives fresh ones; cascades are done in code.
- [x] Checked on a real PostgreSQL 16 (throwaway cluster, since removed): upgrade from the old schema, idempotent backfill, composite FK, JSONB patterns, subset rules, pruning, and `ON DELETE CASCADE` from `bot_git_accounts` to `git_scopes` at the DB level all pass.

## Phase 20 — Resolver, git read tools, prompt

The LLM can now browse git from Discord. Account and repo come from the server/channel scope of Phase 19.

- [x] `packages/skills/src/gitScope.ts`: `computeAccess` (pure: server rule on, channel or thread-parent rule narrows, none = closed), `repoAllowed`, `pickAccess`, `loadGitAccess`, `connectionOf` (re-checks the host allowlist)
- [x] `SkillContext.parentChannelId`, filled in `discord/client.ts` (thread → its parent channel) and `loop/react.ts`
- [x] Tools in `builtin/git.ts`: `gitAccounts`, `repoList` (paged, filtered by scope), `repoMergeRequests`, `repoMergeRequest`, `repoIssues`, `repoBranches`, `repoCommits`, `repoMembers`, `repoReadFile`, plus the existing `repoWriteFile` / `repoOpenPullRequest`. All take optional `account`; every repo is checked against the account's patterns before any provider call
- [x] `git.ts`: `browseCommits`, `getMergeRequest` (description + changed files, no patches)
- [x] Loop: tool results capped at 12k characters with a truncation note; default iterations 8 → 12
- [x] Prompt rules for git (find repos with `repoList`, follow `hasMore`, pass `account` when several, closed git is an admin task)
- [x] Tests: `packages/skills/test/git-scope.test.ts`, `apps/agent/test/git-tools.test.ts` (scripted LLM: list repos → MRs of the first; scope hides other repos; no rule = closed), commits/MR cases in `packages/skills/test/git.test.ts`
- [ ] Try it in Discord with a real GitHub/GitLab account (provider calls are faked in tests)
- Known limit: `repoWriteFile` and `repoOpenPullRequest` still run without confirmation until Phase 21; they only write to non-default branches.
- Known limit: `repoList` filters a page after fetching it, so a page can hold fewer than 30 items; with narrow patterns the model may need several pages.
- Known limit: `browseRepos` with a search term on GitHub covers the account's own repos, not org repos (Phase 18 limit).
- Known limit: the seed leaves `git_repositories` off by default, so a tenant still has to enable the skill.
- Known limit: the web chat (`/v1/chat`) has no guild, so git tools return "only work in a Discord server channel".

## Phase 21 — Confirmation for git write actions

- [x] Write tools (`repoWriteFile`, `repoOpenPullRequest`, new `repoComment`, `repoCreateIssue`, `repoMergeMergeRequest`, `repoCloseItem`) no longer run on the model's call: they validate account, scope and arguments, queue the action and return `pending` (`builtin/git.ts` `confirmable`)
- [x] `packages/skills/src/gitConfirm.ts`: in-memory pending store, 10 min TTL, capped at 200
- [x] `SkillContext.confirmed` is set only by the host (never copied from model arguments or `input.context`); the confirmed run re-resolves scope, so a rule narrowed after queueing blocks it
- [x] `apps/agent/src/discord/gitConfirm.ts`: Confirm/Cancel buttons posted after the reply; only the asker can press them; single use; result edited into the message. Wired through `Events.InteractionCreate` in `discord/client.ts`
- [x] `git.ts`: `commentOn`, `createIssue`, `mergeMergeRequest`, `closeItem` (GitHub and GitLab); prompt rule that pending means "awaiting confirmation"
- [x] Tests: `apps/agent/test/git-confirm.test.ts` (queue, argument bypass attempt, out-of-scope, wrong user, once only, cancel, narrowed scope); `discord.test.ts` fake extended for the new discord.js imports
- Known limit: pending actions are lost on restart; the user asks again.
- Known limit: only the person who asked can confirm, not an admin. Web chat cannot confirm, so write tools fail there.
- Known limit: merge uses the provider's default merge method; no choice of squash/rebase. Closing and commenting by number only, no labels, assignees or reviews.

## Phase 22 — Web UI for many git accounts and git access per server/channel

- [x] `lib/api.ts`: `Bot.gitAccountIds`, `BotInput.gitAccountIds`, `getGuildGit`, `saveGuildGit`
- [x] `TenantBots.tsx`: the single Git account select is now a checklist; cards list all attached accounts
- [x] `pages/tenant/GuildGit.tsx` (new), shown in the server Settings sheet (`GuildInstructions.tsx`, button renamed from Instructions to Settings): per server, switch accounts on and set repository patterns; per channel, narrow further or follow the server
- [x] Docs: `GLOSSARY.md` (Git account rewritten, Git scope and Git write confirmation added, relationships), `docs/adr/0002-bot-has-many-git-accounts-scoped-per-guild-and-channel.md`
- [x] Web typecheck and `vite build` pass; full test run: 48 pass, 1 fail (the `packages/cli` setup test, failing before this work)
- [x] Antislop audit 004 (`anti-slop/audit-004-2026-10-07.md`, mode AFTER): 11 findings, #9 closed by measurement, the rest waiting for the numbers to fix
- [x] New screens run in headless Chrome at 360 and 1280 px against the real agent API: no overflow, long names wrap, rules and channel narrowing load and save (audit 004 has the measurements and one more finding)
- [ ] Try the whole flow in Discord with a real bot and a real GitHub and GitLab account (needs credentials only the owner has; Discord and the providers were faked)
- [x] Channel narrowing takes several channels at once: tick channels, set accounts and patterns once, one button saves them all (one API call per channel); starts from the server's patterns because a channel can only narrow them. Verified in headless Chrome against the real API (two channels saved, "own rule" badges, 44 px rows at 360 px)
- [x] Attaching a git account to a bot now turns the `git_repositories` skill on for that tenant (`setBotGitAccounts` in `tenancy.ts`). Before this the skill stayed off and the console had no switch, so the bot answered that it had no git tools. Detaching an account does not turn it off again. The git rules in the system prompt only appear while the skill is on. Test: `apps/agent/test/git-accounts.test.ts`
- Known limit: bots that already had accounts attached before this change keep the skill off until an account is attached again (or `tenant_skills.is_enabled` is set to 1 by hand); nothing backfills them. There is still no Skills switch in the console.
- Known limit: the server and channel save buttons write immediately; the sheet's bottom Save only saves instructions (audit 004 #1).
- Known limit: UI never runs against the live API in tests; the API side is covered by `apps/agent/test/git-accounts.test.ts`.

## Phase 23 — PR and issue management tools (rows 18–30)

- [x] PR/MR updates: `repoUpdateMergeRequest`, `repoReopenItem`, `repoReviewMergeRequest`, `repoRequestReviewers`, `repoMergeRequestDiff`, `repoChecks`, `repoRebaseMergeRequest`
- [x] Issue management: `repoUpdateIssue`, `repoAssign`, `repoLabels`, `repoSetLabels`, `repoLockItem`, `repoEditComment`, `repoDeleteComment`
- [x] All mutating tools reuse channel repository scope and Discord Confirm; comment deletion uses the danger/owner guard
- [x] GitHub and GitLab request/response normalization added in `packages/skills/src/git.ts`
- [x] Provider helper regression tests added to `packages/skills/test/git.test.ts` (22 assertions pass)
- Known limit: GitHub rebase is rejected because the REST API has no general rebase endpoint; GitLab lock is rejected because the selected API surface has no equivalent lock endpoint
- Known limit: GitLab request-changes is represented by a note; GitLab labels are replaced through the issue/MR update endpoint

## Phase 24 — Remaining repository, CI/CD, access, org, and utility tools

- [x] Repository lifecycle: create, settings, rename, archive, delete, fork, transfer
- [x] Branch/tag/release: delete/protect/read protection, create/delete tags, create/delete releases
- [x] Code writes: delete/move files, multi-file commits, guarded default-branch writes
- [x] CI/CD: run/cancel pipelines, artifacts, schedules, variables, secrets, runners
- [x] Access/security: members and roles, invitations, deploy keys, webhooks, security alerts
- [x] Org/group: list orgs, members, teams/subgroups, group creation, team/member management
- [x] Other: wiki, snippets/gists, packages, notifications/to-dos, contributor/language/traffic stats
- [x] All remaining tool definitions are registered in `git_repositories`; total registered Git tools: 83
- [x] Existing Git and confirmation suites: 11 tests / 50 assertions pass
- Known limit: GitHub secret writes require public-key encryption and are rejected until that key exchange is added; secret values are never returned
- Known limit: GitHub wiki and organization creation, GitLab lock/traffic stats, and GitHub general rebase remain explicit provider capability errors
- Known limit: provider-specific package, runner, artifact, and schedule APIs expose different shapes; handlers normalize the common fields and preserve provider payloads where needed
- [x] Final verifier follow-up: Git tool type errors in default-branch guard and file move narrowing fixed; remaining root typecheck failures are existing `apps/web` alias/implicit-any errors

## Phase 25 — Guardrails and anti-abuse

Three layers: conversation policy (prompt), capability/authorization gate (code), execution safety (confirmation, limits, audit). The prompt only steers; code decides.

- [x] 1. Plan and checklist recorded here
- [x] 2. Types: `SkillRisk`, `ToolPolicy`, skill metadata (`capabilities`, `risk`, `requiresConfirmation`, `allowedScopes`, `requiredPermissions`), `AuthorizationContext`; `packages/skills/src/guardrails.ts` (`GuardrailDecision`, `GuardrailService`)
- [x] 3. Gate in `SkillRegistry.executeTool` (active tool, scope, role, size, rate, confirmation, idempotency) and `auth` on `SkillContext`
- [x] 4. Generic confirmation store (tenant, bot, user, channel, payload hash, expiry, single use) and Discord handler
- [x] 5. System prompt policy block; tool results labelled `<untrusted_data>`; secrets/paths redacted
- [x] 6. Rate, idempotency and audit events (`guardrail_denied`, `tool_denied`, `confirmation_*`, `prompt_injection_detected` in `usage_events`)
- [x] 7. Tests and full verification
- [x] 8. Rollout via `GUARDRAIL_MODE`: `observe` (log only) → `write` (enforce confirmation) → `enforce` (default; also scope, role, injection)

- Done: `SkillModule` gained `capabilities`, `risk`, `requiresConfirmation`, `allowedScopes`, `requiredPermissions`, `toolPolicy`, `confirmsInternally`; `SkillContext.auth` (`AuthorizationContext`) is filled by the ReAct loop from the Discord member's roles and permissions, and the registry refuses it when its ids disagree with the context
- Done: `packages/skills/src/guardrails.ts` (decisions, classify, checkTool, redact, `asUntrusted`, rate, duplicate, audit). Gate lives in `SkillRegistry.executeTool`; classification runs before the ReAct loop
- Done: tasks `updateTaskStatus`/`assignTask` and Discord `createChannel`/`archiveChannel` now return `pending` and need the asker's Confirm button; `createTask` and `setChannelTopic` do not. Discord channel writes need the `ManageChannels` permission (or `Administrator`). Git keeps its own queue and scope (`confirmsInternally`) but now shares the store, so payload hash and audit apply
- Done: confirmation is bound to tenant, bot, user, guild and channel (the store), payload hash, 10 min expiry and single use; the confirmed run gets the Discord adapter again (`handleConfirmButton(i, botId, discordFor)`)
- Done: tool results go to the model inside `<untrusted_data>` with secrets, env values and internal paths redacted; replies are redacted too; injection phrases in messages and tool results are audited (`prompt_injection_detected`), and in messages refused before the model runs
- Done: audit rows are `usage_events` of type `guardrail_denied`, `tool_denied`, `confirmation_requested`, `confirmation_accepted`, `prompt_injection_detected`; they hold categories and ids only. Limits: 30 calls/min per user, 120 per tenant, 10 per write tool per user, args 8000 chars, message 4000 chars, same action blocked for 60 s
- Rollout: `GUARDRAIL_MODE=observe|write|enforce` (default enforce); see `.env.example`
- Tests: `apps/agent/test/guardrails.test.ts` (3 tests); `git-confirm`, `git-tools` and `skills` tests updated for the new wrapper, titles and confirmation. Full run: all pass except `packages/cli` setup (failing before this work)
- Known limit: classification and injection detection are regex (English and Indonesian), so a rephrased attack gets through to the model; the code gates on tools still hold. No external moderation model.
- Known limit: counters, duplicate guard and pending confirmations are in memory, per process, and reset on restart
- Known limit: `confirmation_expired` is not written to the audit table (an expired click carries no tenant after the sweep); the user only sees "expired"
- Known limit: the web chat has no guild or user, so tools needing a confirmer (and the Discord tools) fail there
- Known limit: attachments are not read by the bot, so there is no attachment-specific scan

## Phase 26 — Workspace: tasks, notes and memory as Markdown files (issue #1, tickets #2–#9)
Spec: GitHub issue #1. Decision: `docs/adr/0003-agent-data-lives-in-workspace-files-not-the-database.md`. Term: **Workspace** in `GLOSSARY.md`.

- [x] 2. Storage contract + local driver (`WORKSPACE_DRIVER`, `WORKSPACE_DIR`), path rules, `listFiles`/`readFile`/`writeFile`
- [x] 3. Visibility: own channel (thread → parent), guild `shared/`, tenant `shared/`, DM; name files for guild and channel folders
- [x] 4. Atomic writes + version check, `moveFile`, `deleteFile` (needs confirmation), `searchFiles`
- [x] 5. Task Management stored as `<slug>-<short-id>.md` with frontmatter; same four tool names and confirmation rules
- [x] 6. `MEMORY.md` of tenant, guild and channel loads into the per-turn context (4000 chars each); active tasks read from files
- [x] 7. Admin routes `/api/admin/tenants/:id/workspace/{tree,file,move}` + read-only browser in the tenant page
- [x] 8. Web editor: create, edit, rename/move, delete; stale edit refused with a conflict banner
- [x] 9. One-off export of the `tasks` table: `bun run export-tasks` in `packages/skills`; rerunnable, leaves the table in place
- Also done this session: Discord channel conversations now include threads (parent channel stored in conversation metadata); Git access is its own tab per integration; tenant Skills tab with on/off switches.
- Tests: `packages/skills/test/workspace.test.ts`, `apps/agent/test/workspace-admin.test.ts`; `cache` and `guardrails` tests seed tasks through the tool now. Full run: all pass except `packages/cli` setup (fails on a clean checkout too: `keyId` vs `platformKeyEncrypted`).
- [x] `/api/v1/tasks` now reads and writes tenant Workspace task files; the legacy `tasks` table remains only for the one-off export and rollback window.
- [x] The seed no longer creates a demo row in the legacy `tasks` table; the task tool still accepts the legacy `discordChannelId` argument for compatibility while the current turn determines file visibility.
- Known gap: a task file that cannot be read (over 256 KB) is skipped silently; listing stops at 500 files.
- [x] DM folders, Web UI-created folders, exported task folders, and REST-created task folders receive hidden `.name` labels.
- Known limit: local disk, one instance only. The `s3` driver is designed against the same contract and not built.
- Known limit: the version check is modified time + size, which can miss two same-size writes inside one clock tick.
- Web UI uses `window.prompt` for new file, new folder and rename; replace with a dialog.

## GitHub Issue Audit — 2026-10-08

- GitHub currently has 9 open issues: the Workspace parent spec `#1` and tickets `#2`–`#9`; all are labelled `ready-for-agent` and unassigned.
- The ticketed Workspace implementation is present in this working tree and the focused verification passes: 9 tests across `packages/skills/test/workspace.test.ts`, `packages/skills/test/skills.test.ts`, and `apps/agent/test/workspace-admin.test.ts`.
- The issues have not been closed or marked complete on GitHub, so the tracker still reports the entire spec as outstanding.
- Remaining implementation gap found locally: real-provider/real-Discord validation is still pending and requires credentials and live services; S3 remains explicitly out of scope for this release.
- Ticket #9 is blocked by #5; #8 by #4 and #7; #7 and #6 by #3; #5 and #3 by #2; #4 by #2. The implementation currently exists despite those tracker dependencies remaining open.
- Follow-up fixes completed after review: task listing now reads frontmatter only, renamed task files remain discoverable by UUID frontmatter, malformed IDs/timestamps are rejected, Workspace listings over 500 entries are refused, DM/guild/task labels are created consistently, and the Web UI can initialize folders from the Workspace root.

## Follow-up - Thread-scoped Git write confirmation terminology

- [x] Issue #15: terminology aligned with the glossary, action context construction centralized, and unrelated progress churn restored.

- [x] Kedua branch baru digabungkan ke main melalui fast-forward; seluruh commit feature dan terminology sudah tercakup, perubahan lokal sebelumnya dipertahankan.

## Phase 27 — Brief-to-issue-draft Discord assistant (planning, map #16)

Planning only for now. The decisions are worked on the wayfinder map [#16](https://github.com/yhagus/pachiware/issues/16). Implementation issues come after the spec is complete.

- [x] Destination set: a spec for turning a brief into detailed issue drafts with clarifying rounds, grounded in the repository. It also covers when the bot speaks, its reply style, and image input for each profile.
- [x] Glossary: added Brief, Issue draft, Minutes, Playbook; Profile now declares which inputs it accepts.
- [x] Map and 12 tickets created (#17–#28), with blocking edges wired.
- [x] Out-of-scope bug filed: #29, thread messages debounced against Phase 15.2.
- [x] Research #17–#20 resolved; findings were on `research/*` branches and gisted in the map; merged into `main` under `docs/research/` on 2026-10-14 and the branches removed
- [x] Grilled and closed: #21 Anatomy, #22 Clarifying round, #24 Playbook form, #23 Grounding, #25 When the bot speaks, #26 Reply style, #27 Image handling, #28 Eval harness, #30 Minutes playbook, #31 Creating issues. Glossary gained Clarifying round.
  - [x] #21 Anatomy of an issue draft: the sections and footer are settled, along with the gap checklist, `*(added)*` tags, the Context used permalinks, existing-label proposals, and the size budget. The gap about the issue and its labels needing one confirmed action was closed in #31 (labels go in the create call).
- [x] Fog graduated into new tickets: #30 Minutes playbook and #31 Creating a brief's issues.
- [x] Grilling finished: no open tickets and Not yet specified is empty (the images fog was settled in #27). Map #16 is clear; next is /to-spec.
- [x] Spec published: #32 (ready-for-agent), collapsing the map's 14 decisions. Test seams: the Discord bot (fake client, real agent loop, scripted model), the LLM router's HTTP boundary, and an offline git provider for evals.
- [x] Tickets published as sub-issues of #32 with native blocking: #33-#48 ready-for-agent, #49 judge calibration ready-for-human (label created). Starting frontier: #33 and #36.
- [x] Implementation of #32 on branch `feat/brief-to-issue-draft` (tickets #33-#48, one implementer worktree each, merged in dependency order):
  - [x] #33 Discord scenario harness: fake client, real agent loop, scripted model, stubbed provider HTTP.
  - [x] #34 Reply style: fixed style policy in the cached prompt, splitter that keeps code blocks whole, filler stripping, 3-message ceiling.
  - [x] #35 Speaking rules: 👀 for addressed noise, `[[silent]]` / `[[react:…]]` markers for non-addressed messages.
  - [x] #36 Anthropic profiles, `accepts_images` column (both dialects), profile Test with an image probe, Web GUI switch.
  - [x] #37 Image input: download, downscale with `Bun.Image` (needs Bun ≥ 1.4), base64 per provider, placeholders in history, retry without images on 400.
  - [x] #38 Playbooks: loader with tenant overrides, context-menu and mention triggers, thread bindings as Workspace files, `playbooks/` write refusal.
  - [x] #39 Web GUI playbook editor: read-only built-ins, copy as override, live command re-registration.
  - [x] #40 Brief breakdown and round 1, packed in code; author-only decisions, others' input recorded with 👀.
  - [x] #41 Answers, carry-once, "draft now", pure draft checker, draft embeds revised in place, `drafts.md` without a repository.
  - [x] #42 Grounding: repository choice per draft, fixed read order with a code-enforced budget, duplicate questions, existing labels, Context used pinned to HEAD.
  - [x] #43 Batch issue creation with one confirmation (no thread grant), dependency order, native links with text fallback, duplicate-free retry.
  - [x] #44 Screenshots in a brief described into the brief file and drafts; text-only profiles get a describe question.
  - [x] #45 Minutes: three triggers, 500-message / 24-hour caps, permission checks, jump links, requester corrections, Workspace storage.
  - [x] #46 Minutes action items become a brief.
  - [x] #47 Offline eval: pinned checkout served through the fetch seam, fixtures, code checks in CI, `bun run eval`.
  - [x] #48 Pinned judge, paired profile comparison with standard errors, latency in usage events, 20 fixtures, rejudge script.
  - [x] Code review (Standards + Spec) fixed on the same branch: image notes survive the cut and brief threads, `repoCreateIssue`/`repoSetLabels` closed in brief threads, link failures reported, playbook turns get at least 20 iterations, current Claude model ids, English/Indonesian strings for code-written text, guardrail waiver narrowed to capability and length refusals, screenshot-only briefs reach round 1, `docs/api.md` updated, duplicates removed, brief presentation moved out of `client.ts`, one provider list.
  - [x] Kept on purpose: at most 3 repositories per brief (budget guard, explained in the playbook); Anthropic requests omit temperature (current models reject it); long replies are cut to 3 messages with a note rather than summarised; a reaction marker may answer an addressed message.
  - [x] Verification: `bun test` 255 pass, 1 fail. The failure is `guardrails.test.ts` "iteration cap", which also fails on the base commit and is fixed by an uncommitted local change to `react.ts` outside this branch. `bun run typecheck` reports only the existing `apps/web` and `gitConfirm.ts` errors.
- [x] Merged into main by fast-forward (`chore/brief-map-and-drop-9router` and `feat/brief-to-issue-draft`) and pushed. Spec #32, tickets #33–#48 and map #16 closed.
- [x] ReAct budget raised: default 32 iterations, cap 128, and new tenants seeded with 32. When the budget runs out the model gets one tool-free turn to summarise what was done and what is next. Playbook turns still get at least 20. `bun test` now passes 256/256.
- [ ] Hand calibration of the eval judge: #49 (ready-for-human).
- [ ] Recorded eval outputs in `apps/agent/eval/recorded/` come from scripted dry runs; replace them with a live run once a key is available.
- [x] Removed 9router: the project has no tie to it. The custom provider has no default base URL anymore, and both the call and the connection test refuse to run without one. Docs, the map and research #17 were updated to match. `bun test apps/agent` passes 19/19. `bun run typecheck` still reports only the errors that were already there (`apps/web`, `apps/agent/src/discord/gitConfirm.ts`).

## Phase 28 — Fine-grained skill and playbook control (planning, map #50)

Planning only for now. The decisions are worked on the wayfinder map [#50](https://github.com/yhagus/pachiware/issues/50). Implementation issues come after the spec is complete.

- [x] Destination set: a spec for (A) a playbook catalogue, with mattpocock/skills imported as built-in playbooks that are off by default, started by `/<name>` in a new thread, and able to load other playbooks; and (B) per-tool skill control, with tools grouped inside each skill and tagged read / write / destructive. Both apply at Tenant → Bot → Guild → Channel, where each level only narrows the one above it.
- [x] Glossary: Playbook is started by a person by name and may load another playbook; new relationship between Playbook and Skill.
- [x] ADR 0004: Claude Code style skills become playbooks, not skills (no rename to "Toolset").
- [x] Map and 8 tickets created (#51–#58), with blocking edges wired. Starting frontier: #51, #52 (research, running), #53, #54.
- [x] Research #51 and #52 resolved; findings are in `docs/research/mattpocock-skills-as-playbooks.md` and `docs/research/discord-slash-commands-for-playbooks.md` (merged into `main` on 2026-10-14, branches removed) and gisted in the map. Their open questions were added to #56, #57, #58; web fetch went to Not yet specified.
- [x] Fog graduated into #59: git tools and batch confirmation for tracker playbooks.
- [x] #53 levels: Tenant → Bot → (bot, guild) → channel; availability rules only narrow, no rule inherits, bot and guild may require opt-in below. Glossary gained Availability rule; ADR 0005 records why availability inherits while git scope does not.
- [x] Fog graduated into #60: who may start a playbook or call a tool.
- [x] #54 tool groups and effects: read / write / danger, a multi-action tool takes its riskiest action, tags only describe and are rule targets, git has six groups, playbook-only tools follow their playbook, everything declared in code. Glossary gained Effect.
- [x] Grilling #60 who may use it, #59 git tools and batch confirmation, #56 slash command flow, #57 playbook loading playbook, #58 state of imported playbooks; #55 admin UI settled without a prototype (the #69 views suffice). Decisions are commented on each ticket (2026-10-14).
- [x] Spec published early for track B and the level model: #61 (ready-for-agent). Test seams: the Discord scenario harness (offered tools per call) and the admin HTTP API. Track A tickets stay open on map #50.
- [x] Tickets for spec #61 published as sub-issues with native blocking, all ready-for-agent: #62 tool catalogue (start), #63 availability tracer bullet, then #64 effect rules, #65 opt-in, #66 playbook availability, #67 Confirm re-check, #68 off-summary in the prompt, #69 admin views per bot, guild, and channel.
- [x] Implementation of #61 on branch `feat/availability-rules` (tickets #62–#69, one implementer worktree each, #64–#67 in parallel):
  - [x] #62 Tool catalogue: every tool declares an effect (read / write / danger; `destructive` and git's own scale folded in), git tools in six groups, brief tools marked as playbook tools; the admin catalogue reads the code registry (fixes Git and Workspace showing 0 tools). Git owner-only stays an explicit level per call, independent of effect.
  - [x] #63 Availability rules: `availability_rules` table (both dialects, one shared DDL), one resolver walking tenant → bot → (bot, guild) → channel, rules routes in the admin and tenant APIs, loop offers only available tools, execution re-checks, tenant tool switches on the Skills page.
  - [x] #64 Effect rules, with tenant effect switches. #65 `opt_in` at bot and guild answered by `on` below. #66 Playbook rules, start refusals naming the cause, playbook tools follow their playbook, a bound thread ends with a note. #67 Confirm re-checks availability; a refused change stays queued.
  - [x] #68 A "Turned off here" summary (skills, effects, playbooks) at the end of the prompt only when something is off; byte-identical otherwise.
  - [x] #69 Availability view per bot, server, and channel with inherited state and off / opt-in / on controls; routes return `inherited`. Antislop Delivery Gate passed in headless Chromium (light theme and real servers not checked).
  - [x] Code review (Standards + Spec) fixed on the same branch: `on`/`opt_in` beneath an `off` refused (story 20), rule writes are an atomic upsert (no 500 on concurrent PUTs on Postgres), a test pins playbook tools obeying effect rules, tenant playbook switches (story 11), one route helper and one target key, effect wording typed by `Effect`, shared web skill helpers, `@/` imports, glossary Availability rule includes the tenant, audit metadata documented (`effect`, older rows `risk`).
  - [x] Kept on purpose: brief tools are no longer offered when Workspace is off (issue-draft needs it, so they could not be used anyway); a Confirm refused because the tool is off keeps the change queued.
  - [x] Verification: `bun test` 302 pass, 0 fail. `bun run typecheck` reports only `apps/web` lines (291; the root config does not resolve the web `@/` alias, `apps/web/tsconfig.json` alone reports 0); web build passes. The PostgreSQL migration was read but not run (no local Postgres).
- [x] Track A collapsed into spec [#103](https://github.com/yhagus/pachiware/issues/103) together with bug #71; tickets #55–#60 and #71 closed, map #50 closed (2026-10-14). Implementation is phase 30.

## Phase 29 — Administrative assistant: time, due dates, memory, reminders, digest, filing (spec #72)

Harness review scored the bot 62/100 as an everyday administrative assistant (strong on safety, reply style, playbooks, eval; weak on time awareness, due dates, reminders, memory upkeep, filing, long conversations, router resilience). A grilling session settled every branch; the spec is issue [#72](https://github.com/yhagus/pachiware/issues/72) with one ready-for-agent sub-issue per block and native blocking edges.

- [x] Glossary gained Due date, Reminder, Digest, Memory, Decision, Note, with their relationships.
- [x] ADR 0006: schedules live in the database, not the Workspace (time-indexed runtime state; must run on one process with SQLite and no Redis; no cron strings).
- [x] Test seams agreed: the Discord scenario harness (gains a fake clock, a scheduler tick, and permission grants) for every behaviour; the subprocess API scenario with stubbed `fetch` for the router and the new console endpoints. No web UI tests.
- [x] Spec #72 and sub-issues published, all ready-for-agent: #80 block 1 (start), then #73 persona and memory, #74 history and summary, #75 schedules and Reminders, #78 Discord tools (all blocked by #80); #76 Digest (blocked by #75); #77 filing (blocked by #73); #79 live eval (blocked by all).
- [x] Tickets published as sub-issues of the block issues, all ready-for-agent with native blocking (the block issues are groupers now, no agent label). Starting frontier: #81, #84, #87, #88, #95, #99, #100.
- [x] Implementation on branch `feat/assistant-spec-72` (one implementer worktree per ticket, one merger, four waves by the blocking graph; final tip `fda4511`). All 21 tickets merged with --no-ff; conflicts were only tool-count assertions, the exact tool list, the clock helpers, and catalogue keys.
  - [x] #80 Block 1: #81 `timezone` and `language` on tenant and guild (console: tenant settings tab, server settings sheet), one `Now:` line in the per-turn context, `clock.ts` as the single clock, harness `s.clock`; #82 task `dueAt`/`createdBy`, `setTaskDueDate`, `listTasks` due and late filters, task writes without Confirm; #83 router 60 s timeout, 3 retries with backoff and `Retry-After`, Anthropic `cache_control` and cached tokens in usage, temperature 0.2 in DDL/schemas/seed, fallback text in the configured language.
  - [x] #73 Block 2: #84 `remember`/`forget` (guild level needs Manage Server), harness `s.discord.grant`; #85 persona in `packages/db/src/persona.ts` seeded as the editable prompt, migration of byte-equal old defaults, capability regex removed, top-level folder set enforced; #86 compaction above 4000 characters with the 30-day guard.
  - [x] #74 Block 3: #87 `readChannelHistory`; #88 rolling summary in `conversations.metadata`, rewritten only when the history window steps, after the reply.
  - [x] #75 Block 4: #89 `schedules` table and in-process scheduler (ADR 0006), `createReminder`, harness `s.scheduler.tick()`; #90 daily/weekly/monthly with `until`, six-hour skip, late note, three-failure stop; #91 `listReminders`, `cancelReminder`, limits 50 per owner and 500 per tenant; #92 `withTasks`; #93 per-bot Reminders page and endpoints.
  - [x] #76 Block 5: #94 `digestChannels` on guild settings, one digest row per channel, post of due-today and late tasks, nothing when empty, no pings; tenant zone changes resync rows of guilds without an override.
  - [x] #77 Block 6: #95 attachments of addressing messages filed under `files/` (10 MB, suffixes on duplicates); #96 PDF and DOCX text to a sibling `.md` (unpdf, mammoth); #97 `saveAttachment`; #98 Decision and Note conventions in the persona.
  - [x] #78 Block 7: #99 `sendMessage` behind Confirm with access checks; #100 `pinMessage` (Manage Messages) and `listMembers` (member search, no privileged intent).
  - [x] #79 Block 8: #101 assistant eval under `apps/agent/eval/assistant/` (7 briefs, code checks, judge rubric 0.1, recorded dry runs, `bun run eval:assistant`).
- [x] Code review (Standards + Spec) fixed on the branch: fallback strings no longer name the console, Digest rows follow a tenant zone change, history refusals use the configured language, adapter history reads the shared clock, one set of zone helpers plus `hhmm`, `permissionName`/`hasPermission` in `packages/skills/src/permissions.ts`, Memory speaks of levels (the glossary reserves "scope" for git), `DigestChannel` declared once.
- Decisions and deviations worth knowing:
  - Anthropic requests carry no temperature: current Claude models reject non-default values, so 0.2 applies to OpenAI and custom providers only.
  - A Reminder under five minutes late posts without the late note (ADR 0006 updated). Confirm prompts still address the asker; Reminders are the only unprompted pings.
  - The persona migration replaces four byte-equal old defaults (SQLite DDL, Drizzle, agent fallback, and the block-2 persona), never an edited prompt.
  - Moderators' `listReminders` shows their own guild, not every guild. Caps not in the spec: 10 mentions and 1500 characters per Reminder, 50 Digest channels per guild.
  - `ToolPolicy.requiredPermissions` overrides a skill's permission per tool; `SkillModule.checks` runs before Confirm is offered; `SkillContext.complete` lets a skill make one model call (set only on the chat path).
- Verification at `fda4511`: `bun test` 418 pass, 0 fail (84 files); `bun run typecheck` reports only the pre-existing `apps/web` alias errors from the root config (`apps/web` tsc alone is clean); `bun run build` passes. PostgreSQL 18.6 in a disposable container: a fresh install migrates and seeds twice; an install created on `main` with two tenants upgrades twice with this branch (new `schedules` table and index, guild and tenant zone and language columns, `digest_channels`; the tenant on the old default prompt moves to the persona, the edited one is kept). Existing tenants keep their stored temperature 0.7; only new tenants get 0.2 (decided: no migration of stored values; an admin lowers it in the console).
- [x] Fast-forwarded into `main` and pushed; spec #72 and block issues #73–#80 closed; the feature branch was removed from the remote.
- [ ] Hand calibration of the assistant judge (rubric 0.1), as for the issue-draft judge.
- Target after all blocks: about 90/100; the rest depends on the tenant's model, not the harness.

## Phase 30 — Playbook catalogue and slash commands (spec #103)

Track A of map #50. A grilling session (2026-10-14) settled every open ticket; the spec is issue [#103](https://github.com/yhagus/pachiware/issues/103). Tickets are cut in a later session.

- [x] Glossary: Playbook allows references that are only loaded; Availability rule notes playbooks that start off for the tenant; new term Playbook thread (bound to playbook, bot, and person; only that bot answers); a playbook cannot start while a loaded playbook is off.
- [x] ADR 0007: playbook documents (glossary, decision records) and tracker state live in the target repository through one pull request per thread; the Workspace is the fallback (glossary file, Decisions). ADR 0005 notes that imported playbooks start off for the tenant.
- [x] Decisions recorded in the spec:
  - All commands at guild scope, one overwrite per bot per guild with slash and menus (15 menus, #71), the global list cleared once. Registered unless off at tenant, bot, or guild; channel rules, required skills, and loaded playbooks are refused privately at use. One shape `/<name> text file`. Defer, public line, playbook thread, binding with the bot id.
  - New frontmatter: `run` (`in-place` for minutes and wait-what), `default: off`, `loads` (static, transitive to depth 3, no cycles), `closes` (replaces the hard-coded closed tools), `start: false` for references.
  - Thirteen mattpocock/skills imported as playbooks a person can start, plus codebase-design and writing-for-agents as references; all off by default.
  - Git: labels on create and as a filter, `repoLinkIssues`, `repoSubIssue`, batch `repoCreateIssues` and `repoUpdateIssues` (25 items, one own Confirm, resumable).
  - Out of scope: role rules and "always confirm", web fetch (research, teach), installing from a URL, model-invoked playbooks, moving `tenant_skills`.
- [x] #70 fixed on `main` (`5ed2aeb`): context-menu commands defer privately before the tenant and Workspace lookups and edit that reply. The scenario harness throws on a second initial response and keeps a privately deferred reply private. `bun test` 419 pass, 0 fail; `bun run typecheck` unchanged (325 pre-existing `apps/web` alias errors from the root config).
- [x] Found while grilling: #102, plain git write tools (`repoCommitFiles`, `repoWriteFile`, `repoDeleteFile`, `repoMoveFile`) reach the default branch without the owner check.
- [x] Spec #103 finalised with `/to-spec` and labelled ready-for-agent. Two test seams: the Discord scenario harness (extended with guild command overwrites and slash interactions; it also covers the new git tools through its stubbed provider HTTP) and the admin HTTP API, plus the existing registry test.
- [x] Spec #103 cut into 16 tickets, all sub-issues of #103 with native blocking, ready-for-agent: #119 bot-owned playbook threads, #104 guild-scoped registration, #105 slash command per playbook, #106 in-place playbooks and `/minutes`, #107 `closes` in frontmatter, #108 playbooks loading playbooks, #109 default-off playbooks, #110 slash names and status per guild, #111 git issue tools, #112 batch issue tools, #113 thread repository, #114 playbook documents by pull request, #115-#117 imported conversation, repository, and tracker playbooks, #118 unused `role` scope dropped. Decided while cutting: a playbook that needs a repository declares `repository: required`.
- [x] Implementation on branch `feat/playbook-catalogue-103` (one implementer worktree per ticket, one merger, frontier-driven; final tip `b92b396`). All 16 tickets merged with --no-ff; conflicts were binding fields, the scenario harness, the git tool count, and the availability resolver where #108 and #109 met.
  - [x] Commands: one overwrite per bot per guild with slash and menus (15 menus, 100 slash, alphabetical), only in guilds the bot is set up for; the global list is cleared once when non-empty; a refused overwrite sets the bot's last error and is retried; registration follows playbook edits, availability changes above the channel, and skill switches (one switch route), debounced.
  - [x] Starting: defer privately, refuse privately with the cause (playbook off, skill off, loads X off, no repository), else one public line, a playbook thread bound to playbook, bot (`botId`), and person; only that bot answers there. `run: in-place` for minutes (`/minutes`: last 3 hours or the whole thread) and wait-what (the bot's last message).
  - [x] Playbook frontmatter: `closes`, `loads` (static, up to three hops, no cycles), `start: false`, `default: off` (tenant `on` only for these), `run`, `repository: required`. Chains combine requires, optional, and closes.
  - [x] Git: labels on create and as a filter, `repoLinkIssues`, `repoSubIssue` (GitLab: `relates_to` plus a task line), batch `repoCreateIssues`/`repoUpdateIssues` (25 items, one own Confirm, progress per batch in the Workspace, failed links retried), `playbookRepositories`, `writePlaybookDocument` (branch `playbook/<playbook>-<thread>`, one pull request per thread). 92 git tools.
  - [x] Imported from mattpocock/skills, all off by default with `LICENSE.md` (pr also HumanLayer's): grilling, grill-me, to-questionnaire, ask-matt, wait-what, grill-with-docs, domain-modeling, to-spec, code-review, pr, wayfinder, to-tickets, triage; references codebase-design and writing-for-agents. A catalogue test checks licences, default-off, and that playbooks name only tools and playbooks that exist.
  - [x] Admin: slash status per guild in the availability view, a warning for names Discord cannot use, a switch for default-off playbooks, and what each playbook loads.
- [x] Code review (Standards + Spec) fixed on the same branch: issue-draft closes the new git tools again, document playbooks fall back to the Workspace with the git skill off, `@bot wait-what:` explains the bot's last message, failed batch links are retried, `repository: required` checks the actual repository list, global clear only when needed, guild set-up, 100-command cap, overwrite failures; glossary wording (no "ticket", "session", "conversation") in imported text; comment and duplication cleanups.
- Decisions and deviations worth knowing:
  - `writePlaybookDocument` is write/Code and `playbookRepositories` read/Browse, not Issues & PRs; only the person who started the playbook picks its repository.
  - Batch progress lives in the Workspace (per channel `batches/`), a stretch of ADR 0003 accepted for now.
  - Known gaps: no tool lists a map's sub-issues or an issue's blockers (wayfinder reads `Map:`/`Blocked by:` lines it writes); comments, claims, and map edits still need one Confirm each; the model gets no turn after a batch Confirm; providers are assumed to create missing labels on first use (unverified).
  - "Questionnaire" (to-questionnaire) clashes with the glossary's Avoid list for Clarifying round; left for a domain-modeling pass.
- Verification at `b92b396`: `bun test` 504 pass, 0 fail (97 files); `bun run typecheck` only the 325 pre-existing `apps/web` alias errors from the root config; `apps/web` tsc and build pass. No database schema changes.
- [x] #102 fixed and fast-forwarded into `main` (`60d6997`, `293b7e9`), issue closed: `repoCommitFiles`, `repoDeleteFile`, and `repoMoveFile` require `branch` and refuse the default branch (also when spelled `refs/heads/<name>`), pointing to `repoWriteDefaultBranch`; `repoWriteFile` already refused it and now shares the same check. The owner tool commits through `commitToDefaultBranch`. Code review (Standards + Spec): no hard violations, spec fully met; fixed on the branch the guard's name (`assertNotDefaultBranch`), a trimmed comparison, the empty-files check moved into the shared commit, and the leftover `ref` alias. Test seam: the `git.ts` helpers with stubbed fetch (`packages/skills/test/git-default-branch.test.ts`). `bun test` 509 pass, 0 fail; typecheck has only the pre-existing `apps/web` alias errors.

## Phase 31 — Tasks for project work (spec #120)

Started from a review of the harness as a management assistant (2026-10-14): task and project management scored 11/20, the weakest heavy area. A grilling session the same day settled the model; the spec is issue [#120](https://github.com/yhagus/pachiware/issues/120). Tickets are cut in a later step.

- [x] Glossary: new terms Project (the channel; no project apart from it), Task, Personal task (DM, no project, only its person sees it), Assignee ("owner" now reserved for a Reminder's setter), Progress note.
- [x] ADR 0008: a project is a channel, not an entity of its own; Discord category and an explicit project entity rejected.
- [x] Decisions recorded in the spec:
  - Assignee is a member (id plus display name) or a name only; one per task. Mention, "me", or an exact case-insensitive name match on one member links it; several matches ask once; none records the name and says so. Legacy free-text assignees read as names and link when the task is next changed. A member who cannot view the channel is refused.
  - Status `cancelled` (optional reason as a progress note); no delete tool. Progress notes are dated lines in the task file, recorded only when the bot is addressed. Checklists are Markdown in the description, shown as `(done/total)` in the task line.
  - Edit title, description, and priority; query over title and description; ambiguous references ask once. Move between projects, and from a Personal task to a project, never back; asker must view both channels.
  - Scopes: mine (assigned to me plus my Personal tasks, every viewable channel of the guild, or every shared guild from a DM) and delegated. Grouped by channel, sorted by due date, capped at twenty. Reminder `withTasks` uses mine. The task line column is renamed to assignee.
  - Out of scope: subtasks, dependencies, `blocked`, delete; pinging assignees, Digest pings, stale follow-ups, and overheard progress go to the Proactivity work.
- [x] Test seams: the Discord scenario harness (extended with a second guild for DM views across guilds) and the daily-behaviour eval (new briefs; fixtures move from owner to assignee).
- [x] Spec #120 cut into 12 tickets, all sub-issues of #120 with native blocking, ready-for-agent:
  - #121 Assignee column and member-or-name assignee (prefactor; the only starting ticket)
  - #122 assign by mention, "me", or member name
  - #123 Assignee must view the channel (adds the adapter's view check)
  - #124 Progress notes and detail view
  - #125 cancel a task
  - #126 edit and query
  - #127 checklists
  - #128 mine and delegated within a guild
  - #129 Personal tasks and filing from a DM
  - #130 DM views across guilds, Reminders with tasks, second harness guild
  - #131 move a task
  - #132 persona and daily-behaviour eval (last, so the persona is frozen once)
- [x] Implement #121–#132.
  - [x] #121 Assignee is a member (id plus name) or a name only; legacy plain-text `assignedTo` parses as a name; filter matches name in any case, id, or mention; task line column renamed owner to assignee (persona frozen into old defaults, turn context, Reminders with tasks, eval checks). Helpers `parseAssignee`, `renderAssignee`, `assigneeLabel`, `assigneeMatches`, `isAssignee` in `packages/skills/src/builtin/assignee.ts`. 3 new scenarios in `task-assignee.test.ts`, persona migration test extended; full suite 512 pass, 0 fail.
  - [x] #126 `editTask` tool (no Confirm) changes title, description (empty clears) or priority; `listTasks` takes `query` matched against title and description, every word, any case, combined with status/assignee/due filters. Helpers `checkTitle`, `matching` in `packages/skills/src/builtin/tasks.ts`. 4 new scenarios in `task-edit-query.test.ts`; full suite 516 pass, 0 fail.
  - [x] #124 `addProgressNote` tool (no Confirm) appends a dated line with the reporter's name under a `## Progress notes` section after the description; `showTask` returns the task line, description, three latest notes and the older count; files without the section still parse; editing the description keeps notes. Helpers `progressNote`, `parseBody`, `renderBody` in `packages/skills/src/builtin/tasks.ts`. 6 new scenarios in `task-progress-notes.test.ts`; full suite 522 pass, 0 fail.
  - [x] #122 Assignee resolves from a mention, "me", or an exact case-insensitive member name (username or display name); several matches ask once, none records the name only and says so; legacy name-only assignees link when the task is next changed; adapter gains `getMember` and member `username`. Helpers `resolveAssignee`, `linkAssignee`, `assigneeFilter`, `ambiguousAssignee`, `nameOnlyNote` in `packages/skills/src/builtin/assignee.ts`. 8 new scenarios in `task-assign-resolve.test.ts`; full suite 530 pass, 0 fail.
  - [x] #125 Status `cancelled`: `updateTaskStatus` takes an optional reason stored as a Progress note in the same write (none means no note); a cancelled task is never late and leaves the default list, turn context, Digest and Reminder task lists, while status `cancelled` or `all` still finds it. Shared `isOpen` check in `packages/skills/src/builtin/tasks.ts` replaces the scattered `!== "completed"` filters. 3 new scenarios in `task-cancel.test.ts`; full suite 533 pass, 0 fail.
  - [x] #127 Checklists: Markdown `- [ ]`/`- [x]` items in the description; `tickChecklistItem` tool (no Confirm) ticks or unticks by text, unique part of text, or position, refusing a missing or ambiguous item without changing the file; task lines end with `(done/total)` in lists, turn context, Digest and Reminder task lists (open tasks only, via `isOpen`); `showTask` lists every item. Helpers `checklistOf`, `checklistSuffix`, `checklistLine`, `tickItem` in `packages/skills/src/builtin/checklist.ts`, `readInFull` in `tasks.ts`. 5 new scenarios in `task-checklist.test.ts`; full suite 538 pass, 0 fail.
  - [x] #123 Assignee must view the channel: assigning or creating with a member who cannot view the task's channel (or private thread they were not added to) is refused naming the channel and both ways out, nothing written; name-only, no-channel and no-Discord tasks pass; `change()` edit callback now gets `(task, path)` and a kept name-only Assignee links only to a member who can view. Adapter gains `channelView`; helpers `canHold`, `mustHold`, `taskChannelOf` (now in `packages/skills/src/builtin/taskAccess.ts`). 6 new scenarios in `task-assignee-access.test.ts`; full suite 544 pass, 0 fail.
  - [x] #128 Scopes `mine` (assigned to the asker) and `delegated` (created by the asker for someone else) on `listTasks`, across every channel folder of the guild the asker can view (unresolvable channel counts as not viewable); `here` stays the default and unchanged; results grouped by channel, soonest due first, capped at twenty with the real total and the left-out count. Helpers `viewableProjects` (now in `taskAccess.ts`) and `scopeSources`, `tasksIn`, `inScope`, `groupTasks` (now in `packages/skills/src/builtin/taskScopes.ts`). 5 new scenarios in `task-scopes.test.ts`; full suite 549 pass, 0 fail.
  - [x] #129 Personal tasks and filing from a DM: a DM's turn context and lists hold only the person's Personal tasks (no tenant `shared/`); a Personal task's assignee is the person or a name only, another member is refused; `createTask` takes `channel` (`#name` or `<#id>`) from a DM to file into a project the person can view across the servers they share with the bot; `mine` includes the asker's Personal tasks as their own group. Adapter gains `findChannels` and `forGuild` (adapter built with all bot guild ids); helpers `findProject`, `personalTasksOf`, `canHold`, `mustHold` in `packages/skills/src/builtin/taskAccess.ts`, `filingPlace` in `tasks.ts`. 7 new scenarios in `task-personal.test.ts`; full suite 556 pass, 0 fail.
  - [x] #131 `moveTask` tool (no Confirm) moves a task into another project channel (`#name` or `<#id>`, never a DM; a Personal task moves from a DM), keeping id and fields and adding a `Moved from ...` Progress note; refused with nothing changed when the asker cannot view source or destination or a member Assignee cannot view the destination; new file written before the old one is removed, a concurrent change rolls back. Helpers `move`, `sourceOf`, `projectPlace` in `packages/skills/src/builtin/tasks.ts`. 5 new scenarios in `task-move.test.ts`; full suite 561 pass, 0 fail.
  - [x] #130 DM views across guilds and Reminders with tasks: from a DM, `mine` and `delegated` draw on every guild the bot shares with the asker (each channel labelled with its guild, as "#ops (Beta)") plus Personal tasks; a Reminder with tasks lists the owner's `mine` scope grouped by channel, as asking from where it posts, and a list cut at Discord's limit never ends on a bare channel heading. Adapter gains `sharedGuilds`, bot manager `adapterOf`; `scopeSources` spans guilds from a DM, scheduler `ownerTaskLines` reuses `scopeSources`/`tasksIn`/`inScope`/`groupTasks` and `withinLimit` fits whole chunks; scenario harness gains `joinGuild` and `channel(id, { guild })` for a second guild. 5 new scenarios in `task-dm-views.test.ts`; full suite 566 pass, 0 fail.
  - [x] #132 Default persona describes project work in the glossary's terms (Projects, Assignees resolved by the tools with ask-once and name-only notes, Progress notes only when addressed, cancel without asking a reason, ambiguous references asked once, `mine`/`delegated` scopes, filing from a DM, never moving a Project's task into a DM); the prior persona frozen as `PERSONA_ASSIGNEE` in `packages/db/src/persona.ts` so the migration replaces it. Daily-behaviour eval gains six briefs with dry runs and recordings (assign-ambiguous-name, assign-unknown-name, progress-note, cancel-with-reason, task-reference-ambiguous, plate-across-channels); runner seeds members and a second channel and records each task's channel and Progress notes, checks compare them. 6 new dry-run scenarios, persona and check tests extended, persona migration test extended; full suite 580 pass, 0 fail.
  - [x] Code-review pass on the integration branch: `mine`/`delegated` without a status list open tasks only; `delegated` leaves out Personal tasks; tenant `shared/tasks` and the guild's (from a DM, every shared guild's) `shared/tasks` join both scopes as a "Shared tasks" group; Reminders with tasks cap at twenty and end with a localized "…and N more" line; `moveTask` refuses tenant-wide shared tasks and keeps a guild's shared task inside its guild; a name-only Assignee typed in a DM no longer claims no member matched. `tasks.ts` split into `taskFile.ts`, `progressNotes.ts`, `taskAccess.ts` (`personalOwnerOf` renamed `personalTasksOf`, `linkHeld`) and `taskScopes.ts` (`TaskSource.kind`, `readGroups`), exports unchanged via `index.ts`; client.ts builds adapters through one `adapterFor`, adapter.ts checks membership through `memberOf`/`inThread`. 6 new scenarios, 2 extended; full suite 586 pass, 0 fail.
- [x] Landed on main at 10aa318 (fast-forward, pushed 2026-10-14); #120–#132 closed with their commits. Live daily-behaviour eval (`EVAL_LIVE=1 bun run eval:assistant`) not run yet for the six new briefs.
- [x] Retro of the build: `bun run typecheck` now exits 0 (root tsconfig excludes apps/web and .claude; apps/web checked with its own config), tracked git hooks in `.githooks/` (pre-commit typecheck, pre-push typecheck + suite; `prepare` wires `core.hooksPath`), `AGENTS.md` stale stack/layout caches replaced and dead antislop paths pointed at the global skills, task code map kept in `docs/agents/tasks.md`. Follow-ups filed: #133 (tool-count tests), #134 (stale tool copy in seed.ts), #135 (flaky eval dry run).
- [x] #135 flaky `dry run: task-casual-indonesian`: not a timeout (the suite runs files one after another; the scenario takes 0.3s of its 20s). The `language` check read turn 2 as English: `languageOf` counted letter runs inside the random 8-hex task id (`a`, `be`) as English words, and the reply has only two Indonesian function words, so an id like `a1a2a3b4` tipped it (0.07% of random ids; 1/120 runs with 8 parallel workers). `languageOf` now reads whole alphanumeric tokens, so an id or hash never counts; this also fixes `replyLanguage` for messages carrying ids. Test `language.test.ts`; 0/320 hammered runs and 0/100,000 fuzzed ids after the fix. Landed on main at cd12c6b (pushed 2026-10-15); #135 closed.

## Phase 32 — Long text is read, not refused (spec #140)

Started from a report that messages over 4000 characters are refused in English (`guardrails.ts:93`) and that bursts can cross the limit. A grilling session on 2026-10-15 settled the model; the spec is issue [#140](https://github.com/yhagus/pachiware/issues/140).

- [x] Glossary: new term Document (a file or long text given in a conversation, kept as it was; not a Note); Minutes narrowed to what the bot wrote, pasted minutes are a Document; a Note may be made from a Document.
- [x] Decisions recorded in the spec:
  - The length check leaves `GuardrailService.classify` and the playbook waiver goes; Discord turns are never refused for length (a message over 4000 characters already arrives as `message.txt`, a Document). Web chat, with no Workspace place, refuses above 50,000 characters.
  - Every user-facing `GuardrailService` message goes through `textIn`.
  - New tool `keepAsNote` copies a Document or up to 20 message ids of this place into a Note verbatim, server side, with author, asker, date, and source links; no confirmation; the Document stays; refuses to overwrite. Turns show a message id only for text over 2000 characters.
  - No ADR: easy to reverse, reasons kept in the spec.
- [x] Spec #140 cut into 3 tickets, all sub-issues of #140 with native blocking, ready-for-agent; no prefactor needed (`classify` takes a language, tool-level messages use the context's language):
  - #141 long turns answered, web chat capped at 50,000, every guardrail refusal localized (starts immediately)
  - #142 `keepAsNote` from a Document (starts immediately)
  - #143 message ids for text over 2000 characters, `keepAsNote` from messages, persona and migration (blocked by #142)
- [x] Implement #141–#143 on integration branch `spec/140-long-text` (#141 and #142 in parallel, then #143).
  - [x] #141 `classify(message, language)` no longer measures length and the playbook waiver is gone; injection detection still runs on the assembled turn, refused in the language the person wrote. Web chat refuses above `MAX_WEB_INPUT` (50,000) via `limitLength`, audited, HTTP 200 with the refusal as `reply`. Every `GuardrailService` refusal (injection, length, arguments, auth mismatch, scope, permission, rate, duplicate, no confirmer) comes from `textIn`; tool-level ones use the place's language. Harness gains `s.discord.burst`. Tests `long-turns.test.ts`, `web-chat.test.ts`, guardrails test extended.
  - [x] #142 `keepAsNote { document, path }` copies a Document's text (extracted Markdown for PDF, DOCX, XLSX, large CSV) into a Note under the place's `notes/`, server side, with `source`, `author`, `askedBy`, `date` frontmatter; refuses an existing or non-`.md` target and paths outside the place. Filing writes a hidden `<place>/.documents/<path>.json` record of who gave the file and where its text went (`provenanceOf`, `fileDocument(…, { taken, givenBy })`). Helpers `keptDocument`, `keepNote` in `packages/skills/src/workspace/notes.ts`. Test `keep-as-note.test.ts`.
  - [x] #143 `keepAsNote { messageIds, path }` joins up to 20 messages of this channel or thread (a thread's starter from its parent) verbatim minus the bot's own mention, with parallel `source`/`author` lists; exactly one source kind. Turns show `Name (message <id>): …` only for text over 2000 characters (`keepableId`, `speakerTurn`). Persona sends long text to `keepAsNote`; prior personas frozen as `PERSONA_PROJECTS` and `PERSONA_BULK_TASKS` for the migration.
  - [x] Code-review pass (Standards + Spec) fixed on the branch: shared extracted-text naming rule (`textName`, `unrecordedTextPath`) so an unrecorded PDF never copies an unrelated `<stem>.md` (ambiguous siblings are refused); `withoutMention` shared by turn and kept messages; per-message authors; `.md`-only targets; separate no-source refusal; `renderFrontmatter` reuse; `speakerName` shared with the adapter; renames (`textPath`, `pathInPlaceFolder`); `limitLength` without a limit parameter. Main (#136–#139) merged in first. Full suite 629 pass, 0 fail; typecheck exits 0.
  - Follow-ups filed: #144 (git and brief tool refusals still English; the bulk-task instruction stays English as a model instruction), #145 (Documents filed before #142 carry no author; needs a decision).
- [x] Landed on main at 0b4d5de (fast-forward, pushed 2026-10-15); #140–#143 closed with their commits.

## Phase 33 — Harness review fixes (#136–#139)

Four issues filed from a review of the assistant harness. Triaged on 2026-10-15; the maintainer's decisions are posted on each issue.

- [x] Decisions:
  - #136 keeps counting the history window in rows; the stored tool row holds a short form, and the live turn sees the full result.
  - #137 guards bulk task writes in the guardrail, per turn, above three. The batch is remembered for the asker's next turn only, and an approved batch skips the 10-a-minute write limit.
  - #139 parses XLSX with `exceljs`.
- [x] Implement #136–#139 on `spec/136-139-harness`.
  - [x] #138 A response with `finishReason: "error"` is no longer stored as an assistant row, in the loop or in the budget-exhausted boundary call. When non-read tools succeeded earlier in the turn, the reply lists them before the failure text, in the place's language (`failureReply`, `doneBeforeFailure`, `SkillRegistry.effectOf`). 3 scenarios in `provider-failure.test.ts`.
  - [x] #136 Stored `tool` rows hold `storedToolResult(result)`: success (read from `data.success` too), error and identifying fields, capped at 800 characters (`STORED_TOOL_RESULT`, `shorten` in `apps/agent/src/loop/history.ts`). `historyOffset`, its stepping and `rollSummary` are unchanged. Scenarios in `history-tool-results.test.ts`, plus a unit test in `cache.test.ts`.
  - [x] #139 XLSX gets a sibling `.md` with one Markdown table per sheet, and so does a CSV over `MAX_FILE_BYTES`. A smaller CSV was already readable. Clipping cuts at a whole row and ends with a marker. Dates are written as ISO. A single `TYPES` table drives extraction in `packages/skills/src/workspace/extract.ts`. `searchFiles` no longer scans binary document bytes. The `readFile`/`searchFiles`/`saveAttachment` descriptions say where spreadsheet text is. Dependency `exceljs@^4.4.0`. 5 new scenarios in `discord-file-text.test.ts`, plus `packages/skills/test/extract.test.ts`.
  - [x] #137 `bulkTaskTurn` in `packages/skills/src/guardrails.ts` checks each response's task writes (`BULK_TASK_TOOLS`) before any of them runs.
    - Going over 3 in a turn refuses all of that response's task writes with `confirmation_required`.
    - The refused batch is stored in `conversations.metadata.bulkApproval`. It is matched by tool, 8-character task id (or title for a create) and a hash of the other arguments, and only the asker's next turn can use it.
    - Persona: "more than three" now covers changes. The prior persona is frozen as `PERSONA_PROJECTS`.
    - Eval brief `bulk-cancel` with a dry run. 6 scenarios in `task-bulk-guard.test.ts`.
  - [x] Code-review pass:
    - The bulk refusal keeps its instruction in the stored row.
    - `rollSummary` writes only its own key through `patchConversationMetadata`, in the new `apps/agent/src/loop/conversationMetadata.ts`, so it no longer restores a cleared approval.
    - Failure lines use localized `taskChange` labels.
    - `clipRows` no longer clips at exactly `MAX_TEXT_BYTES`.
    - `executeCall` replaces the nested ternary in `react.ts`.
  - [x] `bun run typecheck` exits 0. `bun test` passes 610, fails 0.
- [x] Landed on main at aac8386 (fast-forward, pushed 2026-10-15); #136–#139 closed with their commits. The live eval (`EVAL_LIVE=1 bun run eval:assistant`) has not been run for `bulk-cancel` yet.
- Known limits, accepted by the decisions:
  - A 5-call turn still takes about 12 of the 30 history rows.
  - A model making one task write per response gets three through before the fourth is refused.

## Phase 34 — Ask about everything kept, across channels (spec #146)

Started from a readiness review (2026-10-15) of the bot as a record keeper people can ask about all their minutes: 58/100, strong at keeping, weak at answering. A channel reads only its own folder, search matches one literal phrase, and a private thread's Minutes sit in the parent channel's folder where anyone in the parent can have them read. A grilling session the same day settled the model; the spec is issue [#146](https://github.com/yhagus/pachiware/issues/146).

- [x] Glossary: new term Public channel; relationships for reading Minutes, Decisions, Notes and Documents across channels and for what a private thread kept.
- [x] ADR 0009: a private thread keeps its own folder (`threads/<thread-id>/` under the parent); a frontmatter field was rejected because model-written files can leave it out.
- [x] Decisions recorded in the spec:
  - Readable elsewhere: Minutes, Decisions, Notes, Documents, read only. Never Memory or Tasks.
  - Sources: the asker must view the channel (and be in a private thread). From a channel, that guild; from a DM, every shared guild. A channel with the Workspace turned off is no source. None from web chat.
  - Quoting: a Public channel's anywhere in its guild; others only in their own channel or a DM. Hits that cannot be quoted are counted, never named, and the bot suggests a DM.
  - Old private-thread Minutes and kept-message Notes move once; Documents, Decisions and other Notes stay (no recorded thread). An unresolvable thread counts as private.
  - Search: every word, any order, up to three ranked lines per file, grouped by channel, newest first, capped at fifty with counts. In-process index, no database table.
  - Answers name channel, date and link; nothing found is said plainly.
- [x] Test seams: the Discord scenario harness (gains a non-public channel) and the daily-behaviour eval (five new briefs).
- [x] Spec #146 cut into 8 tickets, all sub-issues of #146 with native blocking, ready-for-agent. Starting frontier: #147, #148.
  - #147 a private thread keeps its own folder (starts immediately)
  - #148 search matches every word, with ranked lines (starts immediately)
  - #149 move old private-thread Minutes and kept-message Notes (blocked by #147)
  - #150 search index (blocked by #148)
  - #151 read Public channels from another channel of the guild (blocked by #147, #148)
  - #152 read from a DM across shared guilds (blocked by #151)
  - #153 hits that cannot be quoted here (blocked by #151)
  - #154 persona and daily-behaviour eval (blocked by #152, #153)
- [x] Implement #147–#154.
  - [x] #148 merged into `spec/146-across-channels`: search matches every word, with ranked lines.
    - New `packages/skills/src/workspace/search.ts`: `matchFile(words, name, text)`, `queryWords(query)`, `searchFolder(...)`. Result shape is now `{ matches: [{ path, lines: [{ line, text }] }] }`.
    - Words are substrings, split on whitespace with edge punctuation stripped; a repeated word counts once; no stemming.
    - A file's name is its path below its place root, so folder names count as words; a name-only match can return `lines: []`.
    - Lines ranked by distinct query words held, ties to the earlier line, at most 3, clipped to 200 chars.
    - PDF/DOCX/XLSX match by name; their text is searched through the sibling `.md`, so both may be returned. Hidden files are skipped.
    - The walk still stops at 50 matches / 500 files scanned; #150 replaces the walk, #151 adds grouping, order and totals.
    - Verification: `bun run typecheck` exits 0; `bun test` 638 pass, 0 fail across 118 files.
  - [x] #147 merged into `spec/146-across-channels`: a private thread keeps its own folder.
    - Host sets `SkillContext.privateThread` from the channel type (`placeOfChannel` in `apps/agent/src/discord/routing.ts`); turns, minutes, filed Documents and queued Confirm actions carry it.
    - In a private thread `visibleRoots` adds a `thread` root at `guilds/<g>/channels/<parent>/threads/<tid>`; `placeRoot(where)` picks thread → channel → dm; `threadFolder(g,c,t)` builds the path.
    - Writes aimed at `channel/{notes,decisions,files,minutes}/` from a private thread are redirected to `thread/...`, not refused; the tool result returns the real path. Only those four folders at a thread folder's top. A thread's Tasks and Memory stay with the parent.
    - New `packages/skills/src/workspace/threads.ts`: `threadsPath`, `threadAccess(ctx)` (`threadReadable`, `readable`, `check`, `filter`), `checkThreadWrite`. A thread folder is readable from its own thread or by someone `channelView` says can view it, same guild; an unresolvable thread is read by nobody. Playbook bindings `threads/<tid>.md` are never listed, read or searched as kept material.
    - Changed only from inside the thread: moving out of or deleting under `threads/` from elsewhere is refused; `threads` dropped from the top-level folders writeFile may create. Refusals `threadFolderRefused`, `threadFolderReadOnly` in en and id.
    - `searchFolder` takes an optional per-folder `readable` filter.
    - Known limits: default persona still lists `threads/` (left for #154); `channelView` doesn't say a thread is private, so the rule relies on only private threads getting a folder; in a private thread, keeping a parent channel Document as a Note redirects to `thread/files/` and fails if it isn't there; old files move in #149.
    - Verification: `bun run typecheck` exits 0; `bun test` 648 pass, 0 fail across 119 files.
  - [x] #150 merged into `spec/146-across-channels`: search reads an in-process index.
    - `workspaceStore()` returns an `IndexedWorkspaceStore` (`packages/skills/src/workspace/search.ts`) around the local store; per-tenant file texts in memory, no DB table.
    - Writes, moves (files and folders) and removes through the store update the index at once. Each search lists the folder's files with versions and re-reads changed ones, so on-disk changes are picked up.
    - Interface for #151: `workspaceStore().searchFolder(tenantId, folder, words, nameOf)` returns every match uncapped; the caller caps with exported `MAX_MATCHES` (50). Reuses `matchFile`, so results equal #148's. No access decisions stored.
    - `WorkspaceStore.files(tenantId, path)`: every file under a folder with its version; skips "." names; no cap; stops at symlink loops and links outside the workspace.
    - Search no longer stops at 500 files; `store.list` still refuses folders over 500 entries.
    - #147's access filter runs at query time: `searchFiles` passes the index's matches through `threadAccess(ctx).filter`, then caps at 50, so unreadable thread folders and `threads/<tid>.md` bindings never return or use up the cap. #147's per-folder `readable` parameter is gone.
    - Known limits: an on-disk change in the same ms to the same size isn't re-read (version = mtime+size). The index is per process: empty after a restart, it fills as searches run. A too-large or unreadable file is indexed with no text, so only its name matches.
    - Verification: `bun run typecheck` exits 0; `bun test` 654 pass, 0 fail across 120 files.
  - [x] #149 merged into `spec/146-across-channels`: old private-thread files move to the thread's folder.
    - `packages/skills/src/workspace/threadMove.ts` `moveOldThreadFiles(tenantId, guildId, kindOf)`, run from the bot's ClientReady (`DiscordBotManager.moveOldThreadFiles`, `apps/agent/src/discord/client.ts`), only for guilds in `runtime.guildIds` the client is in; two bots of one tenant in one guild run one after the other.
    - Minutes under `channels/<c>/minutes/` whose `postedIn` ≠ `<c>` move.
    - Notes under `channels/<c>/notes/` (any depth) move when their source links point to exactly one channel id ≠ `<c>` in the guild; starter-message links point at the parent, so those stay.
    - A thread counts as private when fetch returns a PrivateThread, nothing, or throws. Target: `threadFolder(g,c,t)/<minutes|notes>/<same relative path>`.
    - Moves go through `workspaceStore().move`, so the index stays current. Never overwrites: a taken name stays, is logged and listed under `notMoved`.
    - Once per guild: hidden marker `guilds/<g>/.private-threads-moved.json` `{at, moved, notMoved}`, written only once `guilds/<g>/channels` has folders.
    - Known limits: taken names need an operator; the report is only in logs and the hidden marker; a failed lookup counts as private; a Note linking several threads stays; Documents, Decisions and other Notes stay (spec).
    - Verification: `bun run typecheck` exits 0; `bun test` 658 pass, 0 fail across 121 files.
  - [x] #151 merged into `spec/146-across-channels`: read Public channels' kept files from another channel of the guild.
    - `packages/skills/src/workspace/sources.ts`: `readableSources(store, ctx): Promise<Source[]>`, `Source = { root, label, folder, folders, guildId?, channelId?, threadId?, here, quotable }`; the place first, then other channels by name.
    - `root` is `channel`/`thread`/`dm` for the place, else `#name` (with ` [id]` when two share a name).
    - `viewableChannels(...)` returns `{id, name, guildId, folder, public}`; Task scopes' `viewableProjects` now uses it.
    - `sourcePath(ctx, sources, input, allowRoot)` resolves `#name/...` or `<#id>/...`, limited to minutes/decisions/notes/files; `namesChannel(path)`.
    - Tools read only quotable sources via `quotableSources()` in `builtin/workspace.ts`; non-public channels come back `quotable: false` (#153 changes that filter). DMs and web chat get only the place itself (#152 adds shared guilds).
    - Discord adapter: `ChannelView.channel.public` (guild @everyone can view; a thread takes its parent's; a private thread is never public). Harness `s.discord.hide(channel)`; fake guilds have `roles.everyone`.
    - Availability: `channelsWithSkill(place, "workspace", channelIds)` checks every channel in one rules query; only skill rules drop a source.
    - `searchFiles` with no path → `{ groups: [{channel, matches}], total, leftOut }`; with a path → `{ matches }` plus `total`/`leftOut` when cut.
    - All searches sort newest first by the file name's leading date, undated after, then by modification time. `WorkspaceStore.files()` and `FileMatch` carry `modified`.
    - Refusals `notASource` (never says whether the channel exists), `sourceFolderRefused`, `sourceReadOnly` in en and id; deleteFile refuses another channel before Confirm.
    - Known limits: a no-path search covers kept folders only and skips private-thread folders (left for #152); each source read looks up every channel folder of the guild on Discord, no per-turn cache; the current channel's label falls back to its id when it has no folder; web chat refusals are English.
    - Verification: `bun run typecheck` exits 0; `bun test` 666 pass, 0 fail across 122 files.
  - [x] #152 merged into `spec/146-across-channels`: read kept files from a DM across every shared guild.
    - From a DM, `readableSources` returns the DM first, then every shared guild (`sharedGuildSources`): each viewable channel folder where the Workspace is on, plus private-thread folders under them that `channelView` says the asker can view.
    - Everything is quotable in a DM; web chat still gets only its own place.
    - Labels and roots always carry the guild ("#ops (Beta)"), even with one shared guild; a private thread is "#thread-name (Guild)". Sorted by label after the DM; `uniqueRoots` adds ` [id]` on clashes.
    - `<#id>` can name a private thread: `sourceNamed` matches thread id, then channel id.
    - A thread follows its parent: a Workspace-off rule on the parent drops it; only threads under viewable channel folders; an unresolvable thread is read by nobody.
    - Known limits: private-thread folders are sources only from a DM (a no-path search from the parent skips them); each DM read looks up every channel and thread folder of every shared guild, no per-turn cache; the guild path keeps its own copy of the ` [id]` logic; DM refusals use the tenant's language.
    - Verification: `bun run typecheck` exits 0; `bun test` 670 pass, 0 fail across 123 files.
  - [x] #153 merged into `spec/146-across-channels`: hits that can't be quoted here are counted, never named, with a DM suggestion.
    - Tools read every readable source (`quotableSources()` filter removed); a no-path search searches all.
    - Hits from non-quotable sources add `notShownHere: n` and a catalogue `suggestion` (`notShownHere(n)`, en and id) telling the model to suggest a DM without naming anything; `total`/`leftOut` count only shown hits.
    - A path search on such a source returns `{ matches: [], notShownHere, suggestion }`.
    - `readFile`/`listFiles` on a non-quotable source throw `notQuotableHere` (en and id) before reading, so existing and missing files get the same refusal; an unviewable channel still gets `notASource`.
    - From a guild channel, `readableSources` also returns private threads under other channels the asker was added to, always `quotable: false` (counted only); root `#parent/thread-name` (no path can name it); `<#threadId>` resolves via `sourceNamed` and is refused.
    - Unchanged: the asking channel's own private threads are reached only through `channel/threads/<tid>/…` with #147's check; a no-path search in the parent doesn't search them.
    - The #151 hidden-channel scenario now expects a count and a refusal.
    - Known limits: a PDF/DOCX/XLSX and its `.md` count as two hidden hits; each search looks up every thread folder of every other kept channel, no per-turn cache; an Availability rule on a thread's own id isn't checked (its parent's is).
    - The `searchFiles` description explains `notShownHere`; persona left for #154.
    - Verification: `bun run typecheck` exits 0; `bun test` 675 pass, 0 fail across 124 files.
  - [x] #154 merged into `spec/146-across-channels`: the persona answers questions about kept material, with five eval briefs.
    - Persona (`packages/db/src/persona.ts`) gains "Asking about kept material": search before answering, name the channel and date of every source, link posted Minutes, say plainly when nothing was found, and on `notShownHere` or a can't-be-shown refusal suggest a DM naming nothing.
    - `threads/` dropped from the allowed top-level folders; the Files and Decisions lines name Minutes and Documents.
    - Prior default frozen as `PERSONA_LONG_TEXT` in `OLD_DEFAULT_PROMPTS`; migration test copy added (indices 8→9); `persona.test.ts` covers the rules.
    - Five eval briefs under `apps/agent/eval/assistant/` with fixtures, dry runs, recordings and required-list names: decision-other-channel, action-items-across-meetings, nothing-found, private-channel-dm, minutes-as-document.
    - Fixture fields `seed.files: [{path, content, channel?}]` (path below the channel folder; absolute and `..` refused) and `seed.hidden: [names]` (calls `s.discord.hide`), documented in the eval README.
    - Known limits: a Minutes link is built from the file's frontmatter (`guildId/postedIn/messageId`), so linking needs a `readFile`; undated files fall back to the date their text gives; seeded Minutes carry only identifying frontmatter; "nothing found" and "suggest a DM" are code-checked by reply phrases (`nothing`, `DM`, `replyLacks`), guessing is left to the judge.
    - Verification: `bun run typecheck` exits 0; `bun test` 687 pass, 0 fail across 124 files.
  - [x] Code review fixes on `review-fixes-146`:
    - Behaviour: a no-path search in a channel or its public thread searches and quotes the channel's private threads the asker was added to (root `channel/threads/<id>`, label `#thread-name`); keepAsNote in a private thread redirects only the Note, so a parent channel Document is kept from where it is; inside a private thread a sibling private thread is a non-quotable Source (counted as `notShownHere`, refused with `notQuotableHere` on read and list; `threadAccess` reads paths as shown, counted or refused). Public channels stay quotable inside a private thread.
    - Structure: `viewableFolders`/`viewedIn` replace three copies of the view+guild check; `sourceAt` builds Sources; the guild path uses `uniqueRoots`; `readableSources` is looked up once per turn context (WeakMap); no-path search grouping and counts live in `sources.ts` (`searchSources`); `agentPaths` maps store paths to agent paths; `threadAccess` exposes only `check`/`sort`.
    - Names: `ThreadKind` is `"private" | "public"`; `filesRoot` removed for `placeRoot`; `workspaceStore()` returns `SearchableWorkspaceStore`, with matching in `search.ts` and the index in `searchIndex.ts`. Glossary gains Kept material and Source.
    - Verification: `bun run typecheck` exits 0; `bun test` 690 pass, 0 fail across 124 files.
- [x] Spec #146 landed on main: `spec/146-across-channels` merged with main (profile Playground work) and fast-forwarded; `bun run typecheck` exits 0, `bun test` 697 pass, 0 fail across 124 files. #146–#154 closed.

## Phase 35 — MongoDB as a third database engine, chosen once at setup (spec #155)

Spec [#155](https://github.com/yhagus/pachiware/issues/155); decision record ADR 0010; glossary term **Database engine**. Integration branch `spec/155-mongodb`, merged into `main` when done (no PR).

- [x] Glossary term and ADR 0010 committed on the integration branch.
- [x] Implement the open sub-issues of #155 (#157–#159 were closed and split into #160–#172).
  - [x] #156 merged into `spec/155-mongodb` (17ec3cd): the database engine is locked at setup.
    - `detectEngine()` / `assertDatabaseEngine()` in `packages/db/src/engine.ts` use a table of URL prefixes. An unknown scheme is an error and creates no file; an empty URL means SQLite. `mongodb://` and `mongodb+srv://` fail as "not supported yet" until #168.
    - The lock runs in the `packages/db/src/index.ts` boot block before the driver opens. `runMigrations()` records `databaseEngine` through `recordDatabaseEngine()` in `runtime-store.ts` after a successful migration, only if no engine is recorded yet.
    - `detectDialect`, `reconnectDatabase` and `switchSchema` are gone. The admin infrastructure API returns `databaseEngine` and `databaseHost`, rejects `databaseUrl` with 400, and `/test-db` is removed. The wizard has no database field, and the overview shows engine and host only.
    - `runtime-config.json` honours `PACHIWARE_RUNTIME_CONFIG`; a root `bunfig.toml` preloads `packages/db/test/preload.ts` so tests never touch the developer's file. Saving git hosts or Redis now merges into the file instead of overwriting it.
    - Start-up tests in `apps/agent/test/database-engine.test.ts` start the real agent with async `Bun.spawn`. The MongoDB standalone case waits for #168.
    - Known limit for #172: re-running `pachiware init` with another engine edits `.env` before the lock refuses the start.
    - Verification: `bun run typecheck` exits 0; `bun test` 711 pass, 0 fail across 125 files.
  - [x] #160 merged into `spec/155-mongodb` (8571a84): repository entry point and contract harness, with Tenants and API keys.
    - `repositories()` in `packages/db/src/index.ts` is built once on the single connection after the engine lock. `createRepositories(connection)` in `packages/db/src/repositories/index.ts` switches on `connection.engine`; `openConnection(url)` lives in `packages/db/src/connection.ts`.
    - One folder per repository: `repositories/<name>/types.ts` (domain types and interface, UUID string ids, `Date` dates) and `repositories/<name>/sql.ts` (`createSql<Name>Repository(conn)`, using `conn.tables`, never the global `db`). `mongo.ts` will sit beside them.
    - Contract suites in `packages/db/test/contract/<name>.contract.test.ts` use `contract("Name", (use) => ...)` from `engines.ts`: SQLite always, PostgreSQL when `TEST_POSTGRES_URL` is set. Each test starts from an empty, migrated and seeded database. The harness drops every app table in that database, so point it only at a test database.
    - `migrateDatabase(conn)` / `seedDatabase(conn)` work on any connection; only `runMigrations()` records `databaseEngine`.
    - The admin DELETE still soft-deletes (`tenants.remove`). `tenants.purge(id)` removes everything the tenant owns in one transaction, with explicit deletes because old SQLite files may lack ownership foreign keys; it has no production caller yet. The contract probes owned rows with `ownedRecords(tenantId)` until other repositories can show them.
    - Small changes: tenant and key listings are ordered oldest first; linking a key updates the tenant's `updatedAt`; the `ApiKey` domain type has no `keyHash`.
    - Raw access left: `listAllActiveBots` in `tenancy.ts` (bots ticket); bootstrap SQL in `migrate.ts` and one `api_keys` hash assertion in `packages/db/test/tenancy.test.ts` (#167); `seedTenant` for the skills routes.
    - The pre-push hook blanks `TEST_POSTGRES_URL` and `TEST_MONGODB_URL`.
    - Verification: `bun run typecheck` exits 0; `bun test` 722 pass, 13 skip, 0 fail across 126 files; contract suite 22/22 with PostgreSQL.
  - [x] #161–#166 move the remaining records to repositories
    - [x] #162 merged (def4b52): `bots: BotRepository` in `packages/db/src/repositories/bots/` replaces `listAllActiveBots` and the bot and guild-config helpers in `tenancy.ts`. It covers token encryption, the admin list's case-insensitive search with count and paging, the bot-delete tombstone (which also removes the bot's availability rules), and guild configs.
      - Behaviour: updating a deleted bot does nothing and returns null, so a late gateway event cannot revive it. Bot answers drop the unused `gitAccountId` column and `publicBot`. The v1 bot list is oldest first.
      - The bots suite sets `PLATFORM_ENCRYPTION_KEY` itself; it may move into the harness.
      - Verification: `bun test` 733 pass, 26 skip, 0 fail across 127 files; contract 44/44 with PostgreSQL.
    - [x] #164 merged (a593372): `skills` (register, list, seedTenant, listForTenant, listEnabled, getForTenant, setEnabled, setConfig, idempotent enable) and `availability` (list(scope), listForBot, set, clear, removeForBot) repositories.
      - Behaviour: the global `seedTenant` is gone; `skills.seedTenant` adds only missing skill switches and no longer fills in a missing agent configuration. Skill listings are ordered by skill id.
      - `seedDatabase` registers built-ins through `skills.register` (`builtInSkills()` in `seed.ts`); the harness clears and re-registers skills between tests.
      - Merge: #162's bot tombstone already removes availability rules; `enableGitSkill` uses `skills.enable`.
      - Verification: `bun test` 744 pass, 41 skip, 0 fail; contract 66/66 with PostgreSQL.
    - [x] #165 merged (09fa545): `schedules` (`create`, `get`, `list`, `count`, `due(at)`, `update`; filter `visibleTo: { ownerId, guildId? }` for "owner, or this guild for a moderator") and `taskRows` (`create`, `list`) repositories. The scheduler, Digest sync, reminder routes and skill, `exportTasks` and the eval moved. The reminders skill calls `repositories()` directly. Due schedules tie-break on id.
    - [x] #166 merged (92a13f4): `conversations` repository (create, get, latestInChannel, listForTenant, getForBot, listForBot with counts, setMetadata, addMessage, countMessages, listMessages, latestMessages).
      - Fix: the admin bot conversation listing always showed 0 messages because Drizzle wrote an unqualified `"id"` in the subquery; a grouped query now gives real counts.
      - Behaviour: `lastMessageAt` is a Date on every engine (ISO in JSON; SQLite used to give milliseconds); null metadata reads as `{}`.
      - Messages are ordered by `createdAt` only; #171 needs an insertion-stable order on MongoDB.
    - [x] #161 merged (a0629cc): `profiles` (`getForBot` only within the bot's tenant), `agentConfig`, `usage` (`record`, `list`, `totals` summing cached tokens from JSON metadata) and `stats` (`ping`, `databaseBytes`) repositories. `pingDatabase` is gone. Agent-config updates always set `updatedAt`; profile and usage lists have a fixed order. `audit()` still types `ctx.db` (for #167). PostgreSQL keeps microseconds, so contract tests never filter on an exact JS Date.
    - [x] #163 merged (4de72b5): `git` repository for accounts, bot links, Git scopes and OAuth apps; scope rules in engine-neutral `repositories/git/rules.ts`. Allowed git hosts stay in `runtime-config.json`, outside every database, so they get no repository. `tenancy.ts` is deleted. `git.setBotAccounts` switches on the git skill through the skills repository's idempotent `enable`.
  - [x] #167 merged (febf8f9): the database package exports repositories only.
    - `@pachiware/db` exports `repositories()` and domain types, `runMigrations`, `runSeed`, `activeDialect`, `ReplicaSetRequiredError`, runtime config, engine and crypto helpers, the persona prompt and `patternCovers`. `db`, `queryClient`, table and schema bindings, query operators, `SQL_TABLES`, `migrateDatabase`/`seedDatabase` and `schema/index.ts` are gone; package.json exports `"."` only.
    - The process connection lives in `packages/db/src/internal.ts`, imported only by `migrate.ts`, `seed.ts` and the package's own tests.
    - `SkillContext` and `audit()` no longer take `db`.
    - Guard: `packages/db/test/public-surface.test.ts` fails if the entry exports Drizzle, a table or an operator, or if code outside packages/db imports drizzle, deep `@pachiware/db/…` paths or internal modules.
    - Raw SQL left inside packages/db only: the SQL migration's bootstrap and backfills; `migration`, `persona-migration` and `git-accounts` tests faking pre-upgrade installs; three `tenancy.test` checks that keys are hashed, tokens encrypted at rest, and a deleted bot leaves a wiped tombstone.
    - Verification: `bun test` 797 pass, 220 skip, 0 fail across 139 files; contract PostgreSQL 166 pass; MongoDB 98 pass.
  - [x] #168 merged (b026609): MongoDB foundation, with Tenants and API keys on MongoDB.
    - Connection in `packages/db/src/mongo/connection.ts` (`openMongoConnection`, database name from the URL path or `pachiware`, `assertReplicaSet` → `ReplicaSetRequiredError`, `inTransaction`, `ensureCollection`). The agent start stops on `ReplicaSetRequiredError`; an unreachable MongoDB still drops into setup mode.
    - Runner in `packages/db/src/mongo/migrate.ts`: steps recorded in `_migrations`, a 60-second renewable lock in `_migrations_lock`. Steps are named `0001-…`, run `ensureCollection` then named `createIndex`, and are safe to run twice.
    - Pattern for #169–#171: `repositories/<name>/mongo.ts` exports `createMongo<Name>Repository(conn)` and `<name>Migrations`, added to `MONGO_MIGRATIONS`. Collections keep the SQL table names, fields keep camelCase domain names, `_id` is the UUID string, JSON becomes embedded documents, and every tenant-owned document has `tenantId`. Multi-document writes run in `inTransaction(conn, async (session) => …)`; same-tenant checks are `findOne({ _id, tenantId }, { session })`. Replace the repository's `notOnMongoYet` stand-in in `repositories/index.ts` and add the suite to `ON_MONGODB` in `test/contract/engines.ts`.
    - `tenants.purge` lists collections first (not allowed inside a transaction), then deletes `{ tenantId }` from each and the tenant in one transaction. Tenant creation writes the default `agents_config` (`_id` = tenant id) and `tenant_skills`. The seed writes built-in skills straight into `skills` until #170. A duplicate API key is proven through the harness hook `storeKeyCopy`.
    - Compose: `mongo` service (`mongo:8.0`, profile `mongo`, single-node replica set `rs0`, health check runs `rs.initiate`). `TEST_MONGODB_URL='mongodb://localhost:27017/<db>?replicaSet=rs0&directConnection=true'`; the standalone refusal uses opt-in `TEST_MONGODB_STANDALONE_URL`. The pre-push hook blanks both.
    - Left for #169: on MongoDB the health route reports the database unreachable (the `stats` stand-in throws), and the stats route's size figure throws.
  - Verification after merging #165, #166, #168, #161 and #163: `bun run typecheck` exits 0; `bun test` 795 pass, 220 skip, 0 fail; contract SQLite 83, PostgreSQL 83, MongoDB (tenants, plus `mongo-migrations`) 98 pass, 0 fail; `database-engine.test.ts` on MongoDB 11 pass, 1 skip.
  - `TEST_MONGODB_URL` checked live against the compose replica set (rs0, writable primary) on 2026-10-16, so #169–#171 can start.
  - [x] #169–#172 MongoDB repositories and setup (started once `TEST_MONGODB_URL` pointed at a live replica set, as the user asked)
    - [x] #169 merged (55c4b06): MongoDB `profiles`, `agentConfig`, `usage`, `stats`, `bots` and guild configs (steps `0100-bots-and-guild-configs`, `0101-profiles`, `0102-usage-events`).
      - Health sends a MongoDB ping; database size comes from `dbStats` (`totalSize`, or storage plus index size on older servers). `apps/agent/test/database-engine.test.ts` checks `/api/health` and `/api/admin/stats` on MongoDB through `serverRequests()`.
      - Rules kept in a transaction: a new bot needs a live tenant; a bot's profile must exist (another tenant's is accepted as on SQL, but `getForBot` returns null); removing a profile clears it from its bots; a usage event's tenant must exist and its bot belong to that tenant; a guild config's bot must exist. New contract test: a bot naming a missing profile is rejected on every engine.
      - Removing a bot deletes `{ botId }` from `availability_rules`. With several problems at once, MongoDB reports them in a different order than SQL. Guild configs list by bot, then guild.
    - [x] #171 merged (d703904): MongoDB `schedules`, `taskRows` and `conversations` (steps `0300-schedules`, `0301-task-rows`, `0302-conversations-and-messages`).
      - Message order: each message takes the next number from a counter on its conversation in the same transaction that checks the tenant; a unique index on conversation and number backs it. A contract test freezes the clock to prove order does not depend on time.
      - `ConversationRepository.remove(tenantId, id)` deletes a conversation and its messages in one transaction on every engine; nothing in production calls it yet.
      - Due schedules read through `schedules_due_idx` (status, `nextAt`, `_id`); an explain plan showed no sort step. Another tenant's bot is refused inside the insert's transaction.
    - Verification after both: `bun test` 800 pass, 227 skip, 0 fail; contract plus `mongo-migrations` SQLite 86, PostgreSQL 86, MongoDB 62 pass (Skills, Availability and Git skip until #170); `database-engine.test.ts` on MongoDB 12 pass, 1 skip.
    - [x] #170 merged (3e69e1f): MongoDB `git` (reusing `rules.ts`), `skills` and `availability` (steps `0200-skills`, `0210-availability-rules`, `0220-git`). Every repository now runs on MongoDB; the `notOnMongoYet` stand-in is gone.
      - The seed registers built-in skills through `repos.skills.register` on every engine; the MongoDB harness reset clears and re-registers skills like SQL. Linking a git account switches the git skill on through `skills.enable`.
      - Behaviour: deleting a git account removes its bot links and Git scopes in one transaction on every engine (PostgreSQL used to refuse with a foreign-key error when a deleted bot kept a link). The admin route still refuses while a live bot uses the account.
      - Parity limit, as on SQL: a link or availability rule checks the git account's tenant, not the bot's.
      - Flaky once: "updatedAt >= createdAt" on PostgreSQL, from about 110 ms of clock skew between the database's `createdAt` and the host's update time.
      - Verification: `bun test` 802 pass, 231 skip, 0 fail; contract plus `mongo-migrations` SQLite 88, PostgreSQL 88, MongoDB 91 pass, no MongoDB suite skips; `database-engine.test.ts` 12 pass, 1 skip (the standalone server, which needs `TEST_MONGODB_STANDALONE_URL`).
    - [x] #172 merged (cf6baae): set up and run an installation on MongoDB. antislop: during (session override, chosen by the user).
      - `pachiware init` prompt is 1) SQLite 2) PostgreSQL 3) MongoDB 4) Docker, so `--database 3` now means MongoDB, not Docker. New `--docker-engine` / `PACHIWARE_DOCKER_ENGINE` let an automated Docker install pick MongoDB. Docker's MongoDB URL is `mongodb://localhost:$MONGO_PORT/pachiware?replicaSet=rs0&directConnection=true`; `start --docker` and init run `compose --profile mongo up … mongo redis`.
      - Init reads `databaseEngine` right after the choice and refuses another engine before writing `.env`, keys or anything else; a test checks both files stay byte-identical.
      - The question logic is in `packages/cli/src/database-choice.ts` with a pluggable prompt; its URL prefixes copy `detectEngine`'s so the CLI doesn't load the db package's `.env` side effects.
      - The install script passes `PACHIWARE_MONGODB_URL` through as `--mongodb-url`, tested with a temporary HOME and fake `bun` and `pachiware`.
      - The CLI no longer reads a MongoDB URL as a SQLite path: `start`, `update`, `doctor` and `logs mongo` handle MongoDB. The infrastructure host for a multi-host replica-set URL lists every member without credentials. The Web GUI shows the MongoDB label and the full host on hover.
      - End to end on the compose replica set: init seeded skills, created the default tenant and recorded `mongodb`; the agent started with healthy health, `mongodb localhost:27017` in infrastructure and a 282624-byte size in stats. The Discord harness ran in-process on MongoDB: a mention answered in a thread, a follow-up without a mention, a Reminder and the Digest posted.
      - Not verified: the Web GUI in a browser; `docker compose --profile mongo up` itself (only with a fake `docker`); a real install. `stop --docker` does not pass `--profile mongo` yet.
      - Verification: `bun test` 810 pass, 232 skip, 0 fail across 139 files; with both test URLs, db tests, `database-engine` and CLI 318 pass, 2 skip (the standalone-MongoDB cases, which need `TEST_MONGODB_STANDALONE_URL`).
- [x] Code review of `main...spec/155-mongodb` (standards and spec axes), fixed in one pass (747247c).
  - Glossary: "dialect" no longer names the engine (`activeEngine`, `SqlEngine`, CLI `{ engine }`; `dialect.ts` is now `sqlite-path.ts`). `/api/health` reports `services.databaseEngine` instead of `databaseDialect`.
  - Comments trimmed to antislop-code; the dead `ON_MONGODB` / `implements` hook removed.
  - `defaultAgentConfig`, profile defaults and fields, and tenant statuses live once in each repository's `types.ts`; the agent-config contract checks every default.
  - One MongoDB host pattern and one SQLite prefix list per package; `packages/db/test/engine-urls.test.ts` checks the CLI and db package detect engines alike (unknown schemes excepted).
  - Clock skew: SQL inserts stamp `createdAt` and `updatedAt` from one host time (tenants, API keys, bots, profiles, agent config, skills, skill switches). Messages keep the database clock so their order holds.
  - `stop`, `restart`, `uninstall` and `logs --docker` add `--profile mongo` on MongoDB.
  - Same-tenant rules in the repositories, in a transaction, on every engine: a bot with another tenant's profile is refused ("Profile not found"); `git.setBotAccounts` refuses another tenant's bot ("Bot not found"). Routes already refused both.
  - `pachiware init` on MongoDB with no terminal and no URL fails without writing `.env`.
  - The standalone refusal ran green against a throwaway `mongo:8.0` on port 27018.
  - Kept as decided: the admin tenant DELETE stays a soft delete (`tenants.purge` has no production caller); the small behaviour changes listed per ticket stay; `runtime-config.json`'s `databaseUrl` still beats `.env`, as the README says.
  - Verification: `bun run typecheck` exits 0; `bun test` 839 pass, 236 skip, 0 fail across 140 files; with both test URLs, db, CLI and `database-engine` tests 351 pass, 2 skip (standalone, needs `TEST_MONGODB_STANDALONE_URL`); contract 90 per engine.

## Phase 36 — Test and tooling hardening after spec #155 (#173–#177)

Tickets [#173](https://github.com/yhagus/pachiware/issues/173)–[#177](https://github.com/yhagus/pachiware/issues/177); #175 is blocked by #173 and #174. Integration branch `spec/173-177-test-hardening`, merged into `main` when done (no PR).

- [x] #173 Contract tests run without a `.env`.
  - The shared test preload (`packages/db/test/preload.ts`) sets a fixed `PLATFORM_ENCRYPTION_KEY` with `||=`, so a key from the environment or `.env` wins. The seven contract suites that set and restored the key themselves (availability, bots, conversations, git, profiles, schedules, usage) no longer do. Spawned test processes inherit the key through `process.env`.
  - `packages/db/test/preload.test.ts` runs a fresh `bun --preload` process in an empty directory: with no key it can encrypt and decrypt, and a key that is already set is kept.
  - Verification: worktree with no `.env` and no key in the shell; `bun run typecheck` exits 0; `bun test` 841 pass, 236 skip, 0 fail across 141 files.
- [x] #174 The contract harness refuses a database that isn't a test database.
  - `requireTestDatabase(variable, url)` in `packages/db/test/test-database.ts` throws unless the database name contains `test` (any case). MongoDB reads the name with `mongoDatabaseName`, so a URL without one counts as the default `pachiware` and is refused; PostgreSQL reads the raw path as postgres.js does and refuses an empty one, which the driver would fill from `PGDATABASE` or the user. Query strings, credentials, hosts and `mongodb+srv` never count; the error names the variable and database, never the password.
  - The contract harness checks `TEST_POSTGRES_URL` and `TEST_MONGODB_URL` while registering suites, before any connection. The other tests that drop data on those servers check too: `mongo-migrations.test.ts` and the CLI MongoDB setup test. `database-engine.test.ts` drops nothing and is unchanged; `TEST_MONGODB_STANDALONE_URL` is unchecked because a standalone server is refused before anything is written.
  - Verification: `bun run typecheck` exits 0; `bun test` 858 pass, 236 skip, 0 fail across 141 files; with both test URLs on `pachiware_test_174`, db, CLI and `database-engine` tests 370 pass, 2 skip (standalone). New `test-database.test.ts` has 19 tests, two of them run a contract suite against a `pachiware` URL and see it refused before connecting.
- [ ] #175 The engine contract suites run on PostgreSQL and MongoDB in CI and with one local command.
- [x] #176 A doc for adding records on all three Database engines.
  - `docs/agents/database-engines.md`: code map, Profiles as the worked example (pointing at its files), steps for a method, a kind of record and a field, the rules (UUID ids, `Date` dates, MongoDB documents mirroring SQL rows, numbered idempotent steps, transactions for same-tenant and cascade rules, the `public-surface.test.ts` guard), and how the contract suites run per engine.
  - AGENTS.md gains one pointer line beside the tasks.md one, and the `packages/db/` workspace line now names repositories, migrations, engine lock, runtime config, crypto and the contract suites.
  - SQL schema changes are hand-written in `migrate.ts` (`definitions()` plus guarded `ALTER TABLE`); `drizzle-kit generate` plays no part, and there is no `drizzle/` output folder.
  - Verification: `bun run typecheck` exits 0; `bun test` 839 pass, 236 skip, 0 fail across 140 files.
- [x] #177 A commit is refused while its message still has merge-conflict comments.
  - `.githooks/commit-msg` (tracked 100755, so `bun install`'s `core.hooksPath` picks it up) refuses a message with a `<commentChar> Conflicts:` line followed by `<commentChar><tab>path` lines, and tells the committer to run `git commit` without `--no-edit`.
  - Git runs commit-msg before it cleans the message, so the hook only looks when the comment lines will survive: no editor ran (git sets `GIT_EDITOR=:`), or `commit.cleanup` is `whitespace`/`verbatim`. A `--cleanup=` flag on the command line isn't visible to the hook.
  - Reproduced on git 2.39: merge and cherry-pick conflicts always write the block commented, under `core.commentChar` `;` and `auto` and with `--cleanup=scissors` (below the cut line). No current mode writes it uncommented, so a plain `Conflicts:` line in prose passes.
  - Tested in `packages/cli/test/commit-msg-hook.test.ts` (next to the `install.sh` tests) against scratch repos with real conflicted and clean merges.
- [ ] Code review of `main...spec/173-177-test-hardening`, fixed in one pass.
