---
description: How to make a playbook for this server from what a person asks; the bot reads it before it drafts one with savePlaybook.
start: false
---
# Making a playbook

A person asked you for a skill, an SOP, a template or a workflow for this server. Here that is a playbook: steps you follow when someone starts it with its slash command or "@bot word: …". You save it with `savePlaybook`, and it applies to the whole server once they press Confirm on the card.

## Before you draft

Draft at once when the request says what the playbook starts from, what it produces, and where that goes. Otherwise ask one round of at most three numbered questions, each with your recommended answer worded so "yes" accepts it, and only about what would change the steps:

- what a person gives when they start it: a brief, a link, a pull request, nothing;
- what it produces and where: a reply, a file under `channel/`, an issue, a Task;
- which repository, Plane project or channel it works in, when that is not this one;
- the language it writes in, when it differs from the person's.

Never ask what you can look up with your tools.

## Writing it

- `name`: the slash command, short and lowercase, such as `release-notes`; never the name of a playbook that exists.
- `description`: one line saying what it does, under 100 characters.
- `words`: one or two words people would type after mentioning you, in their language, such as `rilis`; none that already starts another playbook.
- `body`: under 6000 characters, in the language of the request, without a `---` header. Write it to yourself:
  1. One line on what the thread starts from.
  2. Numbered steps, each one action, naming the tool when it matters (`readFile`, `repoMergeRequests`, `createTask`).
  3. What the result looks like: its sections, its length, where it is kept.
  4. When the work is done, and what to say then.
  Leave out what every turn already does: your policy, your reply style, confirmations, permissions.
- `requires`: only the skills whose tools the steps call, such as `git_repositories` for repositories, `task_management` for Tasks, `workspace` for files. Leave it out when the steps only talk.
- `run`: `in-place` when it answers once where it was started, such as a summary of one message; otherwise leave it out and it opens a thread.

Then call `savePlaybook`. Tell the person the card shows the whole playbook and nothing is saved until they press Confirm; to change something, they press Cancel and say what.

## Changing or deleting one

To change a playbook this server made, read its `PLAYBOOK.md` with `readPlaybookFile`, then call `savePlaybook` with its name, the `version` you read, and only the fields that change: leave out what stays. Change only what the person asked for. `deletePlaybook` deletes one, behind its own card. A built-in or tenant playbook cannot be changed or deleted from chat: say an admin changes it in the console.

## Example

"bikinin skill buat nulis release notes dari PR yang udah di-merge minggu ini": name `release-notes`, words `["rilis"]`, requires `["git_repositories"]`, and a body that reads the pull requests merged in the past seven days with `repoMergeRequests`, groups them under Fitur baru, Perbaikan and Lainnya, writes one line per pull request with its number, and posts the notes in the thread.
