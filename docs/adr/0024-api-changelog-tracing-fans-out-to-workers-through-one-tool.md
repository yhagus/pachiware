# API changelog tracing fans out to workers through one tool

The API changelog of 2026-10-22 covered one commit, eight files and one to three endpoints. It took 66 model calls and 5.09 million prompt tokens, passed its 15 minutes, and recorded nothing: every step sent the whole turn again, which grew from 33,000 to 125,000 tokens. Decided with the user on 2026-10-23: contract-diff's main loop still pins the range, learns the repository's conventions and finds the candidate endpoints. It then hands every candidate to one tool, `traceEndpoints`, and the code runs one worker per endpoint. Each worker is an unstored loop run that gets a brief (repository, both commits, the draft, its endpoint, extensions.md, and a summary of the conventions of at most about 1,500 tokens) and six tools (the repository reads, `putChangelogOperation`, `putChangelogComponents`). It records its endpoint itself. The main loop then validates, writes and publishes, so its own context never holds the files the workers read.

## Considered options

- **A general `delegate` tool, with the model writing each worker's task.** Rejected for now: its work is harder to bound and to test. A general form waits for a second playbook that needs one.
- **Workers return text and the main loop records it.** Rejected: the main loop's context would grow again.
- **The main loop traces a single candidate itself.** Rejected: that is two paths to test, and the files read would still pile up in the main loop.
- **One worker per changed file.** Rejected: the endpoint is what gets recorded and validated.
- **The worker limit in an environment variable, a Profile, or per bot.** Rejected by the user, in favor of a tenant setting. A provider's rate limit belongs to its key, which the tenant's bots share. The tenant's settings already hold the loop's other budgets and need no migration.

## Consequences

- A worker has 20 steps and 5 minutes, and it records its endpoint before it stops, marking what it could not prove as unverified. A worker that fails or records nothing comes back as failed, and the main loop lists that endpoint as unverified in the notes. It is not traced again in the same turn.
- At most `playbookWorkers` workers run at once for each running changelog. This is a tenant setting, 3 by default, between 1 and 5. Two changelogs running at once on one key can double that, and a 429 is left to the router's backoff.
- Workers use the bot's Profile and its fallbacks.
- Workers write the same draft safely: `withDraft` writes one call at a time for each draft and checks the file's version.
- One Discord message, edited in place, shows the run's progress and each endpoint's result as its worker records it. The report and the preview link go in a new message.

## Amended by ADR 0025

A changelog of a thousand endpoints does not fit one turn, so the draft keeps each candidate endpoint as waiting, traced or failed, and `traceEndpoints` traces waiting ones while the turn has time; a later turn goes on with the rest. A worker that fails because the model could not be reached leaves its candidate waiting, and the draft pauses. Any other failure stays failed and is listed as unverified, and the candidate is never traced again by itself. The conventions summary is kept in the draft, where turns that go on by themselves read it too.

## Amended by ADR 0026

The main loop no longer finds the candidate endpoints. Mapping workers map every changed file first, and `traceEndpoints` refuses until each one is mapped and the draft holds the conventions summary. Candidates are no longer handed over as soon as they are found.
