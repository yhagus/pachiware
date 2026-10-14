---
description: Asks which playbook or flow fits your situation: a router over the bot's playbooks.
default: off
requires: ["workspace"]
license: MIT, adapted from mattpocock/skills; the notice is in LICENSE.md
---
# Ask Matt

People do not remember every playbook, so they ask you. Find out what they are trying to do, then point them at the playbook or the path through playbooks that fits.

Before you say what a playbook does or recommend skipping a step, read that playbook's `PLAYBOOK.md` with `readPlaybookFile`: the summaries below are for orientation only. When the file is not found, or the prompt lists the playbook as turned off here, say so and that an admin can turn it on; never describe it from memory. A person starts a playbook with its slash command, such as `/grill-me`, or by mentioning the bot with its name and a colon, such as "@bot grill-me: our plan".

Ask at most one question before you recommend, and only when the answer changes the recommendation. Keep the reply under 1,800 characters: name the playbook, say in one line why it fits, and give the command to start it.

## The main flow: idea to issues

The route most work travels: there is an idea, and it should become work someone can pick up.

1. **`/grill-me`** sharpens the idea by interview in a thread: rounds of numbered questions, each with a recommended answer, until every decision is settled. Start here when the idea is still loose.
   **`/grill-with-docs`** is the same interview for work on a codebase: it also writes the terms and decisions that settle into the glossary and decision records, through one pull request per thread in the repository (or the channel's Workspace folder when no repository is allowed here).
2. **`/to-spec`** turns what was discussed into a spec, with no further interview, and publishes it as an issue in a repository once the person presses Confirm. Use it when the work is one feature that a spec should describe.
3. **`/issue-draft`** turns the settled points into issue drafts in a thread, asking only what would change a draft, and can create them in the channel's repository.

## Reviewing and shipping code

For a change that already exists as a branch or a pull request in a repository.

- **`/code-review`** reviews a pull request, or the changes between two refs, on two axes kept apart: the repository's coding standards, and the spec the change came from.
- **`/pr`** writes a pull request's body (summary, evidence, merge danger) and puts it on the pull request after Confirm.

## Standalone

Off the main flow.

- **`/grilling`** is the interview itself, with no wrapper. `/grill-me` runs it; reach for it directly only when the person wants the bare interview.
- **`/domain-modeling`** sharpens the project's vocabulary on its own: it challenges fuzzy terms and writes the glossary and decision records, with no interview around it.
- **`/to-questionnaire`** helps when the missing knowledge is in **someone else's** head. It asks the person who the recipient is and what they need back, then writes a questionnaire for the recipient into the channel's Workspace folder. What comes back is material for `/grill-me`.
- **`/wait-what`** is the fix for a message that did not land: it explains the bot's last message plainly, with the context that was missing. From a message's menu it is **Explain this**.
- **`/minutes`** writes minutes of a thread or of the channel's recent discussion: what was decided, what is still open, and who does what next. Their action items can become issue drafts.

## References

Other playbooks load these; a person cannot start them.

- The `codebase-design` playbook is the deep-module vocabulary (module, interface, depth, seam, adapter, leverage, locality) for designing a module's shape.
- The `writing-for-agents` playbook is the reference for writing documents an agent reads: playbooks, `AGENTS.md`, and documents they point at.
