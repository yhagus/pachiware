import { expect, test } from "bun:test";
import { typesForViewer } from "../src/openapi/typescript.js";

const doc = () => ({
  openapi: "3.1.0",
  info: { title: "Billing API", version: "2.4.0" },
  paths: {
    "/v2/invoices": {
      post: {
        operationId: "createInvoice",
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateInvoice" } } } },
        responses: {
          "201": { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/Invoice" } } } },
          "400": { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "204": { description: "No content" },
        },
      },
      get: {
        operationId: "listInvoices",
        responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Invoice" } } } } } },
      },
    },
    "/v2/invoices/{id}": {
      get: { operationId: "getInvoice", responses: { "200": { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Invoice" } } } } } },
    },
  },
  components: {
    schemas: {
      CreateInvoice: {
        type: "object",
        required: ["amount", "currency"],
        properties: {
          amount: { type: "number" },
          currency: { type: "string", enum: ["usd", "eur", "idr"] },
          customerId: { type: "string" },
          note: { type: "string", nullable: true },
          metadata: { type: "object", additionalProperties: { type: "string" } },
        },
      },
      Invoice: {
        type: "object",
        required: ["id", "amount"],
        properties: {
          id: { type: "string" },
          amount: { type: "number" },
          customer: { $ref: "#/components/schemas/Customer" },
          lines: { type: "array", items: { $ref: "#/components/schemas/LineItem" } },
          note: { type: ["string", "null"] },
        },
      },
      Customer: { type: "object", required: ["id"], properties: { id: { type: "string" }, email: { type: "string", nullable: true } } },
      LineItem: { type: "object", required: ["sku"], properties: { sku: { type: "string" }, qty: { type: "integer" } } },
      Error: { type: "object", required: ["code"], properties: { code: { type: "string" }, "x-trace": { type: "string" } } },
    },
  },
});

test("keys match the viewer's method and path, and cover body and responses", () => {
  const { operations } = typesForViewer(doc());
  expect(Object.keys(operations).sort()).toEqual(["GET /v2/invoices", "GET /v2/invoices/{id}", "POST /v2/invoices"]);
  const post = operations["POST /v2/invoices"];
  expect(post.request).toBeDefined();
  expect(Object.keys(post.responses).sort()).toEqual(["201", "400"]); // 204 has no schema, so no type
});

test("a request body is a named interface, optional and nullable spelled out", () => {
  const ts = typesForViewer(doc()).operations["POST /v2/invoices"].request!;
  expect(ts).toContain("interface CreateInvoice {");
  expect(ts).toContain("amount: number;"); // required
  expect(ts).toContain('currency: "usd" | "eur" | "idr";'); // enum, required
  expect(ts).toContain("customerId: string | undefined;"); // optional
  expect(ts).toContain("note: string | null | undefined;"); // nullable + optional
  expect(ts).toContain("metadata: Record<string, string> | undefined;"); // additionalProperties
});

test("$refs are inlined so the type stands alone, arrays and nested objects included", () => {
  const ts = typesForViewer(doc()).operations["POST /v2/invoices"].responses["201"];
  expect(ts).toContain("interface Invoice {");
  expect(ts).toContain("id: string;");
  expect(ts).toContain("customer: {"); // Customer inlined
  expect(ts).toContain("email: string | null | undefined;");
  expect(ts).toMatch(/lines: \(\{[\s\S]*sku: string;[\s\S]*\}\)\[\] \| undefined;/); // array of inlined LineItem
  expect(ts).toContain("note: string | null | undefined;"); // 3.1 ["string","null"], and optional
  expect(ts).not.toContain("$ref");
});

test("an array response becomes a type alias of inlined items", () => {
  const ts = typesForViewer(doc()).operations["GET /v2/invoices"].responses["200"];
  expect(ts.startsWith("type ")).toBe(true);
  expect(ts.trimEnd().endsWith("[];")).toBe(true);
  expect(ts).toContain("id: string;");
});

test("a non-identifier property key is quoted", () => {
  const ts = typesForViewer(doc()).operations["POST /v2/invoices"].responses["400"];
  expect(ts).toContain("interface Error {");
  expect(ts).toContain('"x-trace": string | undefined;');
});

test("a required but nullable property gets | null and not | undefined", () => {
  const d = {
    openapi: "3.1.0",
    info: { title: "T", version: "1" },
    paths: { "/x": { get: { responses: { "200": { content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string", nullable: true } } } } } } } } } },
  };
  const ts = typesForViewer(d).operations["GET /x"].responses["200"];
  expect(ts).toContain("name: string | null;");
  expect(ts).not.toContain("undefined");
});

test("a document with no request bodies or response schemas yields no operations", () => {
  const empty = { openapi: "3.1.0", info: { title: "X", version: "1" }, paths: { "/ping": { get: { responses: { "204": { description: "No content" } } } } } };
  expect(typesForViewer(empty).operations).toEqual({});
});

test("a self-referential schema stops at the type name instead of looping", () => {
  const tree = {
    openapi: "3.1.0",
    info: { title: "T", version: "1" },
    paths: { "/n": { get: { responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Node" } } } } } } } },
    components: { schemas: { Node: { type: "object", required: ["id"], properties: { id: { type: "string" }, children: { type: "array", items: { $ref: "#/components/schemas/Node" } } } } } },
  };
  const ts = typesForViewer(tree).operations["GET /n"].responses["200"];
  expect(ts).toContain("interface Node {");
  expect(ts).toContain("children: Node[] | undefined;"); // the cycle collapses to the name
});
