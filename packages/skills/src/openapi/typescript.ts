import { iterOperations, resolveLocal, deref } from "./validate.js";

type Json = any;

/**
 * TypeScript types for an API preview's request bodies and responses. The viewer (Scalar) shows each operation's body and each
 * response as a list of properties; this gives the viewer, per operation, the same shapes as copy-ready TypeScript so a reader can
 * paste `{ name: string | null | undefined; ... }` straight into their code. $refs are inlined so each type stands on its own; a
 * property that is not required gets `| undefined`, and a nullable one gets `| null`. Only the first JSON media type is used.
 */

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const isRef = (v: unknown): v is { $ref: string } => isObject(v) && typeof v.$ref === "string";
const isJsonMedia = (media: string) => media.toLowerCase().includes("json");

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** A property key, quoted only when it is not a plain identifier. */
const propKey = (name: string) => (IDENT.test(name) ? name : JSON.stringify(name));
/** A TypeScript identifier from a free-form name, so `type <name>` always parses. */
const ident = (name: string) => {
  const cleaned = name.replace(/[^A-Za-z0-9_$]+/g, "_").replace(/^_+|_+$/g, "");
  return !cleaned || /^[0-9]/.test(cleaned) ? `T_${cleaned || "type"}` : cleaned;
};
/** The last segment of a local `$ref`, e.g. `#/components/schemas/Invoice` → `Invoice`. */
const refName = (ref: unknown) => (typeof ref === "string" && ref.startsWith("#") ? decodeURIComponent(ref.split("/").pop() ?? "") : null);
/** PascalCase from any words, for a fallback type name. */
const pascal = (s: string) => s.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : "")).join("") || "Type";

const literal = (v: unknown): string => {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return String(v);
  return "unknown";
};
const union = (parts: string[]) => [...new Set(parts.filter(Boolean))].join(" | ");
const parened = (s: string) => (/[ |&]/.test(s) ? `(${s})` : s);

/** A schema as a TypeScript type. `stack` holds the `$ref`s being inlined above here, so a cycle falls back to the type's name. */
function tsType(doc: Json, schema: Json, indent: string, stack: Set<string>): string {
  if (isRef(schema)) {
    const name = ident(refName(schema.$ref) ?? "unknown");
    if (stack.has(schema.$ref)) return name;
    const [target] = resolveLocal(doc, schema.$ref);
    return isObject(target) ? tsType(doc, target, indent, new Set(stack).add(schema.$ref)) : name;
  }
  if (!isObject(schema)) return "unknown";

  if (Array.isArray(schema.allOf) && schema.allOf.length) return nullable(schema, schema.allOf.map((s: Json) => parened(tsType(doc, s, indent, stack))).join(" & "));
  const composed = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(composed) && composed.length) return nullable(schema, union(composed.map((s: Json) => tsType(doc, s, indent, stack))));
  if ("const" in schema) return nullable(schema, literal(schema.const));
  if (Array.isArray(schema.enum) && schema.enum.length) return nullable(schema, union(schema.enum.map(literal)));

  let types: string[] = Array.isArray(schema.type) ? schema.type.slice() : typeof schema.type === "string" ? [schema.type] : [];
  const nullableType = types.includes("null") || schema.nullable === true;
  types = types.filter((t) => t !== "null");
  if (!types.length) types = schema.properties || schema.additionalProperties !== undefined ? ["object"] : schema.items ? ["array"] : [];

  const base = types.length ? union(types.map((t) => baseType(doc, schema, t, indent, stack))) : "unknown";
  return nullableType ? union([base, "null"]) : base;
}

/** Appends `| null` when the schema is nullable, for the branches that do not go through the type list. */
function nullable(schema: Json, body: string): string {
  const isNull = schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes("null"));
  return isNull ? union([body, "null"]) : body;
}

function baseType(doc: Json, schema: Json, type: string, indent: string, stack: Set<string>): string {
  switch (type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const item = schema.items ? tsType(doc, schema.items, indent, stack) : "unknown";
      return `${parened(item)}[]`;
    }
    case "object":
      return objectType(doc, schema, indent, stack);
    default:
      return "unknown";
  }
}

function objectType(doc: Json, schema: Json, indent: string, stack: Set<string>): string {
  const props = isObject(schema.properties) ? schema.properties : {};
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  const inner = indent + "  ";
  const lines: string[] = [];
  for (const [name, propSchema] of Object.entries(props)) {
    const value = required.has(name) ? tsType(doc, propSchema, inner, stack) : union([tsType(doc, propSchema, inner, stack), "undefined"]);
    lines.push(`${inner}${propKey(name)}: ${value};`);
  }
  const extra = schema.additionalProperties;
  if (isObject(extra)) {
    const value = tsType(doc, extra, inner, stack);
    if (!lines.length) return `Record<string, ${value}>`;
    lines.push(`${inner}[key: string]: ${value};`);
  } else if (extra === true && !lines.length) {
    return "Record<string, unknown>";
  }
  if (!lines.length) return "Record<string, unknown>";
  return `{\n${lines.join("\n")}\n${indent}}`;
}

/** A named declaration: an `interface` for a plain object, a `type` alias otherwise. */
function declare(doc: Json, schema: Json, fallback: string): string {
  const name = ident(isRef(schema) ? refName(schema.$ref) ?? fallback : fallback);
  const body = tsType(doc, schema, "", new Set());
  return body.startsWith("{") && body.endsWith("}") ? `interface ${name} ${body}` : `type ${name} = ${body};`;
}

/** The schema of the first JSON media type in a requestBody or response object (either of which may itself be a `$ref`). */
function jsonSchema(doc: Json, container: Json): Json | null {
  const [resolved] = deref(doc, container, "");
  if (!isObject(resolved)) return null;
  for (const [media, obj] of Object.entries<any>(resolved.content ?? {})) if (isJsonMedia(media) && isObject(obj) && "schema" in obj) return obj.schema;
  return null;
}

export type OperationTypes = { request?: string; responses: Record<string, string> };

/** Per operation (keyed `"<METHOD> <path>"`, matching the viewer's section ids), the TypeScript for its body and each response. */
export function typesForViewer(doc: Json): { operations: Record<string, OperationTypes> } {
  const operations: Record<string, OperationTypes> = {};
  for (const { path, method, op } of iterOperations(doc)) {
    const base = pascal(typeof op.operationId === "string" && op.operationId ? op.operationId : `${method} ${path}`);
    const entry: OperationTypes = { responses: {} };

    const requestSchema = op.requestBody ? jsonSchema(doc, op.requestBody) : null;
    if (requestSchema) entry.request = declare(doc, requestSchema, `${base}Request`);

    for (const [status, response] of Object.entries<any>(op.responses ?? {})) {
      const schema = jsonSchema(doc, response);
      if (schema) entry.responses[status] = declare(doc, schema, `${base}Response${/^\d/.test(status) ? status : ""}`);
    }

    if (entry.request || Object.keys(entry.responses).length) operations[`${method.toUpperCase()} ${path}`] = entry;
  }
  return { operations };
}
