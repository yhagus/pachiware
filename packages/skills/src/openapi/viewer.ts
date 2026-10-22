import { iterOperations } from "./validate.js";

/**
 * An OpenAPI document as an API preview's viewer shows it. The viewer (Scalar) draws no `x-changes`, so a changelog's are spelled
 * out where it does draw: each changed operation gets badges for its impact and whether it is new, and a table of its changes at the
 * top of its description; the document's description opens with the changelog's summary, its changes to every endpoint, its removed
 * endpoints and what the code could not settle. A document without `x-changelog` is shown as it is. The published document itself
 * is never changed: this is a copy, and `download` links to the original.
 */
type Json = any;

const BADGES = {
  breaking: { name: "Breaking", color: "#cf222e" },
  deprecated: { name: "Deprecated", color: "#9a6700" },
  new: { name: "New", color: "#1a7f37" },
  changed: { name: "Changed", color: "#0969da" },
};

/** A table cell: one line, pipes escaped. */
const cell = (v: unknown) => String(v ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
const code = (v: unknown) => (v === undefined || v === null || v === "" ? "" : `\`${cell(typeof v === "string" ? v : JSON.stringify(v)).replace(/`/g, "'")}\``);

function details(c: Json) {
  const parts: string[] = [];
  if (c.before !== undefined || c.after !== undefined) parts.push(`${code(c.before) || "none"} → ${code(c.after) || "none"}`);
  if (c.code) parts.push(`error ${code(c.code)}`);
  if (c.removal) parts.push(`removed ${cell(c.removal)}`);
  if (c.note) parts.push(cell(c.note));
  return parts.join("; ");
}

function changesTable(changes: Json[]) {
  const rows = changes.map((c) => `| ${cell(c.status)} | ${cell(c.in)} | ${c.field ? code(c.field) : ""}${c.from ? ` (was ${code(c.from)})` : ""} | ${cell(c.impact)} | ${details(c)} |`);
  return ["| Change | Where | Field | Impact | Details |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

const unverifiedList = (items: Json[]) => items.map((u) => `- ${cell(u.in)}${u.field ? ` ${code(u.field)}` : ""}: ${cell(u.reason)}`).join("\n");
const join = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join("\n\n");

export function forViewer(doc: Json, { download }: { download?: string } = {}): Json {
  const changelog = doc?.info?.["x-changelog"];
  if (!changelog || typeof changelog !== "object") return doc;
  const view = structuredClone(doc);
  for (const { op } of iterOperations(view)) {
    const changes: Json[] = Array.isArray(op["x-changes"]) ? op["x-changes"] : [];
    if (!changes.length) continue;
    const isNew = changes.some((c) => c.status === "NEW" && c.in === "operation");
    const impact = BADGES[op["x-impact"] as "breaking" | "deprecated"];
    op["x-badges"] = [...(impact ? [{ ...impact, position: "before" }] : []), { ...(isNew ? BADGES.new : BADGES.changed), position: "before" }];
    const unverified: Json[] = Array.isArray(op["x-unverified"]) ? op["x-unverified"] : [];
    op.description = join(`**Changes**\n\n${changesTable(changes)}`, unverified.length > 0 && `**Not verified**\n\n${unverifiedList(unverified)}`, op.description);
  }
  const s = changelog.summary ?? {}, rev = (r: Json) => `${code(r?.ref)} (${code(r?.commit)})`;
  const removed: Json[] = changelog.removedOperations ?? [], global: Json[] = changelog.globalChanges ?? [], unverified: Json[] = changelog.unverified ?? [];
  view.info.description = join(
    `**Changelog** of ${cell(changelog.date)}: from ${rev(changelog.base)} to ${rev(changelog.head)}.`,
    `**${s.breaking ?? 0}** breaking · **${s.deprecated ?? 0}** deprecated · **${s["non-breaking"] ?? 0}** non-breaking`,
    global.length > 0 && `### Changes to every endpoint\n\n${changesTable(global)}`,
    removed.length > 0 && `### Removed endpoints\n\n${removed.map((r) => `- ${code(`${String(r.method).toUpperCase()} ${r.path}`)}${r.replacedBy ? `, replaced by ${code(r.replacedBy)}` : ""}${r.note ? `: ${cell(r.note)}` : ""}`).join("\n")}`,
    unverified.length > 0 && `### Not verified\n\n${unverifiedList(unverified)}`,
    download && `[Download the OpenAPI JSON](${download})`,
    view.info.description,
  );
  return view;
}
