# Pachiware Agent

An intelligent, self-hosted autonomous AI agent platform built with **TypeScript**, **Bun**, **Hono**, **PostgreSQL 18**, **Redis**, and **Discord.js**.

`pachiware-agent` features an explicit, lightweight **ReAct (Reasoning + Action) execution loop** with native tool calling, free from heavyweight frameworks like LangChain or Hermes. It is fully controllable via a **Web Management Console** and integrates directly into **Discord** for server operations and task management.

---

## 🏗 Architecture & Blueprint

```text
                                 +-----------------------+
                                 |    Discord Gateway    |
                                 |     (discord.js)      |
                                 +-----------+-----------+
                                             |
                                             v
+------------------------+       +-----------+-----------+       +------------------------+
|   Web Management GUI   | <---> |    Hono REST API &    | <---> |      Redis Cache       |
|    (apps/web: 3000)    |       |   Agent ReAct Loop    |       | (Session, State, Rate) |
+------------------------+       |   (apps/agent: 3001)  |       +------------------------+
                                 +-----------+-----------+
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
             |     PostgreSQL 18     |
             |     (packages/db)     |
             +-----------------------+
```

---

## 📦 Monorepo Structure

```text
pachiware-agent/
├── apps/
│   ├── agent/                 # Bun + Hono backend, ReAct loop, Discord bot, LLM Router
│   └── web/                   # Management console (Vite + React + Tailwind CSS + Lucide)
├── packages/
│   ├── db/                    # Drizzle ORM schema, PostgreSQL 18 connection, migrations & seed
│   └── skills/                # Tool definitions & execution handlers (Tasks, Discord, Custom)
├── docker-compose.yml          # PostgreSQL 18-alpine & Redis 7-alpine services
├── PROGRESS.md                # Phased development tracking and goals document
└── README.md                  # System overview and getting started guide
```

---

## 🚀 One-Line Server Installer & Global CLI

You can install, manage, and update the entire `pachiware-agent` platform directly from your terminal using the global **`pachiware`** CLI command.

### Option 1: One-Line Server Installer (Recommended)
Run this command on your server (Linux or macOS):
```bash
curl -fsSL https://raw.githubusercontent.com/pachiware/pachiware-agent/main/install.sh | bash
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
  init [dir]           Initialize or scaffold a Pachiware Agent deployment
  start [options]      Start PostgreSQL 18, Redis, Agent API, and Web Console
                       Options: -d, --daemon (background), --no-gui (API only)
  stop [options]       Stop running Pachiware Agent services (--all for Docker)
  restart              Restart all Pachiware Agent services
  status | health      Check live health of containers, DB, Redis, and Agent API
  logs [service]       Stream logs (agent, web, postgres, or redis)
  update               Pull latest updates, run migrations, rebuild UI & restart
  doctor               Diagnose system dependencies, Docker, ports, and .env
  chat <message>       Send a test prompt directly to the ReAct loop from terminal
  db:migrate           Run database migrations on PostgreSQL 18
  db:seed              Seed default agent personality and built-in skills
```

### 🔄 Updating with a Single Command
To update the platform to the latest version, run migrations, and recompile:
```bash
pachiware update
```

### 🩺 System Diagnostics
To verify that Docker, runtimes, and ports are clean:
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

---

## ⚙️ Environment Configuration (`.env`)

Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent` | PostgreSQL 18 connection string |
| `REDIS_URL` | `redis://localhost:6380` | Redis caching & rate-limiting endpoint |
| `AGENT_PORT` | `3001` | Hono REST API server port |
| `DEFAULT_LLM_PROVIDER` | `openai` | Active provider: `openai`, `anthropic`, or `custom` |
| `DEFAULT_MODEL` | `gpt-4o` | Default reasoning model |
| `OPENAI_API_KEY` | `""` | OpenAI API Key |
| `ANTHROPIC_API_KEY` | `""` | Anthropic API Key |
| `CUSTOM_LLM_BASE_URL` | `https://api.9router.com/v1` | Custom / 9router proxy endpoint |
| `CUSTOM_LLM_API_KEY` | `""` | 9router or custom proxy API key |
| `DISCORD_BOT_TOKEN` | `""` | Discord Bot Token (Bot operates in simulation mode if omitted) |
| `DISCORD_CLIENT_ID` | `""` | Discord Application Client ID |
| `DISCORD_GUILD_ID` | `""` | Default Discord Server ID |

---

## 🛠 Features

### 1. Explicit ReAct Execution Loop
The agent reasons iteratively through user requests using a lightweight **Thought -> Action (Tool Call) -> Observation -> Answer** cycle:
- Multi-step reasoning with a maximum iteration guard (default: 8).
- Observes real outputs returned from database tasks and Discord actions.
- Automatically stores full session conversations and tool calls in PostgreSQL.

### 2. Extensible Skill & Tool Harness (`packages/skills`)
- **Task Management Skill:** `createTask`, `listTasks`, `updateTaskStatus`, `assignTask`.
- **Discord Management Skill:** `createChannel`, `archiveChannel`, `listChannels`, `setChannelTopic` (features automatic simulation fallback if no live Discord bot token is provided).
- Tool definitions are dynamically converted to OpenAI and Anthropic JSON Schemas.

### 3. Web Management Console (`apps/web`)
- **Dashboard Overview:** Health status cards for Postgres 18, Redis, Discord Gateway, and Agent Engine.
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
| `GET` | `/api/health` | System health for Database, Redis, and Discord |
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
