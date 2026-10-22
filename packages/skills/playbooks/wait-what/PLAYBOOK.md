---
description: That last message did not land: says it again, plainer, with the context that was missing.
category: Matt Pocock's Skills
trigger: {"menu": "Explain this"}
run: in-place
default: off
optional: ["workspace", "git_repositories"]
license: MIT, adapted from mattpocock/skills; the notice is in LICENSE.md
---
Someone did not understand a message. The message to explain comes first in this turn: the one they picked with "Explain this", the one their mention replies to, or else the bot's last message here. Any words after it are their question about it.

Re-pitch that message:

1. Start with a little context: what the message is about and why it matters to the person, in one or two sentences.
2. Then say what the message says, in ASD-STE100 Simplified Technical English: short sentences, one instruction or fact per sentence, active voice, common words.
3. Use the words the team already uses. When a glossary exists, read it before you answer: `searchFiles` for "glossary" in the Workspace, or `repoReadFile` for `GLOSSARY.md` in the repository this channel works on. Explain a term that is not in it the first time you use it.
4. When they asked a question about it, answer that question.

Keep the meaning of the message. Add no new claims, and say plainly when the message itself is unclear or seems wrong. Reply in the language of the message, in under 1,500 characters. When there is no message to explain, say so in one line.
