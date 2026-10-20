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
- [x] #175 The engine contract suites run on PostgreSQL and MongoDB in CI and with one local command.
  - `bun run test:engines` runs `packages/db/test/engines-run.ts`, which holds the test list (`packages/db`, `packages/cli`, `apps/agent/test/database-engine.test.ts`). It defaults `TEST_POSTGRES_URL`, `TEST_MONGODB_URL` and `TEST_MONGODB_STANDALONE_URL` to `pachiware_test` on the compose ports and account (same `.env` variables as compose); a URL already in the environment wins and must name a test database. A default whose server doesn't answer gets its compose service started (`docker start` when a container of that name exists from another checkout), and the runner waits until the replica set has a primary. It creates the PostgreSQL database if missing and exits with `bun test`'s code.
  - Compose gains `mongo-standalone` (profile `test`, port `MONGO_STANDALONE_PORT`, default 27018) for the standalone refusal tests.
  - `.github/workflows/ci.yml`: on push to `main`, ubuntu-24.04, checkout v7.0.1 and setup-bun v2.2.0 pinned by SHA, Bun 1.4.0, `bun install --frozen-lockfile`, typecheck, `bun test`, then `bun run test:engines`, which starts the compose services on the runner (compose's health check initiates the replica set, which a service container can't). actionlint 1.7.7 reports no errors; the first real run happens on the next push to `main`.
  - README (both languages) has an Engine Tests section; the Testing part of `docs/agents/database-engines.md` names `bun run test:engines` and drops the stale note about suites setting their own encryption key.
  - Verification: `bun run typecheck` exits 0; `bun test` 872 pass, 236 skip, 0 fail across 144 files; `bun run test:engines` 386 pass, 0 skip, 0 fail across 27 files (also after stopping the standalone container, which it started again). `engines-run.test.ts` covers the URL defaults, compose settings, environment overrides, the test-database refusal and the PostgreSQL server URL.
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
  - Verification (after the review fixes): `bun run typecheck` exits 0; `commit-msg-hook.test.ts` 7 pass; `bun test` 873 pass, 236 skip, 0 fail across 144 files.
- [x] Code review of `main...spec/173-177-test-hardening`, fixed in one pass.
  - Fixed: the commit-msg hook matches the comment char with `[^A-Za-z0-9 \t]` instead of a POSIX class, which mawk 1.3.3 lacks, and its header comment is two lines. `postgresTestDatabase` moved to `test-database.ts`, and `requireTestDatabase` reads the PostgreSQL name through it. Engine targets carry a `kind` (`postgres`, `replicaSet`, `standalone`) that the runner branches on and finds the PostgreSQL target by. When `test:engines` started a container left by another checkout and it never became ready, the error names the container and says it may use other credentials or ports. `database-engine.test.ts` checks `TEST_MONGODB_URL` with `requireTestDatabase` (it reads no `TEST_POSTGRES_URL`), with a test that sees it refused.
  - Kept as decided: CI starts the databases with compose, not service containers, because the replica set needs `rs.initiate`. A bad test URL fails each contract file at load, not the run once, since nothing connects first. `engines-run.ts` stays in `packages/db/test/`, and the CLI test keeps importing `test-database.ts` across packages. The CI workflow is unverified until the first push to `main`.
  - Verification: `bun run typecheck` exits 0; `bun test` (test URLs empty, as pre-push runs it) 873 pass, 236 skip, 0 fail across 144 files; `bun run test:engines` against local Docker 387 pass, 0 fail across 27 files.
- [x] Merged into `main` by fast-forward and pushed; #173–#177 closed with the commit named.
  - The push to `main` is the first run of `.github/workflows/ci.yml`.

## Phase 37 — Plane as a native skill (planning, spec #178)

Planning is done; implementation follows the sub-issues of [#178](https://github.com/yhagus/pachiware/issues/178) in order. Target: Plane's `/api/v1/` REST API at v1.3.1.

- [x] Decided native tooling over Plane's official MCP server (ADR 0011). Its tools bundle read and delete behind an `action` argument, so Effect, Write confirmation and Availability rules cannot tell them apart. Its key reaches every Plane workspace of its user, and self-hosted Plane would need a Python process.
- [x] Glossary: added Plane account, Plane workspace, Plane project, Work item, Plane scope, Trusted member. Git write confirmation became Write confirmation, and Allowed git hosts became Allowed hosts. Work items and Tasks are never synced.
- [x] Plane v1.3.1 API inventoried from source. Facts the design depends on: no filters on the work-item list; search covers title and key only; HTML-only descriptions; `assignees`/`labels` replace the whole set; comments editable by any member; `created_by` accepted from the body; 60/min per key; no API for pages, views, notifications, work item types, worklogs or webhooks; estimate routes not mounted.
- [x] Spec #178 published with a first cut of sub-issues #179–#182. Trusted member reads `TRUSTED_DISCORD_IDS`, falling back to `GIT_OWNER_DISCORD_IDS`.
- [x] Follow-ups (needs-triage): #183 brief → work items, #184 Digest with work items, #185 Plane webhooks, #186 Discord→Plane member mapping, #187 generic MCP client.
- [x] Re-sliced with /to-tickets so each ticket fits one context window. The confirmation queue was already skill-neutral; only git's `guard()`, the Discord wording and the owner check were git-only, so that prefactor became #188. #180–#182 closed as superseded. Decided: a thread grant covers every skill's changes in the thread, except danger actions, which keep their own Confirm.
- [x] #179 Plane accounts, Plane scope and Allowed hosts (no blockers)
  - Records: `plane` repository (`packages/db/src/repositories/plane/`), tables `plane_accounts`, `bot_plane_accounts`, `plane_scopes`, MongoDB step `0230-plane`, tenant purge included. An account stores name, `baseUrl` (null = Plane's cloud, `https://api.plane.so`), `workspaceSlug`, `apiKeyEncrypted` and the Plane user it acts as (`planeUserId`, `planeUserName` as "display name (email)"), recorded at each check. A rule's `projectIds` are lowercased Plane project UUIDs, or `["*"]` (`ALL_PLANE_PROJECTS`) for all; "*" stands alone. Linking an account switches the seeded `plane` skill (default off) on, as git does.
  - Scope rules mirror Git scope (`plane/rules.ts`): a channel rule needs its account's guild rule and may hold only ids the guild allows ("*" only under a guild "*"); replacing guild rules keeps each channel rule's ids that still fit and drops the rule when none do; detaching or deleting an account removes its scopes. `replaceScopes` runs in one transaction on every engine.
  - Allowed hosts: `getAllowedHosts`, `saveAllowedHosts`, `assertHostAllowed` and `isListedHost` replace the git-only names. Decided to keep the stored key `gitAllowedHosts`, so a saved list keeps working without a migration; the admin API answers at `/infrastructure/allowed-hosts` and still at `/git-hosts`. The Settings label reads "Allowed hosts".
  - Request helper for every Plane tool: `planeRequest(conn, path, { method, query, body })`, `planeList` (cursor pagination, `next_page_results`), `inWorkspace(conn, path)`, `PlaneError`/`PlaneRateLimited` in `packages/skills/src/plane/client.ts`. It sends `X-Api-Key` with `redirect: "error"` (a 3xx is refused too), checks https-unless-listed and Allowed hosts before every call, and on 429 waits once when `Retry-After` is at most 10 s (falling back to `X-RateLimit-Reset`), else reports the wait. Per the v1.3.1 source, a bad key is a 403 "Given API token is not valid" (`isKeyRefusal`), and a wrong slug a 403 on the projects list.
  - Scope at run time: `loadPlaneAccess(ctx)`, `pickPlaneAccess(list, account)`, `planeProjectAllowed`, `allowedPlaneProjectIds`, `allPlaneProjectsAllowed` (for workspace-level tools) and `planeConnOf(account)` in `packages/skills/src/plane/scope.ts`. A thread uses its parent channel's rule.
  - Skill: `planeSkill` in `packages/skills/src/builtin/plane.ts`, registered in the registry; later tools add to `planeTools`, `planeHandlers` and `planeToolPolicy`, each with a group from `PLANE_GROUPS` (a group shows once it holds a tool). `planeAccounts` (read, Browse) lists each usable account's name, Plane user and open Plane projects; with no guild rule it says Plane is not enabled here and calls nothing. The model never sees the key, base URL or slug.
  - Admin routes: `apps/agent/src/routes/admin/planeAccounts.ts` (accounts and their Plane projects), Plane scopes beside git scopes in `routes/admin/bots.ts`, and `planeAccountIds` on bot create and update (admin and tenant API). Documented in `docs/api.md`. Web GUI: `TenantPlaneAccounts.tsx` ("Connected as …"), `GuildPlane.tsx` and `IntegrationPlaneAccess.tsx` (projects picked from Plane's list, or all), and the bot form's Plane accounts.
  - Test seams: contract suite `packages/db/test/contract/plane.contract.test.ts` (14 tests per engine), admin routes in `apps/agent/test/plane-accounts.test.ts` (Plane faked at fetch in v1.3.1 shapes, every response checked for the key), and the tool through the Discord scenario harness in `apps/agent/test/plane-tools.test.ts`, which gains `s.plane({ projects, baseUrl, name })`. The new seeded skill changed the expected skill lists in `skills.contract.test.ts` and `availability-api.test.ts`.
  - Verification, after merging the `spec/178-plane` tip (#188): `bun run typecheck` exits 0; `bun test` 902 pass, 268 skip (engine suites without their URLs), 0 fail; `bun run test:engines` 429 pass, 0 fail on SQLite, PostgreSQL and MongoDB. The web app builds. antislop was not applied to the GUI copy: no mode was set and a subagent cannot ask, so the pages follow the git pages' patterns.
- [x] #188 Trusted member and a Write confirmation any skill can use (no blockers)
  - `isTrustedMember` (`packages/skills/src/threadConfirmation.ts`) replaces `isGitWriteConfirmationOwner`. It reads `TRUSTED_DISCORD_IDS`; when that is unset or blank, it reads `GIT_OWNER_DISCORD_IDS`. A blank value counts as unset so a compose file passing `TRUSTED_DISCORD_IDS=` keeps the old list working.
  - `confirmWrite(ctx, { tool, args, access?: "anyone" | "trusted", ownConfirmation? }, prepare)` in `packages/skills/src/writeConfirmation.ts` checks who may ask, calls `prepare()` (the skill's own account, scope and argument checks, returning `{ summary, run }`), refuses an action that just ran, then runs it when confirmed or under a thread grant (unless `ownConfirmation`), or queues it. The skill sets `confirmsInternally: true`. Git's `guard()` now calls it, keeping its account and scope checks in `prepare`.
  - The queued action now also carries `auth` and `privateThread`, as the registry's generic queue already did, so the confirmed run re-checks the asker's authorization context.
  - Git keeps its behaviour: owner-level git tools still run under a thread grant. Plane danger tools must pass `ownConfirmation: true` to keep their own Confirm, as decided above.
  - Wording: the button reads "Confirm changes in this thread". The footer, the replies and the git danger tool descriptions no longer say Git or owner. A refused thread grant says "Only a Trusted member…", with the audit reason `not_trusted_member`. The button id prefix stays `gitconfirm` so confirmations already posted keep working. `TRUSTED_DISCORD_IDS` is documented in `.env.example`.
  - Verification: `apps/agent/test/write-confirmation.test.ts` registers a test skill that is not git and runs it through the Discord scenario harness: Confirm by the asker only, a thread grant covering any skill, `ownConfirmation` not covered, Trusted-only refusal, `TRUSTED_DISCORD_IDS` overriding the old variable, and no "Git" in the message. The existing git tests changed only for the new wording. `bun run typecheck` exits 0; `bun test` 880 pass, 0 fail.
- [x] #189 Plane read tools for work items (blocked by #179)
  - Tools, all `read`: `planeProjects`, `planeProject`, `planeStates`, `planeLabels`, `planeMembers` (Browse) in `packages/skills/src/plane/browse.ts`; `workItemGet`, `workItemSearch`, `workItemList`, `workItemComments`, `workItemActivity`, `workItemLinks`, `workItemRelations`, `workItemAttachments` (Work items) in `plane/workItems.ts`. `builtin/plane.ts` only spreads each module's tools, policy and handlers.
  - One Plane project resolver, merged with #190's: `plane/projectRef.ts` holds `planeTarget(ctx, args)` (account, connection, and the Plane workspace's projects listed at most once per call, `openProjects()` without archived ones), `findPlaneProject(t, ref)` (id, identifier or name, any case; an id is scope-checked before it is read) and `resolvePlaneProject(ctx, args)` on top of them. Tools that span Plane projects start from `planeTarget`.
  - `plane/resolve.ts` for later tickets: `resolveWorkItem(t, item, project?, query)` takes a key such as `eng-42` (rebuilt from the Plane project's own identifier, since Plane's get-by-key is case-sensitive) or an id with its Plane project; `workItemPath`, `workItemKey`; `projectStates`, `projectLabels`, `projectMembers`; `planeUserName` ("Budi Santoso (budi)", no email), `planeUserAliases` and `matchByName` (exact match on any alias, else partial; callers decide on none or several).
  - Markdown: `planeMarkdown(html, names)` and `planeText` in `plane/markdown.ts` (turndown, added to `@pachiware/skills`). Plane's empty `mention-component` and `image-component` elements become text first, since turndown drops them as blank; mentions are named from the Plane project's members. An image keeps only its alt text, so a presigned link never reaches the channel. List items use "- a". `intakeGet` now uses it instead of #190's local plain-text function.
  - `workItemGet` reads by key with `fields=` (leaving out `description_binary`) and `expand=state,assignees,labels,parent,created_by`. Plane's work item carries no cycle or module, so both are replayed from its activity (`field` "cycles"/"modules").
  - `workItemList` reads Plane's unfiltered list with `order_by=-updated_at`, `per_page=1000`, at most 2 pages per Plane project and 20 Plane projects, stops paging once past `changedSince`, and filters on our side by state group (also "open"/"closed"), state, assignee (or "none"; "me" is refused with a request to name the person), label, priority, change date and title or key text. `stoppedEarly` names the capped Plane projects and the ones not read.
  - `workItemSearch` asks Plane's search for up to 100 hits (`workspace_search=true`, or `project_id` when a Plane project is named), drops hits outside the scope, and puts an exact key first. `workItemRelations` looks up at most 25 related work items for key and title and shows one outside the scope only as `outsideScope`. `workItemAttachments` lists name, type, size and upload time only.
  - The agent prompt, when the plane skill is on, explains Plane project and work item, says work items are never Tasks, and says to look up states, labels and members before a change and to ask about an ambiguous name or "me".
  - Verification: `apps/agent/test/plane-work-items.test.ts` (9 scenarios through the Discord harness) against `apps/agent/test/support/fakePlane.ts`, a fake Plane v1.3.1 with the pagination envelope, `expand`/`fields`, case-sensitive get-by-key and search across projects, for later Plane tests to reuse. #190's intake test now expects Markdown. After merging the `spec/178-plane` tip (#190): `bun run typecheck` exits 0; `bun test` 918 pass, 268 skip, 0 fail.
- [x] #190 Plane read tools for cycles, modules, intake and the Plane workspace (blocked by #179)
  - Tools, all `read`: `cycleList` (view all, current, upcoming, completed, draft or incomplete, sent as `cycle_view`; Plane answers "current" as a plain array, which `planeList` already reads), `cycleGet`, `cycleItems` (Cycles) in `packages/skills/src/plane/cycles.ts`; `moduleList`, `moduleGet`, `moduleItems` (Modules) in `plane/modules.ts`; `intakeList`, `intakeGet` (Intake) in `plane/intake.ts`; `workspaceMembers`, `workspaceInvitations` (Workspace) in `plane/workspace.ts`. `builtin/plane.ts` only spreads each module's tools, policy and handlers.
  - A Plane project is named by id or identifier (`resolvePlaneProject(ctx, args)` and `PROJECT_ARGS` in `plane/projectRef.ts`): an identifier is looked up in the projects list, the scope is checked before Plane is asked about the project, and the project's detail comes back with `cycle_view`, `module_view` and `intake_view`. A project out of scope, unknown, or a 404 all read "is not open in this channel", so the answer does not tell which. A cycle or module is named by id or by name.
  - `cycleItems` and `moduleItems` share `listWorkItemsIn` (`plane/items.ts`): `expand=state,assignees` with `fields=`, key, title, state, state group, assignee display names and priority, up to 5 pages of 200 with `more` when cut.
  - Intake: Plane answers an empty list with intake switched off, so `intakeList` adds a note when the list is empty and the project's `intake_view` is false. `intakeGet` takes the work item id or the key; a key is matched in the intake list, because Plane's lookup by key leaves out items in triage. Its description is HTML reduced to plain text by a small local function, to be swapped for #189's turndown conversion once both are merged.
  - Decided: a skill can hide tools its place does not support, through `SkillModule.hiddenTools(ctx)`. The loop leaves them out of the tools offered (`skillRegistry.hiddenTools(ctx)` in `loop/react.ts`), and the registry refuses a call to one as unavailable, which also covers a confirmed run. The plane skill hides `WORKSPACE_LEVEL_TOOLS` unless a usable account has every Plane project open here (`hiddenWorkspaceTools`), and their handlers choose an account with `pickWorkspaceAccess`. #192 (`projectCreate`) and #193 (`workspaceInvite`, `workspaceCancelInvite`) add their names to `WORKSPACE_LEVEL_TOOLS`.
  - Workspace members are shown with display name, full name and role, without email; invitations carry their email, which is what they are. Plane's member list includes removed members and gives no flag to tell them apart.
  - Verification: `apps/agent/test/plane-cycle-reads.test.ts` (7 scenarios through the Discord harness, Plane faked at fetch in v1.3.1 shapes): the current cycle unpaginated and other views across pages, cycle and module items, a project out of scope refused with no request about it, intake listed and read by key, intake switched off, and the workspace tools offered under "*" but not where a channel names one Plane project, where a call is refused. `bun run typecheck` exits 0; `bun test` 909 pass, 268 skip, 0 fail.
- [x] #191 Plane write tools for work items (blocked by #188, #189)
  - Tools, all `write` in Work items: `workItemCreate`, `workItemUpdate`, `workItemComment`, `workItemEditComment`, `workItemAddLink`, `workItemRemoveLink`, `workItemRelate`, `workItemAttach` in `packages/skills/src/plane/workItemWrites.ts`, spread into `builtin/plane.ts` like the read modules. The plane skill now sets `confirmsInternally: true`.
  - The write pattern for #192 and #193: `planeWrite(tool, prepare, options?)` in `plane/write.ts` wraps `confirmWrite`. `prepare(args, ctx)` resolves the account, Plane project, work item and names inside the Plane scope, checks the arguments, and returns `{ t, summary, run }`; only `run` writes. The summary gets `[Plane account <name>]`. `prepare` runs again on the confirmed run, so a Plane project that left the scope, a name that changed, or a refused asker stops it there. Danger tools pass `{ access: "trusted", ownConfirmation: true }`. `originLine(ctx)` is the closing paragraph of what the bot writes ("Sent from Discord by Alice in #general (thread: …)"); the confirmed run carries no display names, so they are read from Discord (`getMember`, `channelView`). `ORIGIN_LINE` finds it again.
  - Names: `projectNames(t, project)` in `plane/resolve.ts` gives `state`, `label` and `member` by name, each list read once; `pickByName` refuses no match or several matches with the choices listed, and `member` refuses "me" (`ME`). Plane drops assignees who are Guests or not in the Plane project without an error, so create and update report them as `notAssigned`.
  - Markdown to HTML: `planeHtml` in `plane/markdown.ts` (marked 18, GFM, line breaks). Plane keeps comment HTML unsanitized, so raw HTML in the model's Markdown becomes text and a link keeps only an http(s) or mailto address.
  - `workItemUpdate` takes `addAssignees`/`removeAssignees`/`addLabels`/`removeLabels` and reads the current sets just before the PATCH, since Plane replaces the whole set; dates and parent take "none" to clear. A description edit adds no origin line. `workItemEditComment` reads the comment with `expand=actor` and refuses one whose actor is not the account's `planeUserId`; the edited comment keeps its origin line. `workItemRemoveLink` takes the URL or id. `workItemRelate` resolves each related work item in the scope and says Plane's API cannot remove a relation.
  - `workItemAttach` takes a message id from this channel or thread, or the channel the thread sits in; the file must be 5 MB or less (checked on Discord's size before Confirm and on the bytes after the download). `planeUpload(conn, upload_data, file)` in `plane/client.ts` posts the fields, then the file, without the API key and with redirects refused, then the tool PATCHes the attachment as uploaded. Decided: a storage URL on the Plane host takes the base URL's scheme, because a self-hosted MinIO behind a TLS proxy answers `http://`; any other http storage host must be on Allowed hosts. The result has no download or asset link.
  - The agent prompt says Plane changes return pending and wait for Confirm, and that the origin line is added for the model.
  - Test seams: `apps/agent/test/plane-work-item-writes.test.ts` (9 scenarios through the Discord harness). `fakePlane` now models the writes (create and PATCH of work items with Plane's silent assignee and label filtering, comments with `actor` as the API user, links, relations, the attachment request and completion, and the presigned upload at either scheme) and records each in `plane.writes` as `{ method, path, body }`, `path` inside the Plane workspace or the upload's full URL, so a test asserts `plane.writes` is empty before Confirm. Verification: `bun run typecheck` exits 0; `bun test` 927 pass, 268 skip, 0 fail.
- [x] #192 Plane write tools for cycles, modules, intake and Plane project setup (blocked by #190, #191)
  - Tools, all `write`, each a `planeWrite` in its own module and spread into `builtin/plane.ts`: `cycleCreate`, `cycleUpdate`, `cycleAddItems`, `cycleRemoveItem`, `cycleTransfer`, `cycleArchive`, `cycleUnarchive` (Cycles) in `packages/skills/src/plane/cycleWrites.ts`; `moduleCreate`, `moduleUpdate`, `moduleAddItems`, `moduleRemoveItem`, `moduleArchive`, `moduleUnarchive` (Modules) in `plane/moduleWrites.ts`; `intakeCreate`, `intakeTriage` (Intake) in `plane/intakeWrites.ts`; `projectCreate`, `stateCreate`, `stateUpdate`, `labelCreate`, `labelUpdate` (Project admin) in `plane/projectAdmin.ts`. #193 adds its danger tools to these modules.
  - Shared pieces: `PlaneChange` takes `refusals` (Plane answers turned into plain words) and `role` (named when Plane answers 403 "You do not have permission", with the account's Plane user); `planeWrite` wraps `run` in `plainly`. `plane/args.ts` holds the argument readers `workItemWrites.ts` had locally. `resolve.ts` gains `workItemsIn` (work items that must sit in one Plane project) and `findArchived` (archived cycle or module by id or name). `findCycle`, `findModule`, `cyclesOff`, `modulesOff`, `findIntakeItem` and `intakeOff` are exported; a missing cycle or module id now reads plainly. `planeTargetOf(access)` in `projectRef.ts` gives a workspace-level tool its `PlaneTarget`.
  - Behaviour per the v1.3.1 notes where they differ from the spec: a cycle create sends `project_id` in the body; cycles, modules or intake switched off are refused before Confirm. Adding work items to a cycle moves them out of any other cycle and the summary says so; a work item stays in its other modules (Plane allows several). `cycleTransfer` takes only a cycle that has ended (a draft is refused too, though Plane would take one) into one that has not; `cycleArchive` only one that has ended. Plane's 500s (archiving a draft cycle, transferring to a missing cycle) are refused in plain words first. `moduleArchive` needs status completed or cancelled. `moduleUpdate` reads the result from what it resolved, since Plane's PATCH answer has no id, and merges added and removed members with the current set.
  - Intake: the intake path id is the work item id; `intakeTriage` sends Plane's integer status (1 accept, -1 reject, 0 snooze with `snoozed_till`, 2 duplicate with `duplicate_to`), then reads the item back. Plane answers a non-Admin's triage with 200 and nothing changed, so a status left as it was fails the confirmed run with the role problem named. Decided: `intakeCreate` makes a work item, so it carries the origin line.
  - `projectCreate` is in `WORKSPACE_LEVEL_TOOLS`, chooses its account with `pickWorkspaceAccess`, and touches no Plane scope. Decided: it switches cycles and modules on unless asked not to, since Plane's API leaves both off. Intake is switched on by a PATCH after the create, because only a PATCH makes Plane's Intake row. A hyphen, dot, parentheses and Plane's other forbidden characters, an identifier other than 1 to 12 letters or digits, and a taken name or identifier are refused before Confirm. State and label names are checked against the Plane project's own before Confirm; a state without a color gets one for its group.
  - The agent prompt names the new tool families among the changes that wait for Confirm.
  - Test seams: `apps/agent/test/plane-cycle-writes.test.ts` (5 scenarios, cycles and modules) and `apps/agent/test/plane-project-writes.test.ts` (5 scenarios, intake and project setup) through the Discord harness. `fakePlane` now models cycles (views, items, at most one cycle per work item, transfer, archive with Plane's 500s), modules (several per work item, reduced PATCH answer, archive by status), intake (triage ignored unless `member_role` > 15, Intake row only after a PATCH), project create and PATCH, and state and label writes, with builders `cycle`, `module`, `intake` and lookups `cycleOf`, `modulesOf`, `find.*`, `projects`. Each test asserts `plane.writes` is empty before Confirm.
- [x] #193 Plane danger tools, limited to Trusted members (blocked by #191, #192)
  - Tools, all with the `danger` effect, each a `planeWrite` passing `DANGER` (`{ access: "trusted", ownConfirmation: true }`, in `plane/write.ts` with `DANGER_NOTE` for their descriptions): `workItemDelete`, `workItemDeleteComment` (Work items) in `plane/workItemWrites.ts`; `cycleDelete` in `cycleWrites.ts`; `moduleDelete` in `moduleWrites.ts`; `intakeDelete` in `intakeWrites.ts`; `projectUpdate`, `projectArchive`, `projectUnarchive`, `projectDelete`, `stateDelete`, `labelDelete`, `projectMemberAdd` (Project admin) in `projectAdmin.ts`; `workspaceInvite`, `workspaceCancelInvite` (Workspace) in `workspace.ts`, added to `WORKSPACE_LEVEL_TOOLS` and choosing their account with `pickWorkspaceAccess`. Someone who is not a Trusted member is refused before `prepare` runs, so no confirmation appears; a thread grant does not cover them.
  - Decided: `projectMemberRole` and `projectMemberRemove` are not built. Plane v1.3.1's project-member list returns users only, with no membership id, and keeps removed members; PATCH and DELETE need the membership id, which only the POST that adds a member returns, and a user id gives 404. Follow-up [#194](https://github.com/yhagus/pachiware/issues/194) (needs-triage) weighs storing the membership id `projectMemberAdd` gets back.
  - `projectMemberAdd` resolves the person from the Plane workspace's members and takes admin, member (default) or guest. Someone already in the Plane project's list, a removed member included, is refused before Confirm in plain words: Plane answers re-adding with 400 "The payload is not valid", and its API cannot add a removed member back. The same words replace that 400 if it comes at the confirmed run.
  - Plane's refusals in plain words: deleting a work item, cycle, module or pending intake item the bot's Plane user did not create, without the Admin role (`notCreator` in `write.ts`); a state that still holds work items; an invitation already sent. Refused before Confirm: the default state, a comment another Plane user wrote (`ownComment`, now shared with `workItemEditComment`), editing an archived Plane project, archiving an archived one or bringing back one that is not, a project name or identifier Plane would refuse (`freeProjectName`, shared with `projectCreate`), an email already invited, and an invitation already accepted or answered. The summaries say what goes with a delete: a cycle's or module's work items stay, a pending intake item takes its work item with it, a Plane project takes everything.
  - `workspaceInvite` notes that Plane records the invitation but sends no email. The agent prompt says the Plane danger tools are for Trusted members only and wait for their own Confirm.
  - Test seams: `apps/agent/test/plane-danger-tools.test.ts` (8 scenarios through the Discord harness): refusal of a non-Trusted asker with no confirmation, the own Confirm under a thread grant, another user's comment refused, each tool's Plane request after Confirm, Plane's creator and role refusals reported, the workspace tools hidden and refused under a narrowed scope, and one Availability rule on the `danger` effect hiding all 14 tools while the other Plane changes stay offered. `fakePlane` now models work item, comment, cycle, module, intake, state, label and Plane project deletes with Plane's creator or Admin checks, project archive and unarchive, project PATCH needing an Admin, project member add (the list keeps removed members, a re-add is a 400), and the Plane workspace's member list and invitations, with builders `invitation` and `user({ workspaceRole })` and lookups `membersOf`, `find.invitation`.
  - Verification, on the `spec/178-plane` tip (#192): `bun run typecheck` exits 0; `bun test` 945 pass, 268 skip, 0 fail.
  - `projectMemberAdd` returns the `membershipId` Plane answers with, as groundwork for #194. Decided: the presigned upload's storage host is not checked against Allowed hosts. Allowed hosts guards the Plane base URL, and no key is sent to storage, so the behaviour stays.
  - Code review fixes (branch `fix/178-review`):
    - The `plane` skill switches on only when a bot gets its first Plane account; linking another leaves a switched-off skill off (contract test on every engine).
    - A thread always uses its parent channel's rule, ignoring a rule stored on the thread id, in both `computePlaneAccess` and git's `computeAccess`. The admin PUT routes for both scopes already match, so they are unchanged.
    - `projectMemberAdd` keeps the Plane workspace's member list private: with no match it names nobody, with several it lists only the ones the name matches (`pickByName(..., { private: true })`), and its "me" refusal no longer points to `workspaceMembers`.
    - Setup advice from #178 (dedicated Plane user, Member role except where intake triage or project admin is wanted, key expiry, `API_KEY_RATE_LIMIT`) is in README "Connect Plane" and, briefly, in the Plane account form's hints.
    - Glossary wording: tool text, errors and the agent prompt say Plane workspace and Plane project; the prompt no longer calls a work item a ticket. The groups are now "Plane project admin" and "Plane workspace". Availability rules key on skills, tools, effects and playbooks, never groups, so saved rules keep working. Git's danger level `"owner"` is now `"trusted"`.
    - Shared pieces: `CONFIRM_NOTE` in `plane/write.ts`, `Obj` in `plane/client.ts`, `ACCOUNT_ARG` in `projectRef.ts`, `PLANE_ID` exported by `@pachiware/db` (skills already depends on it), one role table in `workspace.ts`, and `DANGER_PREFIX` in `writeConfirmation.ts`, which now starts Plane danger summaries as it does git's. A tool is workspace-level through `workspaceLevel: true` in its `PlaneToolPolicy`; `WORKSPACE_LEVEL_TOOLS` is gone. Renamed `PlaneChange.t` to `target`, `plainly` to `inPlainWords`, `send1` to `sendOnce`, `R` to `READ`; dropped the `planeUserName ??` fallbacks. `planeHost` moved to `apps/web/src/lib/plane.ts`. Doc comments over two lines were cut down. The cycle/module and git/Plane mirroring was left as it is.
    - Verification: `bun run typecheck` exits 0; `bun test` 947 pass, 270 skip, 0 fail; `bun run test:engines` 432 pass, 0 fail.
- [x] Built on integration branch `spec/178-plane`, one worktree per ticket in task-graph order (#179 ‖ #188 → #189 ‖ #190 → #191 → #192 → #193), then a two-axis code review (standards, spec) and one fix pass. Merged into `main` by fast-forward and pushed; #178, #179 and #188–#193 closed with the commit named.
  - Verification on the final tip: `bun run typecheck` exits 0; `bun test` 947 pass, 270 skip, 0 fail across 154 files; `bun run test:engines` 432 pass, 0 fail.
  - Follow-up: #194 Plane project member role change and removal (not possible through Plane v1.3.1's API).

## Phase 38 — Test suite hygiene and speed

- [x] Rule in `AGENTS.md` (Modular & Incremental Development): tautological tests are considered harmful. A test takes its expected value from an independent source of truth (a known-good literal, a worked example, the spec); one that recomputes it the way the code does is rewritten or deleted.
- [x] Swept all 154 test files for tautological tests (five read-only reviewers, each candidate checked by hand).
  - Fixed: `packages/skills/test/clock.test.ts` compared `zonedTime(..., "2026-03-06T09:30:00")` with `wallToInstant(...)`, the helper `zonedTime` returns through, so it passed by construction. It now expects the literal instant `at`, which keeps the check that the optional `:00` seconds are read. The test name no longer names `wallToInstant`.
  - Kept: the "view agrees with what was sent to Discord" check in `apps/agent/test/playbook-slash-status.test.ts`. It compares the availability view with the commands the fake Discord actually received, so it fails if re-registration after an Availability change goes stale.
  - No other tautological tests found.
- [x] Tests run in parallel by default: `bun run test` is `bun test --parallel` (one worker per core) with the `TEST_*_URL` variables blanked, so it always runs the contract suites on SQLite. The `pre-push` hook, the CI "Test suite (SQLite)" step, the `AGENTS.md` completion rule and both READMEs use `bun run test`; the `apps/agent` and `packages/skills` test scripts pass `--parallel` too. Bun 1.4 ignores a `parallel` key in `bunfig.toml` (tried `true` and `4`), so bare `bun test` stays sequential.
  - Decided: `bun run test:engines` stays sequential and refuses `--parallel` (`engines-run.ts`). Its files share one PostgreSQL and one MongoDB test database: run with `--parallel` most postgres and mongodb contract suites failed, run sequentially 432 pass, 0 fail in 47 s.
  - Running `bun test` from inside `packages/skills` fails 12 tests with or without `--parallel`: the root `bunfig.toml` preload (encryption key, runtime config path) is not read there. Unchanged; the root run covers those files.
  - Verification: five parallel runs on 11 workers, each 947 pass, 270 skip, 0 fail in 46–51 s (sequential: 239 s). The `pre-push` hook (typecheck + suite) takes 49–53 s, down from 241 s, and stays on SQLite with `TEST_POSTGRES_URL` set in the shell.
- [x] Diagnosed the cost of a Discord scenario: each of the 478 scenarios runs in its own `bun test` subprocess, and an empty one took ~322 ms, ~85% of it loading modules. Migrations, seed, bot start and close took ~30 ms together.
  - Cause: `packages/skills/src/workspace/extract.ts` imported `exceljs` (~109 ms) and `mammoth` (~31 ms) at the top, so every process start paid for them. They now load the first time a DOCX or XLSX is read. An empty scenario takes ~195 ms and `availability-confirm.test.ts` ~254 ms per scenario, down from ~400 ms.
  - `discordScenario` runs a file's scenarios together (`test.concurrent`, async `Bun.spawn`), so a file with many scenarios no longer holds one worker for its whole length. Each scenario still has its own process, SQLite database and Workspace folder; `EVAL_RECORD=1` writes one file per scenario, so it is safe too.
  - No regression test: a timing assertion would be flaky, and the import order is not behaviour. The check is timing one scenario file: `bun test apps/agent/test/availability-confirm.test.ts`.
  - Left: `discord.js` (~78 ms) and the db modules (~40 ms) load in every scenario process, and starting ~480 processes costs ~80 s of system CPU. The suite now uses ~290 s of CPU on 11 cores, so it cannot go much under ~27 s while each scenario has its own process.
  - Verification: `bun run typecheck` exits 0; `bun run test` 947 pass, 270 skip, 0 fail in 32–37 s over six runs (was 46–59 s).

## Phase 39 — Recall: Daily logs and finding past talk, decisions and done work (spec #195)

Started from a review of the harness as an administrative assistant (2026-10-18): asking about past work ("was audio normalization discussed, and is it done?") scored 9/20, the lowest area and the one people use most. Causes: only talk someone asked to keep is findable after 24 hours, `searchFiles` needs every word (Indonesian and English wordings miss each other), and "is it done?" never reaches Tasks of other channels, git or Plane. A grilling session the same day settled the model; the spec is issue [#195](https://github.com/yhagus/pachiware/issues/195). Tickets are cut in a later step.

- [x] Constraints from the user: only text, images and Documents are processed (no audio or video); no embedding model, the tenant's own chat model only (e.g. DeepSeek BYOK).
- [x] Glossary: new term Daily log (written nightly by one bot from a schedule-started Playbook, never posted, owned by nobody, part of Kept material); Playbook may be started by the schedule; another channel's Tasks are read under the Source rules when someone asks whether work was done.
- [x] ADR 0012: Discord keeps the messages, the bot keeps Daily logs; a 30-day Message archive rejected.
- [x] ADR 0013: recall uses no embedding model and no Database engine full-text index; Workspace files are scored in code.
- [x] Decisions recorded in the spec:
  - Daily logs: off by default, turned on per channel by an admin in one bot's guild settings; one notice on turning on; 30-day backfill (can be unticked); written at 00:30 in the place's zone for the day before, never posted, empty days skipped; kept with no time limit; missed nights caught up to 7 days; turning on again backfills only missing days.
  - Content: Topics with Indonesian and English keywords, Decided, Still open, Who does what next, every item linked to its messages. People's and webhook messages in; other bots and the bot out; public threads in; private threads and DMs never. A busy day read in parts, cut past 5,000 messages with a note. A deleted message loses its link and an item left with none goes; edits ignored. Steps are a built-in, tenant-editable Playbook; an Availability rule turning it off stops the Daily log.
  - Recall: ranked search over files (no AND), several query variants per search, server-written topics and keywords on newly kept material, no topic list for now, "is it done?" reads Tasks of viewable channels under the Source rules plus git and Plane within their scopes, a four-part answer with the newest source winning.
- [x] Test seams: the Discord scenario harness for behaviour and the assistant eval for recall quality with a real model; no new seam.
- [x] Spec #195 cut into 11 tickets, all sub-issues of #195 with native blocking, ready-for-agent. Persona changes land one at a time, so #199, #200 and #202 wait on #197.
  - #196 Recall eval baseline
  - #197 Ranked search with query variants (persona: variants, four-part answer, newest wins)
  - #198 Turn Daily logs on for a channel
  - #199 Keywords on newly kept material (after #197)
  - #200 "Is it done?" reads Tasks across viewable channels (after #197)
  - #201 "Is it done?" reaches git and Plane within their scopes (after #200)
  - #202 Write yesterday's Daily log at 00:30 (after #197, #198)
  - #203 Busy days read in parts (after #202)
  - #204 Backfill and catch-up (after #202)
  - #205 A deleted message leaves the Daily log (after #202)
  - #206 Recall from Daily logs (after #197, #202)
  - Starting frontier: #196, #197, #198.
- [x] #196 Recall eval baseline: three assistant-eval briefs under `apps/agent/eval/assistant/`, each with a dry-run recording and code checks.
  - `recall-asked-in-indonesian`: English Minutes in the asked channel and an English Note in #audio, asked in Indonesian ("normalisasi audio").
  - `recall-asked-in-english`: an Indonesian Decision in the asked channel and Indonesian Minutes in #finance, asked in English ("invoice reminders").
  - `recall-decision-replaced`: support hours decided on 2026-09-21 in this channel and again on 2026-10-09 in #support; neither file says it replaced the other. Must-cover: the newer hours, and that the older were replaced.
  - Measured in the dry runs on the current harness: `searchFiles` for "normalisasi audio" and for "invoice reminders" returns 0 matches; only the exact wording of the kept file finds it.
  - [ ] Baseline score with a real model: not run. This worktree has no model or judge key and no `apps/agent/eval/profiles.yaml`. It needs a live run before #197 lands; record the score here. Command, from the repository root: `EVAL_LIVE=1 EVAL_PROVIDER=<provider> EVAL_MODEL=<model> EVAL_API_KEY=<key> EVAL_JUDGE_PROVIDER=<provider> EVAL_JUDGE_MODEL=<judge model, not the compared one> EVAL_JUDGE_API_KEY=<key> EVAL_TRIALS=3 bun run eval:assistant -t "recall-|decision-other-channel|action-items-across-meetings|nothing-found|private-channel-dm|minutes-as-document"`. The report lands in `apps/agent/eval/results/assistant-<run>/report.md`; the recall score is the mean over the three `recall-` briefs, the others show the existing kept-material behaviour does not regress.
  - Verification: `bun run typecheck` exits 0; `bun run test` 953 pass, 0 fail.
- [x] #197 Ranked search with query variants.
  - `searchFiles` takes `queries` (several wordings) beside `query`; a file is found when it holds any word of any query, in its name or text. Ranking (`ranked` in `packages/skills/src/workspace/search.ts`): files holding every word of some query first, then the sum of each held word's BM25 inverse document frequency over the files searched, then newest first. Decision: term frequency and file length are left out of the score (BM25 with k1 at 0), so files matching the same words keep date order and a long file is not pushed down for being long. `searchFolder` now returns the files it searched with the matches; source grouping, quotability and `notShownHere` are unchanged, groups follow their best match.
  - Persona "Asking about kept material": one search with Indonesian, English and same-meaning variants as `queries`; "is it done?" also reads this place's Tasks with status all (other channels, git and Plane come with #200 and #201); four-part answer (Discussed, Decided, Done or not, Nothing found), each left out when empty; newest source wins and the older is named as replaced. The previous default is frozen as `PERSONA_KEPT_MATERIAL` and in `OLD_DEFAULT_PROMPTS`, so the SQL migration moves tenants still on it (the MongoDB engine has no persona migration step, as before).
  - Tests: file-search scenarios for several queries, a partial match ranked below a full one, and equal matches newest first; the "a file missing any word is not returned" scenario is replaced by the partial-match one. Two cross-channel source scenarios used AND to find nothing and now search a word only the hidden file holds; the guild config test checks for "Answer in Indonesian" since the persona now says "Indonesian". `bun run typecheck` 0, `bun run test` passes.
  - After merging #196: the `recall-asked-in-indonesian` and `recall-asked-in-english` dry runs now find both kept files with one `searchFiles` call carrying both wordings as `queries` (before: 0 matches for the other language's words).
  - [ ] Language-variant briefs against the recorded baseline with a real model: not run (no model or judge key here). Run the command under #196 once its baseline is recorded and note both scores here; no improvement is claimed until then.
- [x] #199 Keywords on newly kept material.
  - `addKeywords` (`packages/skills/src/workspace/keywords.ts`): after a kept file is written, one tool-free call to the bot's model (`KEYWORDS_PROMPT`) returns `{topics, keywords}` in Indonesian and English; the server writes them as the last two lines of the file's head (`topics: [...]`, `keywords: [...]`), adding a head when the file has none and replacing earlier topics and keywords lines. The write is version-checked; a failed call, a reply without keywords or a file changed meanwhile leaves the file as written. Search needs no change: the head is part of the text #197 scores.
  - Where: Minutes after they are stored; `writeFile` under `notes/` and `decisions/` (its returned version is the one after the head is written); `keepAsNote` (the Note's body stays word for word, keywords sit in the head); a filed Document's extracted text (`.md` beside a PDF, DOCX, XLSX or large CSV) and a filed Markdown Document itself, both from chat attachments and `saveAttachment`. `keepAsNote` from a Document leaves the Document's keyword lines out of the Note's body.
  - Decisions: a filed TXT or small CSV is left exactly as given (a head would change the file people download); it is still found by its text and name. Material kept before this is not touched. `botCompletion` (`apps/agent/src/llm/completion.ts`) is the one tool-free model call, shared by the turn's `complete` and Minutes.
  - Tests: `apps/agent/test/kept-keywords.test.ts` (8 scenarios): Note from messages with a head-only keyword found by search, failed call keeps the Note and the turn answers, Decision and Note via `writeFile` with the returned version, a rewrite replacing old keywords, Minutes found by a head-only keyword, a filed PDF and a Note kept from it, a Markdown Document headed while a TXT is untouched, `writeFile` elsewhere makes no call. The scenario harness answers keyword calls from `s.model.keywords(...)`, apart from `script` and `calls`; an unscripted one answers as a provider failure, so scenarios about other things are unaffected.
  - Verification: `bun run typecheck` exits 0; `bun run test` 974 pass, 0 fail after merging #198 and #200.
- [x] #198 Turn Daily logs on for a channel.
  - `dailyLogChannels: { channelId, backfill }[]` on a bot's guild settings, every engine: new `daily_log_channels` JSON column (DDL plus guarded `ADD COLUMN`, migration test), MongoDB mapper default `[]`, contract test. The admin API reads and writes it next to `digestChannels`; `backfill` defaults to true and is only stored (#204 reads it).
  - `saveGuildSettings` refuses a channel another live bot of the tenant logs (`DailyLogTaken`, 409 "Helper already keeps Daily logs of channel …"), keeps the rows in step, and, given the Discord manager, posts one notice in the place's language in each channel just turned on (none for a save that changes nothing, none on turning off). The notice says nothing about the 30 days yet; #204 adds that once backfill runs. A notice that cannot be posted (bot offline, no access) is dropped, not retried; the setting is still saved.
  - Schedule rows for #202: one active row per logged channel, `kind: "daily-log"`, `recurrence: "daily"`, `timeOfDay: "00:30"`, `timezone` the guild's zone (falling back to the tenant's, moved with it by `syncTenantSchedules`), `guildId` and `channelId` set, no owner, no text. Turning off cancels the row. The scheduler currently returns early for a `daily-log` row and only moves it on; #202 replaces that branch with the writer. Digest and Daily log rows share one sync in `apps/agent/src/digest.ts`.
  - Console: a "Daily logs" list per channel in the server settings sheet, with an "Also write the last 30 days" tick (on by default) shown only for a channel being turned on in that edit. antislop mode was unresolved (no global preference, no session choice), so the list follows the Digest list's markup without an antislop pass.
  - Test seam: the Discord scenario harness gained `s.admin(method, path, body)`, which calls the admin API; the harness now uses the process's one `discordBotManager` (burst and command debounce set to 0) so the API posts through the fake clients. Scenarios in `apps/agent/test/daily-log-settings.test.ts`.
  - Verification: `bun run typecheck` exits 0; `bun run test` passes apart from three 5-second timeouts under a machine load average near 150 (`setup.test.ts` doctor, `availability-api`, `web-chat`), which pass when run alone. `bun run test:engines` was not run (no PostgreSQL or MongoDB here).
- [x] #200 "Is it done?" reads Tasks across viewable channels.
  - `listTasks` takes `scope: "anywhere"`: the tasks of this place and of every other channel the asker can view, whoever holds them, every status unless `status` narrows it. Decision: the channels and their quotability come from `readableSources` (the cross-channel Sources code), so the Source rules hold unchanged: another channel's tasks are listed only when it is a Public channel, otherwise counted as `notShownHere` with the DM suggestion (`tasksNotShownHere`, English and Indonesian); a channel the asker cannot view is neither; from a DM every viewable channel of every shared guild is listed, labelled with its guild, plus the asker's Personal tasks. Private threads add nothing (their tasks are the parent's). Side effect of the reuse: a channel where an Availability rule turns the Workspace off is left out, as for files.
  - `listTasks` also takes `queries` (several wordings, as `searchFiles`); a task matches when it holds every word of one of them.
  - Persona: "is it done?" is `listTasks` scope anywhere with the same variants; a cancelled Task was dropped, never done; Done or not names the Task's channel; `notShownHere` from listTasks is handled as from searchFiles. The #197 default is frozen as `PERSONA_RECALL_VARIANTS` and appended to `OLD_DEFAULT_PROMPTS` (and to the persona migration test).
  - Tests: `apps/agent/test/task-done-across-channels.test.ts` (completed Task in a Public channel quoted from #general; a non-public channel's Task counted with the DM suggestion, quoted in its own channel and in a DM; a channel the asker cannot view neither quoted nor counted, while a member who can view it gets it; a cancelled Task listed as cancelled; several wordings at once). New brief `recall-done-other-channel` with a dry run and recording, required in the checks.
  - [ ] The new brief with a real model: not run (no model or judge key here).
  - Verification: `bun run typecheck` exits 0; `bun run test` 966 pass, 0 fail (after merging #198).
- [x] #202 Write yesterday's Daily log at 00:30.
  - The scheduler's `daily-log` branch now writes, through `writeDailyLog` (`apps/agent/src/discord/dailyLog.ts`), the Daily log of the day before the row came due, in the row's zone, with the owning bot's Profile; nothing is posted. The file is `guilds/<g>/channels/<c>/daily-logs/<yyyy-mm-dd>.md`; a day that already has one is never rewritten. A model or read failure is logged and the row moves on (not retried: a row that failed `MAX_POST_ATTEMPTS` times would end as done and stop the channel's Daily logs); that day stays missing until #204's catch-up.
  - Reader: `DiscordJSAdapter.readSpan(channelId, {since, until}, most)` reads the channel and its public threads (active ones, and archived ones archived since the day began; private threads are filtered out by type) from the end of the span backwards, starting each read at the snowflake of `until`. Kept: people's messages and webhook posts (`webhookId`); left out: other bots, the bot itself, system messages. Oldest first, at most `most` (500 for now) with a `count` cut that the file states. #203 replaces the 500 with parts up to 5,000. `readHistory` (Minutes) is unchanged.
  - Playbook: built-in `daily-log`, `start: false` (a reference, so no slash or menu entry), `requires: ["workspace"]`, tenant-editable like Minutes. Before reading, `writeDailyLog` asks availability at the channel: a rule that turns the playbook (or the Workspace skill) off writes nothing.
  - Content: the model answers in JSON (`topics` with `keywords.id` and `keywords.en`, `decided`, `open`, `next`, `labels` in the talk's language), each item with `refs`, a list of message numbers. An item without a valid ref is dropped; an owner the talk never named is cleared, as in Minutes. The file's frontmatter keeps the whole log (each item's `links` list) plus `topics` and `keywords`; the body starts `# Daily log #<channel>, <day>`, then `Topics:`, `Keywords:` (Indonesian then English) and the message count, then the four sections numbered across, each item ending with one `[↗](link)` per message. Decision for #205: rewrite the file from the frontmatter `log`, dropping a deleted message's link from `links` and an item left with none.
  - Kept material: `daily-logs` joined `KEPT_FOLDERS`, so cross-channel Sources, `searchFiles`, the fixed top-level folders and private-thread routing cover it; the searchFiles and readFile path descriptions name Daily logs. Persona: the folder list names `daily-logs/` (written by the server, never by the agent) and "Asking about kept material" lists Daily logs; the previous default (after #200) is frozen as `PERSONA_TASKS_ACROSS` in `OLD_DEFAULT_PROMPTS`.
  - Test seam: the Discord scenario harness gained webhook and embed history messages (`webhook: true`, `embeds`) and a `threads` manager on text channels (`fetchActive` lists every thread under the channel, private ones included, as Discord does; nothing is archived). Scenarios in `apps/agent/test/daily-log.test.ts`: a tick at 00:29 writes nothing and at 00:30 writes yesterday's four parts with links; webhooks in, other bots and the bot out; public thread in, private thread out; a bot-only day writes no file and calls no model; an Availability rule off in one channel stops only that channel's; a search from #general finds #audio's Daily log and only counts #direksi's. Literal expectations that listed the fixed folders now include `daily-logs`, and the playbook catalogue and slash-status tests count `daily-log` as our own reference playbook.
  - Verification: `bun run typecheck` exits 0; `bun run test` 966 pass, 0 fail before merging #199 and #200; after the merge 975 pass, with 5-second timeouts under a load average near 55 that move between runs (e2e, git-confirm, settings-api, availability-api, profiles-anthropic and others) and pass when those files run alone. The Daily log uses `botCompletion` (from #199), and its head ends with `topics` and `keywords` as `addKeywords` writes them. `bun run test:engines` not run (no record or migration change).
- [x] #203 Busy days read in parts.
  - `writeDailyLog` reads the day with `readSpan(..., 5_000)` (`DAY_LIMIT`) and sends it to the model in parts of 500 messages (`PART`), one call per part, each numbered from 1 and told "part n of m (messages a-b of total)". Each reply is parsed against its own part's links; `joinParts` makes one Daily log: a topic named in several parts (same name, ignoring case) appears once with the union of its keywords and links, the other sections are the parts' items in order, labels from the first part. Any part failing fails the day, as one failed call did before.
  - Decision: past 5,000 the cut keeps the latest messages, as `readSpan` already did; the file's existing line states it ("Only the last 5000 messages were read: everything before <time> UTC was left out."). `readSpan` itself is unchanged.
  - Tests in `apps/agent/test/daily-log.test.ts`: 1,200 messages give three calls and one file whose single "Release day" topic links the first message of each part and whose decisions link messages 500 and 1200; 5,003 messages give ten calls and a file that states it stopped at 2026-03-05 18:00 UTC and has no link to message 3. The 5,000 limit was checked by raising it to 6,000, which fails the test.
  - Verification: `bun run typecheck` exits 0; `bun run test` 978 pass with four 5-second timeouts under load (e2e, profiles-anthropic, availability-api, cli setup doctor), which pass when those files run alone.
- [x] #201 "Is it done?" reaches git and Plane within their scopes.
  - Decision: one new read tool for git, a persona procedure for Plane. Git had no word search across issues, pull requests and commits, so `repoSearchWork` (git skill, "Issues & PRs", read) takes `queries` (up to 5) and an optional `repo`. With a repo it goes through `useRepo` (the Git scope check every repo tool uses); without one it searches the repositories `repoList` would show (the account's own, first 3 pages, kept only where `repoAllowed`), at most 10, and says how many more were not searched. Per repository: the provider's issue/PR search (GitHub `/search/issues` with `repo:`, GitLab `issues` and `merge_requests` with `search`, every state), plus the latest 100 commits whose message holds every word of one wording. A pull request reads `merged` when it was. Plane already had `workItemList` (state included, Plane scope checked); it gains `queries` (a Work item matches when its title or key holds every word of one wording). Nothing new opens: no scope check was added or bypassed.
  - Persona: "is it done?" also calls `repoSearchWork` and `workItemList` with the same variants; a merged pull request or matching commit is done, a pull request closed without merging is not; only repositories and Plane projects the tools returned are named; with no git or Plane tool, or "not enabled here", Nothing found says git or Plane is not available here. Done or not names the pull request, issue or commit with link and status, the Work item with key and state. After merging #202 (which froze the #200 default as `PERSONA_TASKS_ACROSS`), the #202 default is frozen as `PERSONA_DAILY_LOGS` in `OLD_DEFAULT_PROMPTS`; the persona migration test now lists both.
  - Tests: `apps/agent/test/recall-done-in-git-and-plane.test.ts` (merged GitHub PR reported as merged with its link, a matching commit and an open issue, the out-of-scope repository never requested or named; GitLab merged MR in a named repo, a named out-of-scope repo refused before GitLab is asked; no Git scope: "No git account is enabled for this channel" and no request; Work items in the open Plane project found by several wordings with their state, the closed project never read or named; no Plane scope: "Plane is not enabled here"). New brief `recall-done-pull-request` (fixtures gained `seed.git`, a faked GitHub) with a dry run and recording, required in the checks. Git tool count 92 to 93 in the catalogue tests.
  - [ ] The new brief with a real model: not run (no model or judge key here).
  - Verification: `bun run typecheck` exits 0; `bun run test` 966 pass, 7 fail, all 5-second timeouts at a load average near 84 (digest-api, availability-api x2, router-hardening, conversations guild config, setup doctor, git-owner-only); each of those files passes alone. After merging #202 and #203: `bun run typecheck` exits 0; `bun run test` 987 pass, 2 fail (availability-api and git-owner-only, 5-second timeouts at a load average near 110), both pass alone.
- [x] #204 Daily log backfill and catch-up.
  - Turning on: `saveGuildSettings`, given the manager, runs in the background (`DiscordBotManager.background`, so `idle()` waits for it) for each channel just turned on: with `backfill` ticked, the missing Daily logs of the 30 days before today (yesterday back to 30 days ago, in the place's zone, oldest first; today is left to the 00:30 row), then the one notice. The notice now says which: "…as a Daily log, and I have recorded the talk of the last 30 days." or "…, starting today." (Indonesian: "dan obrolan 30 hari terakhir sudah saya catat" / "mulai hari ini"). Decision: the notice is posted after the backfill, so "recorded" is true when it is read; a long backfill delays it.
  - Catch-up: on `ClientReady` each active `daily-log` row of the bot writes the missing days of the last 7. The nightly row is no longer skipped when more than 6 hours late: it writes every day from the day before it came due through yesterday, the last 7 at most, so a bot that was down writes its missed nights on its first tick too. A failed day is still not retried by the row; the next start's catch-up writes it.
  - Never rewritten: every path goes through `writeMissingDays` (`apps/agent/src/discord/dailyLogDays.ts`), which runs one channel's days one run at a time, and `writeDailyLog` returns "exists" for a logged day. Turning off cancels the row and touches no file, so off then on again with the tick fills only the gaps.
  - Tests: `apps/agent/test/daily-log-backfill.test.ts` (on with the tick writes 2026-02-04 to 2026-03-05 days with talk and not 02-03 or today, notice says recorded; without the tick none, notice says from today; off then on keeps the old file byte for byte and writes only the two new days; two missed nights written on restart and the late row adds no model call; a 10-night outage writes only the days within 7). `daily-log-settings.test.ts` notices updated to the two wordings.
  - Verification: `bun run typecheck` exits 0; `bun run test` 987 pass, 0 fail after merging #203 (an earlier run under a load average near 195 had about 100 timeouts in unrelated files, which pass alone and in the later run). `bun run test:engines` not run (no record or migration change). After merging #201: `bun run typecheck` exits 0; `bun run test` 992 pass, 2 fail (availability-api and cli setup doctor, 5-second timeouts at a load average near 80), both pass alone.
- [x] #205 A deleted message leaves the Daily log.
  - The bot manager listens for `MessageDelete` (not `MessageUpdate`: edits change nothing). For a message in a guild the bot is set up for, `forgetDeletedMessage` (`apps/agent/src/discord/dailyLog.ts`) looks in the channel's `daily-logs/` (the parent channel's for a thread's message, found from the message's channel or by fetching it), takes the message's link out of every item's `links` in the frontmatter `log`, drops an item left with none, and rewrites the file from `log`, leaving out a part left empty. A message no Daily log holds changes nothing.
  - Decision: only the files of the UTC date of the message's creation time and the days either side are read, since any place's zone puts it within a day of that date; a partial message from Discord carries the time in its snowflake. The write is version-checked and serialized per tenant and channel; a conflict re-reads up to three times.
  - Decision: a rewritten file leaves out every empty part (one that said "None" before as well); a freshly written Daily log still shows "None", as #202 writes it.
  - Test seam: the scenario harness gained `discord.deleteMessage` (removes the message, emits `MessageDelete` to every running bot) and `discord.editMessage` (emits `MessageUpdate`). Scenarios in `apps/agent/test/daily-log-delete.test.ts`: one of two links removed, then the only link's item and its part removed; a public thread's message removed from the parent channel's Daily log; an edit, a deleted message the log does not hold and a deleted message from today leave the file byte for byte.
  - Verification: `bun run typecheck` exits 0; `bun run test` 985 pass, 0 fail after merging #203. After merging #201 and #204 (the `MessageDelete` listener sits beside the #204 `ClientReady` catch-up): `bun run typecheck` exits 0; `bun run test` 995 pass, 2 fail, then 991 pass, 6 fail, all 5-second timeouts at a load average near 60 (availability-api, cli setup doctor, reminders-api, profiles-anthropic); those files and the Daily log delete and backfill files pass alone (52 pass).
- [x] #206 Recall from Daily logs.
  - Decision: a new read tool, `readMessage` (Discord skill, beside `readChannelHistory`), opens one message from its link at any age: speaker, UTC time, text and attachment placeholders. It reaches only what `readChannelHistory` reaches: the asker needs View Channel and Read Message History there (and membership of a private thread), with the same refusal texts; the bot needs only to read. It is not available in a DM, as `readChannelHistory` is not (the skill's guild scope). A link to another server is refused. Then the Source rules: the message is shown when its channel is a Public channel or it sits in the asker's Project (the channel, its public threads, and its private threads except from inside another private thread); otherwise "cannot be shown here", suggesting a DM. The access check runs before the fetch, so a deleted message in a channel the asker cannot read is refused, never reported as gone. A deleted message (or channel) returns `gone: true` with a note telling the model to say so and not guess.
  - Persona: one line under "Asking about kept material": for the exact wording behind a Daily log or Minutes item, open its link with `readMessage` and quote it; a deleted message is reported as no longer there. After merging #201, its default is frozen as `PERSONA_GIT_PLANE` in `OLD_DEFAULT_PROMPTS`; the persona migration test lists it.
  - Tests: `apps/agent/test/linked-message.test.ts` (Bob's message quoted with speaker and time; a deleted one reported gone; no View Channel or no Read Message History refused without the text; a deleted message in a hidden channel refused, not gone; a non-public channel's message shown in that channel, refused in #general, not opened from a DM; another server's link and a non-link refused; a non-public channel's public and private thread messages shown in the channel, the private one refused inside another private thread). A persona scenario checks the readMessage line. Discord tool count 8 to 9 and the no-rules tool list gained `readMessage`.
  - New brief `recall-daily-log-only`: only the #podcast Daily log of 9 October 2026 (talk in Indonesian, English keywords in its head) says the podcast moves from Anchor to Transistor; asked in English from another channel. Dry run and recording added.
  - [ ] The new brief with a real model: not run (no model or judge key here). Command, from the repository root: `EVAL_LIVE=1 EVAL_PROVIDER=<provider> EVAL_MODEL=<model> EVAL_API_KEY=<key> EVAL_JUDGE_PROVIDER=<provider> EVAL_JUDGE_MODEL=<judge model> EVAL_JUDGE_API_KEY=<key> EVAL_TRIALS=3 bun run eval:assistant -t "recall-daily-log-only"`; note the score here.
  - Verification: `bun run typecheck` exits 0; `bun run test` 998 pass, 1 fail (setup doctor for MongoDB, a 5-second timeout at a load average near 70), which passes alone.
  - After merging #205: `linked-message.test.ts` deletes its messages with the harness's `discord.deleteMessage` instead of an `as any` cast. `bun run typecheck` exits 0; `bun run test` 1006 pass, 1 fail (setup doctor for MongoDB, a 5-second timeout at a load average near 60), which passes alone.
- [x] Code review of `spec/195-recall` (Standards and Spec), findings fixed:
  - #203: `readSpan` reads the day forward from its start (`after` the start-of-day id) and stops paging once 5,000 messages are kept, instead of paging the whole day and keeping the latest. The file and the model's prompt say where it stopped: "Reading stopped at 5000 messages: nothing after <time> UTC was read." The header field is now `stoppedAt`. The scenario harness gives message ids with the creation time in their top bits, as Discord does, and a page `after` an id holds the messages right after it.
  - Notice: it now says what the backfill did. A third wording, "starting today; I could not record all of the talk of the last 30 days", covers a backfill where a day failed or an Availability rule turned the Playbook off. The day count comes from `BACKFILL_DAYS`.
  - #205: a rewrite drops only a part that a deletion emptied. A part that was already empty still says "None". Parts a deletion emptied are kept as `leftOut` in the file's head, so a later deletion keeps them out.
  - `readMessage` refusal: it suggests asking in the channel the message was posted in, not in a DM, because a DM opens no message link.
  - MongoDB: a new step `0002-default-persona-<hash of the persona>` (`agentConfigMigrations`, last in `MONGO_MIGRATIONS`) gives a tenant whose prompt still equals an `OLD_DEFAULT_PROMPTS` entry the current persona, the same rule SQL applies on every migrate. The step id changes with the persona's text, so each new persona runs once. Covered in `mongo-migrations.test.ts`.
  - Structure: Daily log schedule sync (`DAILY_LOG_TIME`, `syncDailyLogSchedules`) and the backfill and notice (`startDailyLogs`, called from `saveGuildSettings`) moved to `apps/agent/src/discord/dailyLogDays.ts`. `syncTenantSchedules`, the one tenant-wide entry point, moved to `scheduler.ts` so `digest.ts` and the Daily log module do not import each other. One `GuildPlace` type replaces `Place` and `DailyLogPlace` keeps only the added `channelId`.
  - Shared helpers: `DAY_MS` and `addDays` (`clock.ts`); `replyObject` (`guardrails.ts`) for the JSON object in a model reply (Daily log, keywords, Minutes); `wordingsOf` with `queriesWords` (`workspace/search.ts`) for listTasks, `repoSearchWork`, `workItemList` and searchFiles. Each tool keeps its own matching rule. Words now lose punctuation at their ends in every tool, as searchFiles already did.
  - Small fixes: shorter doc comments on the scheduler's `dailyLog`, `saveGuildSettings` and `writeMissingDays`; the persona doc comments sit on `OLD_DEFAULT_PROMPTS` and `OLD_DEFAULTS` again; `MAX_DAILY_LOG_CHANNELS`; `ScheduleKind` in `syncDailyRows` and both schema bindings; the `@pachiware/db` import in the recall git and Plane test; a missing space in `gitPolicy.ts`; no `as DailyLogRun` cast in `recordText`.
  - Left for the user: #199 leaves a filed TXT or small CSV without a keyword head, and `readMessage` exists as a new tool.
- [x] User decisions on the review, 2026-10-18:
  - Filed TXT and small CSV Documents keep no keyword head. They are found by name and full text, and a head would change the file people download. Revisit only if the recall eval shows misses.
  - `readMessage` stays a new tool: no existing tool could open a message older than 24 hours. It uses `readChannelHistory`'s permission checks and the Source rules.
  - Catch-up writes only what a `daily-log` row still owes: nights the scheduler missed while the bot was down, and days whose write failed. A night the scheduler ran and found the Playbook off counts as handled and is never written later, so lifting an Availability rule does not fill the nights it covered. Backfill on turning on (30 days) is unchanged.
    - Mechanism: no new record. The row's `lastFiredAt` marks the first day still owed: the run's time when every day was handled, or the start of the first failed day. Before any run, the first day owed is the day before `nextAt`. `writeOwedDays` (`dailyLogDays.ts`) serves the nightly row and the start catch-up, so a failed day is retried by the next run or start, up to `CATCH_UP_DAYS` back.
    - Known limit: once a day fails, a later off night is written if the rule is lifted before the failed day is written, because days owed are a range from the first failed day.
    - Scenarios in `daily-log-backfill.test.ts`: two off nights stay without a Daily log after the rule is lifted while a night missed while down is written; a failed nightly day is written on the next start.
    - Verification: `bun run typecheck` exits 0; `bun run test` 1010 pass, 0 fail.
  - Verification: `bun run typecheck` exits 0. `bun run test`: 1008 pass, 0 fail. `bun run test:engines` against the compose PostgreSQL, MongoDB replica set and standalone services: 434 pass, 0 fail.

## Phase 40 — Recall in one call, sharper matching, server-rendered citations (planning, spec #207)

Planning is done; implementation follows the sub-issues of [#207](https://github.com/yhagus/pachiware/issues/207) in order. Prompted by the harness review of 2026-10-18, which scored recall 58/100: matching is substring-based with no filler words, stems or field weights; "is it done?" depends on the model calling four tools in turn; citations are only asked for in the persona.

- [x] Decided one `recall` tool over the four-tool persona procedure. It runs Kept material, Tasks, git and Plane at once and reaches only what `listTasks`, `repoSearchWork` and `workItemList` reach from the same place: the loop passes the tools usable at the place into `SkillContext`.
- [x] Decided light hand-written stemming (Indonesian particles and suffixes, English suffixes, loanword endings such as `-isasi`/`-ization`) over a dictionary stemmer such as Sastrawi; Indonesian prefixes are not stripped. Still within ADR 0013.
- [x] ADR 0014: citations are rendered by the server. Tools give refs (`K1`, `T2`, `G3`, `P4`) with labels and links; the loop renders them in the final reply, drops unknown refs, and drops links found neither in the turn's tool results nor in the conversation sent to the model, following the guardrail mode.
- [x] Spec #207 cut into 5 tickets, all sub-issues of #207 with native blocking, ready-for-agent:
  - #208 Retrieval benchmark for Kept material (no blockers)
  - #209 Shared word matching: stems, filler words, weighted fields (after #208)
  - #210 Date range and match strength on searchFiles (after #209)
  - #211 One recall call answers "was it discussed, decided, done?" (after #210)
  - #212 Citations rendered by the server, links in replies checked (after #211)
- [x] #208 Retrieval benchmark for Kept material.
  - Corpus and questions in `apps/agent/test/support/recallBenchmark.ts`: 60 Kept material files in four Public channels (#general, #audio, #marketing, #ops): Minutes, Daily logs, Decisions, Notes and Documents, some with a topics/keywords header and most without. Distractors are deliberate: long Daily logs that mention a word once, words hidden in other words ("log" in "blog", "api" in "rapid"), decisions replaced by newer ones, and topics kept in one language and asked about in the other.
  - 26 questions, each with its expected files picked by hand from the corpus: Indonesian, English and mixed wording, morphological variants, and full sentences full of filler words, each searched as a model would call `searchFiles` from #general.
  - `apps/agent/test/recall-benchmark.test.ts` runs them in one scripted turn through the Discord scenario harness and counts a question as a hit when an expected file is among the first three paths the result shows (in the order the model reads them; grouping by channel counts). It prints a table of every question and pins the hit count as `BASELINE`, which a change may only raise.
  - Baseline: 22/26. Misses: "normalisasi audio" asked in Indonesian only, the same asked as a full sentence, "siapa yang implementasi normalisasi audio", and "siapa yang pegang on-call dan kapan serah terimanya". Filler words matching inside other words pull marketing files to the top in two of them.
  - Verification: `bun run typecheck` exits 0; `bun run test` 1011 pass, 0 fail. Raising `BASELINE` to 23 fails the test.
- [x] #209 Shared word matching: stems, filler words, weighted fields.
  - `packages/skills/src/workspace/terms.ts` replaces `queryWords`/`matchFile`. Words are matched whole (Unicode letters and digits; a word with inner marks such as `inv-00042` or `2.4` is kept whole and split into its parts). Filler words (a hand-written Indonesian and English list) leave a query unless nothing else is left.
  - `stem`: Indonesian `-nya` and, with a 5-letter root left, `-lah`/`-kah`/`-pun`; loanword endings `-isasi`, `-itas`, `-asi`; an English plural; then one ending (`-ization`, `-ize`, `-ation`, `-ity`, `-ion`, `-ing`, `-ed`, `-ly`, `-kan`, `-an`, `-i`), each leaving a minimum root. "normalisasi", "normalization" and "normalize" all become "normal". Prefixes are not stripped. A query term of 4 or more letters also matches a plain word its stem starts; a word with inner marks matches only whole (otherwise "pricing.md" counted twice).
  - Scoring (`scoreOf`): BM25 over the file name (weight 3), the keyword header (the `topics`/`keywords` lines, weight 3) and the body, k1 1.2, b 0.75 on the body only, scaled by `0.5 + 0.5 × coverage` of the best-covered query; newest first breaks ties. Decided: a body shorter than 50 words counts as 50, so tiny files are not ranked up for being short and equal short files keep date order. A head field holding an object or a list (a Daily log's `log`, a Minutes record) is not searched; plain head fields (title, author) count as body.
  - The index keeps each file's words per field for its version. `searchFolder` takes terms and also returns the searched files' total body words for the length average.
  - Tasks (`listTasks`), the commit filter of `searchWork` and the Work item `queries` filter use `holdsQuery`: every term of one wording, in any form. Decided to keep that every-term rule for them rather than ranking partial matches, so a weak match never reads as "done". Task results with a query are ranked by the same score, title as the name.
  - Tool descriptions of `searchFiles`, `listTasks` and `workItemList` say how words match. The persona is unchanged.
  - Expected values changed in three existing scenarios, each for a reason the spec asks for: `task-done-across-channels` ("Normalize" now meets "normalization", so #audio's Task is found too), `sources-not-quotable` (a file named after "pricing" ranks above one holding it only in its body), and the `recall-asked-in-english` dry run (the Decision named `pengingat-tagihan` comes first; recording re-recorded).
  - New scenarios in `apps/agent/test/word-matching.test.ts`: Indonesian query against English Minutes without a header, whole words ("log" misses "blog"), a filler-word sentence, Minutes above a long Daily log, name and header weight, a Task, a commit and a Work item found across languages.
  - Benchmark: 22/26 → 26/26; `BASELINE` is now 26. Known limit seen in the benchmark: the prefix rule lets "normal" (from "normalisasi") meet "normal" in "server keadaan normal", so that Daily log ranks second for "normalisasi audio".
  - Verification: `bun run typecheck` exits 0; `bun run test` 1018 pass, 0 fail (one earlier run timed out in `availability-api.test.ts`, which passes alone and on the rerun).
- [x] #210 Date range and match strength on searchFiles.
  - `searchFiles` takes `since` and `until` (YYYY-MM-DD, both ends included). `dateRange` (`workspace/search.ts`) keeps a file by the date its name starts with, else by the day in the place's time zone it last changed; a malformed date is refused with "… is not a date: use YYYY-MM-DD". The range applies before ranking, counting and notShownHere, in the grouped search and in a search of one path.
  - `isStrong`: a match holding every term of at least one query is strong. Decided to mark only the exception, `partial: true` on a match, so results that matched well read as before; a result whose matches are all partial carries `nothingStrong: true`. An empty result stays `{ matches: [] }`. The tool description tells the model to read before relying on a partial match and to say plainly when nothing answers.
  - Scenarios in `apps/agent/test/search-range-strength.test.ts`: a month's range with files dated by name and by last change (set on disk with `utimesSync`), strong and partial marks, `nothingStrong` in one path and across channels, and the malformed-date refusal. No existing scenario changed.
  - Verification: `bun run typecheck` exits 0; `bun run test` 1022 pass, 0 fail.
- [x] #211 One recall call answers "was it discussed, decided, done?".
  - `recall` (Workspace skill, effect read) in `packages/skills/src/workspace/recall.ts`: 1 to 5 wordings in `queries` (the description asks for 2 to 5), `since`/`until` for kept material, and `channel` to narrow kept material and Tasks to one Source. Kept material comes from `rankKept` (`workspace/sources.ts`), the core `searchSources` now shares, cut at 10 files of 2 lines of 160 characters.
  - Decided: the Tasks, git and Plane parts call `listTasks` (scope anywhere), `repoSearchWork` and `workItemList` through the registry instead of moving their code into shared functions. `SkillContext.tools` (set by the loop each turn) holds the names of the tools offered at this place, after Availability rules, playbook closures and hidden tools, and `run`, which calls `skillRegistry.executeTool` with the same context. A part whose tool is not offered here, or that fails (no Git scope, no Plane scope), is named under `unavailable` with its reason; the call still succeeds. Every scope, guardrail and audit a model's own call gets applies, and neither tool's code or behaviour changed.
  - Result: `kept` (ref K, label "#channel · Kind date", url, path, lines, `partial`), `tasks` (ref T, label, task line), `work` (ref G, label, url, date), `workItems` (ref P, label), `nothingStrong`, `nothingFound` (the parts searched with no match), `unavailable`, `notShownHere` with the DM suggestion (kept files and Tasks of sources not quotable here). Refs continue across calls in one turn (counted per turn context).
  - Links are built by the server: Minutes from their head (`jumpLink(guildId, postedIn, messageId)`), a Daily log match from the first message link on its matching lines, git items from the provider's URL. Decisions, Notes, Documents and Tasks have a label only. Decided: Work items have a label only too; their web URL format could not be confirmed from Plane's docs, so none is made up.
  - Labels use ISO dates and kind names in the place's language (`keptKinds`, `taskCited`, `workCited` in `language.ts`). Each ref'd item carries its own `ref`, `label` and `url`, so #212 collects citations from the items instead of a separate map; this keeps the result short.
  - Budget: `withinBudget` keeps the serialized result under 11,000 characters (the loop cuts at 12,000), first by keeping one line per file, then by dropping the lowest-ranked item of the longest part, and says `cut`.
  - Persona: the default from #206 is frozen as `PERSONA_READ_MESSAGE` (migration list and its test). "Asking about kept material" now calls `recall` first and reads `partial`, `nothingStrong`, `nothingFound` and `unavailable`. Sources are named by recall's labels and urls. Without `recall`, the four tools are used as before, keeping the old rule for building a Minutes link.
  - Tool counts pinned in `catalogue.test.ts`, `skills-admin.test.ts` and `availability-scenarios.test.ts` now include `recall`.
  - Scenarios in `apps/agent/test/recall-tool.test.ts`: four parts in one call with refs, labels and links, and nothing outside the Git or Plane scope; Daily log and Decision citations; no scope means unavailable and no requests; an Availability rule turning `listTasks` and `repoSearchWork` off; a non-public channel counted, never named; a crowded Workspace staying under 12,000 characters, untruncated; refs not repeating across two calls.
  - Eval: the six recall dry runs answer with one `recall` call and were re-recorded. New brief `recall-among-distractors`: one MP3 bitrate Decision among 23 kept files in three channels, the Decision it replaced among them.
  - Verification: `bun run typecheck` exits 0; `bun run test` 1031 pass, 1 fail. The failure, `availability-api.test.ts`, is a 5-second timeout at a load average near 59; the file passes alone (14 pass).
- [x] #212 Citations rendered by the server, links in replies checked (ADR 0014).
  - `apps/agent/src/loop/citations.ts`: `citationsIn` collects every `{ ref, label, url? }` from the turn's tool results at any depth (refs K, T, G or P and digits). Decided: items carry their own citation, as #211 gives them, instead of a separate `citations` map; ADR 0014 says so now. `renderCitations` turns a known ref into `[label](<url>)` (angle brackets keep Discord from previewing it), or the label alone, and removes an unknown ref. `checkLinks` removes every link, masked or bare, that appears neither in the turn's raw tool results nor in any message the model was sent (system prompt, history, rolling summary, the person's turn); a masked link keeps its text.
  - `cite` in `react.ts` runs on the final reply before it is stored, so history holds the rendered links, and on the reply forced when the action budget runs out. Unknown refs are always removed and audited (`guardrail_denied`, kind `citation`, reason `unknown_ref`). Link removal follows the guardrail mode through the new `citation` kind: enforced in `enforce`, only audited (`link_not_found`, `observed: true`) in `observe` and `write`.
  - Persona: the #211 default is frozen as `PERSONA_RECALL_TOOL`. Sources are cited only by recall's refs, and the model is told never to write a link or date itself. The fallback without `recall` no longer says how to build a Minutes link: such a link would now be removed.
  - Labels are in the place's configured language (Indonesian by default), as every tool's own text is, even when the question was asked in English.
  - Eval: a new code check, `citations` (`assistantChecks.ts`), fails a reply that leaves a ref unrendered or links anything the seed does not hold (its files' text, a seeded Minutes' posted message, a seeded pull request). `action-items-across-meetings` built Minutes links from file fields, as the old persona said; its dry run now uses `recall` and refs. Three recall dry runs cite by ref; all were re-recorded and pass the check.
  - Scenarios in `apps/agent/test/citations.test.ts`: refs rendered with label and link, an unknown ref removed and audited, a made-up link removed while links from the person's message and an earlier reply stay, observe mode keeping the link with the audit row, the stored reply holding the rendered link for a follow-up, and web chat cleaning its reply the same way. `eval-assistant-checks.test.ts` checks the new check fails and passes as it should.
  - Verification: `bun run typecheck` exits 0; `bun run test` 1038 pass, 1 fail. The failure, `packages/cli/test/setup.test.ts`, is a 5-second timeout at a load average near 72; the file passes alone (12 pass).
- [x] Merged `spec/207-recall` into `main` by fast-forward (#208–#212) and pushed; #207–#212 closed.

## Phase 41 — Harness to 85+ (planning, spec #213)

Planning is done; implementation follows the sub-issues of [#213](https://github.com/yhagus/pachiware/issues/213). A re-score after spec #207 put the harness at about 78/100: recall about 80, group conversation 65, agent loop 63, eval 64. The spec targets about 86.

- [x] Decided with the user: a Profile may name a fallback Profile and fallbacks chain (at most 3 hops, cycles and other tenants refused); each bot still picks one Profile. A cut text answer is continued once, then sent with a cut-off note; a cut tool call never runs. A burst in a shared channel is answered per person, each under their own identity.
- [x] Correction to the 2026-10-18 review: Claude's docs say `tool_use` and `tool_result` blocks no longer require `tools`, and document `tool_choice` none, so the budget-exhausted turn is not rejected by Anthropic. The real costs are a cache miss (it drops `tools`) and an unstored reply; #219 fixes both.
- [x] Checked and left out: the prompt listing the tenant's tools while fewer are sent is deliberate (cached prefix, "Turned off here" names what is off).
- [x] Spec #213 cut into 12 tickets, all sub-issues of #213 with native blocking:
  - #214 The turn shows what a reply replied to (no blockers)
  - #215 A burst of several people is answered per person (after #214, same file)
  - #216 A reply or tool call cut off at max_tokens is continued or refused (no blockers)
  - #217 A Profile may name a fallback Profile, and fallbacks chain (after #216)
  - #218 History is kept within a token budget (no blockers)
  - #219 Anthropic caches the history; the budget-exhausted turn keeps its tools with tool_choice none and is stored (after #216, #218)
  - #220 A tool call that hangs gives up after 90 seconds (after #219)
  - #221 readFile reads a range of lines (no blockers)
  - #222 Retrieval benchmark v2: harder questions, top-1 and MRR (no blockers)
  - #223 Matching handles Indonesian prefixes, a bilingual work vocabulary and stem collisions (after #222)
  - #224 Work items cited with a link once Plane's web URL is confirmed (no blockers; research first)
  - #225 Run the live recall eval with a real model and record it (ready-for-human; after #214, #221, #223)
- [x] #216 Cut answers: all four request formats read a cut as `finishReason: "length"` (OpenAI and custom Chat Completions `finish_reason: "length"`, Anthropic and Messages-format `stop_reason: "max_tokens"`, Responses `status: "incomplete"` with `incomplete_details.reason: "max_output_tokens"`; field names checked against current docs), keeping any tool calls as cut. In the loop a cut tool call is refused with an error result telling the model to make it smaller, and skips the bulk-task count; a cut text answer gets one continuation request (not stored), the parts are joined, cited and stored once; a second cut adds the `outputCut` note (`language.ts`) to the reply only, not to history. Each cut is audited as `guardrail_denied` `{ kind: "limit", reason: "output_cut", part: "text" | "tool_call" }`. The scenario harness gains a `{ cut: ... }` model step. Tests: `router-hardening.test.ts` (mapping), `output-cut.test.ts` (loop).
- [x] #222 Retrieval benchmark v2: 22 new hand-labelled questions (48 in all) and 17 new files (77) in four groups, each with deliberate distractors; the 26 of v1 must all stay in the top 3. The scenario prints and pins top-1, top-3 and MRR over the first 10 shown paths (raising the pinned top-1 to 27 fails the test). The questions run in steps of 24 with the per-person tool limit (30 a minute) cleared between steps, and the rolling summary the long turn triggers is scripted.
  - Baseline: top-1 26/48, top-3 42/48, MRR@10 0.68 (v1 alone was top-3 26/26, top-1 20/26, MRR 0.87).
  - Misses (rank, or "-" when outside the first 10): prefix `dirilis` (8), `ditunda` (-); pair `rapat-meeting` (-), `export-ekspor` (-); collision `realisasi-real` (6), `lokalisasi-lokal` (-); sentence none. Weak hits at rank 2–3: prefix `diimplementasikan`, `pembayaran`; pair `anggaran-budget`, `tugas-task`, `schedule-jadwal`; collision `optimasi-optimal`, `standardisasi-standar`.
  - Full suite: 1038 pass, 1 fail (`packages/cli/test/setup.test.ts` doctor MongoDB timed out at 5 s under load; passes alone).
- [x] #221 `readFile` reads a range: `fromLine`/`toLine` (1-based, inclusive) return `lines` as `{ line, text }` (the shape `searchFiles` uses) with `fromLine`, `toLine`, `totalLines`, `version`, and `nextLine` when the range stopped early. Without a range a file over 10,000 characters returns its first whole lines as `content` with `totalLines` and `nextLine`; a smaller file returns `content` and `version` as before. The 10,000 is measured as the JSON the loop sends, so a read never reaches the loop's 12,000-character cut. A reversed range, a `fromLine` past the end, or a non-positive line is refused; a `toLine` past the end stops at the last line. The tool description tells the model to read around a matching line (20 before, 60 after); persona unchanged. Scenarios in `apps/agent/test/read-file-range.test.ts`; the large-CSV scenario in `discord-file-text.test.ts` now expects the head with `nextLine` instead of a clipped result. Verification: typecheck 0; full suite 1011 pass, 32 fail, every failure a 5 s timeout at load average ~200 (the failing API files pass alone with a 30 s timeout; none touch `readFile`).
- [x] #224 Work items cited with a link. Confirmed from Plane v1.3.1's source (makeplane/plane at tag v1.3.1): `apps/web/app/routes/core.ts` routes `:workspaceSlug/browse/:workItem` to `apps/web/app/(all)/[workspaceSlug]/(projects)/browse/[workItem]/page.tsx`, which splits `<PROJECT>-<sequence>`; `generateWorkItemLink` in `packages/utils/src/work-item/base.ts` builds `/${workspaceSlug}/browse/${projectIdentifier}-${sequenceId}/`. The web app has no basename (`apps/web/react-router.config.ts`) and the self-hosted proxy (`apps/proxy/Caddyfile.ce`) serves it at `/` beside `/api/`, so a self-hosted link is `<baseUrl>/<slug>/browse/<KEY>/` and a cloud one `https://app.plane.so/<slug>/browse/<KEY>/`. `workItemList` items and recall `P` items now carry `url` (`workItemWebUrl` in `plane/client.ts`); `recall-tool.test.ts` expects the new `url` on `P1`. Verified: typecheck 0, full suite 1040 pass; `packages/cli/test/setup.test.ts` timed out at 5 s under load and passes alone with a longer timeout.
- [x] #217 Fallback Profiles: Profiles gain a nullable `fallbackProfileId` on all three engines (`fallback_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL` in the DDL and a guarded `ADD COLUMN`; MongoDB needs no step, `toProfile` reads a missing field as null). Create and update check the tenant's chain inside a transaction (`requireFallback` in `profiles/types.ts`): another tenant's or a missing profile, the profile itself and a loop are refused with one message per case; `remove` clears it as anyone's fallback in the same transaction (explicitly, since an older SQLite file lacks the foreign key). The router (`complete`) hands a request that ends in `finishReason: "error"` to the next profile, at most three profiles per request (read as the bot's own plus two fallbacks), without images when that profile does not accept them (the reply then carries the usual rejected-image note). The `llm_tokens` row's `metadata.profileId` names the profile that answered; a fallback answer is audited as `profile_fallback` `{from, to, profiles}`. Admin API answers a refused fallback with 400; the console's Profiles form offers None or the tenant's other profiles, and a card says what it falls back to. Tests: `packages/db/test/contract/profiles.contract.test.ts` (3 new), `packages/db/test/migration.test.ts` (column added to an existing install, cleared on delete; checked to fail without the `ADD COLUMN`), `apps/agent/test/profile-fallback.test.ts` (fallback answers, A→B→C with a missing key and a 500, no fourth profile, image-less fallback, admin refusals). `bun run test:engines` passed (444 pass, SQLite, PostgreSQL and MongoDB).
- [x] #218 History kept within a token budget: `fitHistory` (`loop/history.ts`) estimates characters / 4 (an image 1,000) and keeps the stored window under 16,000 tokens. A message bigger than the whole budget is clipped to half of it with a note pointing to the earlier message (the same way every turn, so the prefix holds); over budget the window advances by whole `HISTORY_STEP`s; a window shorter than a step that is still over budget loses single rows from the front (prefix stability is given up only there). Every cut drops a leading orphan tool result. The row-based offset still drives the rolling summary, unchanged. Tests: `apps/agent/test/history-token-budget.test.ts` (three 40,000-character pastes, a clipped oversized message, the same prefix across two turns within a step, no orphan tool result at a cut; the last checked to fail without the orphan drop). `bun run test` under `--parallel` showed only 5 s timeouts; the serial run's one failure (`packages/cli/test/setup.test.ts`) passes alone.
- [x] #219 History cache and the budget-exhausted turn: on Anthropic and Messages-format BYOK a third `cache_control` breakpoint marks the last block of the last stored-history message (request option `historyEnd`, set by `react.ts`; none on a first turn), so the history is cached with tools and system; Claude's docs confirm 4 breakpoints at most. The turn that runs out of actions now keeps the same `tools` and sends `tool_choice` none (`{ type: "none" }` on Messages, `"none"` on Chat Completions and Responses); a 400 gets one retry without tools. Its reply is cited, then stored as an assistant message, so the next turn's history ends with it. A cut forced reply (#216) still goes out without the cut note. Tests: `apps/agent/test/history-cache.test.ts` (provider faked at fetch through the real router); `provider-failure.test.ts` now expects the tools kept. `bun run test`: 1,060 pass, 0 fail.
- [x] #214 The turn shows what a reply replied to: a turn item that replies to a message gets `(replying to <author>: "<text>")` before its line (`replying to you` for the bot's own), the text on one line, clipped to 500 characters with "…"; over 2,000 characters it also names `(message <id>)`. A message that cannot be fetched or has no text adds nothing. `handleMessage` fetches the reference once and shares it between routing, the Minutes check, the turn line and the replied-to images (`gatherTurnImages` takes the fetched references). In-place playbook turns keep their own path (the replied-to message is already their item). `keepAsNote` by message id now also looks in the parent channel when the turn runs in a thread, since a mention replying to a long channel message opens a thread. Scenarios in `apps/agent/test/replied-to-turn.test.ts`; `discord-images.test.ts` expects the new line. Typecheck clean; full suite run serially with a 60 s timeout (load average about 140 from parallel agents): everything passes; the 5 s parallel run timed out in many unrelated files that pass alone.
- [x] #215 A burst is answered per person: the shared-channel burst key (`client.ts`) now includes the author, so each person's messages within 2.5 s form their own turn, run with that person's identity, member permissions and Write confirmations; turns of one conversation still run one at a time through `serialize`, in the order their bursts closed. One person's several quick messages are still one turn. The scenario harness's `burst` takes entries with their own `author`. Scenarios in `apps/agent/test/discord-burst-per-person.test.ts` (both failed before the change: Alice's pin ran with Bob's Manage Messages in one turn). Typecheck 0; full suite 1060 pass, 0 fail.
- [x] #220 A hung tool call gives up: each tool call (`react.ts`, `toolPolicy.timeoutMs`, 90 s) races its ceiling; on timeout the model gets `toolTimedOut` (`language.ts`, en and id: no answer in time, a change may or may not have happened, check before retrying), the turn goes on, the late result is dropped, and `guardrail_denied` `{ kind: "limit", reason: "tool_timeout", tool }` is audited. Nested calls through `SkillContext.tools.run` (recall) get the same ceiling; decision: the call running them is given until each nested ceiling has passed (plus 10%), so a hung part shows under recall's `unavailable` with the timeout reason instead of the whole recall timing out. `failureReply` lists a timed-out write under `uncertainBeforeFailure`, not as done. Scenarios in `apps/agent/test/tool-timeout.test.ts` (the nested case checked to fail without the extension). Typecheck 0; full suite 1067 pass, 5 fail, all 5 s timeouts under load (`profiles-anthropic`, `guardrails`, `availability-api`, `commit-msg-hook`, `setup`) that pass alone.
- [x] #223 Matching handles Indonesian prefixes, a bilingual work vocabulary and stem collisions (`terms.ts`, new `vocabulary.ts`, ADR 0015). A prefixed word (`di-`, `ter-`, `ber-`, `meng-` … `se-`, root at least 4 letters) gets a half-weight secondary reading, matched whole only; an Indonesian suffix may uncover a loanword ending ("implementasikan" → "implement"). About 140 Indonesian–English groups make a term match its counterparts at full weight. A base word meeting a derived one weighs a quarter; verb forms ("implemented", "-kan") never count as base, so "implementasi" still fully meets "implemented". Coverage counts a term by its best match's strength, so a file holding a query's words only weakly no longer counts as fully covering it. `searchFiles` description names the prefix and vocabulary matching. Scenarios in `word-matching.test.ts` ("diimplementasikan", "kapan rilis 2.4?", "normalisasi audio" against "server keadaan normal"); every existing matching, sources and recall scenario passes unchanged, "log" still misses "blog".
  - Benchmark before → after (same run conditions): top-1 26 → 41/48, top-3 42 → 48/48, MRR@10 0.68 → 0.93; pinned. By group (top-1, top-3): v1 19 → 21, 26 → 26; prefix 1 → 4, 3 → 5; pair 1 → 6, 4 → 6; collision 1 → 5, 3 → 5; sentence 4 → 5, 6 → 6. Still at rank 2: four normalisasi questions (the superseding 2026-10-02 loudness decision, whose keywords say "normalisasi audio", ranks first), `release-date-id`, `release-why` (a Daily log first), `pembayaran`.
  - Verified: typecheck 0, full suite 1048 pass, 0 fail.
- [x] Code review fixes (spec #213): the token budget now moves the window offset (`historyWindow` in `loop/history.ts`, shared by `react.ts` and `rollSummary`), so rows it leaves out reach the rolling summary instead of vanishing; a 400 to a request with `toolChoice` is retried without tools by the router on the same Profile before falling back (the retry left `react.ts`); `readFile` refuses a `toLine` past the end; a call running nested calls (recall) is never extended past twice the tool ceiling from its start; `toolPolicy` in `react.ts` renamed `toolTimeout` (`.ms`) and restored after each `tool-timeout.test.ts` scenario; refused fallbacks throw `FallbackRefused` (exported from `@pachiware/db`) and the admin route checks the class instead of re-typed messages; profile repos' `chain` renamed `tenantFallbacks`, the redundant create guard dropped; `docs/agents/database-engines.md` names the `fallback_profile_id` `ADD COLUMN`. Tests: `history-token-budget.test.ts` (a budget-dropped row reaches the summary request; the older scenarios script the summary calls the budget now triggers), `profile-fallback.test.ts` (two-Profile chain, first answers 400 to tool_choice then without tools; fallback never called), `tool-timeout.test.ts` (three sequential hung nested calls cut at 2× the ceiling), `read-file-range.test.ts` (literal `nextLine` 147 and entry texts; `toLine` past the end refused); each new one failed first. Typecheck 0; full suite 1083 pass, 3 fail, all 5 s timeouts under load (`guardrails`, `availability-api`, `commit-msg-hook`) that pass alone.
- [x] Spec #213 merged: `spec/213-harness` fast-forwarded into `main` and pushed; #214–#224 closed. Final run on the integration tip: typecheck 0, full suite 1086 pass, 0 fail. During the build, parallel implementers pushed load past 100 and many scenarios timed out at 5 s; each passed alone. #225 (live eval) stays open for a person with keys, and #213 stays open until it lands.
- [x] Independent re-score after the merge (2026-10-18), read from code only because no live run exists yet: about 69/100 for a group admin and PM assistant. By area: capture 68, recall and answers 79, tasks, reminders and PM 62, group behaviour 78, loop 72, eval and observability 45. Findings to triage, none filed yet:
  - `walkTasks` (`builtin/taskFile.ts`) counts every `.md` under a channel folder toward its 500 cap, and `daily-logs/`, `decisions/`, `files/`, `minutes/` and `notes/` sort before `tasks/`, so tasks drop out of lists, the turn context and the Digest once a channel holds about 500 kept files. `daily-logs/<day>.md` is flat, so after about 500 days `store.list` throws on that folder (`MAX_LIST_ENTRIES`) and every task walk of the channel fails.
  - The minutes playbook's only trigger word is `minutes`; "@bot notulen" does not start it. A mention in a channel reads the last 3 hours only.
  - `reply()` in `discord/client.ts` catches every turn failure without logging or auditing it; Daily log failures reach only `console.error`.
  - With git and Plane on, every model call carries about 33k tokens of tool schemas (git 93 tools, about 13.5k; Plane 66, about 12.2k). Git hides no tools where no Git scope applies.
  - `forgetDeleted` returns early when `runtime.guildIds` is empty, which elsewhere means every guild, so deletions never leave Daily logs for such a bot.
  - Three failed posts end a repeating Reminder or Digest for good, retried on consecutive minutes, and nobody is told (`scheduler.ts` `failed`).
  - Eval: all 28 recordings are scripted, the judge is uncalibrated (#49), 3 of 26 assistant briefs are Indonesian, and the bilingual vocabulary is gated only by the benchmark whose misses it fixed (no held-out questions).

## Phase 42 — The Rapor and a sturdy floor (planning, spec #226)

Planning is done; implementation follows the sub-issues of [#226](https://github.com/yhagus/pachiware/issues/226). Prompted by the 2026-10-18 re-score of about 69 (Phase 41): the score stays in the 60s and 70s because it is an opinion read from code, with no live run behind it; because the work went to recall while eval, Tasks and capture held the score down; and because of time bombs and silent failures.

- [x] Decided with the user (2026-10-18):
  - The Rapor, a fixed live exam, becomes the harness score. It runs against DeepSeek (BYOK, the tenants' daily model), judged by a model of another vendor, with three trials a brief.
  - Daily logs stay off by default; admins are told where they are off.
  - A Nudge, opt-in per channel by an admin, pings the Assignee the day before a due date and when a task is late. It is a new concept beside the Reminder, built in the next spec; its brief is in the exam now and expected to fail.
  - Scope of this spec: the Rapor and the floor fixes. Tasks from Minutes action items, Nudges and weekly reports come next.
- [x] Found while planning: a reply to posted Minutes always goes to `correctMinutes`, so "@bot jadikan task poin 2" from the requester is treated as a correction. Left for the next spec (Tasks from Minutes).
- [x] Spec #226 cut into 14 tickets, all sub-issues of #226 with native blocking:
  - #227 Tasks are read only from tasks/ folders (no blockers)
  - #228 Daily logs are kept in monthly folders (no blockers)
  - #229 A failed turn and a failed Daily log are audited and logged (no blockers)
  - #230 The scheduler backs off and never ends a repeating Reminder or Digest for good (no blockers)
  - #231 "@bot notulen" starts the minutes playbook (no blockers)
  - #232 Git and Plane tools are offered only where a scope applies (no blockers)
  - #233 Recall names channels without Daily logs when it finds nothing (no blockers)
  - #234 Small correctness fixes: deleted messages, Reminder dates, Minutes dates, withTasks (no blockers)
  - #235 The eval scores per area and as one weighted Rapor number (no blockers)
  - #236 A brief can start from a channel's talk, and any member can speak a turn (no blockers)
  - #237 A brief can have a Daily log written from its seeded talk before it asks (after #236)
  - #238 Human grades are kept beside the rubric, and rejudging prints agreement (no blockers)
  - #239 The Rapor exam: about 30 briefs across five areas, with holdouts (after #235, #236, #237)
  - #240 Run the Rapor live before and after the floor fixes, and record both (ready-for-human; after #239; supersedes #225)
- [x] #227 Tasks are read only from tasks/ folders. `walkTasks` (`builtin/taskFile.ts`) walks the tasks/ folders it is given with `store.files` (no entry cap), and `loadTasks`, `viewableProjects` and Personal tasks pass `<root>/tasks`. Before, it walked whole channel folders and stopped at 500 Markdown files, so kept material (sorted before tasks/) pushed Tasks out, and a folder of more than 500 entries made every task walk throw. Decided: no cap on task files. A tasks/ folder of 520 completed Tasks would also have thrown, and completed Tasks stay on record. Known limit (ponytail): every task file's frontmatter is read per call. Scenarios in `tasks-folder-only.test.ts` (600 Notes plus 501 flat Daily logs; 520 completed Tasks), both failed first.
- [x] #228 Daily logs in monthly folders: `dailyLogPath` is `daily-logs/<yyyy-mm>/<day>.md`. The already-written check and `forgetDeletedMessage` also read the old flat path, so nothing moves. The scenario harness gains `workspace.files()` and `workspace.remove()`. Daily log tests now expect the monthly path. Scenarios in `daily-log-monthly.test.ts` (recall finds a monthly log with its date and link; a flat day is not rewritten and still loses a deleted message), both failed first.
- [x] #229 Failures audited: new audit events `turn_failed` (Discord reply's catch) and `daily_log_failed` (`writeDays`). Each carries the channel, the error's name and its redacted message clipped to 200 characters (`failureOf` in `guardrails.ts`), plus one `console.error` line with tenant, bot and channel ids, never the person's message. Scenarios in `failure-audit.test.ts`, with a planted `sk-` secret, failed first.
- [x] #230 Scheduler retries: retries wait until 1, 6 and 36 minutes past the due time (`RETRY_AFTER_MS`, `retryDelay` in `schedule.ts`; `MAX_POST_ATTEMPTS` is now 4). Decided: `nextAt` keeps the due time and the wait counts from it, because Schedule has no updated time and the late note must name the real due time. No schema change. After the fourth failure a repeating row moves to its next time with the error kept; a one-off ends. The old "retried next tick, done after three" scenario was rewritten. Weekly Reminder and Digest scenarios failed first.
- [x] #231 `notulen` is a trigger word of the minutes playbook beside `minutes`. Built-ins are read from the package unless a tenant overrides them, so existing tenants get it. Scenario in `minutes.test.ts` and a catalogue test, both failed first.
- [x] #232 Tools by scope: the git skill hides every tool that needs an account where `loadGitAccess` finds none (also in DMs and web chat, where it throws). `gitAccounts` and `writePlaybookDocument` stay offered: the latter keeps playbook documents in the Workspace without a repository, ADR 0007, which the first try broke and two playbook scenarios caught. Plane hides everything but `planeAccounts` where no Plane scope opens an account.
  - New `SkillModule.hiddenReason`: a hidden tool called anyway is refused with why (`GIT_NOT_ENABLED`, `PLANE_NOT_ENABLED`, or needing the whole Plane workspace), not "Tool is disabled or unavailable here". Recall's `unavailable` gives the same reasons, so `recall-tool.test.ts` is unchanged. `plane-danger-tools.test.ts` now expects the whole-workspace reason.
  - Measured: tool schemas per call 33.2k tokens with git and Plane on, about 7.9k in a channel without scopes.
  - Scenarios in `tools-offered-by-scope.test.ts`.
- [x] #233 When no kept file answers (`kept` empty or `nothingStrong`), recall adds `notLogged`: the quotable channel sources searched that hold no file under `daily-logs/`. A non-quotable source is never named. Persona line added; the #212 default is frozen as `PERSONA_SERVER_CITATIONS` (migration list and its verbatim copy in `persona-migration.test.ts`, indices 16→17). The console's Daily log section explains that talk in channels without Daily logs cannot be found after a day. Scenarios in `recall-tool.test.ts`.
- [x] #234 Small fixes:
  - `forgetDeleted` treats an empty guild list as every guild.
  - `parseWhen` refuses days and times that do not exist (`2026-02-30T09:00`, `25:00`, `09:75`).
  - Minutes files are named by the date in the place's zone (`MinutesRun.timezone`). The minutes tests that named today's file by the UTC date now use Jakarta's, which would otherwise fail between 17:00 and 24:00 UTC.
  - `withTasks` describes what the code does.
  - Known limit: `until` on a repeating Reminder still rolls an impossible date over.
- Verification (floor tickets): typecheck 0. Every touched file passes alone. A `--parallel` run of the eval and recall files beside the eval implementer's worktree failed with `ENFILE` (system file table full), and those files pass alone.
- [x] #235–#238 built by one implementer on a worktree branch, merged into `spec/226-rapor` (0fc41f2):
  - #235 (be2314e): `area` on every brief, `scorecard.yaml` with `loadExam`, and per-area plus weighted Rapor scores in `compare.ts`, so `report.md` opens with `Rapor v<version>: <total>`. Hand-computed test: 41.25/80 = 51.6 with group empty.
  - #236 (2f048a7): `seed.messages` (the channel's talk before the brief) and `@Member:` follow-ups (`@a+@b:` for a burst). New checks `cites` and `kept`. Briefs `minutes-from-talk` and `member-joins-thread`.
  - #237 (07891f1): `then.dailyLog` writes a day's Daily log from seeded talk with the profile under test. Brief `daily-log-from-talk`.
  - #238 (8b2d3b5): `calibration/<rubric>.yaml` for human grades. `rejudge` prints agreement overall and per criterion and writes `agreement.md`; the rubric freezes at 1.0 at 90% or more on 20 or more items.
  - After the merge, two Plane scenarios that pinned the generic hidden-tool refusal were updated for #232's reasons.
- [x] #239 The exam: `scorecard.yaml` version 2 holds 30 briefs, 22 in Indonesian, at least 4 per area (capture 5, recall 9, tasks 8, group 4, loop 4), and 6 held out. 16 new Indonesian briefs, with dry runs in `eval-rapor-dry-run.test.ts` and recordings. Briefs left out of the exam still run as regressions.
  - Harness additions:
    - Turn facts `quiet` (the bot must post nothing; graded by code alone, no judge call) and `reaction`. Recordings carry `reactions`.
    - `@bot` in follow-ups sends a mention; a block starting with it is Alice's.
    - `closedAt` on seeded pull requests.
    - `kept` covers the Notes and Decisions the bot wrote.
  - Decided: no brief is marked expected to fail. `notulen-jadi-tugas` and `colek-h-1` measure work the next spec builds (Tasks from Minutes, a Nudge that follows the due date), and today a model can pass them only by doing that work by hand. The exam measures outcomes, not mechanisms.
  - Found while writing the exam, for triage:
    - "@bot notulen dong" does not start the playbook. The trigger needs the word alone or a colon after it (`TRIGGER`, `WORD_ONLY` in `client.ts`).
    - `remember` without `level` stores nothing.
    - In a burst, a line that mentions the bot is answered before an earlier line that does not, since the latter waits on a look at whether the bot spoke last.
  - Verification: typecheck 0; `bun run test` 1159 pass, 0 fail.
- [x] Spec #226 merged: `spec/226-rapor` fast-forwarded into `main` and pushed with `--no-verify`, chosen by the user: the pre-push run failed only on the known 5 s timeout of the CLI doctor MongoDB scenario at load about 68, which passes alone, while the full suite at low load was 1159 pass, 0 fail. #227–#239 closed with their commits. #226 stays open until #240 lands.
- [x] #240 First live Rapor (2026-10-18). The user holds only a DeepSeek key, so the judge is Claude Opus 5.5 in Claude Code, a vendor outside the compared profile, judging offline.
  - Harness added on `rapor-offline-judge`:
    - `EVAL_JUDGE_PROVIDER=offline` and `offline-judge.ts` (`prompts` writes the HTTP judge's questions word for word, each once, leaving out those that cannot change a verdict; `grade` refuses answers that leave one out and regrades through `rejudge`). c19e867.
    - `EVAL_EXAM=1`.
    - `rejudge` reruns code checks from the recorded output against current facts. 450fd11.
  - Setup:
    - Profile `deepseek-flash` (DeepSeek-V4.1-Flash, `custom`, `https://api.deepseek.com/v1`), checked against the account's `/models`.
    - `EVAL_TRIALS=3` over the 30 exam briefs.
    - The baseline ran in a temporary worktree with the sources of 80c8faf (before #226) and the eval of this branch. The other run was on the current bot.
    - Run folders (gitignored): `apps/agent/eval/results/rapor-baseline-20261018-2235/` and `rapor-after-20261018-2235/`, each graded into `rejudged-0.2/`. A run took about a minute. About 45k prompt and 0.8k completion tokens per trial, 1.8 s per model call. No price was given, so no cost.
  - Judging was blind: 728 questions of both runs, mixed and shuffled with no run named, answered by 7 subagents; then 116 changed or new ones by 2 more. 654 answers were carried where only the rubric line's version differed. Every answer file passed a validator.
  - Exam defects found by the run and fixed before grading, both runs graded the same way:
    - minutes-as-document asked for a file name, which citations never show.
    - notulen-pemilik-tenggat asked for one of two valid sources.
    - 13 must-cover facts in 12 briefs were cut short by an unquoted " #" (a YAML comment); the loader now refuses that. bc37dbf.
    - The judge's state said a Reminder pings only its mentions; it pings its owner too. Rubric 0.2, 569789e.
    - Scorecard v3.
  - **Rapor v3, rubric 0.2: baseline 65.1, current 76.5 (+11.4).**

    | Area | Weight | Baseline | Current |
    |---|---|---|---|
    | capture | 20 | 33.3 | 73.3 |
    | recall | 25 | 70.4 | 77.8 |
    | tasks | 20 | 72.9 | 81.3 |
    | group | 10 | 80.6 | 72.2 |
    | loop | 15 | 77.8 | 75.0 |

    - Holdout scores, current: capture 100, recall 83.3, tasks 100, group 100, loop 0 (its one holdout, `tiga-alat-sekaligus`).
    - Trial score 0.67 → 0.77, pass^3 47% → 60%, coverage 0.77 → 0.88, question rate 77% → 87%.
    - Group and loop moved within the noise of 3 trials over 4 briefs each.
  - What #226 moved, per brief (baseline → current): `minutes-from-talk`, `notulen-pemilik-tenggat` and `notulen-jadi-tugas` 0 → 1 ("notulen", #231); `channel-tanpa-daily-log` 0 → 0.67 (`notLogged`, #233); `nothing-found`, `private-channel-dm` and `recall-done-pull-request` up to 1.
  - Still failing, filed needs-triage:
    - #241 bulk task changes never unlock when the model lists them first (`bulk-cancel` 0).
    - #242 citations: a Daily log cites the wrong message, pull requests and Documents carry no useful date, ref tags leak (`daily-log-from-talk` 0, `sudah-diimplementasi-pr-ditutup` 0, `minutes-as-document` 0.67).
    - #243 an explicit "ingat ya" is never confirmed, and `remember` without `level` stores nothing (`tiga-alat-sekaligus` 0).
    - #244 in a burst a member's question goes unanswered (`dua-orang-bersamaan` 0.33, `member-joins-thread` 0.56).
    - #245 "@bot notulen dong", and "jadikan task" on Minutes read as a correction.
  - Known limits:
    - The rubric is uncalibrated (#49): no person has graded yet, and the judge is one model family.
    - Questions the code checks made moot grade unknown, so the question rate counts them as not answered.
    - The judges read Minutes and Decision details as outside "tasks, Memory, files or Reminders" when asked whether every statement is supported.
    - Two judges counted a trailing offer after acting ("mau saya buatkan task?") as asking; a calibration item for #49.
    - The baseline worktree and its folder are scratch and not kept.
  - Merged: `rapor-offline-judge` fast-forwarded into `main` and pushed with `--no-verify`, chosen by the user. Two Apple Virtualization VMs (Docker Desktop's among them) held about 94k of the system's 122,880 file handles, so the parallel suite hit `ENFILE`. The tests that failed pass alone, and the branch changes no product code. #240, #225 and #226 closed.
- [x] Suite parallelism: `bun run test` runs on 4 workers (`--parallel=4`), not one per core. Measured on this Mac (11 cores), two full runs each:
  - 11 workers (the default): 46–58 s, 119 and 19 failures, almost all `ENFILE`.
  - 6 workers: 45–50 s, 0 and 1 failure (a 5 s timeout).
  - 4 workers: 62–66 s, 0 and 0.
  - 2 workers: 66–72 s, 0 and 0.
  Each scenario spawns its own bun subprocess, so a worker per core only adds contention, and with Docker's VMs holding about 94k file handles the system table runs out. CI's runners have 4 cores, so CI runs as before. Through the script: 1164 pass, 0 fail in 55 s.
- [x] The first push through the 4-worker hook (2026-10-19, 00:06 in Jakarta) caught `private-thread-folder.test.ts` expecting today's Minutes under the UTC date. #234 names them by the date in the place's zone, and that scenario was missed when the minutes tests were updated, so it failed every day from 17:00 to 24:00 UTC. Fixed in 0d73ca9. Two full runs, then the hook: 1164 pass, 0 fail each, and `main` was pushed without `--no-verify`.


## Phase 43 — Rapor fixes (#241–#245)

The five tickets the first live Rapor (#240, 76.5) filed. Together they cover every exam brief that scored below 1, except `channel-tanpa-daily-log` (0.67). Ranked by impact with the user (2026-10-19), from the upper bound of each fix (area weight × brief gain / briefs in the area / 90): #242 about +9.0, #243 +4.2 (held-out brief), #244 +3.1, #241 +2.8, #245 not yet scored. Built on `fix/rapor-241-245`.

- [x] Decided with the user (2026-10-19), recorded on the issues:
  - #241: the persona has the model make a bulk's calls straight away. The guard's `confirmation_required` lists them for one yes, and the guard stays the only matcher of a batch.
  - #244: within a burst, a line after the bot's last reply follows it, even when another person's line landed in between.
- [x] #242 Citations (77d0902, 8bf3e34):
  - `renderCitations` renders a bracket of several refs (`[K2/K1]`, `[K1, G1]`, `[K2 dan K9]`). It drops a bracket that holds the model's own words beside a ref (`[K1 was only a pricing decision]`) whole, and leaves a Markdown link's text and ref-less brackets alone.
  - A Daily log is cited by the newest message of its first matching decision, open point or next step. A topic row, which links every message of its topic, is used only when nothing else matched, and is cited by its first message. Discord ids grow with time, so the newest is the largest.
  - A merged, closed or committed git item's label carries that day in the place's zone (`(merged 2026-10-09)`). An open one carries none, since its date is only its last update.
  - A Document whose name holds no date is labelled with the date its first line gives (`titleDate` in `workspace/search.ts`: `6 October 2026`, `2 Oktober 2026`, `March 3, 2026`, `2026-09-28`; a day that does not exist gives none). Without one, the label says it is the filing day (`Document, filed 2026-10-18` / `Dokumen, disimpan …`).
  - Scenarios in `recall-tool.test.ts` (each failed first) and `citations.test.ts`. Unit tests in `packages/skills/test/title-date.test.ts`. Three dry-run recordings re-recorded; `minutes-as-document`'s label went from `Dokumen 2026-10-18` to `Dokumen 2026-10-06`.
- [x] #243 Memory (e84d69e):
  - `remember` and `forget` without `level` act on the channel's Memory; `level` is no longer required in their schemas.
  - The persona's Memory line keeps what the bot keeps on its own quiet, and calls an asked-for remember ("ingat ya") a clear request, said in the one line. The remember tool description says the same.
  - The previous default is frozen as `PERSONA_NOT_LOGGED` (migration list and its verbatim copy in `persona-migration.test.ts`, indices 17→18).
  - Tuned against a new regression brief, `ingat-ya-dikonfirmasi` (a Task beside an "ingat ya", outside the exam), never the held-out `tiga-alat-sekaligus`.
- [x] #244 Burst (40605be):
  - `followsBot` (`client.ts`) looks back up to ten messages. People's lines posted within the burst window of each other do not hide the bot's reply they all came after.
  - The eval showed a second cause: in `dua-orang-bersamaan`, Bob's line did reach the model (5 model calls in every trial), after Alice's turn and its answer, marked "Addresses you: no", and the model stayed silent in 2 of 3 trials. Such a line now reads "Addresses you: no, but it follows your last reply". The quiet rules say it carries on the conversation and is left alone only when it plainly speaks to someone else.
  - `member-joins-thread`'s dry run scripts the silence for Alice's "oke Bob, makasih", which now reaches the model in the same burst.
  - The old isolation test's fake `messages.fetch` now returns a Map, as discord.js's Collection is one.
- [x] #241 Bulk (816c75e): the persona's bulk line now has the model make the calls first, then list them and wait for a yes; the same calls then go through. Test in `persona.test.ts`.
- [x] #245 Minutes (d170064):
  - A short request (six words at most) that is only Indonesian or English request words around one word ("notulen dong", "tolong bikinin notulen ya!") names that word (`requestedWord`, `routing.ts`). It starts the playbook only when it is in-place; a thread playbook still needs points after a colon. A question naming notulen still goes to the assistant.
  - The correction prompt answers `{"notACorrection": true}` for a requester's reply that asks for something else ("jadikan task poin 2"). The Minutes are left untouched and the reply goes to the assistant.
  - A replied-to message posted as embeds alone, like Minutes, is quoted in the turn by their titles and descriptions. Only long content names the message for keepAsNote.
  - Making Tasks from Minutes action items stays with the next spec.
- Verification:
  - typecheck 0 at every commit.
  - Every new scenario failed before its fix.
  - Full suite at load average 35–44 (Docker's VM at about 240% CPU): 1177 pass, 4 fail. The failures were 5 s timeouts in `setup.test.ts`, `router-hardening.test.ts` and `workspace.test.ts`, and each file passes alone (30 s timeout).
- [x] Merged: `fix/rapor-241-245` fast-forwarded into `main` and pushed with `--no-verify`, chosen by the user: three pre-push runs at load average 25–39 each failed only on 5 s timeouts (1, 4 and 5 of them, in different files each time), and every file that failed passes alone. #241–#245 closed with their commits; GitHub closed #241 itself from the words "fixes #241" in b0c32ff's subject.
- [x] Second live Rapor (2026-10-19): `EVAL_EXAM=1 EVAL_TRIALS=3`, profile `deepseek-flash`, judged blind and offline by Claude in this session, as the user chose.
  - The first run, on 8738fc1, was kept for its code checks only (`rapor-phase43-interim-20261019-0224/`). `daily-log-from-talk` still cited the question in all three trials. `keptSource` chose among a match's three shown lines, and in a real Daily log those are the head's Topics and Keywords lines and the topic row. Fixed in cac5663: every row of the log's body is weighed against the query words. The #242 scenario now has a realistic head and failed first. The exam then ran again on cac5663 (`rapor-phase43-20261019-0227/`).
  - Code-check failures went from 25 to 2: `member-joins-thread` trial 1 kept no Progress note, and `tanpa-link-karangan` trial 2 answered in English.
  - Judging:
    - 460 questions (450 from the exam, 10 from the regression brief) were shuffled with no run named and split into five batches of 92. Five Claude Opus 5.5 subagents answered them, and every answer file passed a validator: 456 yes, 4 no.
    - Two "no" verdicts on `pdf-ditanya-kemudian` (trials 1 and 2, turn 2: "the contract starts 1 November 2026" is not supported) were reconciled to yes. The same brief's trial 3 and the previous Rapor both read the start date as a detail of the contract, and the PDF says it.
  - Calibration of the new judges: 37 questions of the previous Rapor (its 14 no, 3 unknown and 20 sampled yes) were answered blind by a sixth subagent.
    - Agreement 86%: 12 of the 14 no stayed no.
    - The two that flipped are the trailing offer after acting already noted for #49, now read as acting. Read that way, the previous run would score about 2 points higher, about 78.5.
  - **Rapor v3, rubric 0.2: 95.5** (76.5 before Phase 43). pass^3 90%, coverage 0.97, question rate 98%.

    | Area | Weight | Before | Now | Holdout now |
    |---|---|---|---|---|
    | capture | 20 | 73.3 | 100.0 | 100.0 |
    | recall | 25 | 77.8 | 100.0 | 100.0 |
    | tasks | 20 | 81.3 | 87.5 | 100.0 |
    | group | 10 | 72.2 | 97.2 | 100.0 |
    | loop | 15 | 75.0 | 91.7 | 100.0 |

  - Per brief, before → now: `daily-log-from-talk` 0 → 1, `sudah-diimplementasi-pr-ditutup` 0 → 1, `minutes-as-document` 0.67 → 1, `channel-tanpa-daily-log` 0.67 → 1, `tiga-alat-sekaligus` (held out) 0 → 1, `dua-orang-bersamaan` 0.33 → 1, `member-joins-thread` 0.56 → 0.89. Below 1 now: `tanpa-link-karangan` 0.67 and `bulk-cancel` 0.
  - `bulk-cancel` 0.00:
    - The bot now cancels all four tasks after one yes, and its code checks pass in every trial.
    - The must-cover fact "All four of Bob's tasks are cancelled; Confirm the venue, Alice's, is still pending" was read as unmet in all three trials, because no reply names Alice's untouched task. At 1 of 2 facts, every turn fails. Trial 1 also asked an extra question in turn 1.
    - Exam defect: the venue's state is already a code check, and the persona has the bot say only what changed. With the fact cut to the cancellation, `bulk-cancel` would score 0.83 and the Rapor about 97.8. Left to the user, since the fix bumps the scorecard to v4.
  - Exam defect: the recorded state lists files, not their text, so a claim about what a Document says cannot be checked.
  - The regression brief `ingat-ya-dikonfirmasi` (#243) scored 1.00: all three trials said the line was kept.
  - Run folders (gitignored): `rapor-phase43-20261019-0227/` and `regression-ingat-ya-20261019-0228/`, each graded into `rejudged-0.2/`. About 44k prompt and 0.7k completion tokens a trial, 1.6 s a model call.


## Phase 44 — Harness fixes (#144, #246–#256)

The issues filed from the harness review after Phase 43, plus #144. Asked by the user on 2026-10-19 ("bisa langsung kerjakan semua?"). Built on `feat/review-246-256`, one commit per issue.

- [x] Decided while building (the open questions on the issues):
  - A task's Due date still never creates a Reminder (Glossary); that idea from the review is left out.
  - #255: a turn is refused only when it is nothing but a rule-rewriting attempt (every phrase unquoted, fewer than three topical words left without the phrases and speaker names). Anything else runs with the phrases named as data in the turn's context.
  - #256: the member id goes into the stored turn line as a mention (`Alice (<@id>): …`), so the model can pass it to assignTask. The bot's own lines carry none.
- [x] #144 Refusals (58c11d7): confirmWrite's Trusted-only, no-confirmer and duplicate refusals, the two brief refusals, and the loop's empty-answer and action-budget fallbacks come from `textIn`. Instructions to the model (`Only the brief's author…`, `bulkMessage`) and argument errors stay English, as the issue says.
- [x] #254 Turn deadline (801e622): `TURN_DEADLINE_SECONDS` (default 180). Past it no model call, retry, fallback Profile or tool call starts; the request in flight is cut at the deadline; the turn ends with the action-budget summary (30 s of its own), audited with `source: "deadline"`. Discord's `|| 12` is gone: Discord, web chat and the loop share `DEFAULT_REACT_ITERATIONS` (32) from `@pachiware/db`.
- [x] #255 Quoted injection (eb212b5): `injectionPhrases`, `onlyInjection` in `guardrails.ts`; audited as `prompt_injection_detected` with `quoted: true`.
- [x] #256 Speaker ids (36270ae): `speakerTurn` and `replyLine` carry `<@id>`. The persona's Assignees line says to pass a speaker's mention. The previous default is frozen as `PERSONA_REMEMBER_ASKED` (migration indices 18→19); later persona changes in this phase edit the default only.
- [x] #251 Administration off by default (504dd64): a tool policy may say `defaultOff`; such a tool is off at the tenant until a tenant `on` rule (ADR 0005 updated, Glossary's Availability rule too). Off: git Repo admin and Org groups, CI variables/secrets/runners/packages/schedules, snippets, writing the default branch; Plane project and workspace admin. 45 of 190 tools; schemas with every skill on went from about 32.6k to 25.6k tokens (chars/4). Code writes and pull request management stay on: the code-review, pr and triage playbooks use them. The console switches each with a tenant `on` rule; the harness has `s.adminTools()`.
- [x] #253 Tasks from Minutes (23f59cc):
  - `tasksFromMinutes` (tool) and a reply to posted Minutes that asks for tasks (`asksForTasks`: a verb of making before "task"/"tugas", so "poin 2 itu task Bob" stays a correction) make Tasks of the chosen action items with no model turn. Numbers count as the embed shows them.
  - The person named becomes the Assignee when the name fits one member who can view the channel; otherwise the task is unassigned and the reply says why. A due date in words becomes a day by `dueFromWords` (`packages/skills/src/dueWords.ts`), counted from the discussion's day; words naming no single day ("minggu depan") stay in the description.
  - A task keeps `madeFrom` (`{ label, link, path, item }`; "source" is the Glossary's word for a place), so one action item never makes two tasks; recall shows it.
  - Decided: the reply's language is the request's, else the place's when the request has no function word ("jadikan task semua").
- [x] #250 Tasks and Assignees (23f59cc, 3e97a26):
  - `change()` writes a `## History` line per field change (`- 2026-10-19 10:05 Alice: status pending → completed`) and stamps `completedAt`, cleared when the task opens again. showTask shows both; recall's task label carries the completion day.
  - A member someone else gives a task to is pinged once per turn, one message listing their tasks; the asker and the bot never are. In a private thread the ping goes to the parent channel, since a mention would add them to the thread. Decided: on by default, with no setting; the eval keeps these pings apart from replies (`assigned` on a turn).
  - `taskSummary`: per project, pending, in progress, late, due within a week, completed in the last week, and open tasks per Assignee.
  - The next Minutes of a place get the previous Minutes' open points; the model lists the ones it settled, and the rest are shown again, dated, unnumbered after the action items (`carried`), and survive corrections.
  - `editReminder`: the owner moves the next post (snooze) or rewords it; the schedule repository's `update` takes `text` on every engine (contract test).
  - A weekly report is a persona line (taskSummary, late tasks, one recall since the week's start), not a playbook: a new built-in playbook changes every guild's slash commands.
  - Not built: recurring tasks, and a time zone per person beyond the roster (#249).
- [x] #248 Repository documentation mirror, built by a subagent on `feat/docs-mirror-248` and cherry-picked (437fdc2..d87434a, 4edd4ff):
  - A guild setting `docSources` (`{ channelId, repo, account?, paths }`, every engine) picks per channel a repository and path patterns. Matching text files of the default branch are mirrored under `files/docs/<owner>/<repo>/` as Documents, so recall finds them unchanged; a hidden `.mirror.json` keeps blob shas, so a refresh reads only what changed and deletes what left upstream. At most 200 files a source; over 256 KB or too deep is skipped and listed.
  - The channel's Git scope decides: saving a source it does not allow is a 400; a source it stops allowing is skipped and audited once. Refreshed nightly at the Daily log time (own `docs-mirror` schedule row) and right after saving; removing a source deletes its mirror.
  - Web console: "Documentation from repositories" in a server's settings (typechecked, not viewed in a browser). Glossary: a Document may be mirrored. Persona: files/docs/ is the server's.
- [x] #249 Team roster (8394e20): `setTeamMember` / `teamRoster` keep `guilds/<g>/shared/team.md` (frontmatter `members`, a rendered list). Decided: the roster is neither Memory nor kept material; anyone in the guild may set any line, and each line says who set it and when (as anyone may assign a Task); a person may be name-only; the time zone is shown, not used by Reminders. recall returns matching lines as a `team` part cited with `R` refs (the citation renderer and the eval's ref check take `R`). Glossary: Team roster.
- [x] #246 Talk the bot never kept:
  - Today's talk (80b115b): when recall finds no kept file or nothing strong, it reads the place's messages since midnight in its zone (`readChannelHistory` with `withMessages`) and returns up to five that hold a wording as a `talk` part with message links; the bot's own and the asker's last minute are left out.
  - Images and scanned PDFs (9d4481d), only where the Profile sees images: an image an answered message gave the bot is filed under files/ as the model saw it, the turn line names where, and after the answer the model describes it in Indonesian and English into a `.md` beside it. A PDF with no text layer has the largest image of each of its first ten pages read by the model (`scannedPages`: unpdf's pixels made a BMP for `Bun.Image`), and the text goes to its `.md`, headed as read by the model. Not on a text-only Profile, which DeepSeek Flash is.
  - Long Minutes (6b4cd44): up to 20 pages of 100 messages (24 hours at most), one model call per 500, joined by `joinMinutes`; a count cut names its limit.
- [x] #247 Git ranking (46522f9): `rankWork` scores titles with BM25 as kept files are, the date breaking ties, within and across repositories. GitHub's commit search beside the latest 100 commits (300 on GitLab); a strict search with fewer than five issues and pull requests widens once to any of the wordings' words (`a OR b`, as GitHub's search reads it; the eval stub follows). Unit test: one old merged pull request among 15 newer noisy issues comes first.
- [x] #252 Lived-in exam, built by a subagent on `feat/lived-in-exam-252` and cherry-picked (5aff8fb..70cf5c3; two conflicts in `assistantRun.ts` with the Assignee pings, resolved keeping both):
  - A deterministic corpus (`apps/agent/eval/lived-in/`): guild "Gema", 2026-07-01 → 2026-10-13, four channels, 370 files (24 Minutes, about 270 Daily logs, 10 Decisions, 11 Notes, 10 Documents, 44 Tasks) plus 20 pull requests, 8 issues and 20 commits; fictional names; generated at test time.
  - 19 multi-turn sessions (14 Indonesian, 5 English) with gold sources per turn; `EVAL_EXAM=lived-in`, its own scorecard (v1, recall weighted 50); the 30-brief Rapor stays at v3, comparable.
  - recall@5 with no model (`lived-in-recall.test.ts`): 0.90 and MRR 0.97 when written, 0.98 after #247; pinned as a floor.
  - `report.md` gains cost and latency (profile `price` with `cachedInput`) and retrieval; held-out briefs can be drawn per version from a seed (v3 keeps its six); `hand-grade.ts sample|agree|keep` gives a person 20+ blind items and computes agreement (#49 still needs the person).
- Verification: typecheck 0 at every commit; every new scenario failed before its change; full suite 1265 pass, 0 fail on 46522f9. Two timing scenarios (the hung recall part, the turn deadline) were given wider margins after failing only at load average 20–30.
- [x] Code review of the phase's new code (a review subagent, read-only), fixed in 8d91417: `asksForTasks` took corrections for task requests ("the task belongs to Alice, not Bob" made every item a task), now it wants a turning phrase and refuses a correction's words; the Minutes reply skipped the registry's checks, now it goes through `executeTool`; private threads no longer have their Minutes copied into the parent's tasks, pings go only to thread members inside the thread, and the roster is not changed from one; items are known by link and words, so a correction that renumbers them makes no duplicate; `dueFromWords` read "Jumat 17.00" and "maybe 3 days" wrong; image and page reading have a time budget and real page numbers; pings and the Minutes reply are split under 2,000 characters; the injection check no longer excuses quotes or counts placeholder words; the web `PATCH /tasks/:id` keeps History and `completedAt` (`recordChange`). Leftovers filed as #261. Suite 1270 pass, 0 fail.
- [x] Third live Rapor (2026-10-19, on 73aa092): `EVAL_EXAM=1 EVAL_TRIALS=3`, profile `deepseek-flash`, judged blind and offline by Claude Opus 5.5 subagents as before (the questions of this run and of the lived-in run below mixed, shuffled, 832 in ten batches; validated: 790 yes, 41 no, 1 unknown). No calibration batch this time.
  - **Rapor v3, rubric 0.2: 92.5** (95.5 after Phase 43). capture 100, recall 92.6, tasks 77.1, group 97.2, loop 100; every holdout 100. pass^3 77%, coverage 0.96, question rate 95%. About 46k prompt tokens a trial (90% from the provider's cache), 1.5 s a model call.
  - Below 1: `bulk-cancel` 0 (the exam defect noted in Phase 43, and one trial stopped after one cancel), `cancel-with-reason` 0.67 (the list of active tasks also named the cancelled one), `notulen-jadi-tugas` 0.67 (the model wrote one action item as two; tasksFromMinutes made the three with owners and days right), `private-channel-dm` 0.67 (Indonesian reply), `recall-decision-replaced` 0.67 ("replaces", not the checked "replaced"), `colek-h-1` 0.83 ("18 Okt", not "18 Oktober"), `member-joins-thread` 0.89 (as in Phase 43). None traced to a change of this phase; at three trials a brief moves by a third on one trial.
- [x] First live lived-in exam (same day and judging): **Lived-in v1: 61.4.** capture 100, recall 66.2, tasks 58.3, group 0 (one session), loop 66.7; live recall@5 0.81, MRR 0.84. The failures it shows, filed: replies drift to the sources' language (#257), recall's Tasks part needs every word (#258), recall shows too little of a Minutes file for its decisions (#259), a change reported without being made in multi-turn sessions (#260).
- [x] Merged: `feat/review-246-256` fast-forwarded into `main` and pushed through the pre-push hook, as the user asked (2026-10-19). #144 and #246–#256 closed with their commits; #257–#261 stay open for the next phase.

## Phase 45 — Fixes from the first lived-in exam (spec #262, #257–#260)

The failures the first live lived-in exam showed (Phase 44). Built on `spec/262-lived-in-fixes`, one commit per issue, each by a subagent in its own worktree and fast-forwarded in; #259 waited for #258.

- [x] #257 Reply language (3314a95): the per-turn context says "Reply in: English" or "Reply in: Indonesian" when the person's own words show it (`shownLanguage`), and says nothing otherwise, so the persona's rule stands. It is set where the person's words are (the Discord client, web chat), not in `react.ts`: the framed turn there reads as English. `ReActInput.replyLanguage` stays the refusal language. The line is never stored.
- [x] #258 Tasks ranked like kept files (5c6ad26): `matching` keeps a Task that holds some terms of a wording, scored with `scoreOf` (title as the name, description as the body), best first, and marks one holding no wording whole as `partial`; listTasks and recall's Tasks part carry it, and the persona's partial line covers Tasks. With a query, mine/delegated/anywhere lists are cut by score before grouping. A Task benchmark in `recall-benchmark.test.ts` (20 Tasks, 11 questions, 5 named in other words): top-3 6/11 → 11/11, MRR 0.55 → 0.95, pinned. Lived-in recall@5 0.98 → 1.00 (floor raised).
- [x] #259 Minutes decisions in recall (00f53b0): a kept Minutes gives its `decided` and `open` items that hold a query term, a Daily log its `decided`, `open` and `next`, each with its message link, at most three a list, read with `parseFrontmatter`. The two matching lines stay. Over `RECALL_BUDGET`, the items of lower-ranked files go first, then second lines, then the best file's items, then whole items. The persona no longer asks for readFile before answering from these items.
- [x] #260 A change reported without being made (0a212ba). Diagnosed first from the six lived-in trials: in all six the model found the Task with listTasks and called the write, which said "not found"; the replies said so. The sessions run in #general and the Tasks live in #mobile, and writes (`findTask` → `loadTasks`) saw only this place while listTasks anywhere reads every channel the asker can view. Neither branch of the spec (#258's matching, a persona rule) applied.
  - Decided by the user (2026-10-19): a write by id reaches a Task in any channel the asker can view, with the sources and rules of listTasks scope anywhere. A Task the asker cannot view stays "not found"; one in a channel that may not be shown here is refused without naming it, and can be changed from a DM. ADR 0008, `docs/agents/tasks.md` and the Glossary say so.
  - The change runs in the Task's own server (`taskPlace`), so an Assignee named from a DM is linked, and the Assignee ping goes to the Task's channel.
- [x] Code review of the phase's new code (Standards and Spec reviewers, read-only), fixed in baab5d9: `main`'s default persona from Phase 44 was never frozen, so servers that kept it would not have been migrated; frozen once as `PERSONA_HARNESS_FIXES`. Also the recall budget order above, web chat's reply language, DM assigns, the refusal moved into `textIn`, one `inFolders` helper, the benchmark scaffolding in `support/recallBenchmark.ts`, clearer names (`answerIn`, `ITEMS_PER_LIST`), and `partial` carried through `readGroups`.
- Verification: typecheck 0 at every commit; every new scenario failed before its change; full suite 1284 pass, 0 fail on baab5d9.
- [x] Merged: `spec/262-lived-in-fixes` fast-forwarded into `main` and pushed, as the user asked (2026-10-19). #257–#260 and spec #262 closed with their commits.
- [ ] Live re-run of the Rapor and the lived-in exam, judged offline (the lead, after the branch is green).

## Phase 46 — HTML Documents and a reader for long files (spec #263, #264–#266)

Asked by the user on 2026-10-19: keep an HTML file and answer later what it holds, and read files through a model call ("spawn a subagent") so long files are read whole. Built on `spec/263-html-reader`, one commit per issue, each by a subagent in its own worktree and fast-forwarded in; #266 waited for #264 and #265.

- [x] Decided with the user before building: the reader reads only files over `READ_LIMIT` (short files are read directly), with the bot's own Profile; a general subagent (a nested loop with its own tools) waits until the reader has proved itself; HTML from the repository documentation mirror stays out.
- [x] #265 The turn's deadline reaches `ctx.complete` (2240ad0): `botCompletion` carries the turn's deadline to the router, so a tool's own model call made past it returns null without reaching the provider, and one in flight is cut there. Calls outside a turn (Minutes, Daily logs, the docs mirror, filing on arrival) still have none.
- [x] #264 HTML Documents (de9e412): `.html`/`.htm` are filed like a PDF. The body is parsed with domino (turndown's own parser) and its text goes to a sibling `.md`, which search, readFile and keepAsNote use. Script, style, noscript, template, svg and iframe are dropped, the title becomes the first heading when the body has none, and bytes are read as UTF-8. Decided: an image keeps only its alt text, since saved pages inline images as base64. `isBinaryDocument` is now `readsThroughMarkdown`.
- [x] #266 A reader for long files (b3746ad):
  - `readFile` takes `question`. A file over `READ_LIMIT` is read by the bot's model in chunks of about 40,000 characters, in parallel, at most 8 a call, the rest named by `unreadFrom`. With a question it returns a short answer plus quotes; without one, a summary and an outline with line ranges. Short files and plain line ranges are read as before.
  - Decided: the server joins the chunks' answers itself, labelled by their lines, with no second model call.
  - readFile on a PDF, DOCX, XLSX or HTML path reads its sibling `.md`.
  - Persona: main's Phase 45 default frozen once as `PERSONA_LIVED_IN_FIXES`; the readFile line says to pass the question for a long file and to answer from the quotes.
- [x] Code review of the phase's new code (Standards and Spec reviewers, read-only), fixed in c22572b:
  - A tool sees when its call must answer (`callDeadline`: the earlier of the tool ceiling and the turn's deadline). The reader cuts its calls 5 s before it and starts none with under 15 s left, falling back at once with `readerFailed` saying why.
  - A quote holds only on a line of its own chunk, never from a chunk that found nothing, and under three words only as its whole line. A file that does not answer says so for the lines read. `cutLines` names lines longer than a chunk; `unreadBecause` tells the 8-chunk cap from a failed part. Summaries are in the place's language.
  - One turndown setup for Plane and HTML (`htmlMarkdown.ts`), the file type lists built from `DOCUMENT_TYPES`, `filedText` shared by readFile and keepAsNote, `botCompletion` taking one bundle.
- Verification: typecheck 0 at every commit; every new scenario failed before its change; full suite 1309 pass, 0 fail on c22572b. A first run had one failure, the #254 deadline test in `router-hardening` (a 60 ms deadline passed before the request was sent under four workers); it passed alone three times and in the rerun.
- [x] Merged: `spec/263-html-reader` fast-forwarded into `main` and pushed, as the user asked (2026-10-19). #264–#266 and spec #263 closed with their commits.
- [x] Found by the user right after the merge: the bot answered only "Selesai." to everything. Not this phase's code: the bot's Profile goes through a Chat Completions proxy that, without streaming, answers a tool call as empty text with `finish_reason: "tool_use"` and no `tool_calls` (streamed, it sends the call). The router read that as an empty reply, and the loop's empty-answer fallback said "Selesai.". Decided with the user: the bot follows whatever Profile is set, so the router copes rather than the Profile changing. `callCustomOpenAI` now asks such a server again streaming (with `stream_options.include_usage`), remembers it by base URL and model until restart, drops a leading `<think>` block from the text, and treats an answer that names a tool call it does not hold as a provider failure, so the fallback Profile runs instead of an empty reply. Checked against the live proxy with the channel's own history: the turn calls recall and answers.
- [ ] Live re-run of the Rapor and the lived-in exam, judged offline (the lead, after the branch is green).

## Phase 47 — One source for tool definitions (#133, #134)

Two `ready-for-agent` issues from the retro of the spec #120 build. Asked by the user on 2026-10-19 ("Oke, langsung kerjakan"). Built on `fix/133-134-tool-definitions`, one commit per issue, #133 first since both touch the tool lists.

- [x] #133 Tool tests check invariants, not pinned counts and names (3ebfc1b). `skills-admin` checks that the admin API lists exactly the skill modules, each with its module's tools. `availability-scenarios` checks that a tenant with no rules is offered every tool of the four skills on by default and nothing of git or Plane. `catalogue` (a third file pinning git's and workspace's counts) checks that every tool has a handler and a `toolPolicy` entry, that neither names anything else, and that no two skills share a tool name. New invariant: every write tool of a skill that does not confirm internally states `requiresConfirmation`. Checked by mutation: a new task tool passes all three files unchanged, a task write without `requiresConfirmation` fails `catalogue`, and reminders off by default fails `availability-scenarios`.
- [x] #134 Tools live only in the skill modules (2db2e48). Two places still read the seed's copy: `GET /api/v1/skills` returned it as `tools` (4 task tools where the module has 12), and `getActiveTools` fell back to it for a skill with no module. Decided with the user: the code registry is the one source and the seed stores no copy. `tool_definitions` stays as a column, kept empty; the next start clears the copy an older version stored. `GET /api/v1/skills` takes `tools` from the registry and no longer returns `toolDefinitions`, and `getActiveTools` offers only tools of skills that have a module. Covered by `skills-api.test.ts`, which fails against the old code.
- Verification: typecheck 0 at both commits; full suite 1315 pass, 0 fail on 2db2e48.
- [x] Merged: `fix/133-134-tool-definitions` fast-forwarded into `main` and pushed, as the user asked (2026-10-19). #133 and #134 closed with their commits.
- [x] Found while closing #134: the seed's skill descriptions had drifted from the modules too (task_management, git_repositories, reminders), and the admin console showed the seed's text. Asked by the user to fix it directly rather than file an issue. Both skill APIs now take name and description from the code registry, as they do tools, and the seed's text is brought in line (f78c1b0). Typecheck 0; full suite 1315 pass, 0 fail. Fast-forwarded into `main` and pushed, as the user asked (2026-10-19).

## Phase 48 — A fresh conversation after quiet hours, or from the console

Asked by the user on 2026-10-19: after a long chat, greeting the bot with "Halo" should find it on a fresh context, like `/clear` or a new session. Built on `feat/fresh-conversation`.

- [x] Decided with the user before building: no command in chat for now. A channel, thread or DM starts a fresh conversation on its own after quiet hours (tenant setting, default 24), or when an admin ends it in the console. While building: every turn the bot runs counts as talk, so in an always-on channel any message keeps the conversation going (only counting mentions would cut an active always-on channel mid-talk).
- [x] Backend (03c0644). Each turn records `lastTurnAt` (business clock) in the conversation's metadata. Discord's `reply` continues the channel's latest conversation only when `continuesConversation` says so: not after `endedAt`, nor when `lastTurnAt` is `conversationIdleHours` or more ago (0 never). A Playbook thread keeps its conversation however long it waits, and a conversation from before this phase starts counting at its next turn. Otherwise the loop starts another, so the old history and summary are left behind. Memory, Tasks and files come from the Workspace and stay. No migration: both keys sit in the metadata JSON, and the hours in the tenant's `settings` JSON. `GET/PUT /api/admin/tenants/:id/settings` carry `conversationIdleHours` (whole hours, 0–720). `POST /api/admin/bots/:botId/conversations/:id/end` ends one with nothing posted in Discord, and the bot's conversation listing carries `endedAt` on every engine.
- [x] Console (f636bff): "Fresh conversation after N hours" in tenant Settings. In a channel's conversations, the current one of the channel and each thread is marked Current, an ended one Ended, and an open current one has End conversation.
- [x] Docs: `docs/api.md` (the setting and the bot conversation endpoints, which were not listed before) and a **Conversation** entry in `GLOSSARY.md`.
- Verification: typecheck 0 at every commit. `fresh-conversation.test.ts` (7 scenarios); the 4 about new behaviour failed before the change. New cases in `settings-api` and the conversations contract suite. Full suite 1323 pass, 0 fail on 03c0644; `test:engines` 445 pass, 0 fail on PostgreSQL and both MongoDB setups. The console pages were type-checked and built, not opened in a browser.
- [x] Merged: `feat/fresh-conversation` fast-forwarded into `main` and pushed, as the user asked (2026-10-19).
- [x] Found by the user after the merge: closing the Add Plane account dialog flickered to "Edit Plane account". Not this phase's code. Every console dialog and sheet opened by a piece of state cleared it on close, and read its content from that same state, so the content changed during the closing animation. That hit seven places: the Add/Edit title of the Plane, Git and Profile dialogs; the integration dialog emptying; "Delete ?" without the bot's name; the new API key's box emptying; and the Guild instructions and channel conversations sheets losing their title or showing a skeleton. Fixed with `useLastShown` (`apps/web/src/hooks/use-last-shown.ts`): each dialog still opens on its state but draws from the last value it held, and the two sheets clear their data only when they open. Typecheck 0; checked by the user in the console. Fast-forwarded into `main` and pushed (2026-10-19).

## Phase 49 — A Plane account is pinned to a Plane version (spec #267, #268–#269)

Asked by the user on 2026-10-19: Plane breaks its API between releases, so one release of Plane changing a path should not stop the bot's Plane tools everywhere. Planned in plan mode with the user; built on `spec/267-plane-versions`, #268 first.

- [x] Decided with the user: the Plane versions are hard-coded in the backend, since each needs its own tool code, and each entry names the range of Plane releases it covers. The version is picked by hand; the Plane server's release only suggests one and warns on a mismatch. The first entry is Plane 1.3 (1.3.0 up to 1.4.0, checked against v1.3.1), and every existing account becomes it.
- [x] Checked in the Plane v1.3.1 source: `GET /api/instances/` is `AllowAny` and answers `{ config, instance }`, with the release in `instance.current_version` (from `APP_VERSION`, else `package.json`, so with or without a leading `v`).
- [x] #268 A Plane account is pinned to a Plane version (2db3a50)
  - `packages/skills/src/plane/versions.ts`: `PLANE_VERSIONS` (id, label, releases `{ from, before }`, `checkedAgainst`, `auth`, `headers`), `findPlaneVersion`, `newestPlaneVersion`, `versionHasTool`, `onPlaneVersion`, `unknownPlaneVersion`. Plane 1.3 sends `X-Api-Key`.
  - `plane_accounts.plane_version` (`'1.3'` for existing rows; the MongoDB mapper reads a missing field as `FIRST_PLANE_VERSION` from `@pachiware/db`). `PlaneConn.version` gives the request its headers; `planeConnOf` refuses an unknown version in plain words, so that account fails alone.
  - Gating in `plane/workspace.ts`: `PlaneToolPolicy.versions` (none listed: every version), `offersTool`, `hiddenPlaneToolsFor` / `hiddenPlaneTools` (was `hiddenWorkspaceTools`), `hiddenPlaneReasonFor` naming each account and its version, and `accountForTool` behind `checkedByVersion`, which wraps every handler but `planeAccounts`: a named account whose version lacks the tool is refused before any Confirm; with none named and only one able, that one is used. No tool lists versions yet.
  - Admin API: `GET /plane-versions`; POST takes `planeVersion` (400 when unknown); PATCH re-verifies on a change, and an account on an unknown version takes no edit until a known one is chosen. Console: a Plane version Select that stays editable after create, and a badge on the card. `planeAccounts` shows each account's version.
  - Docs: **Plane version** in `GLOSSARY.md`, ADR 0016 (ADR 0011 points to it), README "Connect Plane", `docs/api.md`. `README.id.md` has no Plane section, so it is unchanged.
  - Tests: `packages/skills/test/plane-versions.test.ts` against a test version table; a scenario in `plane-tools.test.ts` where an account on an unknown version is refused while the other answers; the admin scenario in `plane-accounts.test.ts`; contract, SQLite migration and MongoDB legacy-document tests.
- [x] #269 The Plane server's release suggests a Plane version and warns on a mismatch (60e277d)
  - `planeServerRelease(baseUrl)` in `plane/client.ts`: no key, redirects refused, base URL checks, 5 s; only `instance.current_version` is kept, anything else is null. `parseRelease`, `versionForRelease` and `versionNote` in `versions.ts`.
  - `plane_accounts.plane_server_version` (null until read), recorded at every create and PATCH. `GET /plane-versions?baseUrl=` adds `{ release, suggested }`; POST without `planeVersion` takes the suggestion, else the newest; every account carries `planeServerVersion` and `versionNote`.
  - Console: reads the release when the dialog opens and when the base URL loses focus, preselects the suggestion for a new account, and says what the Plane runs or warns; the card and the save toast show the note.
- Verification on 60e277d: `bun run typecheck` 0; `bun run test` 1345 pass, 0 fail; `bun run test:engines` 453 pass, 0 fail on SQLite, PostgreSQL and both MongoDB setups; the web app builds. The console pages were type-checked and built, not opened in a browser (the console's sign-in needs the platform key).
  - The new scenario first flaked under the parallel run: another scenario in `plane-tools.test.ts` changes Allowed hosts, which lives in the runtime config file the scenario processes share. The scenario's second account now stays on Plane's cloud; ten runs in a row passed.
- [x] Merged: `spec/267-plane-versions` fast-forwarded into `main` and pushed, as the user asked (2026-10-19). #267, #268 and #269 closed with their commits.

## Phase 50 — The Console page: the agent's logs in the dashboard

Asked by the user on 2026-10-20: one menu in the web UI, "Console", that shows all the agent's logs instead of a terminal, with search, timestamps and other filters. Built on `feat/console-logs`.

- [x] Decided with the user: the menu is named Console (in prose "the console" still means the whole web app; the glossary says so under Agent log). Lines are kept in memory and in daily files for 7 days, so a crash or a restart, and `pachiware start --daemon`, keep them.
- [x] Capture (`apps/agent/src/logs/agentLog.ts`, ADR 0017): `installAgentLog` is the agent's first import (`logs/install.ts`). Every `console` call still reaches the terminal and becomes an Agent log line `{id, run, seq, time, level, source, text}`: `util.format` text without ANSI colours, the leading tag as the source (else `agent`), and keys of this platform (`pk_live_…`), bearer tokens and JWT-shaped tokens such as Discord bot tokens masked. The newest 5,000 lines stay in memory; every line is appended to `agent-YYYY-MM-DD.jsonl` (UTC) under `LOG_DIR` (`data/logs`, resolved like the SQLite path), and files past `LOG_RETENTION_DAYS` (7) are pruned at start and every six hours. A file that cannot be written is told once; the line stays in memory.
- [x] Sources: the LLM router, the Discord startup notices and the unhandled API error now start with `[llm]`, `[discord]` and `[http]`. `logAt(level, …)` keeps an HTTP line as a warning for 4xx and an error for 5xx while the terminal still gets it on standard output; the Console page's own `/api/admin/logs*` requests are left out of the HTTP log.
- [x] API (`routes/admin/logs.ts`, platform admin): `GET /api/admin/logs` reads the day files in the range and filters on the server (level, source, words or regular expression, match case), returning the newest matches up to 5,000 with `truncated`, every source in the range, `run`, `cursor`, `retentionDays` and `dir`; `format=text` downloads up to 100,000 lines as `.log`. `GET /api/admin/logs/stream` is server-sent events: `hello`, the lines after the cursor still in memory, then each new line, with a comment every 15 s and Bun's idle timeout switched off for it.
- [x] Console page (`apps/web/src/pages/Console.tsx`, `lib/logs.ts`): history then the live tail (read with fetch, so the key stays in a header; reconnects from the last line it got), search with highlighting, match case and regular expression, time range (15 minutes to 7 days, or a custom range, live when it ends now), level toggles, a source menu, pause and resume with a count of new lines, following the newest line until the reader scrolls up ("Jump to the newest line"), wrapping, local time, UTC or time ago, multi-line messages folded, a marker where the agent restarted, copy, download and clear the view. The filters live in the address bar, so a view can be bookmarked; wrapping and the time format are remembered per browser.
- [x] Docs: **Agent log** in `GLOSSARY.md`, ADR 0017, `docs/api.md`, both READMEs, `LOG_DIR` and `LOG_RETENTION_DAYS` in `.env.example`.
- Verification: `bun run typecheck` 0; `bun run test` 1362 pass, 0 fail; the web app builds. `agent-log.test.ts` (14 tests: format, tag, colours, masking in memory and file, UTC day files, a failing write, the memory ring and replay, subscribers, queries over two days with every filter and the limit, an invalid regular expression, pruning, install and restore, `logAt`, the folder) and `logs-api.test.ts` (3 scenarios: admin only, server-side filters, 400s, the download, the stream replaying the line logged while the page loaded and then a live line, the HTTP log's levels and its leaving out the page's own requests). `bun run test:engines` was not run: Docker Desktop was not running; the database layer is unchanged.
  - Checked in a browser against a separate test instance (its own database, log folder and a generated key): history, the live tail, search with highlighting and the address bar, the level filter from a bookmarked address, warnings for 4xx, and the narrow layout without sideways scrolling.
- [x] Merged: `feat/console-logs` fast-forwarded into `main` and pushed, as the user asked (2026-10-20).

## Phase 51 — Plane accounts: exactly Plane 1.3.1, one key for many Plane workspaces, Test and Playground (spec #280, #281–#283)

Asked by the user on 2026-10-20. The Plane version should be 1.3.1, not 1.3. One API key opens every Plane workspace its user belongs to, so it should not be tied to one workspace slug. A Plane account needs a Test and a Playground like a Profile has. Planned in plan mode with the user; built on `spec/280-plane-workspaces`.

- [x] Checked in Plane's source (v1.3.1, v1.4.2, `preview`): `APIKeyAuthentication` returns `api_token.user` and checks no workspace, so one key reaches every workspace its user belongs to. `/api/v1/` cannot list them: it has only `users/me/` and paths under `workspaces/<slug>/`, and `/api/users/me/workspaces/` takes a browser session only. Decided with the user:
  - the version is exactly 1.3.1;
  - an account lists workspace slugs, typed by the admin, each with an on/off switch;
  - the Playground runs the checklist and lists projects.
- [x] #281 Exactly Plane 1.3.1 (2c706ee)
  - `versions.ts`: the first entry is now `{ id: "1.3.1", label: "Plane 1.3.1", releases: { from: "1.3.1", before: "1.3.2" } }`.
  - Stored `1.3` becomes `1.3.1`: an idempotent `UPDATE` on SQL and step `0231-plane-version-1.3.1` on MongoDB. The column defaults and `FIRST_PLANE_VERSION` follow.
  - A Plane on 1.3.0 or 1.3.2 now gets the mismatch note. ADR 0016 is amended for this one-time rename.
- [x] #282 A Plane account holds one key and a list of Plane workspaces (e7513da)
  - Storage:
    - `plane_accounts.workspaces` (`[{ slug, enabled }]`) replaces `workspace_slug`, which is dropped after the backfill.
    - `plane_scopes.workspace_slug` joins the scope's unique key. SQLite rebuilds the table, dropping orphan scopes; PostgreSQL swaps the constraint after looking up its name; MongoDB runs step `0232-plane-workspaces`.
    - A rule's slug may be left out for an account with one workspace.
    - Removing a slug deletes its scopes on every bot; switching it off keeps them.
  - Runtime:
    - `PlaneAccess` is one usable (account, Plane workspace), named by the account alone, or `account/workspace` when it has several here.
    - One matcher (`findPlaneAccess`) serves `pickPlaneAccess` and `accountForTool`.
    - `planeConnOf(account, slug)`. Tool arguments do not change.
    - A channel whose rules are all for switched-off workspaces gets no Plane rather than its guild's.
  - Admin API:
    - `workspaces` on create and patch: 1 to 20 slugs, none twice; names without `/`.
    - Plane is asked about the key and every switched-on workspace when the key, host or version changes, and otherwise only about workspaces newly switched on.
    - `/projects?workspace=`; guild Plane rules carry `workspaceSlug`.
  - Console:
    - a workspace list with a switch per slug, and the workspaces on the card;
    - Plane access shows one row per switched-on workspace and sends hidden rules back unchanged;
    - the attach list shows the switched-on slugs.
  - Docs: GLOSSARY (Plane account, Plane workspace, Plane scope), ADR 0018, README "Connect Plane", `docs/api.md`.
- [x] #283 Test and Playground for a Plane account (9859757)
  - `POST /api/admin/plane-accounts/test` checks the server (`readPlaneServer`), the version against the release, the key's Plane user, then each listed workspace with its project count. A step after a failed one is skipped.
  - With `accountId` and no key, the saved key is used only on its saved host.
  - Console:
    - a Test button beside Save, with each workspace's result in its row;
    - a Playground on the card that runs the checks and lists a chosen workspace's Plane projects;
    - the status icons are shared with the profile checklist.
- [x] Fixed after the phase's code review (2c63cc2):
  - A write waiting for Confirm, asked with a bare or no account name, could run in another Plane workspace if workspaces were switched before Confirm. `checkedByVersion` now passes the picked entry on as `account/workspace` (`pinnedPlaneAccess`), so the write runs where it was asked or is refused.
  - Plane access warns that Use server rule also removes a channel's rules for switched-off workspaces.
  - Glossary wording in console text, and a scope test compared against a literal.
- Verification on 2c63cc2:
  - `bun run typecheck` 0; `bun run test` 1380 pass, 0 fail; the web app builds.
  - `bun run test:engines` 472 pass, 1 fail. The failure is the MongoDB fresh-install check in `database-engine.test.ts`, which also fails on `main` (be2a753): since Phase 50 the agent writes `data/logs` there. Filed as #284.
  - New tests:
    - migration from the old shape on SQLite (with an orphan scope), PostgreSQL (`plane-workspaces-postgres.test.ts`) and MongoDB, each run twice;
    - contract suites for the workspace list and per-workspace rules;
    - `plane-scope.test.ts`;
    - Discord scenarios with one key on two workspaces, the switched-off channel, and a pending Confirm both pinned and refused;
    - the admin Test scenario, which asserts that no `X-Api-Key` reaches a new host.
  - Checked in a browser against a separate test instance (its own database, runtime config and a generated key) with a fake Plane on localhost: the workspace list (lowercased slugs, a duplicate refused), Test with a refused workspace, saving with that workspace switched off, the card, and the Playground's checks and projects.
  - Plane access was not opened in the browser: it needs a bot connected to Discord.
- [x] Merged: `spec/280-plane-workspaces` fast-forwarded into `main` and pushed, as the user asked (2026-10-20). #281–#283 and spec #280 closed with their commits.

## Phase 52 — Plane 1.4.2, and a plainer Plane account form

Asked by the user on 2026-10-20: add Plane 1.4.2, stop the Plane account form from offering saved passwords and emails and from explaining every field, and keep the page's intro to how to make the key.

- [x] Checked in Plane's source, v1.3.1 against v1.4.2, for every call the Plane tools and admin routes make. None changed in a way the tools notice:
  - New `-lite` list endpoints (projects, cycles, modules, members), unused here.
  - `order_by` is checked against an allowlist, which has the `updated_at` the work-item list sorts by; `pql` and `filters` are refused on the work-item list, and the tools send neither.
  - Comment HTML is sanitized with nh3 as descriptions already were; everything `planeHtml` writes, the origin line among it, is on its list.
  - Reading a project's members or labels needs membership of that project, as work items already did.
  - Rate limit (60 a minute, the same headers), `X-Api-Key`, the key refusal, `/api/instances/`, the work-item link route, and every Plane message a tool turns into plain words are unchanged.
- [x] `versions.ts` (feb847f): Plane 1.4.2 (1.4.2 up to 1.4.3, checked against v1.4.2) shares the tools' code and is now the newest, so a new account gets it unless its server reports a release another version covers. Accounts on Plane 1.3.1 stay there until an admin changes them.
- [x] Plane account form (c713365): the API key field no longer overrides the shared input's `autocomplete="new-password"` with `off`, which browsers ignore on password fields. The fixed help text under each field is gone; the notes that depend on state stay.
- [x] Plane accounts page (c713365): its intro only says how to make the key in Plane (Profile settings → Personal Access Tokens → Add access token, the same place in v1.3.1 and v1.4.2).
- Verification: `bun run typecheck` 0; `bun run test` 1381 pass, 0 fail; the web app builds.
- [x] Committed on `main` and pushed, as the user asked (2026-10-20).
