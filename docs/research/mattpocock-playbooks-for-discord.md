# Which mattpocock playbooks carry over to a Discord assistant

Research for [#18](https://github.com/yhagus/pachiware/issues/18), child of the map [#16](https://github.com/yhagus/pachiware/issues/16). It feeds two grilling tickets: issue-draft anatomy ([#21](https://github.com/yhagus/pachiware/issues/21)) and playbook form, storage, and trigger ([#24](https://github.com/yhagus/pachiware/issues/24)).

**Source:** `mattpocock/skills` at commit [`49dd158`](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336), read on 2026-10-11. Paths below are relative to that repo. Citations use `path:line`.

**Vocabulary:** Matt's repo calls every playbook a "skill". In this repo a **Skill** is a bundle of tools and a **Playbook** is written guidance (map #16, Notes). This document says *playbook* for his SKILL.md files. His term "agent brief" (`skills/engineering/triage/AGENT-BRIEF.md`) means the finished spec posted on an issue. That is close to our **Issue draft**, not our **Brief**. Keep the two apart when borrowing text.

Brief, Issue draft, Minutes and Playbook are not yet in `GLOSSARY.md` on `main` (checked 2026-10-11), although the map's Notes say terms follow it.

## Short answer

| Playbook | Verdict for a brief-to-issue-draft bot |
| --- | --- |
| `grilling` (and its wrappers `grill-me`, `grill-with-docs`) | **Core.** The round format carries over almost verbatim. Multi-person answering and the 2000-char limit need new rules. |
| `triage` → `AGENT-BRIEF.md` | **Core for anatomy.** The best "well-specified issue" guidance in the repo. The needs-info template fits drafts that still have open questions. |
| `to-tickets` | **Core for splitting a brief into several drafts.** Vertical slices, blocking edges, a breakdown quiz before publishing, dependency-ordered creation. |
| `to-spec` | **Partial.** Section list is useful raw material. Too long for one Discord message and assumes a developer audience (seams, testing decisions). |
| `to-questionnaire` | **Partial.** Good question-writing rules, and useful when the brief author is not the person who knows the answer. File output does not apply. |
| `domain-modeling` | **Passive use only.** Read the target repo's `GLOSSARY.md` and ADRs and use their words. Writing glossary entries or ADRs during drafting does not apply. |
| `writing-for-agents` (+ `SKILL-MECHANICS.md`, `.agents/invocation.md`) | **Applies to how we write playbooks (#24)**, not to what the bot does in chat. |
| `wayfinder` | **Mostly not for the bot.** Some mechanics help with creating many issues at once (create-then-wire, refer by name). |
| `wait-what` | A small idea that could become a chat command. |
| `handoff`, `research`, `prototype`, `tdd`, `diagnosing-bugs`, `code-review`, `implement*`, `pr`, `teach`, `chief-of-staff`, misc | Do not apply to brief → issue draft. |

## Discord constraints used in this analysis

- Message `content` is "up to 2000 characters". An embed description is 4096 characters, and all embeds on one message share a 6000-character total. A message holds up to 10 embeds. Source: [Discord API, Message resource](https://docs.discord.com/developers/resources/message).
- Several people can answer in one channel or thread. Matt's playbooks assume one user who is also the decider (`skills/productivity/grilling/SKILL.md:28`: "The _decisions_ are the user's").
- There is no working directory. Playbooks that write files to the current directory or `.scratch/` must write to the **Workspace** (ADR 0003) or to chat instead.
- Every git write goes through **Git write confirmation**: buttons that only the person who asked can press (`GLOSSARY.md`). Reading never needs it.
- From the map: the bot does not read channel history yet, and no repo is bound to a channel.

## Per playbook

### grilling (`skills/productivity/grilling/SKILL.md`), grill-me, grill-with-docs

`grill-me` and `grill-with-docs` are one-line wrappers. `grill-me` calls `grilling`. `grill-with-docs` calls `grilling` and `domain-modeling` (`skills/productivity/grill-me/SKILL.md:7`, `skills/engineering/grill-with-docs/SKILL.md:7`). All of the logic is in `grilling`.

**Transfers as-is**

- Design tree, frontier, and rounds. "Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round" (`:8`). A question that depends on another open question waits for a later round (`:26`). This matches the map's rule: "numbered rounds, each with a recommended answer".
- The fixed question shape: `❓ **Q1** - **<title>**: <body>`, then `➡️ <recommended answer>`, with `---` between questions (`:10-22`; the `---` came in PR #917, `CHANGELOG.md:41`). This is plain Markdown, and Discord renders it. People can answer by number ("1 yes, 2 the second option") (`docs/productivity/grilling.md`, "The round, the frontier, and who decides").
- "Word each question so 'yes' accepts your recommended answer" (`:24`, PR #706).
- Facts vs decisions. "Finding _facts_ is your job, never the user's ... don't ask the user for anything you could look up yourself" (`:28`). For us, the bot reads the repo with git skill read tools inside the Git scope, which needs no confirmation, before it asks.
- End condition: the frontier is empty, and then a separate confirmation gate. "Do not act on it until the user confirms you have reached a shared understanding" (`:30`).
- No hard cap on the number of questions. Matt rejected a cap on purpose (`.out-of-scope/question-limits.md`). Low-value questions are a prompt-quality problem, not a quantity problem.
- Questions are plain text, not a native picker. Matt rejected structured question UIs because "Structured pickers push the model towards multiple-choice questions with pre-baked answers" (`.out-of-scope/native-question-tool.md:9`). That argues against Discord select menus for each question. A single "accept all recommendations" button is a separate question.

**Must change for a multi-person Discord channel**

- **Rounds, not one question at a time.** Rounds already are the default. Matt moved off one-at-a-time in PR #593 ("Same 13 questions land in ~3 rounds instead of 13", `CHANGELOG.md:186`). In a shared channel, fewer bot messages is a bigger win than in a terminal. His docs still offer one-at-a-time as an opt-out for slow readers and second-language users (`docs/productivity/grilling.md`, "Can I go back to one question at a time?"). That could become a per-person or per-channel setting.
- **Message length.** One round can pass 2000 characters. We need a rule: one message per question, or pack questions into messages under 2000 characters (or into an embed under 4096). Number questions across the whole round, so "Q3" means the same thing whichever message it is in.
- **Who decides.** The playbook has exactly one decider. In a channel, several people may answer, disagree, or answer only some questions. Options: (a) the brief author decides and other answers are input; (b) whoever answers first wins; (c) the bot raises conflicting answers as a question in the next round. Option (a) matches Git write confirmation ("Only the person who asked can press them"). This is an open decision for #24 or a follow-up ticket, not something the source settles.
- **What "yes" means.** A bare "yes" must be tied to its speaker and its round. "Yes" from someone who is not the decider is not acceptance under option (a).
- **Partial answers.** In chat, people often answer 2 of 5 questions. The playbook says to wait for answers before the next round. The bot needs a rule for unanswered questions: keep them open, carry them into the next round, or take the recommendation after a timeout. The source gives no rule for this.
- **Facts via sub-agents.** "Dispatch a sub-agent" (`:28`) becomes "call the git read tools". The rule that a running lookup only holds back the questions that depend on it still holds.
- **Two gates.** The "shared understanding" gate (`:30`) comes before Git write confirmation. They can be one step: post the final drafts with Confirm/Cancel. Or two: a text "looks right?" step first. #24 or the flow ticket should choose.
- **Conversation context.** The bot does not read channel history today. A grilling session needs its earlier rounds, so it probably needs a thread per brief.

**Does not apply**

- `grill-with-docs` writing `GLOSSARY.md` and ADRs into the working directory. The bot drafts issues. It does not maintain the target repo's docs.

### triage (`skills/engineering/triage/SKILL.md`, `AGENT-BRIEF.md`, `OUT-OF-SCOPE.md`)

**Transfers as-is**

- `AGENT-BRIEF.md` principles and template. See "Anatomy raw material" below. This is the strongest source for #21.
- The needs-info template: "What we've established so far" / "What we still need from you (@reporter)", and "Questions must be specific and actionable, not 'please provide more info'" (`SKILL.md:92-108`). It fits a draft that is created while questions are still open, and a grilling session that pauses because the author left.
- "Parse any prior triage notes so you don't re-ask resolved questions" (`:70`, `:110-112`). The same applies when a brief is picked up again in a thread.
- Redundancy check before drafting: "search for an existing implementation of the requested behavior by domain concept (not just the request's wording)" (`:70`). The bot can also search existing issues for duplicates. Both are read-only.
- A disclaimer at the top of every AI-written post: `> *This was generated by AI during triage.*` (`:13-17`). This is a candidate default line in issue drafts.
- The category roles `bug` / `enhancement` (`:26-29`) as a minimal category field.

**Must change**

- Labels. Triage maps canonical roles to each repo's real label strings through a config file (`SKILL.md:43`, `skills/engineering/setup-matt-pocock-skills/triage-labels.md`). For us, labels are proposed per target repo (GitHub or GitLab) and applied only through Git write confirmation.
- `.out-of-scope/` prior-rejection lookup (`:70`, `OUT-OF-SCOPE.md`). It works only for repos that keep such a folder. The bot could read it when present, but should not create it.

**Does not apply**

- "Verify the claim": reproducing bugs and checking out PRs and running tests (`:74`). The bot has no checkout or runtime.
- The triage state machine and the "show what needs attention" queue. That is maintainer workflow, not brief drafting.

### to-tickets (`skills/engineering/to-tickets/SKILL.md`)

This is the closest match for one brief that becomes several issue drafts.

**Transfers as-is**

- Tracer-bullet vertical slices: "a narrow but COMPLETE path through every layer", "demoable or verifiable on its own" (`:29-36`).
- Blocking edges for each ticket (`:38`).
- Quiz the user on the breakdown before publishing. Show each ticket's Title, Blocked by, and What it delivers. Ask whether the granularity is right, whether the edges are correct, and whether to merge or split. "Iterate until the user approves the breakdown" (`:42-56`). In our flow this is the step before Git write confirmation.
- Publish blockers first, "so each ticket's blocking edges can reference real identifiers". Use native blocking where it exists (`:63`). Wayfinder adds create-then-wire: create first, then set edges in a second pass, because "a placeholder `#<n>` auto-links to an unrelated issue" (`skills/engineering/wayfinder/SKILL.md:114`). This is raw material for the "creating many issues at once" fog on the map.
- The issue template: Parent / What to build / Acceptance criteria / Blocked by (`:84-103`).
- The rule against file paths and code snippets, with the prototype-snippet exception (`:105`).
- Native blocking per platform. GitHub uses sub-issues and blocking links. GitLab uses `/blocked_by` quick actions, which are Premium/Ultimate only, with a `Blocked by:` line as the free-tier fallback (`skills/engineering/setup-matt-pocock-skills/issue-tracker-gitlab.md`, "Wayfinding operations"). This is relevant because GitHub and GitLab are equal targets.

**Must change**

- "Sized to fit in a single fresh context window" (`:33`) is an AFK-agent sizing rule. Our drafts are for humans or agents. #21 needs its own size rule ("how much detail is too much for one point of a brief").
- Auto-applying `ready-for-agent` (`:63`). We propose labels and do not assume this vocabulary.
- One point of a brief is not always one vertical slice. Points may merge or split. The quiz step is where that gets settled.

**Does not apply**

- The local-files tracker (`.scratch/<feature>/issues/NN-*.md`) and its template.
- Wide refactors and expand–contract sequencing (`:40`). Prefactoring advice (`:23`).
- "Do NOT close or modify any parent issue" (`:67`) is a guardrail we would keep, but no parent exists in the basic flow.

### to-spec (`skills/engineering/to-spec/SKILL.md`)

**Transfers as-is**

- "Do NOT interview the user; just synthesize what you already know" (`:7`). This describes the step after grilling: turn the settled answers into drafts.
- Use the project's glossary vocabulary and respect ADRs (`:13`).
- Section list: Problem Statement, Solution, User Stories (`As an <actor>, I want a <feature>, so that <benefit>`), Implementation Decisions, Testing Decisions, Out of Scope, Further Notes (`:21-75`).
- No file paths or code snippets in implementation decisions, with the prototype exception (`:55-57`).

**Must change**

- Length. "A LONG, numbered list of user stories ... extremely extensive" (`:33-41`). That does not fit a 2000-char message. Long drafts need an embed (4096), several messages, or a file attachment. Another option is a short preview in chat with the full body only in the created issue.
- Seams and testing decisions (`:15-17`, `:59-65`) assume the person answering is a developer. Briefs may come from non-developers. Make them optional or have the bot fill them from the repo.

**Does not apply**

- "Apply the `ready-for-agent` triage label - no need for additional triage" (`:19`).
- `/setup-matt-pocock-skills` tracker configuration. Our equivalent is Git scope plus the git account.

### to-questionnaire (`skills/productivity/to-questionnaire/SKILL.md`)

**Transfers as-is**

- "Grill the send, not the subject" (`:9`). When the brief author cannot answer, the bot asks the author who knows, then targets the questions at that person's knowledge gap.
- Question-writing rules: most important first ("async means you may only get one pass"), group by theme, "Every question is one idea, never compound", add "why this matters" only when a question could be misread, "Partial answers and 'I don't know' are useful", and finish with "Anything else?" (`:20-52`).

**Must change**

- The recipient is someone in the channel (an @mention or a thread), not someone who receives a Markdown document.
- The async deadline and effort line (`:36`) becomes a note in chat.

**Does not apply**

- Writing `to-questionnaire-<slug>.md` to the current directory (`:16`).

### domain-modeling (`skills/engineering/domain-modeling/SKILL.md`)

**Transfers as-is (passive)**

- Use the target repo's `GLOSSARY.md` words in drafts, and point out when a brief uses a term that conflicts with them (`:44-50`).
- Cross-reference with code: "When the user states how something works, check whether the code agrees" (`:56-58`). For us, flag a brief point that contradicts the repo.

**Does not apply**

- Writing `GLOSSARY.md` and ADRs inline (`:60-74`). Matt draws this line himself: merely reading `GLOSSARY.md` "is not this skill" (`:8`, `.agents/invocation.md:24-26`).

### wayfinder (`skills/engineering/wayfinder/SKILL.md`)

Not a playbook for the bot's main job. Parts that transfer:

- "Refer by name": in narration, a ticket is called by its title with the link inside it, never as a wall of `#42, #43` (`:15-17`). This is good chat style when the bot reports created issues.
- Create-then-wire and native blocking (`:69`, `:114`). See to-tickets above.
- Fog vs out of scope (`:82-101`) could become an "Open questions" or "Out of scope" section in a draft.

### writing-for-agents (`skills/productivity/writing-for-agents/`) and invocation (`.agents/invocation.md`)

This does not change what the bot says in chat. It is guidance for writing our playbooks, so it bears on #24.

- **Trigger = description.** A playbook's description is its "context pointer": it says what the material is and lists the branches that should trigger it (`SKILL.md:10-18`).
- **Explicit vs intent-detected maps to user-invoked vs model-invoked.** A user-invoked playbook (`disable-model-invocation: true`) costs no context and only fires when a human names it. A model-invoked one keeps its description in context every turn so the agent can fire it on its own (`SKILL-MECHANICS.md:5-12`). "Pick model-invocation only when the agent must reach the skill on its own, or another skill must." In this repo, `grilling` and `domain-modeling` are model-invoked. `to-spec`, `to-tickets`, `triage`, `to-questionnaire` and `wayfinder` are user-invoked (frontmatter of each).
- **Naming dependencies.** One playbook pulls in another with an explicit instruction ("Call the Skill tool with 'grilling'"), not a cross-folder file link (`.agents/invocation.md:16-20`). For us, the equivalent for naming the **Skills** (tools) a playbook needs is an open question in #24.
- **Progressive disclosure.** Keep the steps in the main file and move reference behind a pointer to a sibling file. `triage` keeps `AGENT-BRIEF.md` and `OUT-OF-SCOPE.md` beside `SKILL.md` (writing-for-agents `SKILL.md:29-43`; `skills/engineering/triage/SKILL.md:19-22`). This favours a playbook as a small folder of Markdown files, which fits Workspace storage (ADR 0003).
- **Platform specifics live outside the playbook.** The tracker (GitHub, GitLab, local) and the label mapping come from per-repo config docs written by `setup-matt-pocock-skills`. The playbooks say "publish to the issue tracker" (`skills/engineering/setup-matt-pocock-skills/issue-tracker-gitlab.md`, "When a skill says 'publish to the issue tracker'"). This is the same split as our platform-neutral issue draft.
- Every step needs a clear completion criterion (`SKILL.md:45-52`). Prompt the positive behaviour, not a prohibition (`:74`).

### Others

- `wait-what` (`skills/productivity/wait-what/SKILL.md:7`): "Re-pitch that ... in ASD-STE100 Simplified Technical English, and use the ubiquitous language from `GLOSSARY.md`". Could become a "say that again simply" command in chat.
- `handoff` writes to the OS temp directory. `research` and `prototype` are agent-side workflows. `pr` is a PR-body template. Its text credits Dex Horthy / Humanlayer's `show-me` skill (`skills/engineering/pr/SKILL.md:5-9`), so it has a second upstream. `tdd`, `diagnosing-bugs`, `code-review`, `implement`, `implement-spec`, `teach`, `chief-of-staff` (in progress) and the misc bucket do not apply. No playbook in the repo covers meeting minutes, so the Minutes playbook has no upstream to borrow from.

## Anatomy raw material for #21

The sources' guidance on what makes a well-specified issue, gathered in one place.

**Sections that recur**

| Section | Sources |
| --- | --- |
| Title: short, descriptive | to-tickets `:46` |
| Category: `bug` / `enhancement` | AGENT-BRIEF template; triage `:26-29` |
| Summary: one line on what needs to happen | AGENT-BRIEF template |
| Current behaviour (for a bug, the broken behaviour; for an enhancement, the status quo) / Problem statement from the user's perspective | AGENT-BRIEF; to-spec `:23-25` |
| Desired behaviour / Solution: "Be specific about edge cases and error conditions" | AGENT-BRIEF; to-spec `:27-29` |
| User stories: `As an <actor>, I want a <feature>, so that <benefit>` | to-spec `:31-41` |
| Key interfaces: types, function signatures, config shapes to look for or change | AGENT-BRIEF |
| Implementation decisions: modules, interfaces, schema changes, API contracts, specific interactions | to-spec `:43-57` |
| Testing decisions: what a good test is (external behaviour only), which modules, prior art | to-spec `:59-65` |
| Acceptance criteria: checkboxes, "concrete, testable", "independently verifiable" | AGENT-BRIEF; to-tickets `:94-97` |
| Out of scope: "prevents the agent from gold-plating or making assumptions about adjacent features" | AGENT-BRIEF; to-spec `:67-69` |
| Parent / Blocked by (or "None (can start immediately)") | to-tickets `:86-101` |
| Open questions: "established so far" / "still need from you" | triage needs-info template |
| AI-generated disclaimer | triage `:13-17` |

**Quality rules**

1. **Durability over precision.** The issue may sit for weeks. Do not cite file paths or line numbers. Do name types, signatures, and behavioural contracts (AGENT-BRIEF "Durability over precision"; to-spec `:55`; to-tickets `:105`).
2. **Behavioural, not procedural.** Describe *what* the system should do, not *how* to implement it. The implementer explores the code fresh (AGENT-BRIEF "Behavioral, not procedural", with good and bad pairs).
3. **Acceptance criteria tell the implementer when it is done.** Each one is testable on its own. "Triage should work correctly" is the bad example.
4. **One vertical slice per issue.** It is demoable or verifiable on its own (to-tickets `:29-36`).
5. **Use the domain glossary words and respect ADRs** (to-spec `:13`; to-tickets `:21`).
6. **Code snippets only when they encode a decision** (state machine, schema, type shape) better than prose. Trim them to the decision-rich parts (to-spec `:57`).
7. **The bad-brief checklist** (AGENT-BRIEF "Bad agent brief"): no category, vague description, stale paths and line numbers, no acceptance criteria, no scope boundaries, no current-vs-desired contrast.

**Tension to settle in #21:** #21 asks "how it cites the repository context it relied on". Matt's rule bans file paths and line numbers because they go stale. Ways to reconcile the two: name types, functions and concepts, as his rule allows. Use commit-pinned permalinks, which do not go stale but do go out of date. Or keep citations in a separate "Context used" footer that the reader can treat as a snapshot.

## Licence for borrowing text

- `mattpocock/skills` is MIT licensed, "Copyright (c) 2026 Matt Pocock" (`LICENSE`). Copying, modifying, and redistributing are allowed if "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software."
- In practice: if we ship playbook text adapted from these files (the grilling round format, the AGENT-BRIEF principles, the to-tickets template), keep the MIT notice with the copied material. Examples: a `NOTICE` or `THIRD_PARTY_LICENSES` entry, or a credit line in each adapted playbook that points to the source path and commit. Ideas and structure re-expressed in our own words do not need the notice, though a credit is still polite.
- `skills/engineering/pr/SKILL.md` credits a third-party source (Humanlayer `show-me`). Check that upstream's licence before borrowing its text. Nothing in this analysis depends on it.
- The `docs/` pages (for example `docs/productivity/grilling.md`) are in the same repo and under the same `LICENSE`.

## Surprising or notable

- `grilling` moved from one question at a time to rounds in PR #593. The upstream docs report that "a large part of the audience" still opts back to one question at a time. Rounds are the map's preference, but making them a setting is cheap.
- Matt rejected structured question UIs and question caps on purpose, with reasons (`.out-of-scope/`). Both choices come up again in Discord (buttons and selects, and noise in a shared channel). His reasons apply, but a shared channel raises the cost of noise more than a terminal does.
- No upstream playbook handles more than one person answering. Matt's whole design assumes one decider. Who decides in a channel is a new decision, and nothing upstream can be borrowed for it.
- His "agent brief" is our **Issue draft**, not our **Brief**. Copying text without renaming would bring in a term clash.
