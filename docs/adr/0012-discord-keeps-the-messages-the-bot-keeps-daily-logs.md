# Discord keeps the messages; the bot keeps Daily logs

To answer questions about talk nobody asked to keep, the bot writes a Daily log of each opted-in channel every night from Discord's history, and keeps no copy of the raw messages. Each item of a Daily log links to the messages it rests on, and the bot follows a link when someone needs the exact wording. This holds less personal data, needs no new storage and no deletion job, and a message a person deletes in Discord is gone for the bot too.

## Considered options

- **A Message archive kept for 30 days beside the Daily logs.** Rejected: a second copy of every person's messages, a deletion job to keep the limit, and faster exact-wording lookups were the only gain; the link costs one extra tool call.
