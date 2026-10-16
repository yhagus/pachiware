# Plane is native tooling, not its MCP server

Plane ships an official MCP server (`makeplane/plane-mcp-server`), but the Plane skill calls Plane's REST API itself, one tool per operation, the way the git skill calls GitHub and GitLab. The MCP server's tools bundle several operations behind an `action` argument, so one tool name can both list and delete work items. Effect, Write confirmation and Availability rules are all keyed by tool name, so they cannot tell those calls apart. A Plane scope also has to limit each channel to some Plane projects, while the server's API key reaches every Plane workspace its user belongs to.

## Considered options

- **A generic MCP client, with Plane as its first server.** Rejected for Plane: every call would need its `action` argument inspected to choose the effect, and its `project_id` inspected to enforce the Plane scope. That layer is most of a native skill, without its tool descriptions. A generic MCP client may still come later for services not worth building natively.
- **The hosted endpoint at `mcp.plane.so`.** Rejected: it serves Plane's cloud only, not a self-hosted Plane.

## Consequences

- A self-hosted Plane needs no Python process next to the agent: the stdio server runs through `uvx`, the HTTP one is another service to run.
- The model sees only the tools a channel may use, instead of all 30 tools and the 207 operations in their descriptions on every turn.
- Plane API changes are ours to follow. The skill targets the `/api/v1/` API of Plane v1.3.1.
