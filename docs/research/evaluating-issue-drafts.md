# Evaluating LLM-written issue drafts

Research for #20 (child of map #16). Unblocks #28, "Eval harness for issue drafts".

**Question.** How do practitioners evaluate LLM-written structured documents (here: issue drafts plus clarifying questions) repeatably? This note compares golden-set comparison, rubric LLM-as-judge and checklist assertions. It also covers the known pitfalls, whether the eval can run under `bun test`, and how to compare several Profiles on the same briefs.

Researched 2026-10-11. Every claim cites the source that owns it; the "Recommendation" section is my own synthesis.

---

## 1. The three methods

### Checklist assertions (code-graded)

These are deterministic checks on the output: substring, regex, JSON shape, or arbitrary code.

- Anthropic ranks code-based grading as "fastest and most reliable, extremely scalable, but also lacks nuance for more complex judgments" ([Anthropic, Define success criteria and build evaluations](https://platform.claude.com/docs/en/docs/test-and-evaluate/develop-tests), "Grade your evaluations").
- Anthropic's agent-eval guidance says code graders are fast, cheap, objective and reproducible, but "brittle to valid variations that don't match expected patterns exactly" ([Anthropic Engineering, Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).
- promptfoo's deterministic assertion vocabulary shows what is typical: `contains`, `icontains`, `regex`, `contains-all`, `contains-any`, `is-json`, `contains-json`, `javascript`, plus a `not-` prefix for any of them. Each assertion has a `weight`, a test passes when its weighted score is at or above `threshold`, and `assert-set` groups checks ([promptfoo, Assertions & metrics](https://www.promptfoo.dev/docs/configuration/expected-outputs/)).

**Fit for issue drafts.** This is the strongest method for structural and "no invented facts" criteria:
- the draft parses into the expected shape (title, body sections, list of questions);
- required sections are present;
- every file path, symbol or label the draft mentions exists in the fixture repo snapshot. This is a set-membership check, not a judgment call.

### Golden-set comparison (reference-based)

Here each input has an expert-written reference answer, and the output is compared against it.

- OpenAI describes this as held-out reference sets and "hard-coded correct answers to questions created by domain experts". It notes that metric graders (exact match, ROUGE) "may miss nuance" ([OpenAI, Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)).
- Anthropic's examples use exact match, cosine similarity and ROUGE-L against references ([Anthropic, develop-tests](https://platform.claude.com/docs/en/docs/test-and-evaluate/develop-tests)).
- Zheng et al. find that a *reference-guided* LLM judge (one given the reference solution) is the single most effective mitigation they tested. On math grading, failures dropped from 14/20 to 3/20 ([Zheng et al. 2023, §3.4, Table 4](https://arxiv.org/html/2306.05685v4)).

**Fit for issue drafts.** A complete "golden draft" is a poor target. Many differently-worded drafts are equally good, and text-similarity metrics penalise valid variation. What works is a golden set of **facts per brief** rather than golden text:
- the points a good draft must cover;
- the gaps a good clarifying question must probe;
- the repo facts that are allowed.

These become the reference a judge or checklist grades against. This is the "reference-guided" pattern, not similarity scoring.

### Rubric-based LLM-as-judge

A second model grades the output against a written rubric.

- Anthropic calls it "fast and flexible, scalable and suitable for complex judgment. Test to ensure reliability first then scale." Its tips are detailed rubrics, an "empirical or specific" output (correct/incorrect or 1–5), and reasoning before the score ([Anthropic, develop-tests](https://platform.claude.com/docs/en/docs/test-and-evaluate/develop-tests)).
- OpenAI says "LLMs are better at discriminating between options" and recommends pairwise or pass/fail over single-answer scoring. It recommends using the strongest judge you can afford and scaling up only once the judge "consistently agrees with human annotations" ([OpenAI, Evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)).
- Anthropic recommends grading each rubric dimension with its own isolated judge and giving the judge an "Unknown" escape hatch to reduce hallucinated grades ([Anthropic Engineering, Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).
- In promptfoo's `llm-rubric`, the judge returns `{reason, score 0..1, pass}`. The grader is set with `--grader`, `defaultTest.options.provider` or `assertion.provider`, and a custom `rubricPrompt` is allowed ([promptfoo, llm-rubric](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/)).

**Fit for issue drafts.** This is the only practical way to grade "are the clarifying questions relevant and non-obvious?" and "is the acceptance criterion testable?". Write one narrow binary question per criterion, each grounded in the per-brief reference facts.

### Side-by-side

| | Checklist assertions | Golden-set (reference facts) | Rubric LLM-judge |
|---|---|---|---|
| Determinism | Fully deterministic | Deterministic when checked by code; judge-dependent otherwise | Non-deterministic |
| Cost per run | ~0 | ~0 to 1 judge call | 1 judge call per criterion |
| Catches | Shape, required sections, invented paths/symbols | Missed points, missing questions | Relevance, clarity, question quality |
| Main risk | Brittle to valid wording | Reference set goes stale or is incomplete | Judge bias, drift, cost |
| Runs offline | Yes | Yes (code-checked part) | No |

---

## 2. Pitfalls

**Position bias.**
- When GPT-4 judged pairs with the answers swapped, it gave a consistent verdict only 65.0% of the time. It favoured the first position in 30.0% of cases ([Zheng et al., §3.3, Table 2](https://arxiv.org/html/2306.05685v4)).
- Wang et al. showed that order alone let "Vicuna-13B beat ChatGPT on 66 over 80 tested queries with ChatGPT as an evaluator". They propose Balanced Position Calibration, which averages over both orders ([Wang et al. 2023, arXiv:2305.17926](https://arxiv.org/abs/2305.17926)).
- Mitigation: run pairwise judgments in both orders and count a disagreement as a tie (Zheng §3.4).

**Verbosity bias.**
- Under a "repetitive list" attack, the padded answer won 91.3% of the time with Claude-v1 and GPT-3.5 as judges, and 8.7% with GPT-4 ([Zheng et al., §3.3, Table 3](https://arxiv.org/html/2306.05685v4)).
- OpenAI names verbosity bias explicitly and advises controlling for length ([OpenAI best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)).
- This matters here because a longer draft with more questions can win on length rather than quality. Cap the question count, or grade each question individually.

**Self-preference.**
- LLM evaluators score their own outputs higher than human annotators do. The bias correlates with how well the model recognises its own text ([Panickssery, Bowman & Feng 2024, arXiv:2404.13076](https://arxiv.org/abs/2404.13076)).
- Zheng et al. saw GPT-4 favour itself by ~10% and Claude-v1 by ~25%, but call the evidence inconclusive (§3.3).
- Anthropic: "Generally best practice to use a different model to evaluate than the model used to generate the evaluated output" ([develop-tests](https://platform.claude.com/docs/en/docs/test-and-evaluate/develop-tests)).
- This matters here because Profiles share providers. If the judge is one of the compared Profiles' models, that Profile is advantaged. Pin the judge to one model and provider outside the comparison set.

**Limited judge reasoning.**
- A judge that could solve a problem on its own still accepted wrong answers when shown them: 14/20 failures. Chain-of-thought cut this to 6/20, and reference-guided judging cut it to 3/20 ([Zheng et al., §3.3–3.4](https://arxiv.org/html/2306.05685v4)).
- For drafts, this argues for giving the judge the reference facts and the repo fixture rather than asking it to recall repo facts.

**Run-to-run variance.**
- "Models sometimes produce different output from the same input" ([OpenAI](https://developers.openai.com/api/docs/guides/evaluation-best-practices)).
- Run multiple trials per task. `pass@k` (at least one success in k) rises with k, and `pass^k` (all k succeed) falls with k. `pass^k` is the right metric for user-facing reliability ([Anthropic Engineering, Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).
- Report the standard error of the mean, cluster it when items are related, and average several samples per question to cut within-question variance ([Anthropic, A statistical approach to model evals / Miller, arXiv:2411.00640](https://www.anthropic.com/research/statistical-approach-to-model-evals)).

**Judge calibration and criteria drift.**
- Scale an LLM judge only after it agrees with human grades ([OpenAI](https://developers.openai.com/api/docs/guides/evaluation-best-practices); [Anthropic develop-tests](https://platform.claude.com/docs/en/docs/test-and-evaluate/develop-tests)).
- Shankar et al. document "criteria drift": people need criteria to grade outputs, but grading outputs changes the criteria. Some criteria only emerge after seeing outputs ([Shankar et al. 2024, arXiv:2404.12272](https://arxiv.org/abs/2404.12272)).
- In practice the rubric is not final on day one. Hand-grade a first batch, then freeze the rubric.

**Cost.**
- Few-shot judging raised GPT-4's swap consistency from 65.0% to 77.5%, but made calls ~4x more expensive (Zheng §3.4).
- Each rubric criterion is one judge call per draft per trial per Profile. With B briefs × T trials × P Profiles × C criteria, a modest 20 × 3 × 3 × 4 is already 720 judge calls plus 180 generation calls per run.

**Dataset size and source.**
- "20-50 simple tasks drawn from real failures is a great start" ([Anthropic Engineering, Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).
- Anthropic's general guidance prefers volume with automated grading over a few hand-graded cases ([develop-tests](https://platform.claude.com/docs/en/docs/test-and-evaluate/develop-tests)).
- Include edge cases: irrelevant input, very long input, and ambiguous cases where humans would disagree (same source).

**Capability vs regression.**
- Capability evals start at a low pass rate. Regression evals should sit near 100%, and saturated capability evals graduate into regression suites ([Anthropic Engineering, Demystifying evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)).
- A draft-quality eval that compares Profiles is a capability eval, so it should not gate CI on 100%.

---

## 3. `bun test` or a separate runner?

### What `bun test` offers

From the [Bun docs: writing tests](https://bun.com/docs/test/writing-tests), [discovery](https://bun.com/docs/test/discovery) and [CLI](https://bun.com/docs/cli/test):

- Default discovery covers only `*.test.*`, `*_test.*`, `*.spec.*` and `*_spec.*`. A file named `*.eval.ts` is **not** picked up by a plain `bun test`, so live evals stay out of the normal suite with no configuration.
- Default per-test timeout is 5000 ms. Override it with a third argument or `--timeout`. Live LLM calls need minutes.
- `test.skipIf(cond)` / `describe.if(cond)` can gate on an env var such as `EVAL_LIVE=1` plus an API key.
- `test.each(cases)` and `describe.each` can produce brief × Profile matrices.
- The `{ repeats: N }` option fails if *any* iteration fails. That is pass^k semantics with no score aggregation.
- `{ retry: N }` passes if any attempt succeeds. That hides variance and is wrong for evals.
- `--rerun-each N`, `test.concurrent` / `--concurrent`, `--max-concurrency` (default 20), and `--reporter junit` are available.

### What `bun test` lacks

It has no score aggregation, no per-criterion weighting or threshold, no side-by-side Profile matrix view, no result caching, and no history across runs. You would hand-write all of these.

### Dedicated runners

- **promptfoo.**
  - Gives a prompts × providers × tests matrix view, `--repeat`, a disk cache (`--no-cache` to bypass), `-j` concurrency, and `-o` to csv/json/html/junit.xml ([promptfoo CLI](https://www.promptfoo.dev/docs/usage/command-line/); [config guide](https://www.promptfoo.dev/docs/configuration/guide/)).
  - CI exit code is `100` on any failure, and `PROMPTFOO_PASS_RATE_THRESHOLD` sets the tolerated pass rate (default 100%).
  - It runs on Node and loads TS providers "in Node.js" ([custom provider docs](https://www.promptfoo.dev/docs/providers/custom-api/)).
  - **Repo-specific catch:** `packages/db/src/index.ts` and `packages/db/src/runtime-store.ts` `require("bun:sqlite")`, so importing the app's draft code into a Node-loaded provider will break in sqlite mode. The workaround is the `exec:` provider, which runs a shell command with the prompt as argv[1] and treats stdout as the output ([promptfoo exec provider](https://www.promptfoo.dev/docs/providers/custom-script/)). For example: `exec: bun run apps/agent/eval/draft.ts`. An HTTP provider against the running Hono server is the other option.
- **evalite.**
  - Built on Vitest and uses `.eval.ts` files with scorers on a 0–100 scale. Local-only, with a localhost UI and a static HTML export for CI ([evalite docs](https://v1.evalite.dev/guides/what-is-evalite)). The docs are for a beta.
  - Its docs do not mention Bun. Vitest workers run on Node, so the same `bun:sqlite` catch applies.
- **Braintrust.**
  - `Eval({data, task, scores})` is run with `bt eval file.eval.ts`. It supports `trialCount` (global or per row) and `noSendLogs: true` / `--no-send-logs` for local-only runs ([Braintrust quickstart](https://www.braintrust.dev/docs/start/eval-sdk); [advanced evaluations](https://www.braintrust.dev/docs/evaluate/advanced-evaluations)).
  - Comparing experiments happens in its hosted UI.
  - Its open-source scorer library `autoevals` (`npm install autoevals`) works standalone: "completely optional and not required for using Autoevals". It honours `OPENAI_BASE_URL`, or takes a custom `OpenAI` client with `baseURL`, which fits the OpenAI-compatible-proxy Profiles ([autoevals README](https://github.com/braintrustdata/autoevals)).
- **OpenAI Evals platform.** Not a candidate. OpenAI's guide says the platform goes read-only for existing users on 2026-10-31 and shuts down on 2026-11-30 ([OpenAI best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)).

### Assessment

Everything can run under Bun if the harness is a plain Bun script, or a `*.eval.ts` file run with `bun test <path>` and a raised `--timeout`. Scoring and aggregation are about 100 lines of code. The things a dedicated runner adds are the matrix UI, caching and history, and the price is a Node runtime boundary. That boundary is crossable via `exec:`.

---

## 4. Comparing several Profiles on the same briefs

- **Hold the briefs fixed; vary only the Profile.** This is exactly promptfoo's `providers` matrix, or `describe.each(profiles)` × `test.each(briefs)` in Bun. Hold the system prompt, the temperature and the repo fixture constant across Profiles.
- **Use a paired analysis.** Every Profile sees the same briefs, so compare per-brief score *differences* rather than the two means independently: "conducting a paired-differences test lets us eliminate the variance in question difficulty" ([Anthropic, statistical approach](https://www.anthropic.com/research/statistical-approach-to-model-evals)).
- **Run several trials per brief and average them per brief** before pairing (same source, "reduce variance within questions"). Report pass^k for reliability.
- **Report a standard error, and size the set with a power analysis.** 20 briefs will not separate two Profiles that differ by a few points (same source).
- **Prefer pairwise judging to per-draft scores when ranking Profiles.** Absolute single-answer scores "may be unstable if the judge model changes", whereas pairwise is more stable but grows quadratically with the number of Profiles ([Zheng et al., §3.1](https://arxiv.org/html/2306.05685v4); OpenAI also prefers pairwise). For 2–4 Profiles the quadratic cost is fine. Run both orders (§2 above).
- **Pin the judge** to a fixed model outside the compared set (self-preference, §2). Record judge model, provider and rubric version with every result so runs stay comparable.
- **Record cost and latency per Profile** alongside quality. The router already writes `usageEvents` with prompt and completion tokens (`apps/agent/src/llm/router.ts`), and promptfoo has `cost` / `latency` assertions.

**Repo note.** `LLMRouter.getBotProfile` currently throws `Unsupported profile provider` for anything other than `openai` / `custom` (`apps/agent/src/llm/router.ts`). An Anthropic Profile can't be compared until that changes, although the tenant-level `anthropic` provider path exists. Driving each Profile through the real router (rather than direct SDK calls) keeps the eval honest about what production does.

---

## 5. Recommendation for #28 (synthesis)

1. **Use layered grading per draft**, cheapest first:
   - (a) code checklist: parses, required sections present, question count within bounds, every repo path, symbol or label mentioned exists in the fixture snapshot;
   - (b) code-checked golden facts: required points covered, using keyword/regex sets per point where feasible;
   - (c) an LLM judge only for what code can't decide, such as "does question N probe one of the brief's known gaps?" and "is this point covered (paraphrased)?". Use one binary question per criterion, with reasoning before the verdict, an `unknown` option, and the reference facts in the prompt.
2. **Store each brief as a fixture**: brief text, repo snapshot or allow-list, must-cover points, known gaps, forbidden inventions. Start with 20–50 briefs taken from real drafting failures.
3. **Use a pinned judge** that is not one of the compared Profiles' models.
4. **Don't put live LLM calls in the default `bun test` suite.**
   - Keep the deterministic checklist and scoring code as normal `*.test.ts` unit tests over recorded outputs, using the scripted-LLM pattern in `apps/agent/test/git-tools.test.ts`.
   - Put live runs in `*.eval.ts`, run on demand: `bun test ./apps/agent/eval --timeout 600000`, gated by `test.skipIf(!process.env.EVAL_LIVE)`. Alternatively use a Bun script that writes a JSON report.
5. **Add promptfoo only if** a matrix UI and caching become worth a Node toolchain. Wire it through `exec: bun …` to avoid the `bun:sqlite` import problem.
6. **Treat the Profile comparison as a capability eval.** It is run on demand or before release, reports paired score differences with standard errors and per-Profile cost, and does not gate CI. A small near-100% regression subset can gate later, once it is saturated.
7. **Hand-grade the first batch** to calibrate the judge and freeze the rubric. Expect criteria drift until then.

## Sources

- Zheng et al. 2023, "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena", NeurIPS 2023 Datasets & Benchmarks. https://arxiv.org/abs/2306.05685 (HTML v4: https://arxiv.org/html/2306.05685v4)
- Wang et al. 2023, "Large Language Models are not Fair Evaluators". https://arxiv.org/abs/2305.17926
- Panickssery, Bowman, Feng 2024, "LLM Evaluators Recognize and Favor Their Own Generations". https://arxiv.org/abs/2404.13076
- Shankar et al. 2024, "Who Validates the Validators?". https://arxiv.org/abs/2404.12272
- Anthropic, "Define success criteria and build evaluations". https://platform.claude.com/docs/en/docs/test-and-evaluate/develop-tests
- Anthropic Engineering, "Demystifying evals for AI agents". https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Anthropic, "A statistical approach to model evals" (Miller, arXiv:2411.00640). https://www.anthropic.com/research/statistical-approach-to-model-evals
- OpenAI, "Evaluation best practices". https://developers.openai.com/api/docs/guides/evaluation-best-practices
- promptfoo docs: assertions, llm-rubric, model-graded, config guide, CLI, custom provider, exec provider. https://www.promptfoo.dev/docs/
- evalite docs. https://v1.evalite.dev/guides/what-is-evalite
- Braintrust: eval SDK quickstart, advanced evaluations. https://www.braintrust.dev/docs/start/eval-sdk, https://www.braintrust.dev/docs/evaluate/advanced-evaluations
- braintrustdata/autoevals README. https://github.com/braintrustdata/autoevals
- Bun docs: writing tests, discovery, CLI. https://bun.com/docs/test/writing-tests, https://bun.com/docs/test/discovery, https://bun.com/docs/cli/test
