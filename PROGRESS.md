# PROGRESS &amp; GOALS: pachiware-agent

## 🎯 End Goals

`pachiware-agent` is an intelligent, self-hosted AI agent platform built with TypeScript and Bun. It features:

- **No heavy frameworks:** Lightweight, explicit ReAct agent execution loop with native tool calling.
- **Multi-channel integration:** Modular messaging gateway (Discord active; WhatsApp, Telegram, Slack planned) providing chat interaction, task creation, conversation channels, and status tracking.
- **Management Web GUI (`apps/web`):** Clean, modern dashboard (Vite + React + Tailwind CSS + Lucide) for managing agent prompts, personality, active skills, tasks (Kanban/List), and LLM routing.
- **LLM Router Adapter:** Direct integration with OpenAI, Anthropic, and custom OpenAI-compatible proxies (such as `9router`).
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
