# Live evals

This folder holds two evals that compare profiles on the same work, graded the same way: the **issue-draft eval** (how well the issue-draft playbook turns a brief into drafts) and the **daily-behaviour eval** (everyday assistant work: tasks from casual wording, relative due dates, status changes, remember and forget, file search, Reminder creation, and project work: assignees, Progress notes, cancelling, ambiguous references, and a person's tasks across channels, and questions about kept Minutes, Decisions, Notes and Documents across channels). The decisions behind the first are in issue #28; the research is `docs/research/evaluating-issue-drafts.md` on the `research/evaluating-issue-drafts` branch. The second follows spec #72, block 8, spec #120 for project work, and spec #146 for kept material.

Two halves, for both:

- **Code checks** run on every `bun test` over the recorded outputs in `recorded/` (`apps/agent/test/eval-*.test.ts`). The judge, comparison and report code is tested there too, with a scripted model and a scripted judge. None of these tests need a key.
- **The live eval** (`drafts.eval.ts`, `assistant.eval.ts`) runs only on demand. It drives the real bot through the Discord scenario harness with real profiles; the issue-draft eval runs against this repository at the commit pinned in `repository.yaml`, served offline, and the daily-behaviour eval against a fixed clock. A pinned judge grades every trial. Neither gates CI.

## Running a live eval

```sh
EVAL_LIVE=1 \
EVAL_PROFILES=apps/agent/eval/profiles.yaml \
EVAL_JUDGE_PROVIDER=anthropic EVAL_JUDGE_MODEL=<judge model> EVAL_JUDGE_API_KEY=<key> \
bun run eval              # issue drafts
bun run eval:assistant    # daily behaviours
```

| Variable | Meaning |
|---|---|
| `EVAL_LIVE=1` | Without it the file only reports a skipped test. |
| `EVAL_PROFILES` | Path to the profiles to compare. Copy `profiles.example.yaml` to `profiles.yaml` (gitignored). Each profile names the env variable holding its key (`apiKeyEnv`), and may give a `price` in USD per million tokens and `acceptsImages`. |
| `EVAL_PROVIDER`, `EVAL_MODEL`, `EVAL_API_KEY`, `EVAL_BASE_URL`, `EVAL_ACCEPTS_IMAGES=1` | One profile, used when `EVAL_PROFILES` is unset. |
| `EVAL_JUDGE_PROVIDER`, `EVAL_JUDGE_MODEL`, `EVAL_JUDGE_API_KEY`, `EVAL_JUDGE_BASE_URL` | The judge: `openai` (default), `anthropic`, or `custom` with a base URL. Model and key are required. |
| `EVAL_TRIALS` | Trials per brief and profile, default 3. |

The run refuses to start when the judge's model is any compared profile's model (a vendor prefix such as `anthropic/` is ignored when comparing). A model grades its own output too kindly, so keep the judge outside the comparison.

Each trial runs in its own subprocess. Results land in `results/<run>/` (`results/assistant-<run>/` for the daily-behaviour eval): one JSON per trial under `trials/`, then `report.json` and `report.md` once every trial is done. Both reports record the judge's provider and model, the rubric version, the number of trials, and, for issue drafts, the pinned commit. Failed trials are never retried; a retry would hide exactly the variance the trials measure.

## How a draft is graded

Cheapest layer first:

1. **Code checks** (`checks.ts`): the draft checker's limits (title, acceptance criteria, open questions, body size), proposed labels exist in the repository, every Context used link resolves at the pinned commit, no stock filler, and the draft is in the brief's language.
2. **Judge** (`judge.ts`), one isolated call per criterion. The judge sees the brief, the author's answers and the fixture's reference facts, reasons first, and ends with `yes`, `no` or `unknown`:
   - per must-cover fact: do the brief's drafts, taken together, cover it?
   - per question the bot asked (round questions and the drafts' own open questions): does it probe a known gap or a real ambiguity?
   - per draft: is every statement about the repository supported by the allowed repository facts, the brief, the answers, or the files under Context used?

A draft **passes** when it passes every code check, the brief's drafts cover at least 80% of the must-cover facts, and the judge does not answer `no` on the draft's repository statements. `unknown` never counts as covered, and an `unknown` on repository statements does not fail a draft. Question quality is reported as a rate, not a gate. A judge call that errors counts as `unknown`, with the error as its reasoning.

## How a daily-behaviour turn is graded

A daily-behaviour brief is a short conversation: the brief, then follow-ups in the thread the bot opened. After every turn the runner (`assistantRun.ts`) records the bot's replies and the state a person could see: the channel's tasks (title, status, due date, assignee, creator, Progress notes), plus those of any other channel the brief seeded tasks in, marked with that channel, the channel's and the server's Memory lines, the files under `files/`, and the Reminder rows. The grade is per turn, so a trial's score is the share of its turns that pass, in place of the share of drafts.

1. **Code checks** (`assistantChecks.ts`), against the `turns` entry of `facts.yaml` for that turn: the bot replied; no Confirm button was offered (task writes, Memory and Reminders need none); nothing was pinged (only a Reminder post pings); an ambiguous turn left the Workspace as it was; the tasks match (each expected task is found by a phrase of its title, then status, `dueAt`, assignee, creator and channel are compared when given, `notes` phrases must each be in a Progress note (an empty list means none), and the count must agree); Memory has and lacks the given lines; `files/` holds exactly the given files; the Reminder rows match (recurrence, weekdays, time of day, `nextAt`, mentions); the reply mentions or avoids given phrases, and lists tasks in the fixed `status | due | assignee | id | title` format when the facts say it does; no stock filler; no reply reads as the other language; and no reply leaves a ref such as `[K1]` unrendered or links anything the seed does not hold (its files' text, a seeded Minutes' posted message, a seeded pull request). When `then` names a clock, the scheduler ticks once at it and the Reminder posts are checked for their text and pings, charged to the last turn.
2. **Judge** (`assistantJudge.ts`), the same pinned judge with its own rubric (`ASSISTANT_RUBRIC_VERSION`), one isolated call per criterion, with the conversation and the recorded state in front of it:
   - per must-cover fact: do the replies, taken together, convey it?
   - per turn: on a clear request, did the bot act without asking back; on an ambiguous one (the fixture says what is unclear), did it ask exactly one question that names the gap and refrain from acting?
   - per turn: is every statement about tasks, Memory, files or Reminders supported by the recorded state, the reference facts, or the conversation?

A turn **passes** when it passes every code check, the brief's replies convey at least 80% of the must-cover facts, and the judge answers neither `no` on the act-or-ask question nor `no` on support. `unknown` never counts as conveyed and never fails a turn. The share of turns where the bot acted or asked as called for is reported in the question-rate column. A trial passes when every turn passes.

## How profiles are compared

Every profile runs the same briefs. A trial scores the share of its drafts (or turns) that pass (0 when no draft was posted). Trials are averaged per brief, and the profile's score is the mean over briefs.

- **Paired differences**: for each pair of profiles, the mean of the per-brief score differences, with the standard error of that mean. Pairing removes how hard each brief is. At about 20 briefs only large differences stand out; treat anything within two standard errors of zero as noise. The daily-behaviour set is smaller still, so read its differences as a hint.
- **pass^k**: the share of briefs where every trial passed, the reliability a user feels.
- **Cost**: tokens per run from the usage events, priced when the profile has a `price`.
- **Latency**: the router records `latencyMs` on every model call's usage event; the report shows the mean per call, plus the wall time per run.

## The Rapor

The Rapor is the harness score (spec #226): the daily-behaviour eval run live against the model the tenants use, scored per area and as one weighted number out of 100. `scorecard.yaml` holds the exam:

- `version`: bumped on any change to the weights, the briefs or the holdouts; only reports at one version compare.
- `weights`: capture 20 (Minutes, Daily logs, Documents), recall 25, tasks 20 (Tasks, Reminders and project work), group 10 (several people at once), loop 15 (the agent loop itself: Memory, tool use, links). The other 10 of the review's rubric, the eval itself, is met by how the run is made, not by briefs.
- `briefs`: the exam, each a folder under `assistant/` whose `facts.yaml` names its `area`.
- `holdout`: the briefs among `briefs` that are held out.

A brief or holdout that does not exist, a missing weight, or a fixture without an area stops the run before it starts. Per profile, an area scores the mean of its exam briefs' scores, held-out ones included, and the total is the mean of the areas with a brief in the run, weighted, the weights renormalised over them: a run of the recall briefs alone scores recall alone. `report.md` opens with `Rapor v<version>: <total>` for each profile, and has a table per area with its weight, score, the number of its briefs that ran, and the score of its held-out briefs alone; `report.json` holds the same under `summary.profiles[].rapor`. An area that scores well above its holdout score was fitted to its briefs.

**The held-out rule.** A holdout brief never tunes anything the bot reads: `packages/skills/src/workspace/vocabulary.ts`, the persona, a tool description, or a playbook. Read why it fails, then make the fix against another brief that fails the same way, adding one if none does. A holdout brief that has been used to tune is no holdout any more: take it out of `holdout`, bump `version`, and write a new held-out brief in its place.

## Fixtures

### Issue drafts: `briefs/`

One folder per brief:

- `brief.md`: the author's message.
- `answers.md`: the author's reply to round 1. The harness posts it, then "draft now" when no draft is up. Nobody simulates the author beyond that.
- `facts.yaml`: `language` (`en` or `id`), `cases` (edge cases, from `one-line`, `vague`, `duplicate`, `ambiguous-repository`, `mixed-language`, `screenshot`), `mustCover`, `knownGaps`, `repoFacts` (facts true at the pinned commit), and `alsoOpen` (stub repositories with only a README, opened beside pachiware for an ambiguous brief).
- Any `.png`, `.jpg`, `.webp` or `.gif` is attached to the brief. A `screenshot` fixture must have one, and its facts should need the image to be covered.

The briefs are rewritten from this repository's history: the spec tickets #33 to #49, earlier decision issues, and PROGRESS phases. The real issue supplies the reference facts. When a draft fails in Discord, add its brief here.

Reference facts describe the repository at the pinned commit. Moving the pin means checking every `repoFacts` line and re-recording `recorded/`.

### Daily behaviours: `assistant/`

One folder per brief:

- `brief.md`: the first message, sent with a mention in the channel.
- `follow-ups.md`: later messages, one per block split on a `---` line, sent in the thread the bot opened. Optional.
- `facts.yaml`: `language`; `area`, the Rapor area the brief scores in (`capture`, `recall`, `tasks`, `group` or `loop`); `clock`, the instant the conversation starts at (every brief uses a Wednesday 09:00 in Asia/Jakarta, so "Friday", "tomorrow" and "in two hours" have one answer); optional `settings` (guild `timezone`, `language`), `grants` (guild permissions the author holds, such as `ManageGuild`), `members` (guild members besides Alice and Bob: `id`, display `name`, optional `username`), `seed.tasks` (task files written before the brief; their ids are `00000001-…`, `00000002-…` in order; a `channel` name files one in that other channel of the guild instead), `seed.files` (Workspace files written before the brief: `path` below the channel's folder, such as `minutes/2026-10-07-launch-sync.md`, `content`, and an optional `channel` as for tasks), `seed.hidden` (channels the guild's @everyone cannot view, so they are no Public channel; the author still can), and `attachments` (`name` plus `pdf` lines, attached to the brief as a real one-page PDF); `mustCover`; `turns`, one entry per message with what is expected after it (`ambiguous`, `tasks` with optional `channel` and `notes`, `memory.channel` / `memory.guild` with `has` and `lacks`, `files`, `reminders`, `replyContains`, `replyLacks`, `taskList`); and `then` (`clock` and the Reminder `posts` expected after one scheduler tick there).

The first seven briefs cover the behaviours spec #72 names: a task from casual wording in Indonesian (`task-casual-indonesian`) and in English with an assignee, followed by a request that points at nothing (`task-casual-english`); relative due dates against the fixed clock (`due-dates-relative`); status changes named by title and the open list in the fixed format (`status-by-title`); a channel line, a server line and a forget (`remember-forget`); a filed PDF found by a word from its text (`file-search`); and a weekly Reminder that the scheduler then fires (`reminder-weekly`).

Six more cover project work, spec #120: a name that matches two members, asked about once and then settled by the answer (`assign-ambiguous-name`); a name no member has, recorded by name only and said so (`assign-unknown-name`); a progress report made to the bot, kept as a Progress note and shown when asked (`progress-note`); a cancellation with a reason in Indonesian, after which the open list leaves the task out (`cancel-with-reason`); a reference that fits two tasks, listed and asked about once (`task-reference-ambiguous`); and "what's on my plate" across two channels, then the tasks the asker delegated (`plate-across-channels`). One covers a bulk cancel, issue #137: four tasks that would change at once are listed as task lines for a yes before anything changes, and the yes cancels them (`bulk-cancel`). Five cover asking about kept material, spec #146: a Decision kept in another Public channel, answered with its channel and date (`decision-other-channel`); one person's action items from Minutes in two channels, each with channel, date and a link to the posted Minutes (`action-items-across-meetings`); a question nothing kept answers, answered with "nothing found" and no guess (`nothing-found`); an answer that sits in a channel @everyone cannot view, asked about from a Public channel, which gets a DM suggestion naming nothing (`private-channel-dm`); and Minutes written elsewhere and kept as a Document under `files/`, found by search (`minutes-as-document`). Five measure recall, spec #195: English Minutes and a Note in #audio asked about in Indonesian (`recall-asked-in-indonesian`); an Indonesian Decision and Minutes in #finance asked about in English (`recall-asked-in-english`); and two support-hours Decisions at different dates, answered with the newer one and the older named as replaced (`recall-decision-replaced`); and work discussed in this channel's Minutes and tracked as a completed Task in #audio, answered as done from that Task (`recall-done-other-channel`); and work done only through a merged pull request in a repository the Git scope opens, which no Minutes or Task mention (`recall-done-pull-request`; `seed.git` fakes GitHub for it). One more, spec #207: the one MP3 bitrate Decision among two dozen kept files in three channels that share its words, an older Decision it replaced among them (`recall-among-distractors`). Since #211 their dry runs answer with one `recall` call. Run them alone with `-t recall-` after `bun run eval:assistant`. The seeded Minutes carry only the record's identifying fields in their frontmatter; the bot's own also hold the minutes as JSON there. When the assistant gets something wrong in Discord, add the conversation here.

## Recorded dry runs

`recorded/*.json` and `recorded/assistant/*.json` are outputs of a scripted model (`profile: { provider: "scripted", model: "dry run" }`) driven through the real bot by `apps/agent/test/eval-dry-run.test.ts` and `apps/agent/test/eval-assistant-dry-run.test.ts`. The checks tests re-grade them on every `bun test`, so a change to a check, a fixture or the bot's own text shows up without a key. To re-record the daily-behaviour runs after such a change: `EVAL_RECORD=1 bun test apps/agent/test/eval-assistant-dry-run.test.ts`.

## Calibrating the judge by hand

The judge is trusted only once it agrees with a person (issue #49). Until then the rubric versions stay below 1 (`RUBRIC_VERSION` in `judge.ts` and `ASSISTANT_RUBRIC_VERSION` in `assistantJudge.ts`, both `0.1`).

1. Run the live eval with one profile and `EVAL_TRIALS=1`.
2. Take the first 10 or so items across different briefs from `results/<run>/trials/*.json`. For issue drafts each file holds the drafts (`result.drafts`), the questions (`result.questions`), and the judge's verdicts with reasoning (`result.judged`); for daily behaviours it holds the turns with their replies and recorded state (`result.turns`) and the verdicts per fact and per turn (`result.judged`).
3. Grade each criterion yourself before reading the judge's verdict, as `yes`, `no` or `unknown`. Use only what the judge sees: the brief, the answers and `facts.yaml`, or the conversation, the recorded state and `facts.yaml`.
4. Compare with `result.judged`. For every disagreement, decide whether the rubric text was unclear (change the system prompt or the criterion's question in `judge.ts` or `assistantJudge.ts`), the reference facts were wrong or vague (fix `facts.yaml`), or the judge is simply wrong in a way you accept (note it as a known limit below).
5. After a change, grade the same trials again without running the bot: `bun apps/agent/eval/rejudge.ts apps/agent/eval/results/<run>` writes `rejudged-<version>/` with the same trials and a new report, using the rubric the run's `report.json` names (`kind`). Bump the rubric version on every rubric change so reports at different versions are never compared.
6. When the judge agrees with you on nearly every criterion and the remaining disagreements are written down, freeze the rubric: set its version to `1.0`, and record the date, the run graded, the number of criteria compared and agreed, and the known limits below. From then on any change to the rubric text or the pass rule is a new version, and only reports at the same version are compared.

### Frozen rubric versions

None yet.

### Known limits

None recorded yet.
