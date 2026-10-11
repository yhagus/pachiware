# Anatomy of an issue draft

## Sections, in order

Leave out an empty optional section; never write "N/A". Use only Markdown that both GitHub and GitLab render.

1. **Title**: imperative, at most 70 characters, no `[Feature]`-style prefix. Labels carry the category.
2. **Summary**: one or two lines on what changes and why.
3. **Current behaviour**: what happens now. For a bug, the broken behaviour; for a change to an existing feature, the status quo it builds on. Leave it out for a brand-new feature.
4. **Desired behaviour**: what should happen afterwards, including edge cases and error conditions. When the draft is grounded in a repository, name its interfaces here by concept.
5. **Acceptance criteria**: a `- [ ]` task list, each item concrete, testable, and verifiable on its own. At most 7.
6. **Out of scope**: what this issue does not change, so nobody gold-plates adjacent features.
7. **Open questions**: in the needs-info shape below, each question with your recommended answer. At most 5.
8. **Blocked by**: only when another draft of the same brief has to land first.
9. **Footer**: "Drafted by <bot name> from a brief by <author>", linked to the Discord message, then **Context used** when you read anything.

The body must fit one Discord embed (4096 characters). A draft that would not fit, or would need more than 7 acceptance criteria or 5 open questions, is split into several drafts.

writeIssueDraft lays the body out from its fields (summary, current, desired, acceptance, outOfScope, established, openQuestions, blockedBy) and adds the footer itself. Write no headings inside a field.

Open questions take this shape:

```
**Established so far:**
- what the author already settled

**Still need from @author:**
- the question ➡️ your recommended answer
```

Questions must be specific and actionable, never "please provide more info".

## Gap checklist

Walk this list for every point. Add only the items that apply to that point, each in the section where it belongs, tagged *(added)* so the author can reject it. When an item would change the draft and you cannot settle it from facts, ask about it in the round instead.

- Edge cases and error conditions
- Dependencies between points of the brief
- Non-functional concerns: permissions, security, privacy, performance
- Testing
- Rollout: migrations, backward compatibility, feature flags
- UI states: empty, loading, error

## Writing rules

- **Durability over precision.** An issue may wait weeks while the code changes. Name types, functions, behavioural contracts and glossary terms; never file paths or line numbers in the body.
- **Behavioural, not procedural.** Say what the system should do, not how to implement it. Good: "Exports keep the table's current filters." Bad: "Add a filter param in the export handler."
- **Complete acceptance criteria.** The implementer needs to know when the work is done. "Export works correctly" is not a criterion.
- **Explicit scope.** State what is out of scope.
- **Labels.** A neutral Category (`bug`, `feature`, `chore`, `docs`) plus Proposed labels taken only from the target repository's existing labels. Never invent a label.

## Credit

The writing rules and the needs-info shape are adapted from `skills/engineering/triage/AGENT-BRIEF.md` and `skills/engineering/triage/SKILL.md` in mattpocock/skills (https://github.com/mattpocock/skills, commit 49dd158d1076134a641b33efb035946536778336), used under the MIT License:

MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
