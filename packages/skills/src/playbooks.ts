import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve, sep } from "node:path";
import { checkSegments, safeId } from "./workspace/paths.js";
import { workspaceStore, WorkspaceConflict } from "./workspace/store.js";

/** Built-ins ship with the code; a tenant's own playbooks live under this Workspace folder and win by name. */
export const BUILTIN_PLAYBOOKS_DIR = fileURLToPath(new URL("../playbooks/", import.meta.url));
export const TENANT_PLAYBOOKS_DIR = "shared/playbooks";
export const PLAYBOOK_FILE = "PLAYBOOK.md";

export interface Playbook {
  /** The folder name; a tenant playbook with the same name overrides the built-in. */
  name: string;
  description: string;
  /** Message context-menu command label (Discord allows 1-32 characters). */
  menu: string | null;
  /** Words that start the playbook when the bot is mentioned with `word:` first. */
  words: string[];
  requires: string[];
  optional: string[];
  /** `default: off`: off for the tenant until a tenant rule says on (ADR 0005). */
  defaultOff: boolean;
  /** Tools withheld in the playbook's threads; a name no tool has is ignored. */
  closes: string[];
  /** Playbooks whose bodies join this one's prompt at start, bringing their required skills and closed tools. */
  loads: string[];
  /** False for a reference: no menu or trigger word, so it is only ever loaded by another playbook. */
  start: boolean;
  /** `run: in-place` answers where the playbook was started; the default `thread` opens and binds a playbook thread. */
  run: "thread" | "in-place";
  /** `repository: required`: the playbook cannot start where git scope allows no repository (ADR 0007). */
  repository?: "required";
  body: string;
  source: "builtin" | "tenant";
}

/** `key: value` per line; a value is JSON when it parses (which keeps it valid YAML), else the bare text. */
export function parseFrontmatter(text: string): { fields: Record<string, unknown>; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fields: Record<string, unknown> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const raw = line.slice(i + 1).trim();
    try { fields[line.slice(0, i).trim()] = JSON.parse(raw); } catch { fields[line.slice(0, i).trim()] = raw; }
  }
  return { fields, body: m[2]! };
}

export const renderFrontmatter = (fields: Record<string, unknown>, body: string) =>
  `---\n${Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n${body}`;

const list = (v: unknown) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
const WORD = /^[\p{L}\p{N}_-]{1,32}$/u;

/** A playbook file, or null when it is not one: a broken file is skipped, never half-trusted. */
export function parsePlaybook(name: string, text: string, source: Playbook["source"]): Playbook | null {
  const parsed = parseFrontmatter(text);
  if (!parsed || !parsed.body.trim()) return null;
  const f = parsed.fields, trigger = typeof f.trigger === "object" && f.trigger ? f.trigger as Record<string, unknown> : { word: f.trigger };
  const start = f.start !== false && f.start !== "false";
  const menu = start && typeof trigger.menu === "string" && trigger.menu.trim() ? trigger.menu.trim().slice(0, 32) : null;
  return {
    name, source, menu, start, body: parsed.body.trim(),
    description: typeof f.description === "string" ? f.description : "",
    words: start ? list(trigger.word ?? trigger.words).map((w) => w.toLowerCase()).filter((w) => WORD.test(w)) : [],
    requires: list(f.requires), optional: list(f.optional), closes: list(f.closes), loads: list(f.loads), defaultOff: f.default === "off",
    run: f.run === "in-place" ? "in-place" : "thread",
    ...(f.repository === "required" ? { repository: "required" as const } : {}),
  };
}

/** How many loads deep a chain may go: wayfinder -> grill-with-docs -> grilling is two. */
export const MAX_LOAD_DEPTH = 3;
export type ChainProblem = { cycle: string[] } | { tooDeep: string[] } | { missing: string };
/** What is wrong with a chain, said after the playbook's name: "wayfinder loads itself through ...". */
export const chainProblemText = (p: ChainProblem) =>
  "cycle" in p ? `loads itself through ${p.cycle.join(" -> ")}` : "tooDeep" in p ? `has a chain deeper than ${MAX_LOAD_DEPTH}: ${p.tooDeep.join(" -> ")}` : `loads ${p.missing}, which does not exist`;

type Loader = Pick<Playbook, "name" | "loads">;
/** The playbooks a start brings in, the started one first and each loaded one once in load order, or the first problem on the way. `all` is every playbook of the tenant. */
export function playbookChain(root: Loader, all: Loader[]): { chain: string[] } | { problem: ChainProblem } {
  const chain: string[] = [];
  const walk = (p: Loader, path: string[]): ChainProblem | null => {
    if (!chain.includes(p.name)) chain.push(p.name);
    const at = [...path, p.name];
    for (const name of p.loads) {
      if (at.includes(name)) return { cycle: [...at, name] };
      if (at.length > MAX_LOAD_DEPTH) return { tooDeep: [...at, name] };
      const loaded = all.find((x) => x.name === name);
      const problem = loaded ? walk(loaded, at) : { missing: name };
      if (problem) return problem;
    }
    return null;
  };
  const problem = walk(root, []);
  return problem ? { problem } : { chain };
}

/** The tenant playbook a Workspace path names, as its folder or its PLAYBOOK.md; null for any other path. */
export function tenantPlaybookAt(path: string): { name: string; file: boolean } | null {
  const m = new RegExp(`^${TENANT_PLAYBOOKS_DIR}/([^/]+)(/${PLAYBOOK_FILE})?$`).exec(path);
  return m ? { name: m[1]!, file: !!m[2] } : null;
}

/**
 * Why saving `content` at `path` would break a chain: a cycle, or a chain deeper than MAX_LOAD_DEPTH, that was not there before,
 * the saved playbook's own chain checked first. A load of a playbook that does not exist yet is allowed; the start refuses it.
 */
export async function playbookSaveProblem(tenantId: string, path: string, content: string): Promise<string | null> {
  const at = tenantPlaybookAt(path);
  const saved = at?.file && parsePlaybook(at.name, content, "tenant");
  if (!saved) return null;
  const before = await listPlaybooks(tenantId), after = [saved, ...before.filter((p) => p.name !== saved.name)];
  const broken = (p: Loader, all: Loader[]) => { const found = playbookChain(p, all); return "problem" in found && !("missing" in found.problem) ? chainProblemText(found.problem) : null; };
  for (const p of after) {
    const problem = broken(p, after), old = before.find((x) => x.name === p.name);
    if (problem && (!old || broken(old, before) !== problem)) return `${p.name} ${problem}`;
  }
  return null;
}

/** The started playbook with its chain folded in: the loaded bodies after its own, and requires, optional, closes and a required repository combined. A broken chain leaves it as it is; the availability check refuses it anyway. */
export function withLoads(playbook: Playbook, all: Playbook[]): Playbook {
  const found = playbookChain(playbook, all);
  if ("problem" in found || found.chain.length < 2) return playbook;
  const chain = found.chain.map((name) => name === playbook.name ? playbook : all.find((p) => p.name === name)!);
  const union = (key: "requires" | "optional" | "closes") => [...new Set(chain.flatMap((p) => p[key]))];
  return {
    ...playbook, requires: union("requires"), optional: union("optional"), closes: union("closes"),
    ...(chain.some((p) => p.repository === "required") ? { repository: "required" as const } : {}),
    body: [playbook.body, ...chain.slice(1).map((p) => `#### Loaded playbook: ${p.name}\n\n${p.body}`)].join("\n\n"),
  };
}

/** Tools a playbook closes in its threads, each with the error a call to it gets when the model names it anyway. */
export const closedTools = (playbook?: { name: string; closes?: string[] }): Map<string, string> =>
  new Map((playbook?.closes ?? []).map((tool) => [tool, `This thread follows the ${playbook!.name} playbook, which closes ${tool}: follow the playbook's steps instead.`]));

const validName = (name: string) => { try { checkSegments([name]); return true; } catch { return false; } };

let builtins: Playbook[] | null = null;
/** The playbooks that ship with the code, read once. */
export function builtinPlaybooks(): Playbook[] {
  builtins ??= readdirSync(BUILTIN_PLAYBOOKS_DIR).sort().flatMap((name) => {
    if (!validName(name)) return [];
    try { const p = parsePlaybook(name, readFileSync(join(BUILTIN_PLAYBOOKS_DIR, name, PLAYBOOK_FILE), "utf8"), "builtin"); return p ? [p] : []; } catch { return []; }
  });
  return builtins;
}

async function tenantPlaybook(tenantId: string, name: string) {
  const file = await workspaceStore().read(tenantId, `${TENANT_PLAYBOOKS_DIR}/${name}/${PLAYBOOK_FILE}`).catch(() => null);
  return file ? parsePlaybook(name, file.content, "tenant") : null;
}

/** The effective playbook for a tenant: its own under shared/playbooks/, else the built-in of that name. */
export async function loadPlaybook(tenantId: string, name: string): Promise<Playbook | null> {
  if (!validName(name)) return null;
  return (await tenantPlaybook(tenantId, name)) ?? builtinPlaybooks().find((p) => p.name === name) ?? null;
}

/** Every playbook a tenant can start: built-ins, each replaced by a tenant playbook of the same name, plus the tenant's new ones. */
export async function listPlaybooks(tenantId: string): Promise<Playbook[]> {
  const entries = await workspaceStore().list(tenantId, TENANT_PLAYBOOKS_DIR).catch(() => []);
  const names = entries.filter((e) => e.type === "dir").map((e) => e.path.split("/").pop()!).filter(validName);
  const own = (await Promise.all(names.map((n) => tenantPlaybook(tenantId, n)))).filter((p): p is Playbook => !!p);
  return [...builtinPlaybooks().filter((b) => !own.some((p) => p.name === b.name)), ...own].sort((a, b) => a.name.localeCompare(b.name));
}

const changeListeners = new Set<(tenantId: string) => void>();
/** Called with the tenant id whenever someone changes that tenant's playbooks; returns the unsubscribe function. */
export function onPlaybooksChanged(listener: (tenantId: string) => void) { changeListeners.add(listener); return () => changeListeners.delete(listener); }
export function playbooksChanged(tenantId: string) { for (const listener of changeListeners) listener(tenantId); }

/** A sibling file of the effective playbook (a template or checklist its steps point at): the tenant's copy first, then the built-in one. */
export async function readPlaybookFile(tenantId: string, name: string, path: string): Promise<string | null> {
  const parts = path.replace(/\/$/, "").split("/");
  if (!validName(name)) return null;
  checkSegments(parts);
  if (!(await loadPlaybook(tenantId, name))) return null;
  const own = await workspaceStore().read(tenantId, `${TENANT_PLAYBOOKS_DIR}/${name}/${parts.join("/")}`).catch(() => null);
  return own ? own.content : readBuiltinPlaybookFile(name, parts.join("/"));
}

/** Where a path inside a built-in playbook's folder lives on disk, or null when the name is not a built-in. */
function builtinLocation(name: string, path: string) {
  if (!builtinPlaybooks().some((p) => p.name === name)) return null;
  const parts = path.replace(/\/$/, "").split("/").filter(Boolean);
  checkSegments(parts);
  const folder = resolve(BUILTIN_PLAYBOOKS_DIR, name), file = resolve(folder, ...parts);
  return file === folder || file.startsWith(folder + sep) ? file : null;
}

export function readBuiltinPlaybookFile(name: string, path: string): string | null {
  const file = builtinLocation(name, path);
  try { return file && statSync(file).isFile() ? readFileSync(file, "utf8") : null; } catch { return null; }
}

/** One folder of a built-in playbook, paths relative to the playbook folder; null when there is no such folder. */
export function listBuiltinPlaybookDir(name: string, path = ""): { path: string; type: "file" | "dir"; size?: number }[] | null {
  const dir = builtinLocation(name, path);
  try { if (!dir || !statSync(dir).isDirectory()) return null; } catch { return null; }
  const prefix = path.replace(/\/$/, "");
  return readdirSync(dir).sort().filter(validName).map((entry) => {
    const stat = statSync(join(dir, entry)), rel = prefix ? `${prefix}/${entry}` : entry;
    return stat.isDirectory() ? { path: rel, type: "dir" as const } : { path: rel, type: "file" as const, size: stat.size };
  });
}

/** Every file of a built-in playbook, relative to its folder: what a tenant override starts from. */
export function builtinPlaybookFiles(name: string, path = ""): string[] {
  return (listBuiltinPlaybookDir(name, path) ?? []).flatMap((e) => e.type === "dir" ? builtinPlaybookFiles(name, e.path) : [e.path]);
}

export type BindingStatus = "active" | "done" | "cancelled";
/** A thread bound to a playbook. Later playbooks keep their own state in the same file: extra frontmatter fields and the body survive a rewrite. */
export interface PlaybookBinding {
  playbook: string;
  status: BindingStatus;
  guildId: string;
  /** The channel the thread belongs to; its Workspace folder holds the binding. */
  channelId: string;
  threadId: string;
  authorId: string;
  /** The bot that started the thread and alone answers in it; absent on bindings written before it was recorded. */
  botId?: string;
  sourceMessageId: string;
  startedAt: string;
  [field: string]: unknown;
}
export type BindingPlace = { guildId: string; channelId: string; threadId: string };
export const bindingPlace = ({ guildId, channelId, threadId }: BindingPlace): BindingPlace => ({ guildId, channelId, threadId });
/** A link that opens one Discord message; a DM has "@me" for its server. */
export const jumpLink = (guildId: string | null | undefined, channelId: string, messageId: string) => `https://discord.com/channels/${guildId ?? "@me"}/${channelId}/${messageId}`;

/** One file per bound thread, in its channel's Workspace folder, so the binding survives a restart. */
export function bindingPath({ guildId, channelId, threadId }: BindingPlace) {
  const g = safeId(guildId), c = safeId(channelId), t = safeId(threadId);
  if (!g || !c || !t) throw new Error("Invalid thread location");
  return `guilds/${g}/channels/${c}/threads/${t}.md`;
}

export async function readBinding(tenantId: string, place: BindingPlace): Promise<{ binding: PlaybookBinding; body: string; version: string } | null> {
  const file = await workspaceStore().read(tenantId, bindingPath(place));
  const parsed = file && parseFrontmatter(file.content);
  if (!parsed || typeof parsed.fields.playbook !== "string" || typeof parsed.fields.status !== "string") return null;
  return { binding: { ...parsed.fields, ...place } as PlaybookBinding, body: parsed.body, version: file.version };
}

/** Creates the binding, or replaces it when `version` is the one last read. */
export function writeBinding(tenantId: string, binding: PlaybookBinding, body: string, version?: string) {
  return workspaceStore().write(tenantId, bindingPath(binding), renderFrontmatter(binding, body), version);
}

/**
 * Read-modify-write of a binding, retried once when another write landed in between. `change` returns the binding
 * to write and the value to hand back, or null to leave the file alone.
 */
export async function rewriteBinding<T>(tenantId: string, place: BindingPlace, change: (found: { binding: PlaybookBinding; body: string }) => { binding: PlaybookBinding; value: T } | null): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const found = await readBinding(tenantId, place);
    const out = found && change(found);
    if (!out) return null;
    try { await writeBinding(tenantId, out.binding, found!.body, found!.version); return out.value; }
    catch (e) { if (!(e instanceof WorkspaceConflict) || attempt) throw e; }
  }
}

/** The playbook a thread is bound to while the binding is active, or null. */
export async function boundPlaybook(tenantId: string, place: BindingPlace): Promise<{ playbook: Playbook; binding: PlaybookBinding } | null> {
  const found = await readBinding(tenantId, place).catch(() => null);
  if (found?.binding.status !== "active") return null;
  const playbook = await loadPlaybook(tenantId, found.binding.playbook);
  return playbook ? { playbook, binding: found.binding } : null;
}
