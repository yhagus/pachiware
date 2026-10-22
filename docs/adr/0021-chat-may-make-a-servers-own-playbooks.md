# Chat may make a server's own playbooks, behind the asker's Confirm

Until now playbooks changed only in the console, because a playbook is rules the agent follows. Decided with the user on 2026-10-22: a person may ask the bot in chat to make a playbook ("bikinin skill buat nulis release notes kita"), and the bot saves it for that guild only, under the guild's Workspace folder. Anyone the bot answers in the guild may ask, but nothing is saved until the asker presses Confirm on a card that shows the whole change; a thread's grant does not cover it. A playbook made this way never replaces a built-in or tenant playbook: those always win by name, and they change only in the console.

## Considered options

- **The whole tenant.** Rejected: one server's way of working would appear in every other server of the tenant, and its name could take a command another server needs.
- **One bot.** Rejected: bots are identities, not teams. Two bots in one server would each need their own copy, and the Workspace keeps nothing per bot.
- **One channel.** Rejected: Discord registers commands per guild, so the command would still show in every channel and be refused in all but one, and a team's way of writing release notes spans its channels. A channel rule can still turn it off.
- **A server's playbook wins over the tenant's or a built-in of the same name.** Rejected: text written in chat would silently replace text an admin chose, and the built-in commands could be pushed past Discord's limit.
- **Let the Workspace tools write the `playbooks/` folder.** Rejected: one tool is the only way in, so every save is checked and confirmed the same way.
- **Only Trusted members may make one.** Rejected by the user: the asker's own Confirm, an availability rule on the tool, and the record of who made each one are enough for a team's own steps.

## Consequences

- Chat sets the name, description, trigger words, required skills, loaded playbooks and whether it runs in a thread or in place. Context menus, `default`, closed tools, references and a required repository stay console-only. A server keeps at most 25 of its own playbooks.
- Availability rules name a server's playbook only at that guild or its channels; a tenant or bot rule cannot, since the name may mean something else in another server. To stop chat-made playbooks everywhere, an admin turns the tool off.
- When the tenant later adds a playbook with the same name, the server's copy is hidden, not deleted, and the threads that followed it stop at their next message, as they do when it is deleted.
- ADR 0004 kept "skill" out of chat. People will now ask for a "skill", and the bot answers with a playbook.
