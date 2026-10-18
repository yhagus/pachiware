# Availability is inherited, git scope is not

Playbooks, skills, and tools reach a bot, a guild, and a channel by inheritance: with no availability rule a level gets what the level above allows, and rules only turn things off. Git scope does the opposite (ADR 0002): a guild with no rule has no git. We accept the asymmetry because starting every new guild and channel with nothing would leave the bot mute until an admin turned each thing on, while the risky reach (which repositories) stays default-none behind git scope.

## Considered options

- **Default none, as git scope.** Rejected: every new guild or channel starts with no tools and no playbooks.
- **Lower levels may turn things back on.** Rejected: a channel could reach what its guild ruled out.

## Consequences

- A new guild or channel inherits everything, including write tools. To keep something to a few places, a bot or guild rule can make it wait for the level below to opt in.
- A git tool needs both: an availability that allows the tool, and a git scope that allows the repository.
- Imported playbooks are the exception: they start off for the tenant and are turned on there once; below the tenant they inherit as usual.
- Administration tools of git and Plane (`defaultOff` in their tool policy: repository and organization admin, secrets, runners, Plane project and workspace admin) start off the same way (#251). An administrative assistant rarely needs them, and their schemas went out on every model call: about 7k of 32.6k tokens of tool schemas with every skill on. The Effect model is unchanged; this is only a default.
