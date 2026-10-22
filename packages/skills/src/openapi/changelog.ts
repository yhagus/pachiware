import { workspaceStore, MAX_BLOB_BYTES, WorkspaceConflict } from "../workspace/store.js";
import { placeRoot, resolvePath } from "../workspace/paths.js";
import { checkThreadWrite } from "../workspace/threads.js";
import { browseTree, compareRefs, defaultBranch, EMPTY_TREE, lastCommitBy, type GitConn } from "../git.js";
import { DEFAULT_TIMEZONE, isoInZone, zonedTime } from "../clock.js";
import { HTTP_METHODS, IMPACTS, OPENAPI_VERSION, escapePointer, iterOperations, mostSevere, resolveLocal, validateChangelog, validateOperation, type Impact } from "./validate.js";
import type { SkillContext } from "../types.js";

/**
 * An API changelog in the making (contract-diff): an OpenAPI document kept as a draft beside where the changelog will be, built one
 * operation at a time so a model with a small output limit can write a large one, and a turn cut midway loses nothing. The tools own
 * the counts: each operation's `x-impact` and the `summary` are computed here, never written by the model.
 */

export type Scope = "all" | "range";
type Revision = { ref: string; commit: string };
/** What a draft remembers of how it was started, so a second start of the same changelog finds it. Removed when the changelog is written. */
type DraftMeta = { repo: string; account?: string; branch: string; scope: Scope; from?: string; to: string };
type Json = any;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const short = (sha: string) => sha.slice(0, 7);
const FOLDER = "files/changelogs";
const DRAFT = /^(?:channel|thread|dm)\/files\/changelogs\/[^/]+\/[^/]+\.draft\.json$/;

/** The day a date argument names, checked: YYYY-MM-DD and a real day. */
function day(value: unknown, name: string) {
  if (typeof value !== "string" || !DATE.test(value.trim()) || Number.isNaN(Date.parse(`${value.trim()}T00:00:00Z`)) || new Date(`${value.trim()}T00:00:00Z`).toISOString().slice(0, 10) !== value.trim()) {
    throw new Error(`${name} must be a date written YYYY-MM-DD.`);
  }
  return value.trim();
}

/**
 * The strict guard: what a changelog covers is the person's choice, never a default. `all` is the whole history; `range` needs `from`,
 * and `to` is today unless given. Dates are days in the place's time zone, none after today.
 */
export function changelogScope(args: { scope?: unknown; from?: unknown; to?: unknown }, today: string): { scope: Scope; from?: string; to: string } {
  if (args.scope !== "all" && args.scope !== "range") throw new Error("Ask the person first whether the changelog covers the whole history (scope all) or part of it (scope range, from one date to another), and wait for the answer. Never choose for them.");
  const to = args.to === undefined || args.to === null || args.to === "" ? today : day(args.to, "to");
  if (to > today) throw new Error(`to is after today (${today}).`);
  if (args.scope === "all") {
    if (args.from !== undefined && args.from !== null && args.from !== "") throw new Error("scope all covers the whole history; from is only for a range.");
    return { scope: "all", to };
  }
  if (args.from === undefined || args.from === null || args.from === "") throw new Error("A range needs from, the first day it covers (YYYY-MM-DD). Ask the person for it.");
  const from = day(args.from, "from");
  if (from > to) throw new Error(`from (${from}) is after to (${to}).`);
  return { scope: "range", from, to };
}

/**
 * The two commits a changelog compares, on `branch`: head is the last commit on or before the end of `to`; base is the last commit before
 * `from` begins, or Git's empty tree when the range starts before the first commit or the changelog covers the whole history.
 * Equal commits mean nothing changed.
 */
export async function changelogRevisions(conn: GitConn, repo: string, branch: string, covers: { scope: Scope; from?: string; to: string }, timezone: string) {
  const at = (wall: string, shift = 0) => isoInZone(timezone, zonedTime(timezone, wall)! + shift);
  const head = await lastCommitBy(conn, repo, branch, at(`${covers.to}T23:59:59`));
  if (!head) throw new Error(`${branch} has no commit on or before ${covers.to}.`);
  const before = covers.scope === "range" ? await lastCommitBy(conn, repo, branch, at(`${covers.from}T00:00:00`, -1000)) : null;
  if (before?.sha === head.sha) throw new Error(`No commit on ${branch} from ${covers.from} to ${covers.to}: nothing changed, so there is no changelog to write.`);
  const base: Revision = before ? { ref: `${branch} before ${covers.from}`, commit: before.sha } : { ref: "(empty)", commit: EMPTY_TREE };
  return { base, head: { ref: covers.scope === "range" ? `${branch} through ${covers.to}` : branch, commit: head.sha, date: head.date } };
}

// One draft is changed by one call at a time in this process: a model may call putChangelogOperation several times at once.
const queues = new Map<string, Promise<unknown>>();
function serial<T>(key: string, job: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(job, job);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

async function readJson(tenantId: string, full: string): Promise<{ doc: Json; version: string } | null> {
  const file = await workspaceStore().readBytes(tenantId, full);
  if (!file) return null;
  try { return { doc: JSON.parse(new TextDecoder().decode(file.bytes)), version: file.version }; } catch { throw new Error(`${full.split("/").pop()} is not valid JSON.`); }
}
const writeJson = (tenantId: string, full: string, doc: Json, version?: string) =>
  workspaceStore().write(tenantId, full, `${JSON.stringify(doc, null, 2)}\n`, version, { maxBytes: MAX_BLOB_BYTES });

/** A draft the place's own folder holds, by the path the tools gave: its store path, refused anywhere else. */
function draftPath(ctx: SkillContext, draft: unknown) {
  if (typeof draft !== "string" || !DRAFT.test(draft.trim())) throw new Error('draft must be the path startChangelog returned, e.g. "channel/files/changelogs/acme-api/2026-10-22_1a2b3c4..5d6e7f8.draft.json".');
  const full = resolvePath(ctx, draft.trim());
  checkThreadWrite(ctx, full);
  return full;
}

/** "GET /users (breaking)" for each operation a draft holds. */
const operationsOf = (doc: Json) => [...iterOperations(doc)].map((o) => `${o.method.toUpperCase()} ${o.path} (${o.op["x-impact"] ?? "no changes yet"})`);

/** Where a changelog of `repo` lives in this place, and its file names for these revisions. */
function placeOf(ctx: SkillContext, repo: string, base: Revision, head: Revision, today: string) {
  const root = placeRoot(ctx);
  if (!root) throw new Error("A changelog is kept in a channel's, a thread's or a DM's folder, and this place has none.");
  const folder = `${root}/${FOLDER}/${repo.replace(/\//g, "-")}`, stem = `${short(base.commit)}..${short(head.commit)}`;
  return { folder, stem, draft: `${folder}/${today}_${stem}.draft.json` };
}

export async function startChangelog(ctx: SkillContext, conn: GitConn, repo: string, args: { account?: string; branch?: unknown; scope?: unknown; from?: unknown; to?: unknown }) {
  const timezone = ctx.timezone ?? DEFAULT_TIMEZONE, today = isoInZone(timezone).slice(0, 10);
  const covers = changelogScope(args, today);
  const branch = typeof args.branch === "string" && args.branch.trim() ? args.branch.trim() : await defaultBranch(conn, repo);
  const { base, head } = await changelogRevisions(conn, repo, branch, covers, timezone);
  const at = placeOf(ctx, repo, base, { ref: head.ref, commit: head.commit }, today);
  const names = (await workspaceStore().list(ctx.tenantId, resolvePath(ctx, at.folder, true))).map((e) => e.path.split("/").pop()!);
  const draftName = names.find((n) => n.endsWith(`_${at.stem}.draft.json`)), written = names.find((n) => n.endsWith(`_${at.stem}.json`));
  const draft = draftName ? `${at.folder}/${draftName}` : at.draft, full = resolvePath(ctx, draft);
  checkThreadWrite(ctx, full);

  let resumed: string[] | undefined;
  await serial(`${ctx.tenantId}/${full}`, async () => {
    const found = await readJson(ctx.tenantId, full);
    if (found) { resumed = operationsOf(found.doc); return; }
    const meta: DraftMeta = { repo, ...(args.account ? { account: args.account } : {}), branch, scope: covers.scope, ...(covers.from ? { from: covers.from } : {}), to: covers.to };
    await writeJson(ctx.tenantId, full, {
      openapi: OPENAPI_VERSION,
      info: { title: `${repo} API changes`, version: short(head.commit), "x-changelog": { date: today, base: { ref: base.ref, commit: short(base.commit) }, head: { ref: head.ref, commit: short(head.commit) }, summary: { breaking: 0, deprecated: 0, "non-breaking": 0 }, globalChanges: [], removedOperations: [], unverified: [] } },
      paths: {}, components: {}, "x-draft": meta,
    });
  });

  // From the empty tree every file of head is new; otherwise the comparison lists what changed.
  const fromNothing = base.commit === EMPTY_TREE;
  const files = fromNothing ? await browseTree(conn, repo, head.commit, undefined, 1) : await compareRefs(conn, repo, base.commit, head.commit, 1);
  return {
    draft, repo, branch, scope: covers.scope, ...(covers.from ? { from: covers.from } : {}), to: covers.to,
    base: { ...base, commit: fromNothing ? "empty tree" : base.commit }, head,
    ...(fromNothing ? { note: "Nothing came before this changelog: every endpoint of head is NEW. Read head only." } : {}),
    changedFiles: fromNothing
      ? { files: (files as any).files, totalFiles: (files as any).totalFiles, ...((files as any).nextPage ? { more: `repoTree with ref ${head.commit} and page ${(files as any).nextPage}` } : {}) }
      : { commits: (files as any).ahead, files: (files as any).files, totalFiles: (files as any).totalFiles, ...((files as any).nextPage ? { more: `repoCompare from ${base.commit} to ${head.commit} with page ${(files as any).nextPage}` } : {}), ...((files as any).filesCapped ? { capped: (files as any).filesCapped } : {}) },
    ...(resumed ? { resumed: { operations: resumed, note: "This changelog was started before; its operations so far are kept. Go on with the endpoints not yet recorded." } } : {}),
    ...(written ? { alreadyWritten: `${at.folder}/${written}`, alreadyNote: "A changelog of these same commits was written before. Offer it with sendFiles unless the person asked to write it again." } : {}),
  };
}

const METHODS = new Set<string>(HTTP_METHODS);

/** Adds or replaces one operation of a draft (null removes it), with the components it brings; returns that operation's own problems. */
export async function putOperation(ctx: SkillContext, args: { draft?: unknown; method?: unknown; path?: unknown; operation?: unknown; components?: unknown }) {
  const full = draftPath(ctx, args.draft);
  const method = typeof args.method === "string" ? args.method.trim().toLowerCase() : "";
  if (!METHODS.has(method)) throw new Error(`method must be one of ${[...METHODS].join(", ")}.`);
  const path = typeof args.path === "string" ? args.path.trim() : "";
  if (!path.startsWith("/")) throw new Error('path must be the endpoint\'s full path, starting with "/", e.g. "/api/v2/users/{id}".');
  const operation = args.operation;
  if (operation !== null && (typeof operation !== "object" || Array.isArray(operation))) throw new Error("operation must be the whole OpenAPI operation object, or null to remove it.");
  if (args.components !== undefined && (typeof args.components !== "object" || args.components === null || Array.isArray(args.components))) throw new Error('components must be an object such as {"schemas": {"User": {...}}}.');
  const changes = (operation as Json)?.["x-changes"];
  if (operation && (!Array.isArray(changes) || !changes.length)) throw new Error("operation needs x-changes, at least one entry saying what changed. An endpoint whose contract did not change does not belong in the changelog.");

  return serial(`${ctx.tenantId}/${full}`, async () => {
    const found = await readJson(ctx.tenantId, full);
    if (!found) throw new Error("No such draft: start it with startChangelog.");
    const doc = found.doc, where = `${method.toUpperCase()} ${path}`;
    doc.paths ??= {};
    if (operation === null) {
      if (doc.paths[path]) { delete doc.paths[path][method]; if (!Object.keys(doc.paths[path]).some((k) => METHODS.has(k))) delete doc.paths[path]; }
    } else {
      const op = { ...(operation as Json) };
      if (changes.every((c: Json) => IMPACTS.includes(c?.impact))) op["x-impact"] = mostSevere(changes);
      doc.paths[path] = { ...(doc.paths[path] ?? {}), [method]: op };
      for (const [section, entries] of Object.entries<Json>((args.components as Json) ?? {})) {
        if (entries && typeof entries === "object") doc.components = { ...(doc.components ?? {}), [section]: { ...(doc.components?.[section] ?? {}), ...entries } };
      }
    }
    await writeJson(ctx.tenantId, full, doc, found.version);
    const operations = operationsOf(doc);
    if (operation === null) return { removed: where, operations };
    const report = validateOperation(doc, path, method);
    return {
      saved: where, impact: doc.paths[path][method]["x-impact"], operations: operations.length,
      ...(report.errors.length ? { problems: report.errors, fix: "Send the whole operation again with putChangelogOperation; finishChangelog refuses while any problem remains." } : {}),
      ...(report.warnings.length ? { warnings: report.warnings } : {}),
    };
  });
}

/** Adds or replaces shared components (schemas, responses, parameters, securitySchemes, ...) by name, for operations to $ref. */
export async function putComponents(ctx: SkillContext, args: { draft?: unknown; components?: unknown }) {
  const full = draftPath(ctx, args.draft), components = args.components;
  if (!components || typeof components !== "object" || Array.isArray(components) || !Object.values(components).every((v) => v && typeof v === "object" && !Array.isArray(v))) {
    throw new Error('components must be an object of sections, e.g. {"schemas": {"User": {...}}, "securitySchemes": {"bearerAuth": {...}}}.');
  }
  return serial(`${ctx.tenantId}/${full}`, async () => {
    const found = await readJson(ctx.tenantId, full);
    if (!found) throw new Error("No such draft: start it with startChangelog.");
    const doc = found.doc;
    for (const [section, entries] of Object.entries<Json>(components)) doc.components = { ...(doc.components ?? {}), [section]: { ...(doc.components?.[section] ?? {}), ...entries } };
    await writeJson(ctx.tenantId, full, doc, found.version);
    return { saved: Object.entries<Json>(components).flatMap(([section, entries]) => Object.keys(entries).map((name) => `#/components/${section}/${name}`)) };
  });
}

/** Sets what a changelog says beyond its operations: changes to every endpoint, removed endpoints, what the code could not settle, and its title. */
export async function putNotes(ctx: SkillContext, args: { draft?: unknown; globalChanges?: unknown; removedOperations?: unknown; unverified?: unknown; title?: unknown; description?: unknown }) {
  const full = draftPath(ctx, args.draft);
  for (const key of ["globalChanges", "removedOperations", "unverified"] as const) if (args[key] !== undefined && !Array.isArray(args[key])) throw new Error(`${key} must be a list.`);
  return serial(`${ctx.tenantId}/${full}`, async () => {
    const found = await readJson(ctx.tenantId, full);
    if (!found) throw new Error("No such draft: start it with startChangelog.");
    const doc = found.doc, changelog = doc.info["x-changelog"];
    for (const key of ["globalChanges", "removedOperations", "unverified"] as const) if (args[key] !== undefined) changelog[key] = args[key];
    if (typeof args.title === "string" && args.title.trim()) doc.info.title = args.title.trim();
    if (typeof args.description === "string") { if (args.description.trim()) doc.info.description = args.description.trim(); else delete doc.info.description; }
    await writeJson(ctx.tenantId, full, doc, found.version);
    return { saved: true, globalChanges: changelog.globalChanges.length, removedOperations: changelog.removedOperations.length, unverified: changelog.unverified.length };
  });
}

/** The components the paths reach, through $refs at any depth; the rest are left out of the written changelog. */
function reachedComponents(doc: Json) {
  const reached = new Set<string>(), queue: Json[] = [doc.paths ?? {}];
  const visit = (node: Json) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") {
      if (typeof node.$ref === "string" && node.$ref.startsWith("#/components/") && !reached.has(node.$ref)) {
        reached.add(node.$ref);
        const [target] = resolveLocal(doc, node.$ref);
        if (target !== null) queue.push(target);
      }
      for (const v of Object.values(node)) visit(v);
    }
  };
  while (queue.length) visit(queue.shift());
  return reached;
}

/** One line per breaking change, as the report lists them. */
function breakingLines(doc: Json) {
  const changelog = doc.info["x-changelog"], lines: string[] = [];
  const moved = (c: Json) => (typeof c.before === "string" && typeof c.after === "string" ? ` ${c.before} → ${c.after}` : "");
  const line = (where: string, c: Json) => `${where}: ${c.status} ${c.in}${c.field ? ` ${c.field}` : ""}${c.code ? ` ${c.code}` : ""}${c.from ? ` (was ${c.from})` : ""}${moved(c)}${c.note ? `: ${c.note}` : ""}`;
  for (const c of changelog.globalChanges ?? []) if (c.impact === "breaking") lines.push(line("every endpoint", c));
  for (const r of changelog.removedOperations ?? []) lines.push(`${String(r.method).toUpperCase()} ${r.path}: REMOVED${r.replacedBy ? ` (replaced by ${r.replacedBy})` : ""}`);
  for (const o of iterOperations(doc)) for (const c of o.op["x-changes"] ?? []) if (c.impact === "breaking") lines.push(line(`${o.method.toUpperCase()} ${o.path}`, c));
  return lines;
}

/**
 * Writes the changelog when the draft is a valid one: counts the summary, sets each operation's x-impact, leaves out the components no
 * path reaches, and runs the whole validator. With errors the draft stays and they come back to fix; with none the `.json` is written
 * beside it and the draft goes. A draft that records no change writes nothing.
 */
export async function finishChangelog(ctx: SkillContext, args: { draft?: unknown }) {
  const full = draftPath(ctx, args.draft), shown = String(args.draft).trim();
  return serial(`${ctx.tenantId}/${full}`, async () => {
    const found = await readJson(ctx.tenantId, full);
    if (!found) throw new Error("No such draft: start it with startChangelog.");
    const { "x-draft": _, ...doc } = found.doc, changelog = doc.info["x-changelog"];
    const operations = [...iterOperations(doc)];
    if (!operations.length && !changelog.globalChanges?.length && !changelog.removedOperations?.length) {
      await workspaceStore().remove(ctx.tenantId, full);
      return { written: false, note: "The draft records no frontend-visible change, so no changelog was written; the draft is gone. Say so, with what was examined." };
    }
    const summary: Record<Impact, number> = { breaking: 0, deprecated: 0, "non-breaking": 0 };
    for (const c of changelog.globalChanges ?? []) if (IMPACTS.includes(c?.impact)) summary[c.impact as Impact]++;
    summary.breaking += (changelog.removedOperations ?? []).length;
    for (const o of operations) {
      const changes = Array.isArray(o.op["x-changes"]) ? o.op["x-changes"] : [];
      if (changes.length && changes.every((c: Json) => IMPACTS.includes(c?.impact))) o.op["x-impact"] = mostSevere(changes);
      for (const c of changes) if (IMPACTS.includes(c?.impact)) summary[c.impact as Impact]++;
    }
    changelog.summary = summary;
    const reached = reachedComponents(doc), named = new Set(operations.flatMap((o) => (o.op.security ?? []).flatMap((r: Json) => Object.keys(r ?? {}))));
    for (const [section, entries] of Object.entries<Json>(doc.components ?? {})) {
      for (const name of Object.keys(entries ?? {})) if (section === "securitySchemes" ? !named.has(name) : !reached.has(`#/components/${section}/${escapePointer(name)}`)) delete entries[name];
      if (!Object.keys(entries ?? {}).length) delete doc.components[section];
    }
    if (!Object.keys(doc.components ?? {}).length) delete doc.components;

    const report = validateChangelog(doc);
    if (report.errors.length) {
      return { written: false, errors: report.errors, ...(report.warnings.length ? { warnings: report.warnings } : {}), fix: "Fix each error (putChangelogOperation or putChangelogNotes) and call finishChangelog again." };
    }
    const path = shown.replace(/\.draft\.json$/, ".json"), target = resolvePath(ctx, path);
    try { await writeJson(ctx.tenantId, target, doc, (await workspaceStore().readBytes(ctx.tenantId, target))?.version); }
    catch (e) { if (e instanceof WorkspaceConflict) throw new Error(`${path} changed while it was being written; call finishChangelog again.`); throw e; }
    await workspaceStore().remove(ctx.tenantId, full);
    return {
      written: true, path, summary, breaking: breakingLines(doc), unverified: [...(changelog.unverified ?? []), ...operations.flatMap((o) => (o.op["x-unverified"] ?? []).map((u: Json) => ({ operation: `${o.method.toUpperCase()} ${o.path}`, ...u })))],
      ...(report.warnings.length ? { warnings: report.warnings } : {}),
      validation: "0 errors: the contract-diff checks and the OpenAPI 3.1 schema.",
    };
  });
}
