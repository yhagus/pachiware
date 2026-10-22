import { readFileSync } from "node:fs";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

/**
 * The contract-diff validator, ported from the skill's `scripts/validate.py`: the x- extensions, the summary counts, that every change
 * points at something that exists (or, for REMOVED, no longer does), that every $ref resolves, that every example matches its schema.
 * The Python script's third layer, Redocly's lint, is the official OpenAPI 3.1 JSON Schema here (vendored, run with ajv). Its error and
 * warning texts are the script's, so its documentation still explains them.
 */

/** The version every changelog targets: the skill's own fallback, which the vendored schema, the validator and the viewer all read. */
export const OPENAPI_VERSION = "3.1.2";
export const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace", "query"] as const;
export const IMPACTS = ["breaking", "deprecated", "non-breaking"] as const;
export type Impact = (typeof IMPACTS)[number];
const STATUSES = ["NEW", "CHANGED", "RENAMED", "DEPRECATED", "REMOVED"];
const IN_PATTERN = "^(operation|url|path|query|header|cookie|body|security|envelope|response\\.([1-5][0-9]{2}|[1-5]XX|default))$";
const PARAM_LOCATIONS = ["path", "query", "header", "cookie"];
const EXTENSIONS_URI = "urn:contract-diff:extensions", DOC_URI = "urn:contract-diff:document";

/** The contract for the x- extensions; a viewer can rely on it. */
export const EXTENSIONS_SCHEMA = {
  $id: EXTENSIONS_URI,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $defs: {
    revision: {
      type: "object", required: ["ref", "commit"],
      properties: { ref: { type: "string", minLength: 1 }, commit: { type: "string", pattern: "^[0-9a-f]{7,40}$" }, dirty: { type: "boolean" } },
      additionalProperties: false,
    },
    change: {
      type: "object", required: ["status", "impact", "in"],
      properties: {
        status: { enum: STATUSES }, impact: { enum: IMPACTS }, in: { type: "string", pattern: IN_PATTERN },
        field: { type: "string", minLength: 1 }, code: { type: "string", minLength: 1 }, from: { type: "string", minLength: 1 },
        before: {}, after: {}, removal: { type: "string", minLength: 1 }, note: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
      allOf: [
        { if: { properties: { status: { const: "RENAMED" } } }, then: { required: ["field", "from"], properties: { impact: { const: "breaking" } } } },
        { if: { properties: { status: { const: "CHANGED" } } }, then: { required: ["before", "after"] } },
        { if: { properties: { status: { const: "DEPRECATED" } } }, then: { properties: { impact: { const: "deprecated" } } } },
        { if: { properties: { in: { const: "url" } } }, then: { required: ["before", "after"] } },
        { if: { properties: { in: { enum: PARAM_LOCATIONS } } }, then: { required: ["field"] } },
      ],
    },
    unverified: {
      type: "object", required: ["in", "reason"],
      properties: { in: { type: "string", pattern: IN_PATTERN }, field: { type: "string", minLength: 1 }, reason: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
    removedOperation: {
      type: "object", required: ["method", "path"],
      properties: { method: { type: "string", pattern: "^[a-z]+$" }, path: { type: "string", pattern: "^/" }, replacedBy: { type: "string", minLength: 1 }, note: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
    changelog: {
      type: "object", required: ["date", "base", "head", "summary"],
      properties: {
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        base: { $ref: "#/$defs/revision" }, head: { $ref: "#/$defs/revision" },
        summary: { type: "object", required: IMPACTS, properties: Object.fromEntries(IMPACTS.map((k) => [k, { type: "integer", minimum: 0 }])), additionalProperties: false },
        globalChanges: { type: "array", items: { $ref: "#/$defs/change" } },
        removedOperations: { type: "array", items: { $ref: "#/$defs/removedOperation" } },
        unverified: { type: "array", items: { $ref: "#/$defs/unverified" } },
        openapiVersionNote: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    operation: {
      type: "object", required: ["x-impact", "x-changes"],
      properties: { "x-impact": { enum: IMPACTS }, "x-changes": { type: "array", minItems: 1, items: { $ref: "#/$defs/change" } }, "x-unverified": { type: "array", items: { $ref: "#/$defs/unverified" } } },
    },
  },
};

/**
 * The official schema (spec.openapis.org/oas/3.1/schema/2026-08-03) reaches Schema Objects through `$dynamicRef: "#meta"`, which ajv
 * resolves to the document's root instead of `$defs/schema`. Alone, with no dialect extending it, that anchor can only mean
 * `$defs/schema`, so it is read as a plain `$ref` there.
 */
const staticMeta = (node: unknown): unknown =>
  Array.isArray(node) ? node.map(staticMeta)
    : node && typeof node === "object" ? Object.fromEntries(Object.entries(node).map(([k, v]) => (k === "$dynamicRef" && v === "#meta" ? ["$ref", "#/$defs/schema"] : [k, staticMeta(v)])))
    : node;
const OAS_31 = staticMeta(JSON.parse(readFileSync(new URL("./oas-3.1-schema.json", import.meta.url), "utf8"))) as object;

function newAjv() {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false, logger: false });
  addFormats(ajv);
  // OpenAPI's own format for the keys of `content`; any string the media type map accepts.
  ajv.addFormat("media-range", true);
  return ajv;
}
let shared: { ajv: Ajv2020; defs: Map<string, ValidateFunction>; oas: ValidateFunction } | null = null;
function sharedAjv() {
  if (shared) return shared;
  const ajv = newAjv();
  ajv.addSchema(EXTENSIONS_SCHEMA);
  return (shared = { ajv, defs: new Map(), oas: ajv.compile(OAS_31) });
}
function extensionValidator(definition: string) {
  const { ajv, defs } = sharedAjv();
  if (!defs.has(definition)) defs.set(definition, ajv.compile({ $ref: `${EXTENSIONS_URI}#/$defs/${definition}` }));
  return defs.get(definition)!;
}

export class Report {
  errors: string[] = [];
  warnings: string[] = [];
  error(where: string, msg: string) { this.errors.push(`${where}: ${msg}`); }
  warn(where: string, msg: string) { this.warnings.push(`${where}: ${msg}`); }
}

type Json = any;
type Op = { path: string; method: string; op: Json };

export const escapePointer = (token: string) => token.replace(/~/g, "~0").replace(/\//g, "~1");

/** Resolves "#/a/b" inside the document: the node and its pointer, or nulls. */
export function resolveLocal(doc: Json, ref: unknown): [Json, string] | [null, null] {
  if (typeof ref !== "string" || !ref.startsWith("#")) return [null, null];
  let node = doc;
  const pointer = ref.slice(1);
  if (pointer) {
    for (const raw of pointer.replace(/^\/+/, "").split("/")) {
      const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
      if (node && typeof node === "object" && !Array.isArray(node) && token in node) node = node[token];
      else if (Array.isArray(node) && /^\d+$/.test(token) && Number(token) < node.length) node = node[Number(token)];
      else return [null, null];
    }
  }
  return [node, pointer];
}

/** Follows a chain of $ref objects. */
export function deref(doc: Json, node: Json, pointer: string, depth = 0): [Json, string] | [null, null] {
  while (isObject(node) && "$ref" in node && depth < 20) {
    const [target, targetPtr] = resolveLocal(doc, node.$ref);
    if (target === null) return [null, null];
    [node, pointer, depth] = [target, targetPtr!, depth + 1];
  }
  return [node, pointer];
}

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const isJsonMedia = (media: string) => media.toLowerCase().includes("json");

function* walkRefs(node: Json, path = ""): Generator<[string, string]> {
  if (isObject(node)) {
    if (typeof node.$ref === "string") yield [node.$ref, path];
    for (const [k, v] of Object.entries(node)) yield* walkRefs(v, `${path}/${escapePointer(k)}`);
  } else if (Array.isArray(node)) for (let i = 0; i < node.length; i++) yield* walkRefs(node[i], `${path}/${i}`);
}

/** $ref, allOf, anyOf and oneOf expanded into the concrete schemas to search. */
function subschemas(doc: Json, schema: Json, pointer: string): [Json, string][] {
  const [s, p] = deref(doc, schema, pointer);
  if (!isObject(s)) return [];
  const found: [Json, string][] = [[s, p!]];
  for (const key of ["allOf", "anyOf", "oneOf"]) (s[key] ?? []).forEach((sub: Json, i: number) => found.push(...subschemas(doc, sub, `${p}/${key}/${i}`)));
  return found;
}

/**
 * Whether a dotted field path exists in a schema: "a.b[].c" means property a, property b (an array), then property c of its items.
 * "unknown" means the schema is open-ended (additionalProperties etc.), so existence cannot be decided.
 */
export function findField(doc: Json, schema: Json, pointer: string, fieldPath: string): ["found", Json] | ["missing" | "unknown", null] {
  let current: [Json, string][] = [[schema, pointer]];
  for (const token of fieldPath.split(".").filter((t) => t !== "")) {
    let name = token, arrays = 0;
    while (name.endsWith("[]")) { name = name.slice(0, -2); arrays++; }
    let next: [Json, string][] = [], openEnded = false;
    for (const [sch, ptr] of current) {
      for (const [sub, subPtr] of subschemas(doc, sch, ptr)) {
        if (name === "") { next.push([sub, subPtr]); continue; }
        const props = sub.properties ?? {};
        if (name in props) next.push([props[name], `${subPtr}/properties/${escapePointer(name)}`]);
        else if ((sub.additionalProperties !== undefined && sub.additionalProperties !== false) || sub.patternProperties) openEnded = true;
      }
    }
    for (let i = 0; i < arrays; i++) {
      const items: [Json, string][] = [];
      for (const [sch, ptr] of next) for (const [sub, subPtr] of subschemas(doc, sch, ptr)) if (isObject(sub.items)) items.push([sub.items, `${subPtr}/items`]);
      next = items;
    }
    if (!next.length) return openEnded ? ["unknown", null] : ["missing", null];
    current = next;
  }
  const resolved = current.map(([s, p]) => deref(doc, s, p)[0]);
  return ["found", resolved.find(isObject) ?? null];
}

/** The first JSON media type schema inside a requestBody or response object. */
function jsonSchemaOf(container: Json, pointer: string): [Json, string] | [null, null] {
  for (const [media, obj] of Object.entries<any>(container?.content ?? {})) {
    if (isJsonMedia(media) && isObject(obj) && "schema" in obj) return [obj.schema, `${pointer}/content/${escapePointer(media)}/schema`];
  }
  return [null, null];
}

export function* iterOperations(doc: Json): Generator<Op> {
  for (const [path, item] of Object.entries<any>(doc?.paths ?? {})) {
    if (!isObject(item)) continue;
    for (const method of HTTP_METHODS) if (isObject(item[method])) yield { path, method, op: item[method] };
    for (const [method, op] of Object.entries<any>(item.additionalOperations ?? {})) if (isObject(op)) yield { path, method, op };
  }
}

function collectParameters(doc: Json, pathItem: Json, operation: Json) {
  const params = new Map<string, Json>();
  for (const source of [pathItem, operation]) {
    for (const p of source?.parameters ?? []) {
      const [resolved] = deref(doc, p, "");
      if (isObject(resolved) && "name" in resolved && "in" in resolved) params.set(`${resolved.in}:${resolved.in === "header" ? String(resolved.name).toLowerCase() : resolved.name}`, resolved);
    }
  }
  return params;
}

function checkRefsAndComponents(doc: Json, report: Report, only?: Op) {
  const used = new Set<string>();
  const root = only ? doc.paths[only.path][only.method] : doc, base = only ? `/paths/${escapePointer(only.path)}/${only.method}` : "";
  for (const [ref, where] of walkRefs(root)) {
    if (!ref.startsWith("#")) { report.error(base + where || "/", `external $ref '${ref}' - the document must be self-contained`); continue; }
    if (resolveLocal(doc, ref)[0] === null) report.error(base + where || "/", `$ref '${ref}' does not resolve`);
    else used.add(ref);
  }
  if (only) return;
  // securitySchemes are referenced by name from `security`, not by $ref
  const securityNames = new Set<string>();
  for (const item of [doc, ...[...iterOperations(doc)].map((o) => o.op)]) for (const req of item.security ?? []) for (const name of Object.keys(req ?? {})) securityNames.add(name);
  for (const [section, entries] of Object.entries<any>(doc.components ?? {})) {
    if (!isObject(entries)) continue;
    for (const name of Object.keys(entries)) {
      if (section === "securitySchemes") {
        if (!securityNames.has(name)) report.warn(`/components/securitySchemes/${name}`, "unused security scheme");
        continue;
      }
      if (!used.has(`#/components/${section}/${escapePointer(name)}`)) report.warn(`/components/${section}/${name}`, "unused component - include only what changed paths reference");
    }
  }
  for (const name of securityNames) if (!(name in (doc.components?.securitySchemes ?? {}))) report.error("security", `security scheme '${name}' is not defined in components.securitySchemes`);
}

function checkChangeTarget(doc: Json, { path, method, op }: Op, change: Json, where: string, report: Report) {
  const { status, in: location, field } = change, mustExist = status !== "REMOVED";
  if (["url", "security", "envelope"].includes(location)) return;
  if (location === "operation") {
    if (status === "DEPRECATED" && !op.deprecated) report.error(where, "operation marked DEPRECATED in x-changes but the operation has no `deprecated: true`");
    return;
  }
  if (PARAM_LOCATIONS.includes(location)) {
    const params = collectParameters(doc, doc.paths[path], op), key = `${location}:${location === "header" ? String(field).toLowerCase() : field}`, exists = params.has(key);
    if (mustExist && !exists) report.error(where, `${location} parameter '${field}' is not declared on this operation`);
    else if (!mustExist && exists) report.error(where, `${location} parameter '${field}' is marked REMOVED but is still declared`);
    else if (status === "DEPRECATED" && exists && !params.get(key).deprecated) report.error(where, `${location} parameter '${field}' is DEPRECATED but lacks \`deprecated: true\``);
    return;
  }
  const opPtr = `/paths/${escapePointer(path)}/${method}`;
  let container: Json, containerPtr: string;
  if (location === "body") {
    const [body, bodyPtr] = deref(doc, op.requestBody, `${opPtr}/requestBody`);
    if (body === null || body === undefined) {
      if (mustExist) report.error(where, "change is `in: body` but the operation has no requestBody");
      return;
    }
    [container, containerPtr] = [body, bodyPtr!];
  } else {
    const code = location.split(".", 2)[1], responses = op.responses ?? {};
    if (!field) {
      if (mustExist && !(code in responses)) report.error(where, `response ${code} is not documented on this operation`);
      if (!mustExist && code in responses) report.error(where, `response ${code} is marked REMOVED but is still documented`);
      return;
    }
    if (!(code in responses)) {
      if (mustExist) report.error(where, `response ${code} is not documented on this operation`);
      return;
    }
    const [resolved, resolvedPtr] = deref(doc, responses[code], `${opPtr}/responses/${code}`);
    [container, containerPtr] = [resolved, resolvedPtr ?? ""];
  }
  if (!field) return;
  const [schema, schemaPtr] = jsonSchemaOf(container, containerPtr);
  if (schema === null) { report.warn(where, "no JSON schema to check the field against"); return; }
  const [result, target] = findField(doc, schema, schemaPtr!, field);
  if (result === "unknown") report.warn(where, `field '${field}' sits under an open-ended schema; existence not verified`);
  else if (mustExist && result === "missing") report.error(where, `field '${field}' does not exist in the ${location} schema`);
  else if (!mustExist && result === "found") report.error(where, `field '${field}' is marked REMOVED but still exists in the ${location} schema`);
  else if (status === "DEPRECATED" && result === "found" && !target?.deprecated) report.error(where, `field '${field}' is DEPRECATED but its schema lacks \`deprecated: true\``);
  if (status === "RENAMED" && findField(doc, schema, schemaPtr!, change.from)[0] === "found") report.warn(where, `RENAMED from '${change.from}' but the old name still exists in the schema`);
}

/** The most severe impact among an operation's changes. */
export const mostSevere = (changes: { impact: Impact }[]): Impact => IMPACTS.find((i) => changes.some((c) => c.impact === i)) ?? "non-breaking";

function validateExtension(instance: Json, definition: string, where: string, report: Report) {
  const validate = extensionValidator(definition);
  if (validate(instance)) return true;
  // The script lists one error per failing rule, deepest first; ajv adds a wrapper "if" error for each failed then-branch.
  for (const err of (validate.errors ?? []).filter((e: ErrorObject) => e.keyword !== "if")) {
    const loc = err.instancePath.replace(/^\//, "");
    report.error(loc ? `${where} ${loc}` : where, err.message ?? "is not valid");
  }
  return false;
}

function checkOperation(doc: Json, o: Op, report: Report) {
  const where = `${o.method.toUpperCase()} ${o.path}`;
  if (!validateExtension(o.op, "operation", where, report)) return false;
  const changes: Json[] = o.op["x-changes"], highest = mostSevere(changes);
  if (o.op["x-impact"] !== highest) report.error(where, `x-impact is '${o.op["x-impact"]}' but the most severe change is '${highest}'`);
  if (!o.op.responses || !Object.keys(o.op.responses).length) report.error(where, "operation documents no responses");
  if (!("security" in o.op) && !("security" in doc)) report.error(where, "declare `security` explicitly (use [] for public endpoints) so auth requirements are part of the contract");
  changes.forEach((change, i) => checkChangeTarget(doc, o, change, `${where} x-changes[${i}]`, report));
  return true;
}

/** How many changes of each impact a changelog records: each global change, each removed operation (breaking), and each operation's changes. */
export function changeCounts(doc: Json): Record<Impact, number> {
  const counts: Record<Impact, number> = { breaking: 0, deprecated: 0, "non-breaking": 0 }, changelog = doc.info?.["x-changelog"] ?? {};
  const count = (c: Json) => { if (IMPACTS.includes(c?.impact)) counts[c.impact as Impact]++; };
  (changelog.globalChanges ?? []).forEach(count);
  counts.breaking += (changelog.removedOperations ?? []).length;
  for (const o of iterOperations(doc)) (Array.isArray(o.op["x-changes"]) ? o.op["x-changes"] : []).forEach(count);
  return counts;
}

/** A changelog with no operation, no global change and no removed operation records nothing. */
export const recordsNothing = (doc: Json) => {
  const changelog = doc.info?.["x-changelog"] ?? {};
  return ![...iterOperations(doc)].length && !changelog.globalChanges?.length && !changelog.removedOperations?.length;
};

function checkExtensions(doc: Json, report: Report) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(doc.openapi ?? ""));
  if (!m || Number(m[1]) < 3 || (Number(m[1]) === 3 && Number(m[2]) < 1)) report.error("/openapi", `'${doc.openapi ?? ""}' - contract-diff documents must use OpenAPI 3.1 or newer`);
  const changelog = doc.info?.["x-changelog"];
  if (changelog === undefined) { report.error("/info", "missing x-changelog"); return; }
  if (!validateExtension(changelog, "changelog", "/info/x-changelog", report)) return;

  if (recordsNothing(doc)) report.warn("/paths", "document records no changes at all");
  let countable = true;
  for (const o of iterOperations(doc)) if (!checkOperation(doc, o, report)) countable = false;
  if (!countable) { report.warn("/info/x-changelog/summary", "not checked until the x-changes errors above are fixed"); return; }
  const counts = changeCounts(doc);
  for (const impact of IMPACTS) {
    if (changelog.summary[impact] !== counts[impact]) report.error("/info/x-changelog/summary", `${impact} is ${changelog.summary[impact]} but the document contains ${counts[impact]}`);
  }
}

function checkExamples(doc: Json, report: Report, only?: Op) {
  const ajv = newAjv(), compiled = new Map<string, ValidateFunction>();
  ajv.addSchema({ ...doc, $id: DOC_URI });
  const validateExample = (value: Json, schemaPtr: string, where: string) => {
    try {
      if (!compiled.has(schemaPtr)) compiled.set(schemaPtr, ajv.compile({ $ref: `${DOC_URI}#${schemaPtr.split("/").map(encodeURIComponent).join("/")}` }));
      const validate = compiled.get(schemaPtr)!;
      if (validate(value)) return;
      for (const err of (validate.errors ?? []).filter((e) => e.keyword !== "if")) {
        const loc = err.instancePath.replace(/^\//, "").split("/").join(".") || "(root)";
        report.error(where, `example does not match schema at ${loc}: ${err.message}`);
      }
    } catch (e: any) { report.error(where, `could not validate example: ${e?.message ?? e}`); }
  };
  const exampleValues = (obj: Json): [string, Json][] => {
    const values: [string, Json][] = [];
    if ("example" in obj) values.push(["example", obj.example]);
    for (const [name, raw] of Object.entries<any>(obj.examples ?? {})) {
      const [ex] = deref(doc, raw, "");
      if (!isObject(ex)) continue;
      const key = ["dataValue", "value"].find((k) => k in ex);
      if (key) values.push([`examples/${name}`, ex[key]]);
    }
    return values;
  };
  const checkContent = (container: Json, containerPtr: string, where: string, required: boolean) => {
    for (const [media, obj] of Object.entries<any>(container?.content ?? {})) {
      if (!isObject(obj) || !("schema" in obj)) continue;
      const values = exampleValues(obj);
      if (!values.length && required && isJsonMedia(media)) report.error(where, `${media} has no example`);
      const schemaPtr = `${containerPtr}/content/${escapePointer(media)}/schema`;
      for (const [label, value] of values) validateExample(value, schemaPtr, `${where} ${media} ${label}`);
    }
  };
  for (const o of iterOperations(doc)) {
    if (only && (o.path !== only.path || o.method !== only.method)) continue;
    const opPtr = `/paths/${escapePointer(o.path)}/${o.method}`, where = `${o.method.toUpperCase()} ${o.path}`;
    const changed = new Set((o.op["x-changes"] ?? []).filter((c: Json) => isObject(c) && String(c.in ?? "").startsWith("response.")).map((c: Json) => String(c.in).split(".", 2)[1]));
    const [body, bodyPtr] = deref(doc, o.op.requestBody, `${opPtr}/requestBody`);
    if (isObject(body)) checkContent(body, bodyPtr!, `${where} requestBody`, true);
    for (const [code, raw] of Object.entries<any>(o.op.responses ?? {})) {
      const [resp, respPtr] = deref(doc, raw, `${opPtr}/responses/${escapePointer(code)}`);
      if (isObject(resp)) checkContent(resp, respPtr!, `${where} response ${code}`, code.startsWith("2") || changed.has(code));
    }
    const pathPtr = `/paths/${escapePointer(o.path)}`;
    for (const [params, paramsPtr] of [[doc.paths[o.path].parameters ?? [], `${pathPtr}/parameters`], [o.op.parameters ?? [], `${opPtr}/parameters`]] as [Json[], string][]) {
      params.forEach((raw, i) => {
        const [p, pPtr] = deref(doc, raw, `${paramsPtr}/${i}`);
        if (isObject(p) && "schema" in p) for (const [label, value] of exampleValues(p)) validateExample(value, `${pPtr}/schema`, `${where} parameter '${p.name}' ${label}`);
      });
    }
  }
}

/** The structural check that stands in for Redocly's lint: the official OpenAPI 3.1 schema. */
function checkStructure(doc: Json, report: Report) {
  const { oas } = sharedAjv();
  if (oas(doc)) return;
  const seen = new Set<string>();
  for (const err of oas.errors ?? []) {
    if (["if", "else", "then", "$dynamicRef"].includes(err.keyword)) continue;
    const text = `${err.instancePath || "/"} ${err.message}${err.keyword === "additionalProperties" ? ` '${err.params.additionalProperty}'` : ""}`;
    if (!seen.has(text)) { seen.add(text); report.error("schema", text); }
  }
}

/** Every check on a whole changelog, as `validate.py <file>` runs them. */
export function validateChangelog(doc: Json): Report {
  const report = new Report();
  if (!isObject(doc) || (doc.paths !== undefined && !isObject(doc.paths))) { report.error("/", "Not an OpenAPI document object"); return report; }
  checkExtensions(doc, report);
  checkRefsAndComponents(doc, report);
  checkExamples(doc, report);
  checkStructure(doc, report);
  return report;
}

/** The checks one operation can pass on its own, while a changelog is still being written: its extensions, targets, refs and examples. */
export function validateOperation(doc: Json, path: string, method: string): Report {
  const report = new Report(), op = doc.paths?.[path]?.[method];
  if (!isObject(op)) { report.error(`${method.toUpperCase()} ${path}`, "no such operation"); return report; }
  checkOperation(doc, { path, method, op }, report);
  checkRefsAndComponents(doc, report, { path, method, op });
  checkExamples(doc, report, { path, method, op });
  return report;
}
