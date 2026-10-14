# Playbook mechanics

The playbook-specific branch of the `writing-for-agents` playbook: what changes when the document is a playbook (frontmatter, the choice between a startable playbook and a reference, and router playbooks). Everything else about writing it is the universal reference in that playbook's `PLAYBOOK.md`.

A playbook is a folder named after it, holding `PLAYBOOK.md` and any files its steps point at. The agent reads those files with `readPlaybookFile`. A playbook says how to think and in what steps; the tools it uses come from skills.

## Frontmatter

One `key: value` per line; a value in JSON form (a list, an object, a quoted string) is read as JSON.

- `description`: one line a person reads in the slash command picker and the console.
- `trigger`: `{"menu": "<label>"}` gives the playbook a message context-menu command. Every startable playbook already starts with `/<name>` and with "@bot <name>: <text>".
- `requires` and `optional`: the skills the playbook needs, and the ones it uses when they are on.
- `loads`: playbooks whose text joins this one's at start, bringing their required skills and closed tools.
- `closes`: tools the playbook withholds in its threads.
- `run: in-place`: the playbook answers where it was started, in one turn, instead of opening a thread.
- `start: false`: a reference; see below.
- `default: off`: the playbook stays off until the tenant turns it on.

## Startable or reference

Two choices, trading the two loads:

- A **startable** playbook gets a slash command, a mention trigger, and optionally a menu label. A person starts it by name; the agent never starts one on its own. Each command sits in every server's picker, so it spends the person's cognitive load: they are the index that must remember it exists.
- A **reference** (`start: false`) cannot be started. Other playbooks reach it through `loads`, which adds its text to their prompt at start. A reference that is all reference material is the one home for knowledge several playbooks need, so it lives in one place.

Make a playbook startable only when a person must start it by name. If only other playbooks need it, make it a reference and keep it out of the picker.

## Splitting by invocation

The invocation cut of splitting (the sequence cut lives in the `writing-for-agents` playbook): split off a reference when two or more playbooks need the same material, or a startable playbook when people have a distinct reason to start it on its own. Every load adds the reference's whole text to the prompt, so the shared reach has to be worth it.

## Router playbooks

When startable playbooks multiply past what people can remember, that piled-up cognitive load is cured by a **router playbook**: one startable playbook that names the others and when to reach for each, so a person has one playbook to remember instead of many. It can only point, never start them: only a person starts a playbook.
