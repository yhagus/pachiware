# Pachiware

A self-hosted AI assistant platform. An operator provisions tenants; each tenant connects chat bots that answer with a chosen model and can act on repositories.

## Language

**Platform admin**:
The operator who runs the installation and provisions tenants and API keys.
_Avoid_: Superuser, root

**Database engine**:
The kind of database an installation keeps its records in: SQLite, PostgreSQL, or MongoDB. The platform admin chooses it while setting up the installation; once records exist it never changes, though the address of the same engine may.
_Avoid_: Driver (the code that talks to it), dialect, backend

**Tenant**:
An isolated owner of its bots, profiles, git accounts, Plane accounts, skills, conversations, and one Workspace. Nothing is shared across tenants.
_Avoid_: Organization, customer

**API key**:
A credential issued by the platform admin that lets its holder operate the tenants linked to it.
_Avoid_: Token (reserved for credentials of external services)

**Bot**:
A chat identity a tenant connects so the agent can listen and reply on a platform. Today only Discord.
_Avoid_: Agent (the agent is the reasoning loop behind every bot, not the identity)

**Profile**:
A named choice of provider, models, and key that a bot answers with. The provider is OpenAI, Anthropic, DeepSeek, or BYOK: a server of the tenant's choosing, which alone names its address and the API format it speaks (Chat Completions, Responses, or Messages). It lists at most three models of that provider in order: the first answers, and each later one, a fallback model, answers when the one before fails. A bot without one uses the tenant default. It declares whether its models see images (Vision); text they always take.
_Avoid_: Model config, preset, fallback Profile

**Git account**:
A tenant's credentials for one account on GitHub, GitLab, or a self-hosted GitLab. A bot may have many git accounts, and several bots may share the same one.
_Avoid_: Repo connection, git integration, git credentials

**Git scope**:
The rule that says which of a bot's git accounts, and which repositories of each (wildcard patterns such as `org/*`), are usable in one guild, or in one channel of it. No rule means no git access. A channel rule can only narrow its guild's rule; a thread follows its parent channel.
_Avoid_: Git permissions, repo ACL

**Write confirmation**:
The Confirm/Cancel buttons shown in Discord before any change on a git platform or in Plane (commit, pull request, comment, issue, merge, close, work item), and before a playbook is saved or deleted from chat. Only the person who asked can press them. Reading never needs it.
_Avoid_: Approval, git approval, Git write confirmation (its older, git-only name)

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
The record of a discussion the bot wrote from a channel's or thread's messages: what was decided, what is still open, and who does what next. Its action items can become issue drafts or Tasks. What the previous Minutes of the place left open and this discussion did not settle is shown again, dated. Minutes someone wrote elsewhere and pasted in are a document, not minutes.
_Avoid_: Notulen (in English text), summary, recap

**Trusted member**:
A Discord user the platform admin listed as allowed to ask for danger actions on a git platform or in Plane. Anyone else is refused before any Write confirmation appears.
_Avoid_: Owner (reserved for the person who set a Reminder), bot owner, superuser

**Allowed hosts**:
The platform-wide list of self-hosted servers that git accounts and Plane accounts may point at. Empty means unrestricted.
_Avoid_: Whitelist, Allowed git hosts (its older, git-only name)

**Plane account**:
A tenant's API key for one Plane server, Plane's cloud or a self-hosted Plane. It acts as one Plane user in every Plane workspace that user belongs to. Plane cannot list those workspaces, so the account lists the ones an admin typed in, each switched on or off; integrations can use only those switched on. A bot may have many Plane accounts, and several bots may share the same one. Everything done through it is done as that one Plane user.
_Avoid_: Plane integration, Plane connection, Plane token

**Plane version**:
The Plane releases a Plane account's server runs, chosen from the ones Pachiware has tool code for. Each Plane version names the releases it covers; Plane 1.3.1 and Plane 1.4.2 each cover that release alone. It decides how the bot signs in to that Plane and which Plane tools the account offers. An admin changes it after upgrading Plane; a new release that changes Plane's API gets a new Plane version, and the older one keeps working.
_Avoid_: API version (Plane's API path is `/api/v1/` on every release), Plane release (what a server reports, such as v1.3.1; a Plane version covers one or more of them)

**Plane workspace**:
An organization in Plane, named by the slug in its address and holding its Plane projects and members. A Plane account lists the ones the bot may reach. To the bot, each switched-on Plane workspace is one entry, named by its account alone, or `account/workspace` when that account has several usable in the place. Always named with "Plane" in front.
_Avoid_: Workspace (reserved for the tenant's own tree of files), organization

**Plane project**:
A container of work items inside a Plane workspace. It is not a channel and has no tasks. Always named with "Plane" in front.
_Avoid_: Project (reserved for the work a channel exists for), board

**Work item**:
A unit of work tracked in a Plane project, with its own state, any number of assignees, and comments. It lives only in Plane; it is never a task and never an issue.
_Avoid_: Issue (reserved for git platforms), ticket, Task, Plane task

**Plane scope**:
The rule that says which Plane workspaces of a bot's Plane accounts, and which Plane projects of each (or all of them), are usable in one guild, or in one channel of it. No rule means no Plane access. A channel rule can only narrow its guild's rule for the same Plane workspace; a thread follows its parent channel. Switching a Plane workspace off keeps its rules, and a channel whose rules are all for switched-off workspaces gets no Plane rather than its guild's.
_Avoid_: Plane permissions, project ACL

**Skill**:
A bundle of tools the agent may call. Enabled or disabled per tenant. The git skill turns on by itself when a git account is first attached to a bot, and the Plane skill when a Plane account is.
_Avoid_: Plugin, extension

**Availability rule**:
A rule that turns a playbook, a skill, a tool, or every tool with one effect off for the tenant, a bot, a guild of that bot, or a channel. Without a rule a level inherits what the level above allows; a rule can only narrow, never turn back on what is off above. A bot or a guild may instead make something wait for the level below to opt in. Some playbooks, and the administration tools of git and Plane (settings, members, secrets, runners, webhooks, transfer, delete), start off for the tenant until the tenant turns them on.
_Avoid_: Permission (reserved for Discord permissions), toggle, scope (reserved for git scope)

**Effect**:
What calling a tool can do: read (changes nothing), write (changes something that can be changed back), or danger (cannot be undone, or changes access, security, or settings). A tool that does several things carries the riskiest of them. Fixed by the skill; an admin cannot change it.
_Avoid_: Risk level, destructive (too narrow: a webhook change deletes nothing)

**Playbook**:
Written guidance the agent follows for one kind of work, such as turning a brief into issue drafts or writing minutes. It says how to think and in what steps; the tools it uses come from skills. A person starts one by name from chat, unless it is only a reference other playbooks load or one the schedule starts, such as the Daily log's; the agent never picks one on its own, but a playbook may load another playbook that is also available. It is built in, the tenant's own, or a server's own: one a person made in chat for that guild alone, which never replaces a built-in or tenant playbook of the same name.
_Avoid_: Skill (a skill is tools, even though other agent tools and people in chat call this a skill), prompt, template

**Playbook thread**:
The thread a started playbook opened, bound to that playbook, the bot that started it, and the person who started it. It follows its parent channel's availability, and stops following its playbook when that playbook is deleted or replaced.
_Avoid_: Session, conversation

**Workspace**:
A tenant's tree of folders and Markdown files where the agent keeps its tasks, notes, and memory. It is the agent's own store, separate from the platform's configuration. Folders follow the tenant's guilds and channels, and the agent may add subfolders below them.
_Avoid_: Vault, file store, database

**Guild**:
A Discord community a bot has joined. Discord's own name for what its interface calls a server.
_Avoid_: Server, channel group

**Public channel**:
A channel every member of its guild can view. What the bot kept there may be quoted in any channel of that guild; what it kept in any other channel is quoted only in that channel or in a DM to someone who can view it.
_Avoid_: Open channel

**Project**:
The work a channel exists for. A channel's tasks are its project's tasks, and a thread's tasks belong to its parent channel's project. There is no project apart from a channel.
_Avoid_: Board, workstream, category (a Discord category only groups channels)

**Task**:
A piece of work a person asked the bot to track, in a channel or privately: a title, at most one assignee, a status, and optionally a due date, a checklist, and progress notes. A cancelled task stays on record as cancelled; it is never active again and is not late. Every change made through the bot to its status, Assignee, due date, title or priority is a dated line of its History, saying who asked; completing it records when. A task made from a Minutes action item remembers that item.
_Avoid_: Ticket, issue (reserved for git platforms), work item (reserved for Plane), todo

**Personal task**:
A task a person keeps for themselves from a DM with the bot, in no project. Only that person sees it, and its assignee is that person or someone known only by name. It can be moved into a project; a project's task never becomes personal.
_Avoid_: Private task, DM task

**Assignee**:
The one person responsible for a task: a guild member, or a person known only by the name the team gave, such as someone outside the guild. Only a member can be reached by the bot: a member someone else gives a task to is pinged once with it. Two people sharing work means two tasks.
_Avoid_: Owner (reserved for the person who set a Reminder), PIC, responsible

**Progress note**:
A dated line on a task saying who reported what about it. Notes accumulate; they never replace the task's description.
_Avoid_: Comment, update, Note (a Note is a file of its own)

**Due date**:
The day, and optionally the time, by which a task should be done. A task without one is not late. Set and changed, like the rest of the task, by anyone who can view the task's channel, from any channel whose tasks they can view.
_Avoid_: Deadline (reserved for people's wording in minutes), ETA

**Reminder**:
A message the bot sends to a channel or a DM at a time a person chose, once or on a repeating schedule. It is created from chat and belongs to the person who asked, who alone can move (snooze) or reword it. A task's due date never creates one. Its time is read from the person's own words; what they leave open (morning or evening, once or repeating) is asked about, never guessed.
_Avoid_: Alarm, notification, scheduled message

**Routine**:
An instruction the bot carries out at a time a person chose, once or on a repeating schedule ("simpulkan tugasku setiap jam 9 pagi"), posting what it found where it was asked. It runs as the person who set it, with what they may see at that time, and it only reads: it looks things up and reports, and changes nothing. Like a Reminder, it is created from chat, belongs to that person, and its time is read from their own words.
_Avoid_: Scheduled prompt, cron job, automation

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
A file or a long text a person gave the bot in a conversation, or a file an admin chose to mirror from a repository, kept as it was in the Workspace folder of that place so the bot can read it when it needs to. A mirrored file follows its repository: it changes and goes when the file does upstream. Where the Profile sees images, an image given to the bot is kept too, with what the model saw in it written beside it, and a scanned PDF's pages are read the same way. Nobody asked to keep a given one; asking turns its content into a note.
_Avoid_: Attachment (Discord's word for any file on a message), upload, Note

**API changelog**:
An OpenAPI document the bot wrote from a repository's source code, recording every endpoint whose frontend-facing contract changed between two of its commits, or every endpoint when it covers the whole history. What it covers, the whole history or a range of days, is always the asker's answer, never the bot's choice.
_Avoid_: Contract diff (the playbook that writes one), API docs, Swagger, release notes

**Changelog draft**:
An API changelog still being made: one repository, branch and coverage, started by one person. It stays open until the changelog is written (or published, when the asker asked for that too), the asker stops it, or every changed file was examined and none changed what the frontend sees. One nobody touches for a week is dropped.
_Avoid_: Changelog run, unfinished changelog, job

**OpenAPI Schema Viewer**:
A public page showing one OpenAPI document as it was when the bot published it, which anyone with its link can open without signing in, until it is revoked in the console. Publishing again makes another; a later change to the file never reaches it.
_Avoid_: API preview, public link, share, docs page

**Team roster**:
A guild's list of the people its team keeps: each one's role, what they are responsible for, and their time zone. Anyone in the guild sets a line from chat, and each line says who set it and when. It answers "who owns X?" and is searched by recall beside the Tasks; it is neither Memory nor kept material, and its time zones do not change when Reminders post.
_Avoid_: Directory, org chart, members list (Discord's own)

**Conversation**:
What the bot reads back of its talk in one channel, thread or DM: the recent messages and a summary of the older ones, shared by everyone there. It ends when nobody has talked with the bot there for the tenant's quiet hours (24 by default) or when an admin ends it in the console; the next message then starts a fresh one. A Playbook thread keeps its conversation however long it waits. Memory, Tasks and kept material are not part of it, so a fresh conversation still has them.
_Avoid_: Session, chat history, context

**Memory**:
What the bot keeps about a place to answer better later: the team's decisions, how people like to be addressed and to work, and the conventions of the place. One memory per tenant, per guild, and per channel; a channel's memory is not read in another channel. Conversation itself and private details are never memory.
_Avoid_: Notes (notes are files a person asked for), context, history

**Agent log**:
A line the agent process writes about itself: its time, level (debug, info, warn, error), source (the leading tag, such as `http` or `llm`, else `agent`) and text. Text shaped like a key or token is masked first. The newest lines are kept in memory for the live tail and every line in one file per UTC day, for 7 days by default. The console's **Console** page shows them to the platform admin; in prose "the console" still means the whole web app. An Agent log is never a Daily log and never reaches a bot's answers.
_Avoid_: Daily log (the bot's record of a channel's talk), audit (the record of tool calls and refusals), Minutes

**Daily log**:
The record the bot writes on its own, each night, of one channel's talk on the day before, with links to the messages it rests on. Nobody asks for it, it is never posted, and nobody owns it; an admin turns it on per channel.
_Avoid_: Summary, recap, journal, automatic minutes

**Kept material**:
The Minutes, Daily logs, Decisions, Notes, Documents and API changelogs the bot kept for a place, which people can ask about later. Memory and Tasks are not kept material.
_Avoid_: Records, archive, files (a place's files also hold its tasks and memory)

**Source**:
A place whose kept material an asker may read from where they ask: the place itself, or another channel or private thread they can view. A source is quotable or not; what a source that is not quotable here holds is only counted, never named or shown.
_Avoid_: Scope (reserved for git scope), origin, channel (a source can be a thread or a DM)

## Relationships

- A **Tenant** owns many **Bots**, **Profiles**, **Git accounts**, and **Plane accounts**, and exactly one **Workspace**.
- A **Bot** has zero or one **Profile**, many **Git accounts**, and many **Plane accounts**; all must belong to the bot's **Tenant**.
- A **Brief** becomes one or more **Issue drafts** through **Clarifying rounds** held in one thread; only its author decides.
- A **Git scope** narrows a **Bot**'s **Git accounts** per **Guild** and per channel; it can never add an account the bot does not have.
- A **Plane account** lists one or more **Plane workspaces**, each switched on or off, and is set to exactly one **Plane version**. A Plane tool is offered in a place only when a usable **Plane account**'s **Plane version** has it. A **Plane scope** narrows a **Bot**'s **Plane accounts**, their switched-on **Plane workspaces** and their **Plane projects**, per **Guild** and per channel; it can never add an account the bot does not have.
- A **Work item** belongs to one **Plane project**. **Work items** and **Tasks** are never synced or converted into each other; the **Digest** and **Reminders** read only **Tasks**.
- A **Playbook** requires some **Skills** and may load other **Playbooks**; it cannot start while a required skill or a loaded playbook is off.
- A **Playbook thread** belongs to one **Playbook** and one **Bot**; only that bot answers in it.
- A **Playbook thread** offers only the tools its **Playbook** names, when the Playbook names any.
- A server's own **Playbook** belongs to one **Guild** and is offered by every **Bot** of the tenant there; an **Availability rule** names it only at that guild or its channels.
- An **Availability rule** narrows **Playbooks** and **Skills** for the tenant and per **Bot**, **Guild**, and channel; for git tools a **Git scope** must allow the repository too, and for Plane tools a **Plane scope** must allow the Plane project.
- A **Task** belongs to one **Project**, which is one channel, unless it is a **Personal task**; it has zero or one **Assignee** and any number of **Progress notes**.
- A **Task** made from **Minutes** belongs to the Project of the channel the Minutes were written in and points at the action item it came from; one action item makes at most one Task.
- A **Reminder** belongs to the person who asked for it and to the channel or DM it will post in; it is not part of any task.
- A **Digest** is per channel and reads that channel's tasks and their **Due dates**; it never reads another channel.
- **Memory** lives in the **Workspace** at the tenant, guild, and channel level; the channel level is read only in that channel.
- A **Team roster** belongs to one **Guild** and is read from any of its channels; a person on it may be a member or someone known only by name, as an **Assignee** may.
- A **Document** is kept in the Workspace folder of the channel or DM it was given in; a **Note** may be made from it, never the other way round.
- A mirrored **Document** is kept under `files/docs/` of the channel an admin chose, and refreshed only while that channel's **Git scope** allows its repository.
- A **Decision** and a **Note** are files in the channel's **Workspace** folder; **Memory** points at a Decision, never repeats it.
- An **API changelog** is written in a **Playbook thread** bound to one repository the **Git scope** allows, and kept in the **Workspace** folder of the thread's channel (or the DM's).
- A place has at most one open **Changelog draft**. One that covers a range of days becomes an **API changelog** only when every file that changed between its two commits was examined or set aside with a reason; one that covers the whole history has no earlier commit to compare with.
- An **OpenAPI Schema Viewer** page belongs to the **Bot** that published it and to the channel or DM it was asked in. It holds a copy of the document, never a link to the file, and it is made only from a file the asker may read there, under the rules of quoting a **Source**.
- A **Daily log** is written by one **Bot** of the tenant, following a **Playbook** that only the schedule starts; it covers one channel and one day, with the channel's public threads; a private thread and a DM never get one. The messages stay in Discord: the Daily log links to them and keeps no copy, and what rests only on a deleted message leaves it.
- **Minutes**, **Daily logs**, **Decisions**, **Notes** and **Documents** of a channel can be read from another channel of the same guild, or from a DM, by someone who can view that channel, unless an **Availability rule** turns the Workspace off there; only a **Public channel**'s may be quoted in a channel other than their own. **Memory** is never read this way.
- When someone asks whether work was done, the **Tasks** of the channels they can view are read under the same rules as **Sources**: only a **Public channel**'s may be quoted in a channel other than their own.
- A **Task** is changed by its id from any channel whose tasks the asker can view, under the same rules: one that may not be shown here is changed only from its own channel or a DM. It stays in its own **Project**, and its **Assignee** is told there.
- What the bot kept from a private thread belongs to that thread: only people added to it can have it read, in its parent channel too. Inside another private thread of the same channel it is a **Source** that is not quotable.
