# Pachiware

A self-hosted AI assistant platform. An operator provisions tenants; each tenant connects chat bots that answer with a chosen model and can act on repositories.

## Language

**Platform admin**:
The operator who runs the installation and provisions tenants and API keys.
_Avoid_: Superuser, root

**Tenant**:
An isolated owner of its bots, profiles, git accounts, skills, conversations, and one Workspace. Nothing is shared across tenants.
_Avoid_: Organization, customer

**API key**:
A credential issued by the platform admin that lets its holder operate the tenants linked to it.
_Avoid_: Token (reserved for credentials of external services)

**Bot**:
A chat identity a tenant connects so the agent can listen and reply on a platform. Today only Discord.
_Avoid_: Agent (the agent is the reasoning loop behind every bot, not the identity)

**Profile**:
A named choice of provider, model, and key that a bot answers with. A BYOK profile (provider `custom`) also names the API format its server speaks: Chat Completions, Responses, or Messages. A bot without one uses the tenant default. It declares which kinds of input its model accepts: text always, images only when the model can see them.
_Avoid_: Model config, preset

**Git account**:
A tenant's credentials for one account on GitHub, GitLab, or a self-hosted GitLab. A bot may have many git accounts, and several bots may share the same one.
_Avoid_: Repo connection, git integration, git credentials

**Git scope**:
The rule that says which of a bot's git accounts, and which repositories of each (wildcard patterns such as `org/*`), are usable in one guild, or in one channel of it. No rule means no git access. A channel rule can only narrow its guild's rule; a thread follows its parent channel.
_Avoid_: Git permissions, repo ACL

**Git write confirmation**:
The Confirm/Cancel buttons shown in Discord before any git change (commit, pull request, comment, issue, merge, close). Only the person who asked can press them. Reading never needs it.
_Avoid_: Approval, git approval

**Brief**:
A short list of points a person writes in chat, each meant to become an issue.
_Avoid_: Notes, todo list

**Issue draft**:
A proposed issue the agent builds from one point of a brief: the point made detailed, with what the author likely missed and the questions still open. It belongs to no git platform until it is created, and creating it is a git change.
_Avoid_: Ticket, issue template

**Clarifying round**:
One batch of numbered questions the agent asks the author of a brief, each with its recommended answer. Only the author's answers decide; anyone else's answers are input.
_Avoid_: Q&A, interview, questionnaire

**Minutes**:
The record of a discussion the bot wrote from a channel's or thread's messages: what was decided, what is still open, and who does what next. Its action items can become issue drafts. Minutes someone wrote elsewhere and pasted in are a document, not minutes.
_Avoid_: Notulen (in English text), summary, recap

**Allowed git hosts**:
The platform-wide list of self-hosted git servers that git accounts may point at. Empty means unrestricted.
_Avoid_: Whitelist

**Skill**:
A bundle of tools the agent may call. Enabled or disabled per tenant. The git skill turns on by itself when a git account is first attached to a bot.
_Avoid_: Plugin, extension

**Availability rule**:
A rule that turns a playbook, a skill, a tool, or every tool with one effect off for the tenant, a bot, a guild of that bot, or a channel. Without a rule a level inherits what the level above allows; a rule can only narrow, never turn back on what is off above. A bot or a guild may instead make something wait for the level below to opt in. Some playbooks start off for the tenant until the tenant turns them on.
_Avoid_: Permission (reserved for Discord permissions), toggle, scope (reserved for git scope)

**Effect**:
What calling a tool can do: read (changes nothing), write (changes something that can be changed back), or danger (cannot be undone, or changes access, security, or settings). A tool that does several things carries the riskiest of them. Fixed by the skill; an admin cannot change it.
_Avoid_: Risk level, destructive (too narrow: a webhook change deletes nothing)

**Playbook**:
Written guidance the agent follows for one kind of work, such as turning a brief into issue drafts or writing minutes. It says how to think and in what steps; the tools it uses come from skills. A person starts one by name from chat, unless it is only a reference other playbooks load; the agent never picks one on its own, but a playbook may load another playbook that is also available.
_Avoid_: Skill (a skill is tools, even though other agent tools call this a skill), prompt, template

**Playbook thread**:
The thread a started playbook opened, bound to that playbook, the bot that started it, and the person who started it. It follows its parent channel's availability.
_Avoid_: Session, conversation

**Workspace**:
A tenant's tree of folders and Markdown files where the agent keeps its tasks, notes, and memory. It is the agent's own store, separate from the platform's configuration. Folders follow the tenant's guilds and channels, and the agent may add subfolders below them.
_Avoid_: Vault, file store, database

**Guild**:
A Discord community a bot has joined. Discord's own name for what its interface calls a server.
_Avoid_: Server, channel group

**Project**:
The work a channel exists for. A channel's tasks are its project's tasks, and a thread's tasks belong to its parent channel's project. There is no project apart from a channel.
_Avoid_: Board, workstream, category (a Discord category only groups channels)

**Task**:
A piece of work a person asked the bot to track, in a channel or privately: a title, at most one assignee, a status, and optionally a due date, a checklist, and progress notes. A cancelled task stays on record as cancelled; it is never active again and is not late.
_Avoid_: Ticket, issue (reserved for git platforms), todo

**Personal task**:
A task a person keeps for themselves from a DM with the bot, in no project. Only that person sees it, and its assignee is that person or someone known only by name. It can be moved into a project; a project's task never becomes personal.
_Avoid_: Private task, DM task

**Assignee**:
The one person responsible for a task: a guild member, or a person known only by the name the team gave, such as someone outside the guild. Only a member can be reached by the bot. Two people sharing work means two tasks.
_Avoid_: Owner (reserved for the person who set a Reminder), PIC, responsible

**Progress note**:
A dated line on a task saying who reported what about it. Notes accumulate; they never replace the task's description.
_Avoid_: Comment, update, Note (a Note is a file of its own)

**Due date**:
The day, and optionally the time, by which a task should be done. A task without one is not late. Set and changed by anyone in the task's channel, like the rest of the task.
_Avoid_: Deadline (reserved for people's wording in minutes), ETA

**Reminder**:
A message the bot sends to a channel or a DM at a time a person chose, once or on a repeating schedule. It is created from chat and belongs to the person who asked. A task's due date never creates one.
_Avoid_: Alarm, notification, scheduled message

**Digest**:
The bot's daily post in a channel an admin opted in, at that channel's chosen hour: the tasks due that day, the tasks already late, and nothing else. A day with nothing to report gets no post.
_Avoid_: Report, standup, summary

**Decision**:
One thing the team settled, written down with its context and the reason, only when a person asks for it to be recorded. Memory keeps a one-line pointer to it; the decision itself is the record. The "Decided" part of minutes is not a decision until someone asks to record it.
_Avoid_: Resolution, agreement, ADR (reserved for this repository's own records)

**Note**:
Text a person asked the bot to keep that is neither a task, a decision, nor minutes. It says what the person said, not what the bot concluded.
_Avoid_: Memo, doc, memory

**Document**:
A file or a long text a person gave the bot in a conversation, kept as it was in the Workspace folder of that place so the bot can read it when it needs to. Nobody asked to keep it; asking turns its content into a note.
_Avoid_: Attachment (Discord's word for any file on a message), upload, Note

**Memory**:
What the bot keeps about a place to answer better later: the team's decisions, how people like to be addressed and to work, and the conventions of the place. One memory per tenant, per guild, and per channel; a channel's memory is not read in another channel. Conversation itself and private details are never memory.
_Avoid_: Notes (notes are files a person asked for), context, history

## Relationships

- A **Tenant** owns many **Bots**, **Profiles**, and **Git accounts**, and exactly one **Workspace**.
- A **Bot** has zero or one **Profile** and many **Git accounts**; all must belong to the bot's **Tenant**.
- A **Brief** becomes one or more **Issue drafts** through **Clarifying rounds** held in one thread; only its author decides.
- A **Git scope** narrows a **Bot**'s **Git accounts** per **Guild** and per channel; it can never add an account the bot does not have.
- A **Playbook** requires some **Skills** and may load other **Playbooks**; it cannot start while a required skill or a loaded playbook is off.
- A **Playbook thread** belongs to one **Playbook** and one **Bot**; only that bot answers in it.
- An **Availability rule** narrows **Playbooks** and **Skills** for the tenant and per **Bot**, **Guild**, and channel; for git tools a **Git scope** must allow the repository too.
- A **Task** belongs to one **Project**, which is one channel, unless it is a **Personal task**; it has zero or one **Assignee** and any number of **Progress notes**.
- A **Reminder** belongs to the person who asked for it and to the channel or DM it will post in; it is not part of any task.
- A **Digest** is per channel and reads that channel's tasks and their **Due dates**; it never reads another channel.
- **Memory** lives in the **Workspace** at the tenant, guild, and channel level; the channel level is read only in that channel.
- A **Document** is kept in the Workspace folder of the channel or DM it was given in; a **Note** may be made from it, never the other way round.
- A **Decision** and a **Note** are files in the channel's **Workspace** folder; **Memory** points at a Decision, never repeats it.
