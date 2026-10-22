import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { validateChangelog, validateOperation } from "../src/openapi/validate.js";

/** The skill's own example operation (SKILL.md, "Example operation"), completed into a document; validate.py reports 0 errors on it. */
const valid = () => JSON.parse(readFileSync(new URL("./fixtures/contract-diff/create-user.json", import.meta.url), "utf8"));
const OP = "POST /api/v2/users";

test("the skill's example operation, completed into a document, has no errors and no warnings", () => {
  const report = validateChangelog(valid());
  expect(report.errors).toEqual([]);
  expect(report.warnings).toEqual([]);
});

// The messages below are validate.py's own templates, filled in for each broken variant.
test("a summary that does not count the changes", () => {
  const doc = valid();
  doc.info["x-changelog"].summary.breaking = 2;
  expect(validateChangelog(doc).errors).toEqual(["/info/x-changelog/summary: breaking is 2 but the document contains 3"]);
});

test("RENAMED marked non-breaking fails the extension schema, and the summary waits for it", () => {
  const doc = valid();
  doc.paths["/api/v2/users"].post["x-changes"][1].impact = "non-breaking";
  const report = validateChangelog(doc);
  expect(report.errors).toEqual([`${OP} x-changes/1/impact: must be equal to constant`]);
  expect(report.warnings).toEqual(["/info/x-changelog/summary: not checked until the x-changes errors above are fixed"]);
});

test("x-impact that is not the most severe change", () => {
  const doc = valid();
  doc.paths["/api/v2/users"].post["x-impact"] = "non-breaking";
  expect(validateChangelog(doc).errors).toEqual([`${OP}: x-impact is 'non-breaking' but the most severe change is 'breaking'`]);
});

test("a change naming a field the body schema does not have", () => {
  const doc = valid();
  doc.paths["/api/v2/users"].post["x-changes"][2].field = "phone_number";
  expect(validateChangelog(doc).errors).toEqual([`${OP} x-changes[2]: field 'phone_number' does not exist in the body schema`]);
});

test("a RENAMED field whose old name is still in the schema is a warning", () => {
  const doc = valid();
  doc.components.schemas.NewUser.properties.name = { type: "string" };
  const report = validateChangelog(doc);
  expect(report.errors).toEqual([]);
  expect(report.warnings).toEqual([`${OP} x-changes[1]: RENAMED from 'name' but the old name still exists in the schema`]);
});

test("an example that does not match its schema", () => {
  const doc = valid();
  doc.paths["/api/v2/users"].post.responses["201"].content["application/json"].example.data.id = "42";
  expect(validateChangelog(doc).errors).toEqual([`${OP} response 201 application/json example: example does not match schema at data.id: must be integer`]);
});

test("a changed response without an example", () => {
  const doc = valid();
  delete doc.paths["/api/v2/users"].post.responses["409"].content["application/json"].example;
  expect(validateChangelog(doc).errors).toEqual([`${OP} response 409: application/json has no example`]);
});

test("an unresolved $ref, and the component nothing references any more", () => {
  const doc = valid();
  doc.paths["/api/v2/users"].post.responses["422"].content["application/json"].schema.$ref = "#/components/schemas/Nope";
  doc.paths["/api/v2/users"].post.responses["409"].content["application/json"].schema.$ref = "#/components/schemas/Nope";
  const report = validateChangelog(doc);
  expect(report.errors).toContain("/paths/~1api~1v2~1users/post/responses/409/content/application~1json/schema: $ref '#/components/schemas/Nope' does not resolve");
  expect(report.errors).toContain("/paths/~1api~1v2~1users/post/responses/422/content/application~1json/schema: $ref '#/components/schemas/Nope' does not resolve");
  expect(report.warnings).toEqual(["/components/schemas/Error: unused component - include only what changed paths reference"]);
});

test("an operation without security, and a parameter change on a parameter that is not declared", () => {
  const doc = valid();
  delete doc.paths["/api/v2/users"].post.security;
  doc.paths["/api/v2/users"].post["x-changes"].push({ status: "NEW", impact: "non-breaking", in: "query", field: "invite" });
  doc.info["x-changelog"].summary["non-breaking"] = 2;
  expect(validateChangelog(doc).errors).toEqual([
    `${OP}: declare \`security\` explicitly (use [] for public endpoints) so auth requirements are part of the contract`,
    `${OP} x-changes[4]: query parameter 'invite' is not declared on this operation`,
  ]);
  expect(validateChangelog(doc).warnings).toEqual(["/components/securitySchemes/bearerAuth: unused security scheme"]);
});

test("an OpenAPI 3.0 document, and one that breaks the OpenAPI 3.1 schema", () => {
  const old = valid();
  old.openapi = "3.0.3";
  expect(validateChangelog(old).errors).toContain("/openapi: '3.0.3' - contract-diff documents must use OpenAPI 3.1 or newer");
  const broken = valid();
  delete broken.paths["/api/v2/users"].post.responses["422"].description;
  expect(validateChangelog(broken).errors).toEqual(["schema: /paths/~1api~1v2~1users/post/responses/422 must have required property 'description'"]);
});

test("one operation is checked on its own while the rest of the changelog is unwritten", () => {
  const doc = valid();
  doc.info["x-changelog"].summary.breaking = 0;
  doc.paths["/api/v2/users"].post["x-changes"][2].field = "phone_number";
  // The summary is not this operation's business; the field is.
  expect(validateOperation(doc, "/api/v2/users", "post").errors).toEqual([`${OP} x-changes[2]: field 'phone_number' does not exist in the body schema`]);
  expect(validateOperation(doc, "/api/v2/users", "get").errors).toEqual(["GET /api/v2/users: no such operation"]);
});
