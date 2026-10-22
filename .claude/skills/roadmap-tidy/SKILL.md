---
name: roadmap-tidy
description: Sync the project roadmap in PROGRESS.md to GitHub Milestones and issues. Use only when the user runs /roadmap-tidy or asks to tidy or sync the roadmap.
disable-model-invocation: true
---

# roadmap-tidy

Turns the phases in `PROGRESS.md` into a visual roadmap on GitHub:

- **Milestone** = a big goal (e.g. "Git access", "Plane integration"). It groups several phases.
- **Issue** = one item in that goal (usually one phase, or the spec issue the phase came from).
- **Issue body** = the item's detail.

GitHub's milestone page then shows each goal with a progress bar, its issues, and their details.

`PROGRESS.md` stays the source of truth. This skill only reads it. It never edits, deletes or reorders `PROGRESS.md`.

## Requirements

- `gh` is installed and authenticated (`gh auth status`). If it is not, stop and say so.
- Run inside the repo clone; `gh` infers the repo from `git remote -v`.
- Follow `docs/agents/issue-tracker.md` for `gh` conventions.

## How issues are recognised (no local state)

Every issue this skill creates or adopts carries a marker in its body, or for adopted issues in a comment:

```
<!-- roadmap-tidy: phase=56 -->
```

Every milestone description ends with:

```
<!-- roadmap-tidy: milestone=<slug> phases=12,13,14 -->
```

Always read these markers first, so running the skill twice changes nothing the second time.

## Step 1: Read the current state

1. Parse `PROGRESS.md`. Every heading that matches `Phase <n>` (including `15.2`-style numbers) starts a phase. For each phase, collect:
   - number and title
   - the "Asked by the user on <date>" date, if present
   - checked `[x]` and unchecked `[ ]` items
   - whether it says "Merged" or "COMPLETE"
   - issue references such as `spec #155`, `map #16` or `(#241–#245)`
   - the Verification line
2. Fetch the GitHub side:
   - `gh api 'repos/{owner}/{repo}/milestones?state=all&per_page=100'`
   - `gh issue list --state all --limit 1000 --json number,title,state,milestone,body,labels`
   - match markers to phases.

## Step 2: Plan

### First run (no milestone has a roadmap-tidy marker yet)

Propose a grouping of all phases into 5–10 milestones. Each milestone must be a goal a user would recognise, not a time period. Group by what the phases were for, using the titles and spec issues. Example from this repo:

- **Multi-tenant platform**: 12–14
- **Git access**: 16–24
- **Admin assistant and memory**: 26, 29, 34, 39, 40, 56
- **Plane integration**: 37, 49, 51–54
- **Harness and eval quality**: 33, 36, 38, 41–45

For each milestone, write a one or two sentence goal statement.

Show the grouping to the user and **wait for approval or edits before creating anything**. The grouping is the user's call.

### Later runs

- Phases with no marked issue are new. Propose a milestone for each one: an existing milestone, or a new one when it fits none.
- Detect changes since the last run:
  - newly ticked items
  - newly merged phases
  - new loose ends

## Step 3: Decide the issue for each phase

1. **The phase names a single spec or map issue** (e.g. "spec #155"): adopt that issue.
   - Add the milestone.
   - Add a comment with the marker.
   - Never rewrite the body of an issue this skill did not create.
2. **Otherwise**, create an issue titled `Phase <n>: <title>` with the label `roadmap`. Create the label if it is missing. The body has:
   - the marker
   - a one-paragraph summary of the phase's goal
   - the checklist copied from `PROGRESS.md`
   - the Verification line
   - linked issue numbers and commit hashes as they appear
   - a closing line: `Source: PROGRESS.md, Phase <n>`

   On later runs, update the body of these created issues when the phase text changed.
3. **Ticket issues** referenced by a phase (e.g. `#241–#245`): give them the same milestone. Leave them otherwise untouched.

## Step 4: Decide states

**Phase issues**

- A phase that is merged or marked complete gets a closed issue, even when it has loose ends.
- Do not reopen an issue a human closed.

**Loose ends**

- Unchecked `[ ]` items in a merged or complete phase are loose ends.
- Collect them into one open issue per milestone, titled `Loose ends: <milestone>`, with the marker `<!-- roadmap-tidy: loose-ends=<slug> -->`.
- Write them as a checklist, each item naming its phase.
- Close this issue when the list becomes empty.

**Unfinished phases**

- A phase that is neither merged nor complete gets an open issue.

**Milestones**

- Close a milestone when all its issues are closed.
- Reopen it if a new open issue joins it.
- Due dates are set only when the user gives them.

## Step 5: Dry run, then apply

1. Print the plan in the user's language as a compact table: milestone, phases, issues to create, adopt or close, and loose ends.
2. Ask for confirmation.
3. Apply with `gh`:
   - **Milestone:** `gh api repos/{owner}/{repo}/milestones -f title=... -f description=...`
   - **Edit a milestone:** `PATCH .../milestones/<number>`
   - **Issues:** `gh issue create --milestone`, `gh issue edit <n> --milestone`, `gh issue close`
4. Use heredocs for bodies.
5. Go in phase order, and continue past single failures. Report them at the end.

## Step 6: Report

In two or three lines, report:

- what was created, adopted and closed
- the number of open loose ends
- the link `https://github.com/<owner>/<repo>/milestones`

## Never

- Edit `PROGRESS.md`, or any issue body this skill did not create.
- Delete milestones or issues. If a milestone becomes empty, tell the user instead.
- Invent progress. Status comes only from `PROGRESS.md` and the issues' own state.
