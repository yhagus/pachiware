import type { SkillModule, ToolPolicy } from "../types.js";
import { acct, repoP, useRepo } from "./gitShared.js";
import { finishChangelog, noteRead, putComponents, putNotes, putOperation, startChangelog, stopChangelog } from "../openapi/changelog.js";
import { listPreviews, publishPreview } from "../openapi/previews.js";
import { readablePath } from "./workspace.js";

/** The playbook the changelog tools serve: they are offered exactly where it is available. */
export const CONTRACT_DIFF_PLAYBOOK = "contract-diff";

const draftP = { type: "string", description: "The draft path startChangelog returned" };
// They write only the bot's own changelog files, and a long playbook calls them many times: no Confirm, outside the per-person rate.
// A second start resumes and a second put replaces, so a repeated call is no accident to guard against.
// One call carries one whole operation with its examples, which a tool's usual 8,000 characters cannot hold (#342).
const DRAFT_ARGS = 40_000;
const drafting: ToolPolicy = { effect: "write", requiresConfirmation: false, playbook: CONTRACT_DIFF_PLAYBOOK, metered: true, repeatable: true, maxArgs: DRAFT_ARGS };
const SIZE = ` Keep each call under ${DRAFT_ARGS.toLocaleString("en")} characters: put large or shared schemas in putChangelogComponents and $ref them.`;

export const openapiSkill: SkillModule = {
  id: "openapi",
  name: "OpenAPI",
  category: "Git, code & APIs",
  description: "Write API changelogs of a repository as OpenAPI documents, and publish OpenAPI documents as public OpenAPI Schema Viewer pages.",
  capabilities: ["openapi"],
  allowedScopes: ["tenant"],
  // Publishing goes without a Write confirmation, as the user decided (#285); the console revokes a link.
  toolPolicy: { startChangelog: drafting, putChangelogOperation: drafting, putChangelogComponents: drafting, putChangelogNotes: drafting, finishChangelog: drafting, stopChangelog: drafting, publishOpenApi: { effect: "write", requiresConfirmation: false }, listOpenApiPreviews: { effect: "read" } },
  tools: [
    { name: "startChangelog", description: "Starts an API changelog of a repository as an OpenAPI draft, or finds the one already started for the same commits. scope is the person's answer, never your choice: all is the whole history (every endpoint is NEW), range covers from one day to another (YYYY-MM-DD in this place's time zone; to is today when left out). It turns the days into commits on the branch (head: the last commit through to; base: the last commit before from) and returns the draft path, both commits, and the first changed files with how to list the rest. resumed lists the operations an earlier, unfinished run recorded.",
      parameters: { type: "object", properties: { account: acct, repo: repoP, branch: { type: "string", description: "Default: the default branch" }, scope: { type: "string", enum: ["all", "range"], description: "The person's answer: the whole history, or a range of days" }, from: { type: "string", description: "First day of a range, YYYY-MM-DD" }, to: { type: "string", description: "Last day, YYYY-MM-DD; default today" } }, required: ["repo", "scope"] } },
    { name: "putChangelogOperation", description: `Records one endpoint whose frontend-facing contract changed: the whole OpenAPI operation (every parameter, the request body, every response, security, examples) with x-changes saying what changed; x-impact is set for you. Call it as soon as an endpoint is traced, so a cut-off run keeps it. Sending the same method and path again replaces it; operation null removes it. Returns this operation's problems to fix.${SIZE}`,
      parameters: { type: "object", properties: { draft: draftP, method: { type: "string", description: "get, post, put, patch, delete, ..." }, path: { type: "string", description: 'The full path as the frontend calls it, e.g. "/api/v2/users/{id}"' }, operation: { type: "object", description: "The OpenAPI operation object with x-changes (and x-unverified when the code does not settle something), or null to remove it" }, components: { type: "object", description: 'Components this operation brings, e.g. {"schemas": {"User": {...}}}' } }, required: ["draft", "method", "path", "operation"] } },
    { name: "putChangelogComponents", description: `Adds or replaces shared components by name (schemas, responses, parameters, securitySchemes, ...) for operations to $ref, e.g. a schema several endpoints return, or the bearerAuth scheme.${SIZE}`,
      parameters: { type: "object", properties: { draft: draftP, components: { type: "object", description: 'Sections of components, e.g. {"schemas": {"User": {...}}}' } }, required: ["draft", "components"] } },
    { name: "putChangelogNotes", description: "Sets what the changelog says beyond single endpoints: globalChanges (a change to every endpoint, such as the envelope or a header every request needs), removedOperations (endpoints only in base), unverified (what the code could not settle, with the reason), setAside (changed files left unexamined because they cannot change what the frontend sees, by pattern, each with its reason; written in the changelog), and the title or description. A list given replaces the one kept. A setAside pattern covering every changed file, or every file not yet examined while those are most of them, is refused.",
      parameters: { type: "object", properties: { draft: draftP, globalChanges: { type: "array", items: { type: "object" }, description: "Change entries" }, removedOperations: { type: "array", items: { type: "object" }, description: '{"method": "delete", "path": "/api/v1/sessions", "replacedBy": "POST /api/v2/sessions/revoke"}' }, unverified: { type: "array", items: { type: "object" }, description: '{"in": "response.200", "field": "data.meta", "reason": "..."}' }, setAside: { type: "array", items: { type: "object" }, description: '{"pattern": "**/*.spec.ts", "reason": "tests, not served"}; ** crosses folders, a pattern without a slash matches a file name anywhere' }, title: { type: "string" }, description: { type: "string" } }, required: ["draft"] } },
    { name: "finishChangelog", description: "Validates the whole draft (the contract-diff checks and the OpenAPI 3.1 schema), counts the summary, and when there are no errors writes the changelog .json beside it and removes the draft. It refuses while a changed file is neither examined (its whole patch read with repoFileDiff, or the whole file with repoReadFile at either commit) nor set aside, and names them. With errors nothing is written: fix each and call it again. A draft that records no change writes nothing. Returns the file path, the summary, one line per breaking change, the unverified items and what was set aside, for your report.",
      parameters: { type: "object", properties: { draft: draftP }, required: ["draft"] } },
    { name: "stopChangelog", description: "Stops the API changelog open in this place when the person who started it asks to stop it, in any words (\"hentikan bikin changelog\", \"stop the changelog\"): its draft is removed with what it recorded and nothing is written. Only the person who started it may stop it. A message that only pauses or asks to wait is not a stop.",
      parameters: { type: "object", properties: { draft: { type: "string", description: "The draft to stop; needed only when several are open here" } } } },
    { name: "publishOpenApi", description: "Publishes an OpenAPI JSON from the Workspace as an OpenAPI Schema Viewer page: a public page anyone with its link can open without signing in, showing the document (an API changelog's changes as badges and tables). It shows the file as it is now: later changes to the file do not reach it, and publishing again makes a new link. Use it when the person asks to show, preview or share an OpenAPI document or a changelog. The path is as readFile takes it. Returns the link; give it to the person, with any warning.",
      parameters: { type: "object", properties: { path: { type: "string", description: 'The .json file, e.g. "channel/files/changelogs/acme-api/2026-10-22_9f8e7d6..a1b2c3d.json"' }, title: { type: "string", description: "Default: the document's info.title" } }, required: ["path"] } },
    { name: "listOpenApiPreviews", description: "Lists the OpenAPI Schema Viewer pages this bot published in this channel (with its threads) or this DM, newest first, with their links.",
      parameters: { type: "object", properties: {} } },
  ],
  handlers: {
    startChangelog: async (args, ctx) => { const { conn, repo } = await useRepo(args, ctx); return startChangelog(ctx, conn, repo, args); },
    putChangelogOperation: (args, ctx) => putOperation(ctx, args),
    putChangelogComponents: (args, ctx) => putComponents(ctx, args),
    putChangelogNotes: (args, ctx) => putNotes(ctx, args),
    finishChangelog: (args, ctx) => finishChangelog(ctx, args),
    stopChangelog: (args, ctx) => stopChangelog(ctx, args),
    publishOpenApi: async (args, ctx) => publishPreview(ctx, { full: await readablePath(ctx, args.path), shown: String(args.path).trim() }, args.title),
    listOpenApiPreviews: (_args, ctx) => listPreviews(ctx),
  },
  // A changelog's reads go through the git skill; these note which changed files they covered (#347).
  observes: {
    repoFileDiff: (args, data, ctx) => noteRead(ctx, "repoFileDiff", args, data),
    repoReadFile: (args, data, ctx) => noteRead(ctx, "repoReadFile", args, data),
  },
};
