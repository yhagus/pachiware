# A Changelog draft is worked on until it ends or pauses

On 2026-10-23 the Velodiva changelog needed "lanjut" again and again. A cut turn went on by itself at most five times, a turn the model ended itself waited for the person, anyone's message ended the chain, and a restart lost it. A changelog of a thousand endpoints needs many 15-minute turns.

Decided with the user on 2026-10-23: an open Changelog draft is worked on turn after turn, with no limit on the number of turns. It ends when it is written (or published), or when its asker stops it. Otherwise it goes on until it pauses, which happens only when:

- the model asks its asker something through `askChangelogAsker`;
- the asker presses Stop;
- the model cannot be reached after one retry, made after the tenant's model retry wait (60 seconds by default, 0 to 600);
- GitLab, GitHub or Plane fail in a way that does not heal: authentication refused, the repository or branch gone, or three 5xx or timeouts in a row;
- two turns in a row add nothing to the draft.

Any turn there that goes on with a paused draft, from anyone, has it worked on again. The draft itself records that it is being worked on, so the agent picks it up again when it starts and on every scheduler pass.

## Considered options

- **A higher cap on continuations.** Rejected: any number is too small for some repository, and each cap reached is one more "lanjut".
- **A turn the model ends itself waits for the person (#351, grilling Q18).** Rejected: that was the main cause of repeated "lanjut". Only a question to the asker, through its own tool, pauses.
- **A person's message ends the chain (Q21).** Rejected: talk in the thread would stop the work. The message goes first, then the work goes on.
- **A row in `schedules` of its own kind.** Rejected: it would duplicate state the draft already keeps.
- **A chain held in memory (Q23).** Rejected: work of hours must outlive a restart.
- **A fixed ceiling of hours or tokens.** Not now. Two turns without progress pause it, and the asker sees the progress and can press Stop. A ceiling waits for real costs.

## Consequences

- A turn that goes on by itself starts from the draft alone: the files examined and left, the operations, the notes, the repository's conventions summary (at most about 1,500 tokens, written in the playbook's step 2), and the previous turn's closing summary. It stores only that closing summary in the conversation; its steps go to the Agent log and the audit. Its cost stays flat however long the work runs, though part of an endpoint traced when a turn was cut may be read again.
- A person's message goes first and is answered as usual. A turn that only talks leaves a paused draft paused and does not count against progress.
- The final answer and every pause ping the asker alone. The turns in between stay silent under one progress message. After a restart that message is edited again, or replaced when it is gone, and its Stop button works again.
- A pause answer names only where it failed ("GitLab", "Plane", "model AI"). The host, status and error go to the Agent log and the audit event `changelog_draft_paused`.
- Only Changelog drafts work this way; other long playbooks keep two continuations. There is no limit on how many drafts a tenant works on at once; each place has at most one.
- For Changelog drafts this replaces the continuation rules of #351 (grilling Q12, Q18, Q21, Q23). ADR 0024's workers trace candidates that the draft keeps across turns; see its amendment.
