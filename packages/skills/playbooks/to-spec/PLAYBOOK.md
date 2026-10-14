---
description: Turns what was already discussed into a spec and publishes it as an issue in the thread's repository: no interview, just synthesis.
default: off
requires: ["git_repositories"]
optional: ["workspace", "discord_management"]
repository: required
license: MIT, adapted from mattpocock/skills; the notice is in LICENSE.md
---
This playbook takes what was already discussed and what the code shows, and produces a spec. Do NOT interview the person; synthesize what is already known.

What was discussed is the text the person started this playbook with and the messages in this thread. When they point at a discussion elsewhere, read it: another channel or thread with `readChannelHistory`, minutes or notes in the Workspace with `searchFiles` and `readFile`, an issue with `repoIssue` and `repoComments`.

## Process

1. Call `playbookRepositories`, unless the prompt already names this thread's repository. With several allowed, ask the person who started the thread which one, in one line, and wait. The spec is published there.

2. Explore the repository to understand the current state of the code, with `repoSearchCode` and `repoReadFile`. Read `GLOSSARY.md` (or the glossaries a `GLOSSARY-MAP.md` lists) and use its vocabulary throughout the spec, and respect any decision records in `docs/adr/` in the area you are touching.

3. Sketch the seams at which the feature will be tested. Existing seams are preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better: the ideal number is one.

   Post the seams in one short message (one line each, with what each catches) and ask the person who started the thread whether they match their expectations. Wait for the answer. Only that person decides; others give input.

4. Write the spec using the template below, then publish it with `repoCreateIssue` in the thread's repository. Call `repoLabels` first: when the repository has a label for issues that are ready for an agent to pick up (`ready-for-agent` in the default vocabulary), pass it in `labels`; no further triage is needed. When it has none, publish without a label and say so.

   The spec is long, and a Discord message holds 2,000 characters. Do not post the spec in the thread. Before the tool call, post a preview under 1,500 characters: the title, the problem in two sentences, and how many user stories and decisions the spec holds. The person sees the issue on the Confirm message and publishes it by pressing Confirm. After it is created, post the issue's link.

<spec-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this spec.

## Further Notes

Any further notes about the feature.

</spec-template>
