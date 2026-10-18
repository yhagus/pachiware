## 🎯 Project Overview & Mission
`pachiware-agent` is a self-hosted personal AI assistant designed to centralize daily workflows, offload repetitive tasks, manage Discord channels, and track tasks. It features a Web GUI for live management of system prompts, skills, and LLM routers.

---

## ⚠️ MANDATORY TOKEN & PROGRESS MANAGEMENT RULES

To prevent context window overflow, broken builds, or lost progress across multi-turn sessions:

1. **Maintain `PROGRESS.md`:**
   - Always create and update `PROGRESS.md` in the repository root.
   - `PROGRESS.md` may contain only phase progress and details belonging to each phase, including granular task checklists (`[ ]` / `[x]`).
   - Never add a new category section to `PROGRESS.md`. Record task results, verification, decisions, and blockers under the relevant phase; create a new phase only when the work actually defines a new project phase.
   - Update `PROGRESS.md` **at the end of every task or phase** before concluding your response.
2. **Modular & Incremental Development:**
   - Execute phase-by-phase. Never generate the entire codebase in a single step.
   - A step is complete when `bun run typecheck` exits 0 and `bun run test` passes. Git hooks in `.githooks/` run them on commit and push (`bun install` wires them).
   - **Tautological tests are considered harmful.** A test takes its expected value from an independent source of truth: a known-good literal, a worked example, the spec. A test that recomputes the expected value the way the code does, or asserts a constant against itself, passes by construction; rewrite it against an independent source or delete it.
3. **Transparent State Logging:**
   - Document architectural decisions or blocking issues under the relevant phase in `PROGRESS.md`.

---

## 🚀 Workspace Structure

```text
apps/agent/      # Bun + Hono + discord.js backend, agent loop, scheduler; tests in apps/agent/test, eval in apps/agent/eval
apps/web/        # Vite + React admin GUI (own tsconfig)
packages/cli/    # `pachiware` CLI (install.sh at the root installs servers)
packages/db/     # repositories (SQL and MongoDB), migrations, engine lock, runtime config, crypto, default persona; contract suites in packages/db/test/contract
packages/skills/ # built-in agent skills and the Workspace store
docs/            # adr/, agents/, research/, api.md
```

Working on Tasks, Assignees, Progress notes, task lists, the Digest or Reminders with tasks: read `docs/agents/tasks.md` first.

Adding or changing records, a repository method, a field, or a migration on any Database engine: read `docs/agents/database-engines.md` first.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `yhagus/pachiware` (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
