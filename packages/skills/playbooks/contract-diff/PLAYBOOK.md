---
description: Records every frontend-facing API contract change of a backend repository, for its whole history or between two dates, as an OpenAPI document read from the source code.
category: Git, code & APIs
trigger: {"word": ["changelog"]}
default: off
requires: ["git_repositories", "openapi"]
tools: ["playbookRepositories", "startChangelog", "stopChangelog", "readPlaybookFile", "repoCompare", "repoCommit", "repoTree", "repoSearchCode", "repoFindDefinition", "repoReadFile", "repoFileDiff", "putChangelogOperation", "putChangelogComponents", "putChangelogNotes", "finishChangelog", "askChangelogAsker", "sendFiles", "publishOpenApi"]
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

**Record as you go.** An endpoint you traced but did not record is lost when the turn runs out: the next turn starts from the draft, not from what you read.

**Keep going until it is written.** While the changelog is open, the turn's context names its draft. Go on with that draft when the person says to; never ask again what it covers. Ending a turn that works on the changelog stops nothing: the work goes on by itself until it is written, so never ask whether to continue. When only the person who started it can answer something, such as which branch to read or whether a folder is set aside, ask them with `askChangelogAsker`: it is the only way you pause the work, and the question is your whole answer. When the person who started the changelog asks to stop it, in any words, call `stopChangelog` and say what was dropped; a message that only pauses stops nothing. When a turn ends before the changelog is written, answer in at most three short lines: how far it is (changed files done of all, endpoints recorded) and what comes next. Name no tools and no failed calls unless the person must act on them.

## 1. Pin what the changelog covers

What the changelog covers is the person's choice, never yours:

- **all**: the whole history. Every endpoint as it is now goes in, each one NEW.
- **range**: what changed from one day to another, both days included.

When the request does not say which, ask once, offering both, and wait. For a range, ask for any end the request leaves open: "per hari ini" or "up to today" names only the last day, so ask for the first. Days are read in this place's time zone. Never choose a scope, a first day or a last day for the person, and call no tool before you have their answer.

The repository is this thread's. When the prompt does not name it, call `playbookRepositories` once you have the answer; with several allowed, ask the person who started the thread which one, in one line, and wait. When neither the scope nor the repository is settled, ask both in the same message, and call `playbookRepositories` first only to offer its list.

Then call `startChangelog` with the repository, the scope, and for a range from and to; pass publish when the request also asks to publish, show, preview or share the changelog. It turns the days into two commits on the branch (head: the last commit through the last day; base: the last commit before the first day) and returns the draft path, both commits, and the first page of changed files.

- When it refuses, say why in one line and stop. When another changelog is open here, say which and ask whether to go on with it or stop it first.
- When no branch was named, it uses the default branch: name it when you say you are starting, and in your answer.
- When it says resumed, an earlier run recorded the operations it lists: go on with the endpoints not yet recorded.
- When it says alreadyWritten, a changelog of the same commits exists: offer it with `sendFiles`, unless the person asked to write it again.

Base and head below are the two commits it returned; read code at them by passing each as the ref. When base is the empty tree, nothing came before: read head only, and every endpoint you record is NEW.

## 2. Learn the repository's global conventions

Before touching individual endpoints, find out how this codebase shapes every request and response. Read checklist.md with `readPlaybookFile` and work through it at head. Many contract facts live in config files, base classes, and framework defaults rather than in the handler, and they also explain team-specific helpers (a custom response helper, a base controller, a global exception filter).

Read a convention's files at base too only when they are among the changed files: a file the range did not change is the same at both commits. If a global convention differs between base and head (envelope shape, error format, a header every request now needs, CORS, naming strategy), record it once as a global change with `putChangelogNotes` instead of repeating it on every endpoint.

Then write what you learned into the draft with `putChangelogNotes` conventions, in at most about 1,500 tokens: how routes are declared, prefixed and versioned, the envelope, the error format, validation, serialization and auth, each with the files that hold it. The turns that go on by themselves start from the draft, not from what you read, so this summary is all they know of the repository's conventions.

## 3. Find the affected endpoints

1. List the changed files. The first page came with `startChangelog`, with the patches of as many of them as fit; get the other patches with `repoFileDiff`, and the rest of the list with `repoCompare` from base to head, page by page, or with `repoTree` at head when base is the empty tree.
2. Follow each changed file outward to every route that uses it. A changed DTO, serializer, model, exception class, or shared helper changes every endpoint that touches it, even when those route files are untouched. Search for its usages (imports, class and function names) with `repoSearchCode`, recursively until you reach route registrations, and confirm each hit at head, since the search reads only the default branch: with `repoFindDefinition` for a function, class or constant, or with `repoReadFile` from the hit's line. Missing this step is the most common way a changelog ends up incomplete.
3. When the changed files include where routes are mounted, prefixed or versioned (the app's bootstrap, its modules or router mounts, a global prefix or versioning setting), compare the full route tables of base and head: list the route, controller and router files of each revision with `repoTree` (pass path for a folder) and read them at each commit, since a one-line change there can move or remove many endpoints. When none of those changed, the route table differs only in the changed controller and route files: compare just their routes, at both commits.

You now have candidate endpoints (method and path), plus any endpoints that exist only in base or only in head.

## 4. Trace each candidate, record it, then deepen

An endpoint's request goes through the code like this, at head and at base:

route registration (with prefixes and versioning) → middleware (global, group, route) → auth → input parsing and validation (declarative rules and manual checks inside the handler) → handler → services and the exceptions they throw → exception-to-status mapping → response building (serializer, resource, transformer) → envelope wrapping → serialization settings.

Trace it in two passes, so every endpoint is recorded before any of them is followed deep:

1. **For every candidate, first:** trace what changed to its end, and the rest of the contract as far as the route, the handler's signature, its DTOs, the validation and the global conventions show it: parameters, body, security, the success response, and the errors the changed code produces. Record it then. A response path the change did not touch and you have not traced, such as how a service's errors from another system map to statuses, goes in the operation's `x-unverified` by name (`"in": "operation"`, the reason saying what is left to trace) instead of being followed now.
2. **Once every candidate is recorded:** trace those named paths, and record each operation again with what you learned, its `x-unverified` entries removed as they are settled.

Read what changed in a file from the patch `startChangelog` gave, or with `repoFileDiff` from base to head; a function, method, class or constant at a commit with `repoFindDefinition`, which brings its decorators and whole body; and any other part of a file with `repoReadFile`, which reads about 9,000 characters at a time from the line you name and says where the next part starts.

From that, write down the contract for each revision: method and path; every path, query, header and cookie parameter (type, required, constraints, default); request content type and body schema; security; and every response the code can produce (status, body schema, error codes). Compare the two contracts. Each difference becomes one x-changes entry. If there are no differences, drop the endpoint.

**Presence versus null.** Decide this from how the serializer actually behaves (see checklist.md), not from the type annotation alone:

| Behavior | OpenAPI |
|---|---|
| always present, never null | listed in `required`, type without `"null"` |
| may be absent | not in `required` |
| always present, may be null | listed in `required`, type includes `"null"` |
| may be absent or null | not in `required`, type includes `"null"` |

Whenever a field is nullable or conditional, state the condition in its description (for example "null until the order ships"), because that is what decides how the frontend renders the empty state.

Record each endpoint as soon as it is traced, before you trace the next one, with `putChangelogOperation`: the whole operation, written as step 6 says. Put schemas that several operations share, and the security schemes, in `putChangelogComponents`, and $ref them. Fix every problem it returns before going on. An endpoint that exists only in base goes in the removed operations, through `putChangelogNotes`; what the code could not settle for the whole changelog goes there too, as unverified.

## 5. Classify impact

- **breaking**: frontend code that was correct against the old contract can fail or misbehave against the new one.
- **deprecated**: still works today, but is scheduled to go away.
- **non-breaking**: everything else.

| Usually breaking | Usually non-breaking |
|---|---|
| URL or method changed (old one gone) | new endpoint |
| request field, param, or header becomes required, or a new required one appears | new optional request field or param |
| validation tightened (shorter max, stricter format, enum value removed from accepted input) | validation relaxed |
| response field removed, renamed, or its type changed | new response field |
| response field becomes nullable or may be absent | response field becomes always present / non-null |
| new enum value in a response field | new error response for a new failure case |
| status code or error code of an existing case changed | |
| auth now required, envelope or content type changed | |

RENAMED is always breaking and DEPRECATED is always deprecated; the validator enforces both. A moved endpoint whose old URL still works is a CHANGED entry with `in: url`, impact deprecated, and a removal date or version. The tools set each operation's x-impact and the summary counts: never count them yourself.

## 6. Write each operation

The draft is OpenAPI 3.1.2: use 3.1 features only. Read extensions.md with `readPlaybookFile` before you record the first operation: it holds the extension reference and an example operation.

- **Only changed endpoints, each one complete.** Include every parameter, the full body, and every response the code can produce, unchanged parts included; what the first pass of step 4 left untraced is named in `x-unverified` until the second pass settles it. Viewers and type generators need the whole shape, and unchanged fields give context.
- **Self-contained.** No external $refs, and no servers. Components no path reaches are left out when the changelog is written.
- **Explicit security on every operation**, with `[]` for public endpoints, so auth is part of the recorded contract.
- **Examples.** Every JSON request body, every 2xx response, and every response named in x-changes gets an example: a realistic full payload exactly as received when hitting the endpoint, envelope included. Take values from the code where possible (enum members, constants, values matching the regex, fixtures, seeds, tests). When the null case of a field matters, give two named examples (one with the value, one with null) instead of a single one.
- **Error codes.** For each error status, name the application error codes it can carry and when, in the response description and the example.
- **Deprecation.** Set `deprecated: true` on deprecated operations, parameters, and schema properties in addition to the x-changes entry, so generated types flag them.
- **Keep schemas free of `x-` keys.** All change metadata lives on the operation and in the changelog notes. Generated types stay clean, and the viewer reads one list per operation.
- **Human-readable text** (descriptions, notes, reasons) follows the language the person writes in.
- Use the handler's name as the operation id when it is meaningful.

## 7. Validate and write

Every changed file is examined or set aside before the changelog is written. A file counts as examined when you read its whole patch with `repoFileDiff`, or the whole file with `repoReadFile` at base or head (every page of it); the patches `startChangelog` gave count too. Files that cannot change what the frontend sees (tests, docs, CI, lockfiles) you may set aside in the setAside list of `putChangelogNotes`, by pattern, each with its reason; never set aside a file only because there are many. `finishChangelog` refuses while any file is neither and names them: read or set those aside, then call it again.

Call `finishChangelog`. It validates the whole document (the contract-diff checks and the OpenAPI 3.1 schema), counts the summary, and writes the changelog's .json beside the draft. With errors nothing is written: fix each with `putChangelogOperation` or `putChangelogNotes` and call it again, until it writes the file. Read its warnings too: an unused component or an unverifiable field path usually means something is off.

## 8. Report

The file holds the details; the report says in plain words what changed for the frontend, as a list. Send the file with `sendFiles`, and write:

1. One sentence: the changelog for the range is ready, how many endpoints changed, and how many of them break existing frontend code.
2. One bullet per endpoint: its method and path in code format, then what changed in everyday words. The request and response fields the frontend uses may be named, in code format; nothing else of the code is (no file paths, schema or class names, commit hashes).
3. What the code could not settle, as a count in one line, such as "Two things could not be confirmed from the code; the file marks them."
   What was set aside unread, in one line with the reasons, such as "Not read: tests and CI configuration."
4. When the changelog was started with publish, `finishChangelog` published it as it wrote it: give the link on its own line and pass on its warning as written; when it says publishing failed, say so in one line. When the person asks to publish it only later, publish it with `publishOpenApi`.

- When nothing frontend-visible changed, `finishChangelog` writes no file: say so in one sentence, with how many changed files were examined.
- When `repoCompare` said GitHub stopped at 300 changed files, add that the changelog may miss some endpoints.
