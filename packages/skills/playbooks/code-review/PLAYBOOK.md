---
description: Reviews a pull request or the changes between two refs along two axes: the repository's coding standards, and the spec the change came from.
category: Matt Pocock's Skills
default: off
requires: ["git_repositories"]
repository: required
license: MIT, adapted from mattpocock/skills; the notice is in LICENSE.md
---
Two-axis review of the changes since a fixed point the person names, in this thread's repository:

- **Standards**: does the code conform to this repository's documented coding standards?
- **Spec**: does the code faithfully implement the originating issue or spec?

Review the two axes as two separate passes, one after the other, and keep their findings apart: do the whole Standards pass before you start the Spec pass, and never let a finding of one pass decide what the other reports.

## Process

### 1. Pin the fixed point

Call `playbookRepositories`, unless the prompt already names this thread's repository. With several allowed, ask the person who started the thread which one, in one line, and wait.

The fixed point is what the person named: a pull request number, or two refs (a branch, tag, or commit to compare against, and the branch with the changes). If they named neither, ask for it.

- For a pull request, read it with `repoMergeRequest` (description, branches, changed files) and its patches with `repoMergeRequestDiff`.
- For two refs, read the commits and changed files with `repoCompare`, and the commit messages with `repoCommits`.

Before going further, confirm that the fixed point resolves and the change is not empty. A bad ref or an empty change ends the review here, with one line saying so.

A tool result is cut at 12,000 characters. When a change is larger, review it file by file: read each changed file you need with `repoReadFile` at the change's branch.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in the pull request description or the commit messages (`#123`, `Closes #45`, GitLab `!67`), read with `repoIssue`.
2. An issue or path the person named.
3. A spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature (`repoReadFile`, `repoSearchCode`).
4. If nothing is found, ask the person where the spec is. If they say there isn't one, skip the Spec pass and report "no spec available".

### 3. Identify the standards sources

Search the repository for every file that documents how code should be written (`repoSearchCode`, `repoReadFile`). When `CODING_STANDARDS.md` or `CONTRIBUTING.md` exists, it must be on the list.

On top of whatever the repository documents, the Standards axis always carries the **smell baseline** below: a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repository documents nothing. Two rules bind it:

- **The repository overrides.** A documented repository standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the change:

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the change. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Run the two passes

**Standards pass.** Report, per file or hunk where relevant, (a) every place the change violates a documented standard: cite the standard (file and the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls: documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repository standard overrides the baseline. Skip anything tooling enforces.

**Spec pass.** Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the change that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding.

### 5. Report

Post the two reports under `## Standards` and `## Spec` headings. Do **not** merge or rerank findings, because the two axes are deliberately separate (see _Why two axes_). Your reply reaches Discord as at most three messages of 2,000 characters: keep each axis under 1,800 characters, and when one runs longer, post it in this turn and the other in the next.

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes: that's the reranking the separation exists to prevent.

Post the review on the pull request with `repoReviewMergeRequest` (event `comment`) only when the person who started the thread asks for it; it waits for their Confirm.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.
