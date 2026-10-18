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

A daily-behaviour brief is a short conversation: the brief, then follow-ups in the thread the bot opened. After every turn the runner (`assistantRun.ts`) records the bot's replies and the state a person could see: the channel's tasks (title, status, due date, assignee, creator, Progress notes), plus those of any other channel the brief seeded tasks in, marked with that channel, the channel's and the server's Memory lines, the files under `files/`, the Reminder rows, and the text of each Minutes and Daily log the bot wrote in the channel (the seeded ones aside). A turn another member spoke records who (`authors`), and a run that seeded talk records each seeded message's link (`seeded`). The grade is per turn, so a trial's score is the share of its turns that pass, in place of the share of drafts.

1. **Code checks** (`assistantChecks.ts`), against the `turns` entry of `facts.yaml` for that turn: the bot replied, or, on a `quiet` turn, posted nothing; it left one of the `reaction` emoji when the facts name some; no Confirm button was offered (task writes, Memory and Reminders need none); nothing was pinged (only a Reminder post pings); an ambiguous turn left the Workspace as it was; the tasks match (each expected task is found by a phrase of its title, then status, `dueAt`, assignee, creator and channel are compared when given, `notes` phrases must each be in a Progress note (an empty list means none), and the count must agree); Memory has and lacks the given lines; `files/` holds exactly the given files; the Reminder rows match (recurrence, weekdays, time of day, `nextAt`, mentions); each `kept` phrase is in a Minutes or Daily log the bot wrote; the reply links each seeded message `cites` names; the reply mentions or avoids given phrases, and lists tasks in the fixed `status | due | assignee | id | title` format when the facts say it does; no stock filler; no reply reads as the other language; and no reply leaves a ref such as `[K1]` unrendered or links anything the seed does not hold (its files' text, a seeded Minutes' posted message, a seeded pull request, a seeded message). When `then` names a clock, the scheduler ticks once at it and the Reminder posts are checked for their text and pings, charged to the last turn.
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
- `briefs`: the exam, each a folder under `assistant/` whose `facts.yaml` names its `area`. Version 2 (#239) has 30, 22 of them in Indonesian, the language the tenants' teams speak, and at least 4 in each area. The other briefs under `assistant/` keep their dry runs and recordings and run live, but the Rapor does not count them.
- `holdout`: the briefs among `briefs` that are held out. Version 2 holds out six: `notulen-pemilik-tenggat`, `holdout-parafrasa-volume`, `keputusan-bertentangan`, `telat-per-orang`, `makasih-reaksi`, `tiga-alat-sekaligus`.

Two exam briefs measure work the next spec builds: `notulen-jadi-tugas` (Tasks from the action items of Minutes) and `colek-h-1` (a Nudge for the Assignee the day before a due date, which follows the date when it moves). Today a model passes them only by doing that work by hand.

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
- `follow-ups.md`: later messages, one per block split on a `---` line, sent in the thread the bot opened. Optional. Alice sends each, unless the block begins with `@<member>:` (`@Bob:`, `@Dewi Anggraini:`), the display name of Alice, Bob or one of `members`: then that member does. A block beginning `@<a>+@<b>:` holds one line per member named, sent at once as a burst, the first line by the first member.
- `facts.yaml`: `language`; `area`, the Rapor area the brief scores in (`capture`, `recall`, `tasks`, `group` or `loop`); `clock`, the instant the conversation starts at (every brief uses a Wednesday 09:00 in Asia/Jakarta, so "Friday", "tomorrow" and "in two hours" have one answer); optional `settings` (guild `timezone`, `language`), `grants` (guild permissions the author holds, such as `ManageGuild`), `members` (guild members besides Alice and Bob: `id`, display `name`, optional `username`), `seed.messages` (the channel's talk before the brief, oldest first, posted as history the bot never saw arrive: `author`, the display name of Alice, Bob or one of `members`; `text`; `at`, an ISO time or a number of minutes before `clock`, never after it; an optional `channel` name for another channel of the guild; an optional `replyTo`, the index of an earlier message in the same channel), `seed.tasks` (task files written before the brief; their ids are `00000001-…`, `00000002-…` in order; a `channel` name files one in that other channel of the guild instead), `seed.files` (Workspace files written before the brief: `path` below the channel's folder, such as `minutes/2026-10-07-launch-sync.md`, `content`, and an optional `channel` as for tasks), `seed.hidden` (channels the guild's @everyone cannot view, so they are no Public channel; the author still can), and `attachments` (`name` plus `pdf` lines, attached to the brief as a real one-page PDF); `mustCover`; `turns`, one entry per message with what is expected after it (`ambiguous`, `tasks` with optional `channel` and `notes`, `memory.channel` / `memory.guild` with `has` and `lacks`, `files`, `reminders`, `kept`, `cites` (indexes into `seed.messages`), `replyContains`, `replyLacks`, `taskList`, `quiet: true` for a message not for the bot to answer, such as one aimed at someone else or a thanks, and `reaction`, the emoji of which the bot must leave one; a quiet turn is graded by code alone, the judge is asked nothing about it); and `then`: `dailyLog`, a day (`2026-10-13`) whose Daily log of the brief's channel the bot writes from the seeded talk with the profile under test before the brief is sent, so what it wrote is in the recorded state from the first turn (a day without seeded talk in the brief's channel, in the place's zone, is refused, and a log not written fails the first turn); and `clock` with the Reminder `posts` expected after one scheduler tick there, after the conversation.

The first seven briefs cover the behaviours spec #72 names: a task from casual wording in Indonesian (`task-casual-indonesian`) and in English with an assignee, followed by a request that points at nothing (`task-casual-english`); relative due dates against the fixed clock (`due-dates-relative`); status changes named by title and the open list in the fixed format (`status-by-title`); a channel line, a server line and a forget (`remember-forget`); a filed PDF found by a word from its text (`file-search`); and a weekly Reminder that the scheduler then fires (`reminder-weekly`).

Six more cover project work, spec #120: a name that matches two members, asked about once and then settled by the answer (`assign-ambiguous-name`); a name no member has, recorded by name only and said so (`assign-unknown-name`); a progress report made to the bot, kept as a Progress note and shown when asked (`progress-note`); a cancellation with a reason in Indonesian, after which the open list leaves the task out (`cancel-with-reason`); a reference that fits two tasks, listed and asked about once (`task-reference-ambiguous`); and "what's on my plate" across two channels, then the tasks the asker delegated (`plate-across-channels`). One covers a bulk cancel, issue #137: four tasks that would change at once are listed as task lines for a yes before anything changes, and the yes cancels them (`bulk-cancel`). Five cover asking about kept material, spec #146: a Decision kept in another Public channel, answered with its channel and date (`decision-other-channel`); one person's action items from Minutes in two channels, each with channel, date and a link to the posted Minutes (`action-items-across-meetings`); a question nothing kept answers, answered with "nothing found" and no guess (`nothing-found`); an answer that sits in a channel @everyone cannot view, asked about from a Public channel, which gets a DM suggestion naming nothing (`private-channel-dm`); and Minutes written elsewhere and kept as a Document under `files/`, found by search (`minutes-as-document`). Five measure recall, spec #195: English Minutes and a Note in #audio asked about in Indonesian (`recall-asked-in-indonesian`); an Indonesian Decision and Minutes in #finance asked about in English (`recall-asked-in-english`); and two support-hours Decisions at different dates, answered with the newer one and the older named as replaced (`recall-decision-replaced`); and work discussed in this channel's Minutes and tracked as a completed Task in #audio, answered as done from that Task (`recall-done-other-channel`); and work done only through a merged pull request in a repository the Git scope opens, which no Minutes or Task mention (`recall-done-pull-request`; `seed.git` fakes GitHub for it). One more, spec #207: the one MP3 bitrate Decision among two dozen kept files in three channels that share its words, an older Decision it replaced among them (`recall-among-distractors`). Two start from talk, spec #226: Indonesian talk in the channel, then "@bot notulen", whose Minutes hold the decision, the open question and the action item with its owner, each linking its message (`minutes-from-talk`); and Bob joining Alice's thread, his task filed as his, then a burst where he and Alice post at once, answered for his line alone (`member-joins-thread`). And one writes a Daily log, spec #226: a day of Indonesian talk, its Daily log written by the bot, then a question the next morning whose answer links the decision's message from it (`daily-log-from-talk`). Sixteen more, all in Indonesian, fill the Rapor's exam, #239. Capture: a contract PDF asked about a turn later (`pdf-ditanya-kemudian`); sprint planning talk whose Minutes keep two action items with owner and when (`notulen-pemilik-tenggat`). Recall: a question in other words than its Minutes (`holdout-parafrasa-volume`); "implemented?" with one pull request closed without merging and a later one merged (`sudah-diimplementasi-pr-ditutup`, `seed.git` pull requests take `closedAt`); two release-day Decisions, the newer one replacing the older (`keputusan-bertentangan`); nothing kept in a channel without Daily logs, so the bot says an admin can turn them on (`channel-tanpa-daily-log`). Tasks: the action items of Minutes made Tasks (`notulen-jadi-tugas`); late tasks grouped per person (`telat-per-orang`); a weekly Reminder asked for in Indonesian (`pengingat-berulang`); a nudge for Bob the day before his due date that follows the date when it moves (`colek-h-1`). Group: Bob and Alice in one burst, each answered as themselves (`dua-orang-bersamaan`); Bob asking Dewi something in the bot's thread, left alone, then Dewi's report kept (`balasan-untuk-orang-lain`); a thanks acknowledged with a reaction alone (`makasih-reaksi`). Loop: a Task, a Reminder and a Memory line asked for in one message (`tiga-alat-sekaligus`); a link no tool can give, asked for where no git account is open (`tanpa-link-karangan`); a long pasted transcript kept as a Note word for word (`tempel-teks-panjang`). Their dry runs are in `apps/agent/test/eval-rapor-dry-run.test.ts`. A follow-up may write `@bot` for a mention of the bot, as a person in the channel would; a block that starts with it is Alice's. `kept` reads the Notes and Decisions the bot wrote too. Since #211 their dry runs answer with one `recall` call. Run them alone with `-t recall-` after `bun run eval:assistant`. The seeded Minutes carry only the record's identifying fields in their frontmatter; the bot's own also hold the minutes as JSON there. When the assistant gets something wrong in Discord, add the conversation here.

## Recorded dry runs

`recorded/*.json` and `recorded/assistant/*.json` are outputs of a scripted model (`profile: { provider: "scripted", model: "dry run" }`) driven through the real bot by `apps/agent/test/eval-dry-run.test.ts` and `apps/agent/test/eval-assistant-dry-run.test.ts`. The checks tests re-grade them on every `bun test`, so a change to a check, a fixture or the bot's own text shows up without a key. To re-record the daily-behaviour runs after such a change: `EVAL_RECORD=1 bun test apps/agent/test/eval-assistant-dry-run.test.ts`.

## Calibrating the judge by hand

The judge is trusted only once it agrees with a person (issue #49). Until then the rubric versions stay below 1 (`RUBRIC_VERSION` in `judge.ts` and `ASSISTANT_RUBRIC_VERSION` in `assistantJudge.ts`, both `0.1`).

1. Run the live eval with one profile and `EVAL_TRIALS=1`.
2. Take at least 20 items across different briefs from `results/<run>/trials/*.json`. For issue drafts each file holds the drafts (`result.drafts`), the questions (`result.questions`), and the judge's verdicts with reasoning (`result.judged`); for daily behaviours it holds the turns with their replies and recorded state (`result.turns`) and the verdicts per fact and per turn (`result.judged`).
3. Grade each criterion yourself before reading the judge's verdict, `yes` or `no`, and keep it as an item of `calibration/<rubric version>.yaml`: `{run, trial, turn, criterion, human, note}`, where `run` is the folder under `results/`, `trial` a file under its `trials/` without `.json`, and `criterion` is `fact <n>` (the nth must-cover fact) or `question <n>` without a turn, `behaviour` or `supported` with its `turn`, or `invented` with the draft's number as `turn` (the file's header shows two). Use only what the judge sees: the brief, the answers and `facts.yaml`, or the conversation, the recorded state and `facts.yaml`. A criterion that material cannot settle is left out. Both rubrics are at 0.1, so `0.1.yaml` holds the grades of both; each item names its run.
4. Grade the run again without running the bot: `bun apps/agent/eval/rejudge.ts apps/agent/eval/results/<run>` writes `rejudged-<version>/` with the same trials and a new report, using the rubric the run's `report.json` names (`kind`), and prints how often the judge agrees with your grades for that version: the share of items where its verdict equals yours (an `unknown` never does), overall and per criterion, every disagreement with your note, and every item naming a trial or criterion the run does not have. The same text is kept as `agreement.md`.
5. For every disagreement, decide whether the rubric text was unclear (change the system prompt or the criterion's question in `judge.ts` or `assistantJudge.ts`), the reference facts were wrong or vague (fix `facts.yaml`), or the judge is simply wrong in a way you accept (note it as a known limit below). Bump the rubric version on every rubric change, so reports at different versions are never compared, copy your grades to the new version's file, and rejudge.
6. The rubric freezes at 1.0 when the judge agrees with you on at least 90% of at least 20 items; the agreement text says when the bar is met. Set its version to `1.0`, and record under Frozen rubric versions the date, the run graded, the number of items compared and agreed, and the known limits below. From then on any change to the rubric text or the pass rule is a new version, and only reports at the same version are compared.

### Frozen rubric versions

One entry per rubric frozen at 1.0: the rubric (issue drafts or daily behaviours), the date, the run graded, and the items compared and agreed (at least 20, at least 90% agreed).

None yet.

### Known limits

None recorded yet.
