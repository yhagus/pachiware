# Claude Code style skills become playbooks, not skills

Claude Code, Codex, and skill collections such as mattpocock/skills use "skill" for a Markdown file of instructions that a person starts by name (`/wayfinder`). In Pachiware that thing is a **Playbook**; a **Skill** stays a bundle of tools the agent may call. We import such collections as playbooks, and a person starts one from Discord as `/<name>`, so the clash shows only in the admin, never in chat.

## Considered options

- **Rename to match the industry**: Playbook becomes Skill, and today's Skill becomes a "Toolset". Rejected: it renames the `skills` and `tenant_skills` tables, the `/v1/skills` routes, the admin pages, and the glossary, for a word people only see in the admin.

## Consequences

- Imported instructions that say "call the Skill tool with X" are rewritten to load playbook X.
