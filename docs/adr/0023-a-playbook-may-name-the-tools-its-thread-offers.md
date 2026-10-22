# A playbook may name the tools its thread offers

A playbook thread offered the model every tool available at that place, and a long turn sent them again on every step. In the contract-diff thread of 2026-10-22 that was about 28,000 of the 33,000 tokens the first call started with, sent 66 times, while the playbook uses 15 tools worth about 3,200 tokens. Decided with the user on 2026-10-23: a playbook may list in its frontmatter the tools its thread offers (`tools:`), and its thread then offers only those. Availability rules and git or Plane scopes still apply on top, so the list only narrows. contract-diff names its 15 tools, and a playbook without the list offers what it did before.

## Considered options

- **Only `closes`.** Rejected: to leave 15 tools open it would have to name about 200 others, and it goes stale whenever a skill gains a tool.
- **Narrow by the skills in `requires`.** Rejected: git_repositories alone has 95 tools, its writes and administration among them.

## Consequences

- In a thread whose playbook names its tools, a request outside the playbook, such as making a task, gets no tool for it. The person asks in the channel instead.
- Like `closes`, the list is set only in the console. A playbook made in chat cannot set it (ADR 0021): what an admin closes or leaves out never reaches chat, which also keeps it out of the model's input.
