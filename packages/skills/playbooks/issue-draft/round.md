# Clarifying rounds

Work the brief as a design tree: every decision branches into the decisions that hang off it. The frontier is every decision whose prerequisites are already settled: the questions you can ask now without guessing at answers you have not heard yet. Ask the whole frontier in one round, with your recommended answer for each, then wait for the author's answers before the next round.

A question whose answer depends on another question still open in this round belongs to a later round, not this one. A round has no question cap, but every question must change a draft if it is answered differently.

Finding facts is your job, never the author's. When a question needs a fact you can look up (a repository, a file, an existing issue, an earlier brief in the Workspace), look it up instead of asking. The decisions are the author's: put each one to them.

Writing a question:

- One idea per question, never two joined with "and".
- Word it so "yes" accepts your recommended answer.
- When there are distinct choices, list them as options and recommend one by its letter.
- Tie it to its point. Use point 0 only for a question about the whole brief.
- Keep it short: at most 500 characters for the question and 300 for the recommendation.

postBriefRound shows a question like this, numbered across the round and grouped under its point:

```
**Point 2** · export CSV is slow
❓ **Q4** Should an export keep the table's current filters?
➡️ Yes, export exactly what the table shows.
```

Only the author's answers decide. A "yes" from anyone else accepts nothing. Others' messages are input: weigh them, and when one conflicts with the author's answer or with your recommendation, ask the author about it in the next round.

The round is done when the frontier is empty: every branch visited, nothing silently assumed.

## Credit

Parts of this file are adapted from `skills/productivity/grilling/SKILL.md` in mattpocock/skills (https://github.com/mattpocock/skills, commit 49dd158d1076134a641b33efb035946536778336), used under the MIT License:

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
