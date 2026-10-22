import { expect, test } from "bun:test";
import { forViewer } from "../src/openapi/viewer.js";

const changelog = () => ({
  openapi: "3.1.2",
  info: {
    title: "Users API changes", version: "a1b2c3d", description: "Users service.",
    "x-changelog": {
      date: "2026-10-22", base: { ref: "main before 2026-10-01", commit: "9f8e7d6" }, head: { ref: "main through 2026-10-22", commit: "a1b2c3d" },
      summary: { breaking: 5, deprecated: 0, "non-breaking": 2 },
      globalChanges: [{ status: "CHANGED", impact: "breaking", in: "header", field: "X-Client-Version", before: { required: false }, after: { required: true } }],
      removedOperations: [{ method: "delete", path: "/api/v1/sessions", replacedBy: "POST /api/v2/sessions/revoke" }],
      unverified: [{ in: "response.200", field: "data.meta", reason: "Passed through from the payment gateway" }],
    },
  },
  paths: {
    "/api/v2/users": {
      post: {
        "x-impact": "breaking",
        "x-changes": [
          { status: "CHANGED", impact: "breaking", in: "url", before: "POST /api/v1/users", after: "POST /api/v2/users" },
          { status: "RENAMED", impact: "breaking", in: "body", field: "full_name", from: "name" },
          { status: "CHANGED", impact: "breaking", in: "body", field: "phone", before: { required: false }, after: { required: true, format: "E.164" } },
          { status: "NEW", impact: "non-breaking", in: "response.409", code: "PHONE_ALREADY_USED" },
        ],
        responses: { "201": { description: "Created" } },
      },
    },
    "/api/v2/health": {
      get: { description: "Liveness.", "x-impact": "non-breaking", "x-changes": [{ status: "NEW", impact: "non-breaking", in: "operation" }], "x-unverified": [{ in: "response.200", reason: "Built from env" }], responses: { "200": { description: "OK" } } },
    },
  },
});

test("a changelog's operations get badges and a list of their changes, and its description the summary and what goes beyond one endpoint", () => {
  const doc = changelog(), original = structuredClone(doc);
  const view = forViewer(doc, { download: "./0f1e/openapi.json" });
  expect(doc).toEqual(original);

  expect(view.paths["/api/v2/users"].post["x-badges"]).toEqual([{ name: "Breaking", color: "#cf222e", position: "before" }, { name: "Changed", color: "#0969da", position: "before" }]);
  expect(view.paths["/api/v2/users"].post.description).toBe(`**Changes**

- **CHANGED** url · breaking: \`POST /api/v1/users\` → \`POST /api/v2/users\`
- **RENAMED** body \`full_name\` (was \`name\`) · breaking
- **CHANGED** body \`phone\` · breaking: \`{"required":false}\` → \`{"required":true,"format":"E.164"}\`
- **NEW** response.409 · non-breaking: error \`PHONE_ALREADY_USED\``);

  expect(view.paths["/api/v2/health"].get["x-badges"]).toEqual([{ name: "New", color: "#1a7f37", position: "before" }]);
  expect(view.paths["/api/v2/health"].get.description).toBe(`**Changes**

- **NEW** operation · non-breaking

**Not verified**

- response.200: Built from env

Liveness.`);

  expect(view.info.description).toBe(`**Changelog** of 2026-10-22: from \`main before 2026-10-01\` (\`9f8e7d6\`) to \`main through 2026-10-22\` (\`a1b2c3d\`).

**5** breaking · **0** deprecated · **2** non-breaking

### Changes to every endpoint

- **CHANGED** header \`X-Client-Version\` · breaking: \`{"required":false}\` → \`{"required":true}\`

### Removed endpoints

- \`DELETE /api/v1/sessions\`, replaced by \`POST /api/v2/sessions/revoke\`

### Not verified

- response.200 \`data.meta\`: Passed through from the payment gateway

[Download the OpenAPI JSON](./0f1e/openapi.json)

Users service.`);
});

test("a document that is no changelog is shown as it is, and a note on several lines stays on one", () => {
  const plain = { openapi: "3.1.0", info: { title: "Plain", version: "1" }, paths: {} };
  expect(forViewer(plain)).toBe(plain);
  const doc = changelog();
  doc.paths["/api/v2/users"].post["x-changes"] = [{ status: "CHANGED", impact: "breaking", in: "body", field: "kind", before: "a|b", after: "a", note: "one of a | b\nnow a" } as any];
  expect(forViewer(doc).paths["/api/v2/users"].post.description).toBe("**Changes**\n\n- **CHANGED** body `kind` · breaking: `a|b` → `a`; one of a | b now a");
});
