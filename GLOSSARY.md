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
A named choice of provider, model, and key that a bot answers with. A bot without one uses the tenant default. It declares which kinds of input its model accepts: text always, images only when the model can see them.
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
The record of a discussion: what was decided, what is still open, and who does what next. Its action items can become issue drafts.
_Avoid_: Notulen (in English text), summary, recap

**Allowed git hosts**:
The platform-wide list of self-hosted git servers that git accounts may point at. Empty means unrestricted.
_Avoid_: Whitelist

**Skill**:
A bundle of tools the agent may call. Enabled or disabled per tenant. The git skill turns on by itself when a git account is first attached to a bot.
_Avoid_: Plugin, extension

**Availability rule**:
A rule that turns a playbook, a skill, a tool, or every tool with one effect off for the tenant, a bot, a guild of that bot, or a channel. Without a rule a level inherits what the level above allows; a rule can only narrow, never turn back on what is off above. A bot or a guild may instead make something wait for the level below to opt in.
_Avoid_: Permission (reserved for Discord permissions), toggle, scope (reserved for git scope)

**Effect**:
What calling a tool can do: read (changes nothing), write (changes something that can be changed back), or danger (cannot be undone, or changes access, security, or settings). A tool that does several things carries the riskiest of them. Fixed by the skill; an admin cannot change it.
_Avoid_: Risk level, destructive (too narrow: a webhook change deletes nothing)

**Playbook**:
Written guidance the agent follows for one kind of work, such as turning a brief into issue drafts or writing minutes. It says how to think and in what steps; the tools it uses come from skills. A person starts one by name from chat; the agent never picks one on its own, but a playbook may load another playbook that is also available.
_Avoid_: Skill (a skill is tools, even though other agent tools call this a skill), prompt, template

**Workspace**:
A tenant's tree of folders and Markdown files where the agent keeps its tasks, notes, and memory. It is the agent's own store, separate from the platform's configuration. Folders follow the tenant's guilds and channels, and the agent may add subfolders below them.
_Avoid_: Vault, file store, database

**Guild**:
A Discord community a bot has joined. Discord's own name for what its interface calls a server.
_Avoid_: Server, channel group

## Relationships

- A **Tenant** owns many **Bots**, **Profiles**, and **Git accounts**, and exactly one **Workspace**.
- A **Bot** has zero or one **Profile** and many **Git accounts**; all must belong to the bot's **Tenant**.
- A **Brief** becomes one or more **Issue drafts** through **Clarifying rounds** held in one thread; only its author decides.
- A **Git scope** narrows a **Bot**'s **Git accounts** per **Guild** and per channel; it can never add an account the bot does not have.
- A **Playbook** requires some **Skills** and may load other **Playbooks**; it cannot start while a required skill is off.
- An **Availability rule** narrows **Playbooks** and **Skills** for the tenant and per **Bot**, **Guild**, and channel; for git tools a **Git scope** must allow the repository too.
