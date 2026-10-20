# A Routine reads only, as its owner, with nobody there

A Routine carries out an instruction at a time someone chose ("simpulkan tugasku setiap jam 9 pagi"), then posts what it found. It runs as one turn of the bot's agent loop. Nobody is in the conversation while it runs, so nobody can answer a question, press Confirm, or notice a wrong reading before it acts. That shapes three decisions.

**It reads only.** The turn runs with `readOnly`, as the console's Playground does: only tools whose effect is `read` are offered, and the Discord adapter refuses everything that would change Discord. A Routine can summarise tasks, search the Workspace or read a repository, and it changes nothing: no task, file, Reminder or message besides its own post. A write tool that needs no Confirm would still act on a model's reading that nobody checked, every day it repeats.

**It runs as its owner, as they are at that time.** The turn's speaker is the person who set it. Their roles and permissions are read again when it runs, not stored. The Source and quotable rules apply as if they had asked in that channel then. If they have left the server or can no longer view the channel, it does not run, and the row ends with the reason.

**Its time comes from the owner's own words.** `said` quotes them and `whenWords` reads them. The arguments must agree with that reading, and what the words leave open is asked about before anything is set. A fixed card then shows every detail. The same rule applies to Reminders.

## Considered options

- **Offer the write tools that need no Confirm.** Rejected: an unattended write repeats a misreading on schedule, and nobody can stop the run in which it happens.
- **Store the owner's permissions with the Routine.** Rejected: someone who lost access would keep reading what they no longer may.
- **Let the model fill in morning or evening, with the card to catch mistakes.** Rejected at the user's request. A Routine set for the wrong half of the day may run before anyone reads the card.

## Consequences

- A Routine costs one model turn per run, so a person may keep 10 active and a tenant 100, against 50 and 500 Reminders.
- Runs go through `manager.background` on one chain per bot, so a slow model never holds up the minute's Reminders, Digests or Daily logs. If the process stops during a run, that run is lost rather than run twice.
- A run that fails at the provider tells its owner in the channel and keeps the error on the row. A run more than six hours late is skipped, as a Reminder is.
