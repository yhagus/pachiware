# Pachiware Agent

**English** | [Bahasa Indonesia](README.id.md)

A self-hosted AI assistant for chat, task management, and Discord automation. The web dashboard lets you configure AI models, system prompts, skills, tasks, and multiple Discord bots.

This repository uses Bun + Hono for the backend, React + Vite for the dashboard, Drizzle for SQLite/PostgreSQL 18, and Discord.js for bots. Redis is optional; without it, caching uses memory. Each tenant has separate data and configuration. Signup and billing applications are not included.

## Before You Install

- Use Linux or macOS with terminal access and an internet connection.
- Bun **1.4.0 or newer** is required. The installer installs Bun if it is missing. If you already have an older version, run `bun upgrade` first.
- Docker with Compose is required only when choosing the bundled PostgreSQL option.
- Have an LLM provider API key ready to start chatting. A Discord token is required only if you want to use a bot.

## Installation

Choose one of the following methods. Both run the same setup workflow.

### Method 1: One-Command Installer

```bash
curl -fsSL https://raw.githubusercontent.com/yhagus/pachiware/main/install.sh | bash
```

The installer places the application in `~/.pachiware`, installs dependencies, builds the `pachiware` CLI, and opens interactive setup in your terminal.

### Method 2: From the Repository

Use this method to inspect or develop the source code. Git must already be installed.

```bash
git clone https://github.com/yhagus/pachiware.git
cd pachiware
bash install.sh
```

The application uses your cloned repository as its installation directory.

### Choose a Database During Setup

| Option | Best for | What you need |
| --- | --- | --- |
| **SQLite** | Getting started with minimal configuration | No additional services; data is stored in `data/pachiware.db` |
| **External PostgreSQL** | Using an existing database | PostgreSQL 18 and a connection URL: `postgresql://user:password@host:5432/database` |
| **PostgreSQL 18 Docker** | Running the database and Redis on your own machine | Docker running; setup starts the containers and waits until they are ready |

Choose **SQLite** if you do not need PostgreSQL yet. Setup creates local configuration, runs migrations and seed, and provisions the default tenant and automatic dashboard access. New installations generate platform and encryption keys automatically.

For an automated installation without prompts, this example selects SQLite:

```bash
curl -fsSL https://raw.githubusercontent.com/yhagus/pachiware/main/install.sh | PACHIWARE_DATABASE=sqlite bash
```

Other options are `PACHIWARE_DATABASE=docker`, or `PACHIWARE_DATABASE=postgres` with `PACHIWARE_POSTGRES_URL`. Without an interactive terminal or an explicit choice, new installations default to SQLite.

The database engine cannot be changed after setup. The first successful migration records it as `databaseEngine` in `runtime-config.json`, and the application refuses to start when `DATABASE_URL` points at another engine. The error names both engines. A URL with an unknown scheme also stops the start; an empty `DATABASE_URL` uses the SQLite default.

You can still change the address of the same engine, for example a new host or a rotated password. Edit `DATABASE_URL` in `.env` on the server, and `databaseUrl` in `runtime-config.json` if it is there, then restart. The dashboard shows the engine and host but cannot change them.

### Start Over on Another Database Engine

There is no command for this, and records are not moved between engines. To start over, for example after a trial on the wrong engine:

1. Stop the application.
2. Remove the `databaseEngine` line from `runtime-config.json`, and `databaseUrl` too if it is there.
3. Run `pachiware init` and choose the new engine.

The new database starts empty. The old one is not deleted: the SQLite file stays in `data/`, and a PostgreSQL database stays on its server until you remove it yourself.

## Start the Application and Open the Dashboard

After the installer finishes:

```bash
pachiware start
```

If you use PostgreSQL Docker, use this command to ensure the containers are started too:

```bash
pachiware start --docker
```

Open **http://localhost:3000**. After successful CLI setup, the dashboard connects automatically without repeating the setup wizard or asking for an operator API key. Keep the terminal running; `Ctrl+C` stops the application.

If your terminal does not recognize `pachiware`, open a new terminal. For the default installation, you can also run the CLI through `~/.pachiware/bin/pachiware`.

If you installed on a remote server, create a tunnel from your computer to access the dashboard through localhost:

```bash
ssh -L 3000:127.0.0.1:3000 user@server
```

Keep the SSH connection open, then visit `http://localhost:3000` on your computer. Automatic access is available only through localhost; direct access through the server's IP address requires operator credentials.

## Finish Configuration and Start Using Pachiware

### 1. Connect an AI Model

In **LLM Router**, choose OpenAI, Anthropic, or a custom OpenAI-compatible endpoint. Enter your API key, base URL if needed, and a model name available from your provider. Test the connection, then save the configuration.

### 2. Try Chat and Tasks

Open **Agent Playground** and send a message to confirm that the model responds. Adjust the agent's behavior in **Personality & Prompts**, then enable the tools you need in **Skills & Harnesses**. Try asking the agent to create a task, then check the result in **Task Kanban**.

The dashboard works before you configure an LLM, but chat requires valid provider credentials.

### 3. Connect Discord (Optional)

1. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Enable **Message Content Intent**, then invite the bot to your server with permissions to view channels, read message history, and send messages. Grant channel management permissions if you want to use the channel management tools.
3. In **Discord Bots**, add a name and bot token. Fill in the Application ID and Guild IDs if needed, then save with **Enabled** checked.
4. Check the connection status, then mention the bot or send it a DM to try a conversation.

Your installation is ready when the dashboard connects, chat receives a model response, and the bot connects if you use Discord.

## Everyday Commands

| Command | Purpose |
| --- | --- |
| `pachiware start` | Start the backend and dashboard |
| `pachiware start --docker` | Start bundled PostgreSQL/Redis and the application |
| `pachiware status` | Check service status |
| `pachiware doctor` | Check configuration and connectivity |
| `pachiware stop` | Stop the application |
| `pachiware update` | Fetch updates and run migrations |
| `pachiware --help` | Show all commands |

For older installations with incomplete setup, run `pachiware init` followed by `pachiware start`. If the wizard still appears, review the setup output and run `pachiware doctor`; make sure the selected database is reachable.

Before updating, back up your database and configuration files in the installation directory: `.env`, `runtime-config.json` if present, and `operator-access.json`. Keep the encryption key with your backup; it is required to read stored credentials.

## Repository Layout

```text
apps/agent/       Backend, agent loop, LLM and Discord integrations
apps/web/         Management dashboard
packages/db/      Schema, migrations, seed, and encrypted storage
packages/skills/  Built-in tools
packages/cli/     Setup and service management
PROGRESS.md       Implementation status and verification results
```

Integration documentation is available in the [API Reference](docs/api.md). For development, run repository checks with `bun test`, `bun run typecheck`, and `bun run build`.
