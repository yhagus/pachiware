import type { SkillModule, ToolPolicy } from "../types.js";
import { acct, repoP, useRepo } from "./gitShared.js";
import { finishChangelog, putComponents, putNotes, putOperation, startChangelog } from "../openapi/changelog.js";
import { MAX_ARGS } from "../guardrails.js";

/** The playbook the changelog tools serve: they are offered exactly where it is available. */
export const CONTRACT_DIFF_PLAYBOOK = "contract-diff";

const draftP = { type: "string", description: "The draft path startChangelog returned" };
// They write only the bot's own changelog files, and a long playbook calls them many times: no Confirm, outside the per-person rate.
// A second start resumes and a second put replaces, so a repeated call is no accident to guard against.
const drafting: ToolPolicy = { effect: "write", requiresConfirmation: false, playbook: CONTRACT_DIFF_PLAYBOOK, metered: true, repeatable: true };
const SIZE = ` Keep each call under ${MAX_ARGS.toLocaleString("en")} characters: put large or shared schemas in putChangelogComponents and $ref them.`;

export const openapiSkill: SkillModule = {
  id: "openapi",
  name: "OpenAPI",
  description: "Write API changelogs of a repository as OpenAPI documents.",
  capabilities: ["openapi"],
  allowedScopes: ["tenant"],
  toolPolicy: { startChangelog: drafting, putChangelogOperation: drafting, putChangelogComponents: drafting, putChangelogNotes: drafting, finishChangelog: drafting },
  tools: [
    { name: "startChangelog", description: "Starts an API changelog of a repository as an OpenAPI draft, or finds the one already started for the same commits. scope is the person's answer, never your choice: all is the whole history (every endpoint is NEW), range covers from one day to another (YYYY-MM-DD in this place's time zone; to is today when left out). It turns the days into commits on the branch (head: the last commit through to; base: the last commit before from) and returns the draft path, both commits, and the first changed files with how to list the rest. resumed lists the operations an earlier, unfinished run recorded.",
      parameters: { type: "object", properties: { account: acct, repo: repoP, branch: { type: "string", description: "Default: the default branch" }, scope: { type: "string", enum: ["all", "range"], description: "The person's answer: the whole history, or a range of days" }, from: { type: "string", description: "First day of a range, YYYY-MM-DD" }, to: { type: "string", description: "Last day, YYYY-MM-DD; default today" } }, required: ["repo", "scope"] } },
    { name: "putChangelogOperation", description: `Records one endpoint whose frontend-facing contract changed: the whole OpenAPI operation (every parameter, the request body, every response, security, examples) with x-changes saying what changed; x-impact is set for you. Call it as soon as an endpoint is traced, so a cut-off run keeps it. Sending the same method and path again replaces it; operation null removes it. Returns this operation's problems to fix.${SIZE}`,
      parameters: { type: "object", properties: { draft: draftP, method: { type: "string", description: "get, post, put, patch, delete, ..." }, path: { type: "string", description: 'The full path as the frontend calls it, e.g. "/api/v2/users/{id}"' }, operation: { type: "object", description: "The OpenAPI operation object with x-changes (and x-unverified when the code does not settle something), or null to remove it" }, components: { type: "object", description: 'Components this operation brings, e.g. {"schemas": {"User": {...}}}' } }, required: ["draft", "method", "path", "operation"] } },
    { name: "putChangelogComponents", description: `Adds or replaces shared components by name (schemas, responses, parameters, securitySchemes, ...) for operations to $ref, e.g. a schema several endpoints return, or the bearerAuth scheme.${SIZE}`,
      parameters: { type: "object", properties: { draft: draftP, components: { type: "object", description: 'Sections of components, e.g. {"schemas": {"User": {...}}}' } }, required: ["draft", "components"] } },
    { name: "putChangelogNotes", description: "Sets what the changelog says beyond single endpoints: globalChanges (a change to every endpoint, such as the envelope or a header every request needs), removedOperations (endpoints only in base), unverified (what the code could not settle, with the reason), and the title or description. A list given replaces the one kept.",
      parameters: { type: "object", properties: { draft: draftP, globalChanges: { type: "array", items: { type: "object" }, description: "Change entries" }, removedOperations: { type: "array", items: { type: "object" }, description: '{"method": "delete", "path": "/api/v1/sessions", "replacedBy": "POST /api/v2/sessions/revoke"}' }, unverified: { type: "array", items: { type: "object" }, description: '{"in": "response.200", "field": "data.meta", "reason": "..."}' }, title: { type: "string" }, description: { type: "string" } }, required: ["draft"] } },
    { name: "finishChangelog", description: "Validates the whole draft (the contract-diff checks and the OpenAPI 3.1 schema), counts the summary, and when there are no errors writes the changelog .json beside it and removes the draft. With errors nothing is written: fix each and call it again. A draft that records no change writes nothing. Returns the file path, the summary, one line per breaking change and the unverified items, for your report.",
      parameters: { type: "object", properties: { draft: draftP }, required: ["draft"] } },
  ],
  handlers: {
    startChangelog: async (args, ctx) => { const { conn, repo } = await useRepo(args, ctx); return startChangelog(ctx, conn, repo, args); },
    putChangelogOperation: (args, ctx) => putOperation(ctx, args),
    putChangelogComponents: (args, ctx) => putComponents(ctx, args),
    putChangelogNotes: (args, ctx) => putNotes(ctx, args),
    finishChangelog: (args, ctx) => finishChangelog(ctx, args),
  },
};
