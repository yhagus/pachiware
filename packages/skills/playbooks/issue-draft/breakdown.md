# Breaking a brief into issue drafts

Break the brief into tracer-bullet drafts: vertical slices, each declaring the drafts that block it.

- Each slice cuts a narrow but complete path through every layer it touches (data, API, UI, tests). It is a vertical slice, not one layer.
- A finished slice is demoable or verifiable on its own.
- One slice fits one issue: at most 7 acceptance criteria and 5 open questions. A point that needs more becomes several drafts.
- Points may also merge when two of them are one slice. Say so in the summary.

For each draft give:

- **Title**: imperative, at most 70 characters, no `[Feature]`-style prefix.
- **What it delivers**: one line on the end-to-end behaviour this draft makes work, from the user's point of view, not a list of layers.
- **Blocked by**: the drafts that must land first. A draft with no blockers can start at once. Add an edge only when a draft genuinely waits on the other.

Use the repository's own words when you know them (its glossary, its README), and name concepts rather than file paths: paths go stale.

The author approves the breakdown together with round 1: a "yes" accepts it. When the author asks to merge, split, or re-order drafts, post the next round with the changed breakdown.

## Credit

Parts of this file are adapted from `skills/engineering/to-tickets/SKILL.md` in mattpocock/skills (https://github.com/mattpocock/skills, commit 49dd158d1076134a641b33efb035946536778336), used under the MIT License:

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
