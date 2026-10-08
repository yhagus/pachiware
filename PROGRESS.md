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
- **Phase 14: Awaiting verification 🚧** (Platform admin portal implemented; manual browser verification pending)
- **Phase 15: Awaiting verification 🚧** (Discord shared conversations and per-server instructions implemented; live Discord verification pending)
- **Phase 15.1: Awaiting verification 🚧** (OpenAI/Custom prompt-cache support implemented; live hit-rate measurement pending; Anthropic support deferred)
- **Phase 15.2: Awaiting verification 🚧** (Quieter shared-thread replies and burst coalescing implemented; live Discord verification pending)
- **Phase 16: Awaiting verification 🚧** (Git accounts and repository access implemented; live-provider verification and existing-tenant activation pending)
- **Phase 17: Awaiting verification 🚧** (Git OAuth and token refresh implemented; real OAuth application verification pending)
- **Phase 18: Awaiting verification 🚧** (Repository browsing and search implemented; live-provider verification pending)
- **Phase 19: Completed ✅** (Multiple git accounts per bot, server/channel scopes, and PostgreSQL verification)
- **Phase 20: Awaiting verification 🚧** (Git scope resolver, read tools, and prompt integration implemented; live Discord/provider verification pending)
- **Phase 21: Completed ✅** (Confirmation for git write actions)
- **Phase 22: Awaiting verification 🚧** (Git account and scope UI implemented and browser checks passed; live Discord/provider flow pending)
- **Phase 23: Completed ✅** (Pull request and issue management tools)
- **Phase 24: Completed ✅** (Repository, CI/CD, access, organization, and utility tools; existing root typecheck failures remain documented)
- **Phase 25: Completed ✅** (Guardrails, confirmation, rate limits, redaction, and audit events)
- **Phase 26: Completed ✅** (Workspace file storage, task tools and REST API, Markdown memory, admin editor, and legacy task export)

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

#### Diagnosis: ReAct iteration-limit reply (2026-10-09)

- [x] Locate the exact fallback in `apps/agent/src/loop/react.ts` and reproduce through `AgentReActLoop.run` with isolated database, model, and tool dependencies.
- [x] Verify default 12 rounds, configured 3/8 rounds, upper clamp 32, a final answer on the last round, and an answer requiring one additional round.
- Confirmed cause of the reply: every allowed model round requested tools, so the loop exhausted its budget before receiving a response without tool calls. Last-round tools execute, but their results get no further model round. The fallback does not check whether tool actions succeeded.
- Discord reads tenant `settings.maxReActIterations`; tenant creation and seeding initialize it to 8. Web chat omits the setting and uses 12. Limits count model rounds, not individual tool calls or reasoning tokens.
- [ ] Determine why the reported live conversation kept requesting tools; its message/tool-result history is needed to distinguish a long task from repetition or retries after failures.
- Initial diagnosis phase completed before the long-horizon continuation change below; the original reproduction harness remains temporary and outside the repository.

#### Long-horizon ReAct continuation (2026-10-09)

- [x] Raise the default action budget to 32 rounds and the hard configurable ceiling to 128.
- [x] Treat legacy tenant values below 32 as the old default, so existing tenants receive the longer budget without a manual migration.
- [x] On budget exhaustion, run one tool-free synthesis turn so the user receives completed-work and next-step context rather than an opaque limit message.
- [x] Mark the boundary event in the guardrail audit with `synthesized: true`.
- [ ] Update the existing tenant settings UI/help text if it exposes the old default or ceiling.

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

### Thread memory after reconnect (2026-10-09)

- [x] Confirmed conversation identity and persistence: messages are stored in the database and resumed by the same Discord thread/channel ID after gateway reconnect.
- [x] Confirmed context-window limit: the ReAct loop loads a stepped window of roughly the latest 30–40 stored messages, so very old messages may be omitted from the next prompt even though they remain persisted.
- Known operational caveat: a new Discord thread ID creates a new conversation; reconnecting the same bot on the same thread does not.

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
- [x] Burst coalescing in guild channels (2.5 s debounce, `BURST_MS`): one reply for a batch, speakers kept as `Name: text` lines. Threads and DMs still reply per message
- [x] Rate-limit hit now reacts with ⏳ instead of replying
- [x] Tests: `conversations.test.ts` (routing, noise), `discord.test.ts` (mock updated, waits out the debounce)
- [ ] Verify on a live server: emoji in thread, two humans talking, 5 rapid messages
- Known limit: the "previous message is the bot's" check costs one Discord API fetch per thread message. Thread messages are not debounced, so a spammer's burst there still gets one reply per message that follows a bot message (only the first, since the next one's previous message is a human).

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

## Phase 26 — Workspace: tasks, notes and memory as Markdown files
Decision: `docs/adr/0003-agent-data-lives-in-workspace-files-not-the-database.md`. Term: **Workspace** in `GLOSSARY.md`.

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
- Follow-up fixes completed after review: task listing now reads frontmatter only, renamed task files remain discoverable by UUID frontmatter, malformed IDs/timestamps are rejected, Workspace listings over 500 entries are refused, DM/guild/task labels are created consistently, and the Web UI can initialize folders from the Workspace root.

## Phase 27 — Session-scoped approval and concise Discord action responses

- [ ] Clarify whether one owner approval covers all sensitive tools in a Discord thread or only a narrower command/category scope
- [ ] Clarify approval lifetime: thread lifetime, idle timeout, or persistent across restarts
- [ ] Clarify canonical owner identity: `GIT_OWNER_DISCORD_IDS` versus tenant/bot owner records
- [ ] Decide approval UX and wording for the one-time thread grant
- [ ] Replace generic Discord action alerts (`Actions executed`, `Action done`) with concise assistant-style result text
- [x] Owner decisions captured: thread-wide grant, thread lifetime, `GIT_OWNER_DISCORD_IDS`, one-time grant UX, concise text results
- [x] Wayfinder map created: https://github.com/yhagus/pachiware/issues/10
- [x] Decision tickets created: #11 state model, #12 owner interaction/lifecycle, #13 response contract
- [x] Implementation specification published as ready-for-agent issue: https://github.com/yhagus/pachiware/issues/14
- [x] Implemented on integration branch feat/thread-scoped-approval: thread grant state, owner-only grant button, guardrail/Git integration, concise Discord responses
- [x] Verification: full Bun suite 65 pass / 0 fail; production build passes; typecheck has pre-existing apps/web alias and implicit-any failures
- [x] Spec and decision issues closed: #10, #11, #12, #13, #14
- Status: implementation complete; integration branch is ready for review.
