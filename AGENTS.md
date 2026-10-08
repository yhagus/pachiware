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
- **Frontend Management GUI:** Vite + React 19 + react-router with Tailwind CSS v4 & shadcn/ui (admin portal)
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
```


<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read these installed skill files directly (use these paths even if a same-named global skill exists):
- Core filter, always on: `antislop`: `.claude/skills/antislop/SKILL.md`
- UI / visual: `antislop-ui`: `.claude/skills/antislop-ui/SKILL.md`
- Copy & text: `antislop-copywriting`: `.claude/skills/antislop-copywriting/SKILL.md`
- Mobile / responsive: `antislop-layoutmobile`: `.claude/skills/antislop-layoutmobile/SKILL.md`
- People: `antislop-human`: `.claude/skills/antislop-human/SKILL.md`
- Code comments: `antislop-code`: `.claude/skills/antislop-code/SKILL.md`
Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session instruction first, then global preference, then ask. A session instruction always wins. For a resolved mode, say `antislop active: <mode> (session override).` or `antislop active: <mode> (global preference).` once before presenting findings or making edits, using the actual mode and source. Acknowledging the user's request without naming the source does not replace this notice.
Only an explicit choice of antislop during or after selects a session mode. A request to review, audit, or avoid file edits does not select a mode; read the global preference in that case. Another skill's mode does not select antislop's mode.
If the mode is unresolved, ask during/after and end the response; wait for the answer before any UI review, planning, or concept. For read-only tasks, put the active-mode notice only at the start of the final answer, never in progress messages. For editing tasks, announce before the first edit and omit it from the final answer.
To update antislop later: `npx antislop-ai --update`, or run `npx antislop-ai` and pick Overwrite them.
<!-- antislop:end -->
## Agent skills

### Issue tracker

Issues live in GitHub Issues for `yhagus/pachiware` (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
