# Live evals

This folder holds two evals that compare profiles on the same work, graded the same way: the **issue-draft eval** (how well the issue-draft playbook turns a brief into drafts) and the **daily-behaviour eval** (everyday assistant work: tasks from casual wording, relative due dates, status changes, remember and forget, file search, Reminder creation). The decisions behind the first are in issue #28; the research is `docs/research/evaluating-issue-drafts.md` on the `research/evaluating-issue-drafts` branch. The second follows spec #72, block 8.

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

A daily-behaviour brief is a short conversation: the brief, then follow-ups in the thread the bot opened. After every turn the runner (`assistantRun.ts`) records the bot's replies and the state a person could see: the channel's tasks (title, status, due date, owner, creator), the channel's and the server's Memory lines, the files under `files/`, and the Reminder rows. The grade is per turn, so a trial's score is the share of its turns that pass, in place of the share of drafts.

1. **Code checks** (`assistantChecks.ts`), against the `turns` entry of `facts.yaml` for that turn: the bot replied; no Confirm button was offered (task writes, Memory and Reminders need none); nothing was pinged (only a Reminder post pings); an ambiguous turn left the Workspace as it was; the tasks match (each expected task is found by a phrase of its title, then status, `dueAt`, owner and creator are compared when given, and the count must agree); Memory has and lacks the given lines; `files/` holds exactly the given files; the Reminder rows match (recurrence, weekdays, time of day, `nextAt`, mentions); the reply mentions or avoids given phrases, and lists tasks in the fixed `status | due | owner | id | title` format when the facts say it does; no stock filler; and no reply reads as the other language. When `then` names a clock, the scheduler ticks once at it and the Reminder posts are checked for their text and pings, charged to the last turn.
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
- `facts.yaml`: `language`; `clock`, the instant the conversation starts at (every brief uses a Wednesday 09:00 in Asia/Jakarta, so "Friday", "tomorrow" and "in two hours" have one answer); optional `settings` (guild `timezone`, `language`), `grants` (guild permissions the author holds, such as `ManageGuild`), `seed.tasks` (task files written before the brief; their ids are `00000001-…`, `00000002-…` in order), and `attachments` (`name` plus `pdf` lines, attached to the brief as a real one-page PDF); `mustCover`; `turns`, one entry per message with what is expected after it (`ambiguous`, `tasks`, `memory.channel` / `memory.guild` with `has` and `lacks`, `files`, `reminders`, `replyContains`, `replyLacks`, `taskList`); and `then` (`clock` and the Reminder `posts` expected after one scheduler tick there).

The seven briefs cover the behaviours spec #72 names: a task from casual wording in Indonesian (`task-casual-indonesian`) and in English with an owner, followed by a request that points at nothing (`task-casual-english`); relative due dates against the fixed clock (`due-dates-relative`); status changes named by title and the open list in the fixed format (`status-by-title`); a channel line, a server line and a forget (`remember-forget`); a filed PDF found by a word from its text (`file-search`); and a weekly Reminder that the scheduler then fires (`reminder-weekly`). When the assistant gets something wrong in Discord, add the conversation here.

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
