---
description: Records every frontend-facing API contract change of a backend repository, for its whole history or between two dates, as an OpenAPI document read from the source code.
category: Git, code & APIs
trigger: {"word": ["changelog"]}
default: off
requires: ["git_repositories", "openapi"]
tools: ["playbookRepositories", "startChangelog", "stopChangelog", "readPlaybookFile", "repoCompare", "repoCommit", "repoTree", "repoSearchCode", "repoFindDefinition", "repoReadFile", "repoFileDiff", "putChangelogOperation", "putChangelogComponents", "putChangelogNotes", "putChangelogMapping", "mapChangedFiles", "traceEndpoints", "finishChangelog", "askChangelogAsker", "sendFiles", "publishOpenApi"]
repository: required
budget: long
---
Produce an OpenAPI document that holds only the endpoints whose frontend-facing contract changed between two revisions of this thread's repository: an API changelog. Each endpoint in it is described completely, and `x-` extensions record exactly what changed. You read the repository through the provider's API (there is no checkout, and nothing is run), and the tools named below keep the document in a draft until it validates.

## Principles

**The code is the only source of truth.** Do not take facts from existing OpenAPI/Swagger files, generated docs, READMEs, or code comments. This playbook exists for teams whose specs are missing or stale, so every type, rule, and status code in the output must come from code you actually traced. You may read those files as hints about what to check, never as answers.

**Record facts, not advice.** The output says what changed, not what the frontend should do about it. No "update the form", no "handle the new 409". Notes explain the change itself (what, when it takes effect, what replaces it).

**Only what the frontend can observe.** Skip refactors, query rewrites, logging, and performance work unless they change something visible: a field that can now be null, a different default sort, new pagination limits, a different status code, new rate-limit headers.

**Never guess.** When the code does not settle a question (dynamic keys, values from env/config, payloads passed through from another service), record it as unverified with the reason. The frontend writes code against this document, so a confident wrong answer does more damage than an honest gap.

**Ask for reads together.** Every step you take costs the person time. When reads do not depend on each other, such as one file at base and at head, call them all in one response.

**Record as you go.** What you found but did not record is lost when the turn runs out: the next turn starts from the draft, not from what you read. Record files set aside with `putChangelogNotes`; the workers record the rest in the draft. Tracing starts only once every changed file is mapped (step 4).

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
- When it says lastDay, the range's last day had not ended when its draft was pinned: the head moved to that day's last commit, so say so in one line with how many commits that added, then map the files it left unmapped and trace the candidates waiting again.
- When no branch was named, it uses the default branch: name it when you say you are starting, and in your answer.
- When it says resumed, an earlier run recorded the operations it lists: go on with the endpoints not yet recorded.
- When it says alreadyWritten, a changelog of the same commits exists: offer it with `sendFiles`, unless the person asked to write it again.

Base and head below are the two commits it returned; read code at them by passing each as the ref. When base is the empty tree, nothing came before: read head only, and every endpoint you record is NEW.

## 2. Learn the repository's global conventions

Before touching individual endpoints, find out how this codebase shapes every request and response. Read checklist.md with `readPlaybookFile` and work through it at head. Many contract facts live in config files, base classes, and framework defaults rather than in the handler, and they also explain team-specific helpers (a custom response helper, a base controller, a global exception filter).

Learn them at head only. A convention that differs between base and head (envelope shape, error format, a header every request now needs, CORS, naming strategy) is in a changed file, and the worker mapping that file records it once as a global change (step 3): do not record it yourself.

Then write what you learned into the draft with `putChangelogNotes` conventions, in at most about 1,500 tokens: how routes are declared, prefixed and versioned, the envelope, the error format, validation, serialization (field names, and how null and absent fields come out) and auth, each with the files that hold it. The turns that go on by themselves start from the draft, not from what you read, and the workers of steps 3 and 4 get this summary instead of checklist.md, so it is all they know of the repository's conventions. Write it before any file is mapped: `mapChangedFiles` and `traceEndpoints` refuse while the draft has none. A draft started earlier without one, such as one you go on with, gets it first too.

## 3. Map the changed files

Every changed file is mapped before any endpoint is traced: its whole patch read, then followed outward to the routes it reaches. Workers map them, so the patches never fill your context: do not read the patches or map files yourself.

1. Set aside first the changed files that cannot change what the frontend sees, such as tests, docs, CI, lockfiles, images and other binaries, in the setAside list of `putChangelogNotes`, by pattern, each with its reason. A pattern needs no list (`**/*.spec.ts`); the first page of changed files came with `startChangelog`, and `repoCompare` from base to head lists the rest, page by page. Never set aside a file only because there are many.
2. Call `mapChangedFiles` with the draft. It splits the files neither mapped nor set aside into groups by path and hands each group to a worker of its own, which follows mapping.md: it reads each file's whole patch, follows each change outward to every route it reaches, and records how each file ends with `putChangelogMapping`: the endpoints its change reaches, none with why, or a change to every endpoint alike, which the changelog records once, and the routes it takes away, which the changelog lists as removed operations. The worker whose files include where routes are mounted, prefixed or versioned compares the route tables of base and head: a route only in head becomes a candidate, one only in base a removed operation. Each endpoint reached is kept in the draft as a candidate waiting to be traced, its note naming every change that reaches it. You hear back only counts.
   - Workers run while the turn has time. When files wait, the next turn goes on with them: call `mapChangedFiles` with the draft again. A turn that goes on by itself sees in the draft which files are left.
   - A file one worker left unmapped joins a later group. A file two workers could not map is listed as unverified with why, and counts as mapped.

Once every file is mapped, the draft holds the candidate endpoints, those only in head among them, and its notes the global changes and the endpoints only in base.

## 4. Hand the candidates to workers

Once every changed file is mapped or set aside, call `traceEndpoints` with the draft alone. It traces the candidates mapping kept, each worker starting from its candidate's note, and with every file mapped they are all there are. Before then it traces nothing and names the files left: map those first. Endpoints that exist only in head are candidates too (they are NEW), kept when the file that declares their route is mapped. Those that exist only in base are not: mapping listed them in the removed operations.

Each candidate gets a worker of its own, which follows tracing.md: it reads the code at both commits, records its endpoint in the draft with `putChangelogOperation` and `putChangelogComponents`, marking what it could not prove as unverified, and says what it recorded. You never read what it read, so do not trace or record endpoints yourself. The result gives each endpoint's outcome: what was recorded, with its impact and number of changes, or why its worker failed.

- The draft keeps every candidate. A traced one is never traced again, and one whose worker failed is listed as unverified in the notes and is not traced again either.
- Workers run while the turn has time. When endpoints wait, the next turn goes on with them: call `traceEndpoints` again. A turn that goes on by itself sees in the draft which endpoints wait. `finishChangelog` refuses while any waits.
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
