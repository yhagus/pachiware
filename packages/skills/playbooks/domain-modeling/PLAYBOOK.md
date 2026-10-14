---
description: Builds and sharpens a project's domain model: challenges terms and writes the glossary and decision records as they settle.
default: off
optional: ["workspace", "git_repositories"]
license: MIT, adapted from mattpocock/skills; the notice is in LICENSE.md
---
# Domain Modeling

Actively build and sharpen the project's domain model while the people in this thread design. This is the *active* discipline: challenge terms, invent edge-case scenarios, and write the glossary and the decisions down when they settle. Reading a glossary for vocabulary is a habit any playbook has; this playbook is for changing the model.

## Where the documents live

At the start, call `playbookRepositories`, unless the prompt already names this thread's repository or the tool is not offered here. With one allowed it becomes the thread's repository; with several, ask the person who started the thread which one, in one line, before you read or write any document.

**With a repository**, the project's documents are files in it:

```
/
├── GLOSSARY.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `GLOSSARY-MAP.md` exists at the root, the repository has several contexts, and the map says where each glossary and `docs/adr/` folder lives. Read the files with `repoReadFile` (it also lists a folder). Once the prompt names this thread's documents branch, read from that branch (`ref`), because your earlier writes are there and not yet on the default branch.

**Without a repository** (git scope allows none here, or `playbookRepositories` is not offered), the glossary is `glossary.md` in this channel's Workspace folder, and each decision record becomes a Decision in that folder. Read them with `readFile` and `listFiles`. When `writePlaybookDocument` is not offered, write them with `writeFile`: the glossary at path "channel/glossary.md", and a decision at "channel/decisions/" plus its date and a slug.

Create files lazily: only when you have something to write. When no glossary exists, create one when the first term is resolved. When no `docs/adr/` exists, create it with the first decision record.

## In the thread

### Challenge against the glossary

When someone uses a term that conflicts with the existing language in the glossary, call it out at once. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When someone uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the people to be precise about the boundaries between concepts.

### Cross-reference with code

When someone states how something works, check whether the code agrees: `repoSearchCode` and `repoReadFile` in the thread's repository. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update the glossary as terms settle

When a term is resolved, write the glossary with `writePlaybookDocument` (kind `glossary`, path `GLOSSARY.md` or the context's glossary from the map). The tool replaces the whole file, so read the current glossary first and send all of it with your change. With a repository every write waits for the person's Confirm, so write once per round of answers: put every term resolved in that round into one write, and do not hold terms back for a later round. Use the format in `domain-modeling/GLOSSARY-FORMAT.md` (read it with `readPlaybookFile`).

The glossary is totally devoid of implementation details. It is not a spec, a scratch pad, or a store for implementation decisions. It is a glossary and nothing else.

### Offer decision records sparingly

Only offer to record a decision when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the record. When the person who started the thread accepts, write it with `writePlaybookDocument` (kind `decision`, path `docs/adr/` plus the next number and a slug). Use the format in `domain-modeling/ADR-FORMAT.md`.

Only the person who started this thread decides which terms and decisions are written. Others give input.
