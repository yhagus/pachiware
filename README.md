# Pachiware Agent

An intelligent, self-hosted autonomous AI agent platform built with **TypeScript**, **Bun**, **Hono**, **PostgreSQL**, and **Redis**.

`pachiware-agent` features an explicit, lightweight **ReAct (Reasoning + Action) execution loop** with native tool calling, free from heavyweight frameworks like LangChain or Hermes. It is fully controllable via a **Web Management Console** and built with a modular, **multi-channel messaging architecture**.

> [!NOTE]
> **Multi-Channel Architecture (Not Discord-Exclusive):**
> Pachiware Agent is designed as a multi-channel autonomous agent platform. It is **not Discord-exclusive**. The core agent logic and ReAct reasoning engine are completely decoupled from the messaging interface.
> 
> **Discord** happens to be the first fully supported communication channel in the current release. Additional adapters for platforms such as **WhatsApp**, **Telegram**, **Slack**, and more are on the roadmap and will be supported in upcoming releases.

---

## 🏗 Architecture & Blueprint

```text
                                 +-------------------------------+
                                 |    Multi-Channel Gateway      |
                                 |  • Discord (Active)           |
                                 |  • Telegram / WhatsApp (Next) |
                                 +---------------+---------------+
                                                 |
                                                 v
+------------------------+       +---------------+---------------+       +------------------------+
|   Web Management GUI   | <---> |        Hono REST API &        | <---> |      Redis Cache       |
|    (apps/web: 3000)    |       |       Agent ReAct Loop        |       | (Session, State, Rate) |
|                        |       |      (apps/agent: 3001)       |       | [External or Bundled]  |
+------------------------+       +---------------+---------------+       +------------------------+
                                                 |
                             +-------------------+-------------------+
                             |                                       |
                             v                                       v
                 +-----------+-----------+               +-----------+-----------+
                 |  Skill & Tool Harness |               |   LLM Router Adapter  |
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

---

## 🗄️ Database & Redis: External by Default vs Bundled Docker

**Does `install.sh` or `pachiware start` automatically create Redis and PostgreSQL?**

> **By default, NO.** 

- **External by default:** By default, Pachiware connects to your existing database and cache using the `DATABASE_URL` and `REDIS_URL` specified in your `.env` file (e.g., your existing local PostgreSQL, cloud-hosted DB like Neon/Supabase/RDS, or Redis like Upstash).
- **Optional Bundled Containers:** If you do not have PostgreSQL or Redis installed and would like Pachiware to spin up bundled local containers (PostgreSQL 18 and Redis 7), simply add the `--docker` flag:
  ```bash
  pachiware start --docker
  ```
  Or run Docker Compose directly:
  ```bash
  docker compose up -d
  ```

---

## 📦 Monorepo Structure

```text
pachiware-agent/
├── apps/
│   ├── agent/                 # Bun + Hono backend, ReAct loop, Messaging adapters (Discord active), LLM Router
│   └── web/                   # Management console (Vite + React + Tailwind CSS + Lucide)
├── packages/
│   ├── db/                    # Drizzle ORM schema, PostgreSQL connection, migrations & seed
│   └── skills/                # Tool definitions & execution handlers (Tasks, Channels, Custom)
├── docker-compose.yml          # Optional bundled PostgreSQL 18-alpine & Redis 7-alpine services
├── install.sh                 # One-line server installer script
├── PROGRESS.md                # Phased development tracking and roadmap document
└── README.md                  # System overview and getting started guide
```

---

## 🚀 One-Line Server Installer & Global CLI

You can install, manage, and update the entire `pachiware-agent` platform directly from your terminal using the global **`pachiware`** CLI command.

### Option 1: One-Line Server Installer (Recommended)
Run this command on your server (Linux or macOS):
```bash
curl -fsSL https://raw.githubusercontent.com/yhagus/pachiware/main/install.sh | bash
```
*Or locally from the repository:*
```bash
./install.sh
```

### Option 2: Install via npm / bun
```bash
npm install -g pachiware
# or
bun add -g pachiware
```

Once installed, the **`pachiware`** command is available globally in your `$PATH`.

---

## 💻 CLI Commands (`pachiware --help`)

```text
Usage: pachiware [options] [command]

Autonomous AI Agent Platform CLI - Manage, Deploy, and Update Pachiware

Options:
  -v, --version        Output the current version of Pachiware
  -h, --help           Display help and command overview

Commands:
  init [dir]           Initialize or scaffold a Pachiware Agent deployment (.env and configs)
  start [options]      Start Agent API and Web Console (uses existing DB/Redis by default)
                       Options: --docker (spin up bundled Postgres & Redis containers),
                                -d, --daemon (run in background),
                                --no-gui (start Agent backend API only)
  stop [options]       Stop running Pachiware Agent services (--docker to stop containers)
  restart [options]    Restart running Pachiware Agent services
  status | health      Check live health of agent, web, DB, Redis, and messaging gateway
  logs [service]       Stream logs (agent, web, postgres, or redis)
  update               Pull latest updates, run migrations, rebuild UI & restart
  doctor               Diagnose system dependencies, runtimes, ports, and .env
  chat <message>       Send a test prompt directly to the ReAct loop from terminal
  db:migrate           Run database schema migrations on PostgreSQL
  db:seed              Seed default agent personality and built-in skills
  uninstall [options]  Completely remove Pachiware CLI and services (--purge, --docker)
```

### 🚀 Starting the Platform
```bash
# Default: connects to your existing DB and Redis configured in .env
pachiware start

# Or with bundled local Docker containers for PostgreSQL 18 & Redis:
pachiware start --docker
```

### 🔄 Updating with a Single Command
To update the platform to the latest version, run migrations, and recompile:
```bash
pachiware update
```

### 🗑️ Uninstalling
To remove Pachiware symlinks and stop services:
```bash
pachiware uninstall

# Or completely remove data, stop Docker containers, and purge directories:
pachiware uninstall --purge --docker
```

### 🩺 System Diagnostics
To verify runtimes, port availability, and environment configuration:
```bash
pachiware doctor
```

### 💬 Quick Terminal Chat
Test your autonomous agent's ReAct reasoning right from the shell:
```bash
pachiware chat "Please create task 'Deploy Ingress Gateway' with priority high"
```

---

## ⚡ Manual Quick Start (Without Global CLI)

If you prefer working directly from the cloned repository using Bun:

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL, REDIS_URL, LLM keys, etc.

# 3. (Optional) If you don't have existing Postgres/Redis running:
docker compose up -d

# 4. Run database migrations & seed
bun run packages/db/src/migrate.ts
bun run packages/db/src/seed.ts

# 5. Start Agent API and Web Console
# Terminal 1: Agent backend
bun run apps/agent/src/index.ts

# Terminal 2: Web management dashboard
bun --filter @pachiware/web dev
```

The Web Console will be accessible at `http://localhost:3000` and the Agent REST API at `http://localhost:3001`.

---

## ⚙️ Environment Configuration (`.env`)

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent` | PostgreSQL connection string (external or local) |
| `REDIS_URL` | `redis://localhost:6380` | Redis caching & rate-limiting endpoint (external or local) |
| `AGENT_PORT` | `3001` | Hono REST API server port |
| `DEFAULT_LLM_PROVIDER` | `openai` | Active provider: `openai`, `anthropic`, or `custom` |
| `DEFAULT_MODEL` | `gpt-4o` | Default reasoning model |
| `OPENAI_API_KEY` | `""` | OpenAI API Key |
| `ANTHROPIC_API_KEY` | `""` | Anthropic API Key |
| `CUSTOM_LLM_BASE_URL` | `https://api.9router.com/v1` | Custom / 9router proxy endpoint |
| `CUSTOM_LLM_API_KEY` | `""` | 9router or custom proxy API key |
| `DISCORD_BOT_TOKEN` | `""` | Discord Bot Token (Gateway operates in simulation/standby mode if omitted) |
| `DISCORD_CLIENT_ID` | `""` | Discord Application Client ID |
| `DISCORD_GUILD_ID` | `""` | Default Discord Server ID |

---

## 🛠 Features

### 1. Explicit ReAct Execution Loop
The agent reasons iteratively through user requests using a lightweight **Thought -> Action (Tool Call) -> Observation -> Answer** cycle:
- Multi-step reasoning with a maximum iteration guard (default: 8).
- Observes real outputs returned from database tasks and messaging actions.
- Automatically stores full session conversations and tool calls in PostgreSQL.

### 2. Multi-Channel Messaging Gateway
- **Platform-Agnostic Core:** The agent engine is decoupled from messaging platforms, allowing flexible routing to multiple chat channels.
- **Discord (Active):** Full support for Discord server operations, channel orchestration, role tasks, mentions, typing indicators, and rich embeds via `discord.js`. Automatic simulation/standby mode if no bot token is configured.
- **WhatsApp, Telegram, Slack (Upcoming):** Modular adapters in development to allow the agent to collaborate across various messaging apps with the same unified ReAct loop.

### 3. Extensible Skill & Tool Harness (`packages/skills`)
- **Task Management Skill:** `createTask`, `listTasks`, `updateTaskStatus`, `assignTask`.
- **Channel Operations Skill (Discord currently):** `createChannel`, `archiveChannel`, `listChannels`, `setChannelTopic` (with automatic simulation fallback if live token is omitted). Future channels (e.g. Telegram group management, WhatsApp broadcast) will follow this exact harness contract.
- Tool definitions are dynamically converted to OpenAI and Anthropic JSON Schemas.

### 4. Web Management Console (`apps/web`)
- **Dashboard Overview:** Health status cards for Postgres, Redis, Messaging Gateway, and Agent Engine.
- **Personality & Prompts Editor:** Live System Prompt tuning, Temperature slider (0.0 to 1.0), and Token limits.
- **Skills & Harnesses Manager:** Instant live toggle switches to enable/disable skills without restarting the agent, with an interactive parameter testing playground.
- **Task Kanban Board:** Workflow columns (Pending, In Progress, Completed), search, priority filtering, and task creation.
- **LLM Router Settings:** Switch between OpenAI, Anthropic, and 9router / custom OpenAI-compatible proxies.
- **Agent Playground:** Interactive chat sandbox with real-time ReAct loop step inspector (Thought, Tool Call, Observation).

---

## 🧪 Testing & Verification

Run the complete test suite (unit tests and end-to-end integration tests):
```bash
bun test
```

### Specific Suites:
```bash
# Skills Harness Unit Tests
bun test packages/skills/test/skills.test.ts

# Full REST API & ReAct Loop End-to-End Tests
bun test apps/agent/test/e2e.test.ts
```

---

## 📡 Core REST Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | System health for Database, Redis, and Messaging gateway |
| `GET` | `/api/agent/config` | Retrieve current agent system prompt and LLM settings |
| `PUT` | `/api/agent/config` | Update agent personality, prompt, and model config |
| `POST` | `/api/agent/chat` | Interactive chat endpoint executing ReAct loop |
| `GET` | `/api/skills` | List registered skills and tools |
| `PATCH` | `/api/skills/:id/toggle` | Toggle skill active state live |
| `POST` | `/api/skills/test` | Execute a tool directly with test parameters |
| `GET` | `/api/tasks` | List tasks with status/priority filtering |
| `POST` | `/api/tasks` | Create a new task in PostgreSQL |
| `PATCH` | `/api/tasks/:id` | Update task title, status, or assignee |
| `DELETE` | `/api/tasks/:id` | Delete a task |
