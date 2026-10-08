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
A named choice of provider, model, and key that a bot answers with. A bot without one uses the tenant default.
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

**Allowed git hosts**:
The platform-wide list of self-hosted git servers that git accounts may point at. Empty means unrestricted.
_Avoid_: Whitelist

**Skill**:
A bundle of tools the agent may call. Enabled or disabled per tenant. The git skill turns on by itself when a git account is first attached to a bot.
_Avoid_: Plugin, extension

**Workspace**:
A tenant's tree of folders and Markdown files where the agent keeps its tasks, notes, and memory. It is the agent's own store, separate from the platform's configuration. Folders follow the tenant's guilds and channels, and the agent may add subfolders below them.
_Avoid_: Vault, file store, database

**Guild**:
A Discord community a bot has joined. Discord's own name for what its interface calls a server.
_Avoid_: Server, channel group

## Relationships

- A **Tenant** owns many **Bots**, **Profiles**, and **Git accounts**, and exactly one **Workspace**.
- A **Bot** has zero or one **Profile** and many **Git accounts**; all must belong to the bot's **Tenant**.
- A **Git scope** narrows a **Bot**'s **Git accounts** per **Guild** and per channel; it can never add an account the bot does not have.
