---
description: Records every frontend-facing API contract change of a backend repository, for its whole history or between two dates, as an OpenAPI document read from the source code.
category: Git, code & APIs
trigger: {"word": ["changelog"]}
default: off
requires: ["git_repositories", "openapi"]
tools: ["playbookRepositories", "startChangelog", "stopChangelog", "readPlaybookFile", "repoCompare", "repoCommit", "repoTree", "repoSearchCode", "repoFindDefinition", "repoReadFile", "repoFileDiff", "putChangelogOperation", "putChangelogComponents", "putChangelogNotes", "putChangelogMapping", "traceEndpoints", "finishChangelog", "askChangelogAsker", "sendFiles", "publishOpenApi"]
repository: required
budget: long
---
Produce an OpenAPI document that holds only the endpoints whose frontend-facing contract changed between two revisions of this thread's repository: an API changelog. Each endpoint in it is described completely, and `x-` extensions record exactly what changed. You read the repository through the provider's API (there is no checkout, and nothing is run), and the tools named below keep the document in a draft until it validates.

## Principles

**The code is the only source of truth.** Do not take facts from existing OpenAPI/Swagger files, generated docs, READMEs, or code comments. This playbook exists for teams whose specs are missing or stale, so every type, rule, and status code in the output must come from code you actually traced. You may read those files as hints about what to check, never as answers.

**Record facts, not advice.** The output says what changed, not what the frontend should do about it. No "update the form", no "handle the new 409". Notes explain the change itself (what, when it takes effect, what replaces it).

**Only what the frontend can observe.** Skip refactors, query rewrites, logging, and performance work unless they change something visible: a field that can now be null, a different default sort, new pagination limits, a different status code, new rate-limit headers.

**Never guess.** When the code does not settle a question (dynamic keys, values from env/config, payloads passed through from another service), record it as unverified with the reason. The frontend writes code against this document, so a confident wrong answer does more damage than an honest gap.

**Ask for reads together.** Every step you take costs the person time. When reads do not depend on each other, such as the diffs of all the changed files, or one file at base and at head, call them all in one response.

**Record as you go.** What you found but did not record is lost when the turn runs out: the next turn starts from the draft, not from what you read. Map each changed file with `putChangelogMapping` as soon as you have followed its patch. Hand candidates to `traceEndpoints` as soon as you have them, and record removed endpoints and files set aside with `putChangelogNotes`.

**Keep going until it is written.** While the changelog is open, the turn's context names its draft. Go on with that draft when the person says to; never ask again what it covers. Ending a turn that works on the changelog stops nothing: the work goes on by itself until it is written, so never ask whether to continue. When only the person who started it can answer something, such as which branch to read or whether a folder is set aside, ask them with `askChangelogAsker`: it is the only way you pause the work, and the question is your whole answer. When the person who started the changelog asks to stop it, in any words, call `stopChangelog` and say what was dropped; a message that only pauses stops nothing. When a turn ends before the changelog is written, answer in at most three short lines: how far it is (changed files mapped of all, endpoints recorded) and what comes next. Name no tools and no failed calls unless the person must act on them.

## 1. Pin what the changelog covers

What the changelog covers is the person's choice, never yours:

- **all**: the whole history. Every endpoint as it is now goes in, each one NEW.
- **range**: what changed from one day to another, both days included.

When the request does not say which, ask once, offering both, and wait. For a range, ask for any end the request leaves open: "per hari ini" or "up to today" names only the last day, so ask for the first. Days are read in this place's time zone. Never choose a scope, a first day or a last day for the person, and call no tool before you have their answer.

The repository is this thread's. When the prompt does not name it, call `playbookRepositories` once you have the answer; with several allowed, ask the person who started the thread which one, in one line, and wait. When neither the scope nor the repository is settled, ask both in the same message, and call `playbookRepositories` first only to offer its list.

Then call `startChangelog` with the repository, the scope, and for a range from and to; pass publish when the request also asks to publish, show, preview or share the changelog. It turns the days into two commits on the branch (head: the last commit through the last day; base: the last commit before the first day) and returns the draft path, both commits, and the first page of changed files.

- When it refuses, say why in one line and stop. When it refuses because another changelog is open here, ask with `askChangelogAsker`, passing that draft, whether to go on with it or stop it first, naming both changelogs. Never ask this in plain text: the work goes on without the answer.
- When it says goesOn, the changelog asked for is the one open here, with the same repository, branch and coverage: say so in one line and go on with it, without asking.
- When no branch was named, it uses the default branch: name it when you say you are starting, and in your answer.
- When it says resumed, an earlier run recorded the operations it lists: go on with the endpoints not yet recorded.
- When it says alreadyWritten, a changelog of the same commits exists: offer it with `sendFiles`, unless the person asked to write it again.

Base and head below are the two commits it returned; read code at them by passing each as the ref. When base is the empty tree, nothing came before: read head only, and every endpoint you record is NEW.

## 2. Learn the repository's global conventions

Before touching individual endpoints, find out how this codebase shapes every request and response. Read checklist.md with `readPlaybookFile` and work through it at head. Many contract facts live in config files, base classes, and framework defaults rather than in the handler, and they also explain team-specific helpers (a custom response helper, a base controller, a global exception filter).

Read a convention's files at base too only when they are among the changed files: a file the range did not change is the same at both commits. If a global convention differs between base and head (envelope shape, error format, a header every request now needs, CORS, naming strategy), record it once as a global change with `putChangelogNotes` instead of repeating it on every endpoint.

Then write what you learned into the draft with `putChangelogNotes` conventions, in at most about 1,500 tokens: how routes are declared, prefixed and versioned, the envelope, the error format, validation, serialization (field names, and how null and absent fields come out) and auth, each with the files that hold it. The turns that go on by themselves start from the draft, not from what you read, and the workers of step 4 get this summary instead of checklist.md, so it is all they know of the repository's conventions. Write it before any endpoint is traced: `traceEndpoints` refuses while the draft has none. A draft started earlier without one, such as one you go on with, gets it first too.

## 3. Map the changed files

Every changed file is mapped before the changelog is written: its whole patch read, then followed outward to the routes it reaches.

1. List the changed files. The first page came with `startChangelog`, with the patches of as many of them as fit; get the other patches with `repoFileDiff`, and the rest of the list with `repoCompare` from base to head, page by page, or with `repoTree` at head when base is the empty tree.
2. Follow each changed file outward to every route that uses it. A changed DTO, serializer, model, exception class, or shared helper changes every endpoint that touches it, even when those route files are untouched. Search for its usages (imports, class and function names) with `repoSearchCode`, recursively until you reach route registrations, and confirm each hit at head, since the search reads only the default branch: with `repoFindDefinition` for a function, class or constant, or with `repoReadFile` from the hit's line. Missing this step is the most common way a changelog ends up incomplete.
3. When the changed files include where routes are mounted, prefixed or versioned (the app's bootstrap, its modules or router mounts, a global prefix or versioning setting), compare the full route tables of base and head: list the route, controller and router files of each revision with `repoTree` (pass path for a folder) and read them at each commit, since a one-line change there can move or remove many endpoints. When none of those changed, the route table differs only in the changed controller and route files: compare just their routes, at both commits.
4. Record how each file ended with `putChangelogMapping` once you have followed it: the endpoints its change reaches (method and full path as the frontend calls it, with what changed), none with why (a seed, a script, a scheduler), or a change to every endpoint alike (a global prefix or versioning, a global guard, interceptor or pipe, the envelope, the bootstrap), recorded once as a global change. Keep every endpoint a change reaches: whether its contract changed is for its worker to find. A file is mapped only once its whole patch was read, with `repoFileDiff` or every line of it at base or head with `repoReadFile` (every page); the patches `startChangelog` gave count. Each endpoint reached is kept in the draft as a candidate waiting to be traced, one per endpoint, its note naming every change that reaches it.

You now have the candidate endpoints in the draft, plus any endpoints that exist only in base or only in head.

## 4. Hand the candidates to workers

Call `traceEndpoints` with the draft and every candidate: its method, its full path as the frontend calls it, and in note where its route is declared and what changed that reaches it, so its worker starts from there. Endpoints that exist only in head are candidates too (they are NEW). Those that exist only in base are not: record them in the removed operations with `putChangelogNotes`.

Each candidate gets a worker of its own, which follows tracing.md: it reads the code at both commits, records its endpoint in the draft with `putChangelogOperation` and `putChangelogComponents`, marking what it could not prove as unverified, and says what it recorded. You never read what it read, so do not trace or record endpoints yourself. The result gives each endpoint's outcome: what was recorded, with its impact and number of changes, or why its worker failed.

- The draft keeps every candidate. A traced one is never traced again, and one whose worker failed is listed as unverified in the notes and is not traced again either.
- Workers run while the turn has time. When endpoints wait, the next turn goes on with them: call `traceEndpoints` with the draft alone. A turn that goes on by itself sees in the draft which endpoints wait.
- Candidates you find later, such as on the next page of changed files, go to `traceEndpoints` too; those already kept keep their state.
- What the code could not settle for the whole changelog goes in the notes as unverified, with `putChangelogNotes`.

## 5. Validate and write

Every changed file is mapped (step 3) or set aside before the changelog is written. Files that cannot change what the frontend sees (tests, docs, CI, lockfiles) you may set aside in the setAside list of `putChangelogNotes`, by pattern, each with its reason; never set aside a file only because there are many. `finishChangelog` refuses while any file is neither and names them: map or set those aside, then call it again.

Call `finishChangelog`. It validates the whole document (the contract-diff checks and the OpenAPI 3.1 schema), counts the summary, and writes the changelog's .json beside the draft. With errors nothing is written: fix each (with `putChangelogNotes`, `putChangelogComponents`, or `putChangelogOperation` given the whole operation) and call it again, until it writes the file. Read its warnings too: an unused component or an unverifiable field path usually means something is off.

## 6. Report

The file holds the details; the report says in plain words what changed for the frontend, as a list. Send the file with `sendFiles`, and write:

1. One sentence: the changelog for the range is ready, how many endpoints changed, and how many of them break existing frontend code.
2. One bullet per endpoint: its method and path in code format, then what changed in everyday words. The request and response fields the frontend uses may be named, in code format; nothing else of the code is (no file paths, schema or class names, commit hashes).
3. What the code could not settle, as a count in one line, such as "Two things could not be confirmed from the code; the file marks them."
   What was set aside unread, in one line with the reasons, such as "Not read: tests and CI configuration."
4. When the changelog was started with publish, `finishChangelog` published it as it wrote it: give the link on its own line and pass on its warning as written; when it says publishing failed, say so in one line. When the person asks to publish it only later, publish it with `publishOpenApi`.

- When nothing frontend-visible changed, `finishChangelog` writes no file: say so in one sentence, with how many changed files were mapped.
- When `repoCompare` said GitHub stopped at 300 changed files, add that the changelog may miss some endpoints.
