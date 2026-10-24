# An API changelog maps every changed file before it traces

On 2026-10-24 the Velodiva changelog of 22–23 October (34 commits, 295 changed files, in a repository of 706 routes) showed "28 dari 38 endpoint selesai ditelusuri", and its asker read it as every endpoint being traced. The main loop had handed 38 candidates to `traceEndpoints` 25 seconds after listing the changed files, having read 6 of the 28 changed controllers. The changes spread over about 38 module folders, the candidates over 6. Tracing then took the whole 15-minute turn, so the total shown was not a total. The draft also held no conventions summary, so every worker learned the conventions again.

Decided with the user on 2026-10-24: no candidate endpoint is traced before every changed file is mapped. The code sorts the changed files by path and splits them into groups bounded by patch size (about 40,000 characters or 20 files), never splitting a file; a file over the bound gets a group of its own. One mapping worker per group reads each file's whole patch, follows each change outward to the routes it reaches, and records in the draft itself the candidates (method, path, and the change that reaches it) and how each file ended:

- it reaches these candidates;
- it reaches no endpoint, and why;
- it changes every endpoint alike (a global prefix or versioning, a global guard, interceptor or pipe, the envelope, the bootstrap), recorded once in the notes;
- it is set aside, by pattern, with a reason.

The worker holding where routes are mounted compares the route tables at base and head: a route only in base goes to the removed operations, one only in head becomes a candidate. Mapping does not judge what the frontend can see; the tracing workers decide that from the code at both commits. `traceEndpoints` refuses while any changed file is unmapped or the draft has no conventions summary. A changelog of the whole history maps the files that declare routes at head the same way, and every route becomes a NEW candidate.

## Considered options

- **Hand candidates to `traceEndpoints` as soon as they are found (ADRs 0024 and 0025 as written).** Rejected: the total the asker sees grows while tracing runs, and a turn spent tracing finds nothing.
- **The main loop maps the files itself.** Rejected: 295 patches (+11,085 lines) in its context is the problem ADR 0024 solved.
- **The code maps them through an import graph.** Rejected: the repository is read through the provider's API, and the playbook serves any framework.
- **One mapping worker per module folder.** Rejected: not every framework groups files by feature; Laravel groups them by kind.
- **One mapping worker per file.** Rejected: 295 workers would repeat every search across modules.
- **Mapping drops changes that look internal.** Rejected: never guess. 8 of the 37 candidates traced came back unchanged, the price of missing none.
- **Reading the commits one by one.** Rejected: every message said "feat: update velodesk revamp N", a change undone inside the range would count, and the frontend sees only the end state.

## Consequences

- A mapping worker has a tracing worker's budget (20 steps, 5 minutes), and both kinds share the tenant's `playbookWorkers`. Files a worker did not map wait and join a later group. A file two workers could not map is listed as unverified with why, counts as mapped for both gates, and is counted in the report's unverified line. A worker that cannot reach the model pauses the draft as ADR 0025 says.
- "Mapped" replaces "examined": `finishChangelog` needs every changed file mapped, and a turn that maps files counts as progress for ADR 0025's two-turns rule. A file is mapped only after its whole patch was read.
- One endpoint reached from several files is one candidate, its note naming each change.
- A global change is the one place mapping judges what the frontend sees: no tracing worker follows it, so its mapping worker reads its code at both commits and writes its change entry, status and impact included, as the changelog keeps it. Global code whose change the frontend does not see, such as logging or metrics, reaches no endpoint, with why.
- Nothing is recorded while files are mapped. The progress message shows the commits, the files mapped of all, and the candidates so far; then the candidates traced, as changed, unchanged or unverified.
- Decided the same day and kept in GLOSSARY only: a range covers its last day to its end, so a draft started before that day was over moves its head to the day's last commit once it goes on after the day; the files changed after the old head are mapped again, and the traced candidates they reach are traced again. Asking for the same changelog goes on with the open draft.
