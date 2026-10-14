# Playbook documents live in the target repository

Imported playbooks such as grill-with-docs and domain-modeling write a glossary and architecture decision records. When the playbook thread has a repository, those files go into that repository through one branch and one pull request per thread, and tracker playbooks (wayfinder, to-tickets, triage) keep their state as issues there. This is an exception to ADR 0003, which keeps the agent's data in the Workspace: these documents describe the team's code, so they belong next to it, where the team reviews and versions them.

## Considered options

- **Always in the Workspace.** Rejected: the glossary and decisions about a codebase would live away from the code and the team's review, and nobody outside Discord would see them.
- **Commit straight to the default branch.** Rejected: it skips review and needs the owner-only write.

## Consequences

- Without a repository allowed by git scope, the glossary is a file in the channel's Workspace folder and each ADR is written as a **Decision**; tracker playbooks refuse to start.
- Every commit to the pull request passes git write confirmation like any other git change.
