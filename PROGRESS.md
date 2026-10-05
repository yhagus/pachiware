# PROGRESS &amp; GOALS: pachiware-agent

## 🎯 End Goals

`pachiware-agent` is an intelligent, self-hosted AI agent platform built with TypeScript and Bun. It features:

- **No heavy frameworks:** Lightweight, explicit ReAct agent execution loop with native tool calling.
- **Multi-channel integration:** Modular messaging gateway (Discord active; WhatsApp, Telegram, Slack planned) providing chat interaction, task creation, conversation channels, and status tracking.
- **Management Web GUI (`apps/web`):** Clean, modern dashboard (Vite + React + Tailwind CSS + Lucide) for managing agent prompts, personality, active skills, tasks (Kanban/List), and LLM routing.
- **LLM Router Adapter:** Direct integration with OpenAI, Anthropic, and custom OpenAI-compatible proxies (such as `9router`).
- **Robust Persistence &amp; Performance:** PostgreSQL for persistent entities (agents, skills, tasks, conversations, messages) via Drizzle ORM, with Redis for low-latency session caching, rate-limiting, and state synchronization. Runs with external instances by default or optional bundled local containers.

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
                 |   (packages/skills)   |               | (OpenAI/Claude/9router|
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
- **Phase 3: Completed ✅** (Agent Engine, LLM Router for OpenAI/Claude/9router, ReAct Loop, Caching)
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
  - [x] Provider support: OpenAI, Anthropic, Custom/9router (OpenAI-compatible)
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
  - [x] Temperature, Top-P, Model selector (GPT-4o, Claude 3.5 Sonnet, Custom 9router)
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
