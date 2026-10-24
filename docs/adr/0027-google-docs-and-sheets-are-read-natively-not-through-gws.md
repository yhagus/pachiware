# Google Docs and Sheets are read natively, not through gws

Google's `googleworkspace/cli` (`gws`) ships 100+ `SKILL.md` files, but each one tells the agent to run the `gws` binary in a shell. In Pachiware they would be playbooks (ADR 0004) that need a shell tool, and Pachiware has none: Effect, Write confirmation and Availability rules are keyed by tool name, and one `shell` tool would run `gws sheets +read` and `gws drive files delete` alike. So the Google skill calls Google's REST APIs itself with `fetch`, the way the git and Plane skills do (ADR 0011): a linked Google Doc is read through the Docs API and a Google Sheet through the Sheets API, and kept as a Document.

## Considered options

- **Install `gws` on the host, give the model a shell tool, and import its skills as playbooks.** Rejected: the shell tool's effect cannot be known from its name, and every tenant's Google credentials would have to be kept apart by an environment variable on each spawn.
- **`gws` behind one tool with fixed arguments.** Rejected: it removes the shell, but leaves a pre-1.0 binary ("expect breaking changes", not an officially supported Google product) on every host, and install.sh to keep it there, to wrap a few HTTP requests.
- **Drive's `files.export` (a Doc as Markdown, a Sheet as XLSX).** Rejected as the main path: it stops at 10 MB, which a Doc full of screenshots or a Sheet of many rows passes. The Docs API returns a Doc's whole text and tables without its images, each image fetched on its own; the Sheets API returns a tab's values in blocks of rows. Export stays only for a file anyone with the link may view when the tenant has no Google account: both APIs need a Google Cloud project's credentials, which such a tenant does not have.

## Consequences

- The agent still spawns no process, and install.sh still installs only Bun and git.
- We turn a Doc's structure (headings, lists, tables) into Markdown ourselves instead of relying on Google's Markdown export.
- Writing to a Google Doc or Sheet, if it comes, is new native tools with their own effects, not a `gws` command.
