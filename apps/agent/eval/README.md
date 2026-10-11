# Issue-draft eval

This folder measures how well the issue-draft playbook turns a brief into drafts, and compares profiles on the same briefs. The decisions behind it are in issue #28; the research is `docs/research/evaluating-issue-drafts.md` on the `research/evaluating-issue-drafts` branch.

Two halves:

- **Code checks** run on every `bun test` over the recorded outputs in `recorded/` (`apps/agent/test/eval-*.test.ts`). The judge, comparison and report code is tested there too, with a scripted model and a scripted judge. None of these tests need a key.
- **The live eval** (`drafts.eval.ts`) runs only on demand. It drives the real bot through the Discord scenario harness with real profiles, against this repository at the commit pinned in `repository.yaml`, served offline. A pinned judge grades every trial. It never gates CI.

## Running the live eval

```sh
EVAL_LIVE=1 \
EVAL_PROFILES=apps/agent/eval/profiles.yaml \
EVAL_JUDGE_PROVIDER=anthropic EVAL_JUDGE_MODEL=<judge model> EVAL_JUDGE_API_KEY=<key> \
bun run eval
```

| Variable | Meaning |
|---|---|
| `EVAL_LIVE=1` | Without it the file only reports a skipped test. |
| `EVAL_PROFILES` | Path to the profiles to compare. Copy `profiles.example.yaml` to `profiles.yaml` (gitignored). Each profile names the env variable holding its key (`apiKeyEnv`), and may give a `price` in USD per million tokens and `acceptsImages`. |
| `EVAL_PROVIDER`, `EVAL_MODEL`, `EVAL_API_KEY`, `EVAL_BASE_URL`, `EVAL_ACCEPTS_IMAGES=1` | One profile, used when `EVAL_PROFILES` is unset. |
| `EVAL_JUDGE_PROVIDER`, `EVAL_JUDGE_MODEL`, `EVAL_JUDGE_API_KEY`, `EVAL_JUDGE_BASE_URL` | The judge: `openai` (default), `anthropic`, or `custom` with a base URL. Model and key are required. |
| `EVAL_TRIALS` | Trials per brief and profile, default 3. |

The run refuses to start when the judge's model is any compared profile's model (a vendor prefix such as `anthropic/` is ignored when comparing). A model grades its own output too kindly, so keep the judge outside the comparison.

Each trial runs in its own subprocess. Results land in `results/<run>/`: one JSON per trial under `trials/`, then `report.json` and `report.md` once every trial is done. Both reports record the judge's provider and model, the rubric version, the number of trials, and the pinned commit. Failed trials are never retried; a retry would hide exactly the variance the trials measure.

## How a draft is graded

Cheapest layer first:

1. **Code checks** (`checks.ts`): the draft checker's limits (title, acceptance criteria, open questions, body size), proposed labels exist in the repository, every Context used link resolves at the pinned commit, no stock filler, and the draft is in the brief's language.
2. **Judge** (`judge.ts`), one isolated call per criterion. The judge sees the brief, the author's answers and the fixture's reference facts, reasons first, and ends with `yes`, `no` or `unknown`:
   - per must-cover fact: do the brief's drafts, taken together, cover it?
   - per question the bot asked (round questions and the drafts' own open questions): does it probe a known gap or a real ambiguity?
   - per draft: is every statement about the repository supported by the allowed repository facts, the brief, the answers, or the files under Context used?

A draft **passes** when it passes every code check, the brief's drafts cover at least 80% of the must-cover facts, and the judge does not answer `no` on the draft's repository statements. `unknown` never counts as covered, and an `unknown` on repository statements does not fail a draft. Question quality is reported as a rate, not a gate. A judge call that errors counts as `unknown`, with the error as its reasoning.

## How profiles are compared

Every profile runs the same briefs. A trial scores the share of its drafts that pass (0 when no draft was posted). Trials are averaged per brief, and the profile's score is the mean over briefs.

- **Paired differences**: for each pair of profiles, the mean of the per-brief score differences, with the standard error of that mean. Pairing removes how hard each brief is. At about 20 briefs only large differences stand out; treat anything within two standard errors of zero as noise.
- **pass^k**: the share of briefs where every trial passed, the reliability a user feels.
- **Cost**: tokens per run from the usage events, priced when the profile has a `price`.
- **Latency**: the router records `latencyMs` on every model call's usage event; the report shows the mean per call, plus the wall time per run.

## Fixtures

One folder per brief in `briefs/`:

- `brief.md`: the author's message.
- `answers.md`: the author's reply to round 1. The harness posts it, then "draft now" when no draft is up. Nobody simulates the author beyond that.
- `facts.yaml`: `language` (`en` or `id`), `cases` (edge cases, from `one-line`, `vague`, `duplicate`, `ambiguous-repository`, `mixed-language`, `screenshot`), `mustCover`, `knownGaps`, `repoFacts` (facts true at the pinned commit), and `alsoOpen` (stub repositories with only a README, opened beside pachiware for an ambiguous brief).
- Any `.png`, `.jpg`, `.webp` or `.gif` is attached to the brief. A `screenshot` fixture must have one, and its facts should need the image to be covered.

The briefs are rewritten from this repository's history: the spec tickets #33 to #49, earlier decision issues, and PROGRESS phases. The real issue supplies the reference facts. When a draft fails in Discord, add its brief here.

Reference facts describe the repository at the pinned commit. Moving the pin means checking every `repoFacts` line and re-recording `recorded/`.

## Calibrating the judge by hand

The judge is trusted only once it agrees with a person (issue #49). Until then the rubric version stays below 1 (`RUBRIC_VERSION` in `judge.ts`, currently `0.1`).

1. Run the live eval with one profile and `EVAL_TRIALS=1`.
2. Take the first 10 or so drafts across different briefs from `results/<run>/trials/*.json`. Each file holds the drafts (`result.drafts`), the questions (`result.questions`), and the judge's verdicts with reasoning (`result.judged`).
3. Grade each criterion yourself before reading the judge's verdict: each must-cover fact for the brief, each question, and each draft's repository statements, as `yes`, `no` or `unknown`. Use only the brief, the answers and `facts.yaml`, as the judge does.
4. Compare with `result.judged`. For every disagreement, decide whether the rubric text was unclear (change the system prompt or the criterion's question in `judge.ts`), the reference facts were wrong or vague (fix `facts.yaml`), or the judge is simply wrong in a way you accept (note it as a known limit below).
5. After a change, grade the same drafts again without running the bot: `bun apps/agent/eval/rejudge.ts apps/agent/eval/results/<run>` writes `rejudged-<version>/` with the same trials and a new report. Bump `RUBRIC_VERSION` on every rubric change so reports at different versions are never compared.
6. When the judge agrees with you on nearly every criterion and the remaining disagreements are written down, freeze the rubric: set `RUBRIC_VERSION` to `1.0`, and record the date, the run graded, the number of criteria compared and agreed, and the known limits below. From then on any change to the rubric text or the pass rule is a new version, and only reports at the same version are compared.

### Frozen rubric versions

None yet.

### Known limits

None recorded yet.
