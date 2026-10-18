# Citations are rendered by the server, not written by the model

When the bot answers from Kept material, Tasks, git or Plane, the model names each source by a short ref the tool gave it (`[K1]`, `[T2]`, `[G3]`, `[P4]`). The loop then replaces each ref with the source's channel, date and link, which the tool built from the source itself. A ref no tool gave is dropped, and so is any link in the reply that appears neither in a tool result of the turn nor in the conversation the model was sent. The model never writes a source's link or date itself, so it cannot cite something that does not exist. This holds for every model a tenant brings.

## Considered options

- **Persona rules alone ("name the channel and date of every source").** Rejected: these are the rules today, and nothing stops a model from building a link from the wrong fields or making one up.
- **Only check links after the fact.** Rejected as the only measure: it catches made-up links but leaves the channel names and dates to the model. It stays in place as a safety net for links outside refs.

## Consequences

- Any tool may return `citations` (ref to label and link). The loop collects them over the turn and renders refs in the final reply, including the reply it forces when the action budget runs out.
- The rendered reply is the one stored in history, so a later turn sees real links, not refs.
- Dropping a link follows the guardrail mode: in `observe` the link stays and the drop is only audited.
- A link a person pasted, or one an earlier reply already showed, is still allowed, because it appears in the conversation the model was sent.
