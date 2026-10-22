---
description: Records every frontend-facing API contract change of a backend repository, for its whole history or between two dates, as an OpenAPI document read from the source code.
trigger: {"word": ["changelog"]}
default: off
requires: ["git_repositories", "openapi"]
repository: required
budget: long
---
Produce an OpenAPI document that holds only the endpoints whose frontend-facing contract changed between two revisions of this thread's repository: an API changelog. Each endpoint in it is described completely, and `x-` extensions record exactly what changed. You read the repository through the provider's API (there is no checkout, and nothing is run), and the tools named below keep the document in a draft until it validates.

## Principles

**The code is the only source of truth.** Do not take facts from existing OpenAPI/Swagger files, generated docs, READMEs, or code comments. This playbook exists for teams whose specs are missing or stale, so every type, rule, and status code in the output must come from code you actually traced. You may read those files as hints about what to check, never as answers.

**Record facts, not advice.** The output says what changed, not what the frontend should do about it. No "update the form", no "handle the new 409". Notes explain the change itself (what, when it takes effect, what replaces it).

**Only what the frontend can observe.** Skip refactors, query rewrites, logging, and performance work unless they change something visible: a field that can now be null, a different default sort, new pagination limits, a different status code, new rate-limit headers.

**Never guess.** When the code does not settle a question (dynamic keys, values from env/config, payloads passed through from another service), record it as unverified with the reason. The frontend writes code against this document, so a confident wrong answer does more damage than an honest gap.

## 1. Pin what the changelog covers

What the changelog covers is the person's choice, never yours:

- **all**: the whole history. Every endpoint as it is now goes in, each one NEW.
- **range**: what changed from one day to another, both days included.

When the request does not say which, ask once, offering both, and wait. For a range, ask for any end the request leaves open: "per hari ini" or "up to today" names only the last day, so ask for the first. Days are read in this place's time zone. Never choose a scope, a first day or a last day for the person, and call no tool before you have their answer.

The repository is this thread's. When the prompt does not name it, call `playbookRepositories` once you have the answer; with several allowed, ask the person who started the thread which one, in one line, and wait. When neither the scope nor the repository is settled, ask both in the same message, and call `playbookRepositories` first only to offer its list.

Then call `startChangelog` with the repository, the scope, and for a range from and to. It turns the days into two commits on the branch (head: the last commit through the last day; base: the last commit before the first day) and returns the draft path, both commits, and the first page of changed files.

- When it refuses, say why in one line and stop.
- When it says resumed, an earlier run recorded the operations it lists: go on with the endpoints not yet recorded.
- When it says alreadyWritten, a changelog of the same commits exists: offer it with `sendFiles`, unless the person asked to write it again.

Base and head below are the two commits it returned; read code at them by passing each as the ref. When base is the empty tree, nothing came before: read head only, and every endpoint you record is NEW.

## 2. Learn the repository's global conventions, in both revisions

Before touching individual endpoints, find out how this codebase shapes every request and response. Read checklist.md with `readPlaybookFile` and work through it at base and at head. Many contract facts live in config files, base classes, and framework defaults rather than in the handler, and they also explain team-specific helpers (a custom response helper, a base controller, a global exception filter).

If a global convention differs between base and head (envelope shape, error format, a header every request now needs, CORS, naming strategy), record it once as a global change with `putChangelogNotes` instead of repeating it on every endpoint.

## 3. Find the affected endpoints

1. List the changed files. The first page came with `startChangelog`; get the rest with `repoCompare` from base to head, page by page, or with `repoTree` at head when base is the empty tree.
2. Follow each changed file outward to every route that uses it. A changed DTO, serializer, model, exception class, or shared helper changes every endpoint that touches it, even when those route files are untouched. Search for its usages (imports, class and function names) with `repoSearchCode`, recursively until you reach route registrations, and confirm each hit with `repoReadFile` at head: the search reads only the default branch. Missing this step is the most common way a changelog ends up incomplete.
3. Compare the full route tables of base and head, not only the changed files. List the route, controller and router files of each revision with `repoTree` (pass path for a folder) and read them at each commit. Prefixes, versioning, and router mounts often live in other files, so a one-line change can move or remove many endpoints.

You now have candidate endpoints (method and path), plus any endpoints that exist only in base or only in head.

## 4. Trace each candidate end to end, in both revisions, and record it

For each endpoint, follow the request through the code at head and at base:

route registration (with prefixes and versioning) → middleware (global, group, route) → auth → input parsing and validation (declarative rules and manual checks inside the handler) → handler → services and the exceptions they throw → exception-to-status mapping → response building (serializer, resource, transformer) → envelope wrapping → serialization settings.

Read what changed in a file with `repoFileDiff` from base to head, and whole files with `repoReadFile` at each commit. A tool result is cut at 12,000 characters and a file at 20,000: when a part you need is cut off, record what you could not read as unverified.

From that, write down the contract for each revision: method and path; every path, query, header and cookie parameter (type, required, constraints, default); request content type and body schema; security; and every response the code can produce (status, body schema, error codes). Compare the two contracts. Each difference becomes one x-changes entry. If there are no differences, drop the endpoint.

**Presence versus null.** Decide this from how the serializer actually behaves (see checklist.md), not from the type annotation alone:

| Behavior | OpenAPI |
|---|---|
| always present, never null | listed in `required`, type without `"null"` |
| may be absent | not in `required` |
| always present, may be null | listed in `required`, type includes `"null"` |
| may be absent or null | not in `required`, type includes `"null"` |

Whenever a field is nullable or conditional, state the condition in its description (for example "null until the order ships"), because that is what decides how the frontend renders the empty state.

Record each endpoint as soon as it is traced, with `putChangelogOperation`: the whole operation, written as step 6 says. Put schemas that several operations share, and the security schemes, in `putChangelogComponents`, and $ref them. Fix every problem it returns before going on. An endpoint that exists only in base goes in the removed operations, through `putChangelogNotes`; what the code could not settle for the whole changelog goes there too, as unverified.

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

- **Only changed endpoints, each one complete.** Include every parameter, the full body, and every response the code can produce, unchanged parts included. Viewers and type generators need the whole shape, and unchanged fields give context.
- **Self-contained.** No external $refs, and no servers. Components no path reaches are left out when the changelog is written.
- **Explicit security on every operation**, with `[]` for public endpoints, so auth is part of the recorded contract.
- **Examples.** Every JSON request body, every 2xx response, and every response named in x-changes gets an example: a realistic full payload exactly as received when hitting the endpoint, envelope included. Take values from the code where possible (enum members, constants, values matching the regex, fixtures, seeds, tests). When the null case of a field matters, give two named examples (one with the value, one with null) instead of a single one.
- **Error codes.** For each error status, name the application error codes it can carry and when, in the response description and the example.
- **Deprecation.** Set `deprecated: true` on deprecated operations, parameters, and schema properties in addition to the x-changes entry, so generated types flag them.
- **Keep schemas free of `x-` keys.** All change metadata lives on the operation and in the changelog notes. Generated types stay clean, and the viewer reads one list per operation.
- **Human-readable text** (descriptions, notes, reasons) follows the language the person writes in.
- Use the handler's name as the operation id when it is meaningful.

## 7. Validate and write

Call `finishChangelog`. It validates the whole document (the contract-diff checks and the OpenAPI 3.1 schema), counts the summary, and writes the changelog's .json beside the draft. With errors nothing is written: fix each with `putChangelogOperation` or `putChangelogNotes` and call it again, until it writes the file. Read its warnings too: an unused component or an unverifiable field path usually means something is off.

## 8. Report

- When nothing frontend-visible changed, `finishChangelog` writes no file. Say so, and what was examined: how many changed files, and which endpoints were traced.
- Otherwise report briefly: the file path, the summary counts, one line per breaking change, every unverified item, and that it validated. The file is the deliverable; the report only helps the person decide whether to open it. Offer to send it with `sendFiles`.
- When the request also asked to show, preview or share the changelog, publish it with `publishOpenApi` and give the link it returns, with any warning.
- When `repoCompare` said GitHub stopped at 300 changed files, say that the changelog may miss endpoints those files would have shown.
