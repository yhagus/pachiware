---
description: Turns a decision you cannot fully answer into a questionnaire for someone else to fill in.
default: off
requires: ["workspace"]
license: MIT, adapted from mattpocock/skills; the notice is in LICENSE.md
---
Turn something the person cannot answer alone into a **questionnaire**: a Markdown document they hand to one person to fill in on their own time, or fill in together in a meeting. The recipient holds knowledge the person lacks; the questionnaire pulls it out of them.

**Grill the send, not the subject.** Ask the person only about the _send_, which they can always answer: who it goes to, and what they need back. The questions in the document then aim at the **gap** between what the recipient knows and what the person needs.

Only the person who started this thread decides. Messages from anyone else reach you marked as input.

1. **Who is it going to?** In one message, ask the recipient's role, expertise, and relationship to the person. This sets the questionnaire's tone and how much context it must carry. Done when you know who the recipient is and what they know that the person does not.
2. **What do you need back?** In one message, ask which decisions or facts the person cannot settle alone and needs from this recipient. Done when you have a concrete list of what the person must be able to do or decide afterwards.
3. **Write the questionnaire.** Write questions aimed at the gap from steps 1 and 2, in the document structure below. Save it with `writeFile` at `channel/questionnaires/<slug>.md` (the slug from the topic, lowercase words joined by hyphens); for a file that already exists, read it first with `readFile` and pass its version. Then reply with the path, the title, and the question headings, under 1,800 characters: Discord cuts longer replies, so never paste the whole document. Done when the file is saved and every item from step 2 has a question.

When the person asks for changes, edit the saved file the same way and reply with what changed.

## Document structure

Frame the document as a **discovery questionnaire**: the person lacks context, the recipient holds it. Order the questions most important first, since the recipient may answer only once, and group them under `##` headings by theme once there are more than a handful.

```
# <Questionnaire title>

**Purpose:** why this questionnaire exists and the decision that rides on it.

**From:** <the person>, **To:** <the recipient>, **How your answers will be used:** <where they go>

## Context

One paragraph for a recipient who was not part of the discussion. Enough to answer well, not a page.

## How to answer

Deadline and rough effort. Partial answers and "I don't know" are useful: flag anything you are unsure of rather than skip it.

## <Theme heading>

### What load is the system expected to handle at launch?

_Why this matters: it decides whether we provision for burst traffic now or later._

>

## Anything else?

Anything we did not ask that we should know?
```

Every question is one idea, never two joined with "and", with an empty answer line (`>`) right below it. Add a one-line _why this matters_ only where the question could be misread or invite a throwaway answer.
