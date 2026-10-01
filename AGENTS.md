## 🎯 Project Overview & Mission
`pachiware-agent` is a self-hosted personal AI assistant designed to centralize daily workflows, offload repetitive tasks, manage Discord channels, and track tasks. It features a Web GUI for live management of system prompts, skills, and LLM routers.

---

## 🛠 Tech Stack Architecture
- **Runtime:** Bun (native TypeScript execution)
- **Backend Framework:** Hono (HTTP Webhooks & Web Management REST API)
- **Discord Client:** `discord.js` (WebSocket Gateway for real-time channel & event listening)
- **Database Engine:** PostgreSQL 18 (Primary data store for tasks, skills, prompts, settings, and chat history)
- **Cache / Storage:** Redis (Session state, rate-limiting, and async queue execution)
- **ORM / Query Builder:** Prisma or Drizzle ORM
- **Frontend Management GUI:** Next.js (App Router) or Vite + React with Tailwind CSS & Shadcn UI
- **LLM Integrations:** Direct SDK calls supporting OpenAI, Anthropic Claude, or custom proxy endpoints (e.g., `9router`)

---

## ⚠️ MANDATORY TOKEN & PROGRESS MANAGEMENT RULES

To prevent context window overflow, broken builds, or lost progress across multi-turn sessions:

1. **Maintain `PROGRESS.md`:**
   - Always create and update `PROGRESS.md` in the repository root.
   - List overall project goals, phase breakdowns, and granular task checklists (`[ ]` / `[x]`).
   - Update `PROGRESS.md` **at the end of every task or phase** before concluding your response.
2. **Modular & Incremental Development:**
   - Execute phase-by-phase. Never generate the entire codebase in a single step.
   - Verify that current code compiles cleanly before marking a step as complete.
3. **Transparent State Logging:**
   - Document any architectural decisions or blocking issues in `PROGRESS.md`.

---

## 🚀 Target Workspace Structure

```text
pachiware-agent/
├── apps/
│   ├── agent/        # Bun + Hono + Discord.js backend & agent loop
│   └── web/          # Frontend Web Management GUI
├── packages/
│   ├── db/           # PostgreSQL ORM models & migrations
│   └── skills/       # Built-in agent skills (Discord, Tasks, etc.)
├── docker-compose.yml # PostgreSQL 18 & Redis infrastructure
├── PROGRESS.md       # Live tracking of implementation status
├── AGENTS.md         # Instructions for AI coding tools (this file)
└── README.md         # Project documentation