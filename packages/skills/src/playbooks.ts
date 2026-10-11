import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve, sep } from "node:path";
import { checkSegments, safeId } from "./workspace/paths.js";
import { workspaceStore } from "./workspace/store.js";

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
  const menu = typeof trigger.menu === "string" && trigger.menu.trim() ? trigger.menu.trim().slice(0, 32) : null;
  return {
    name, source, menu, body: parsed.body.trim(),
    description: typeof f.description === "string" ? f.description : "",
    words: list(trigger.word ?? trigger.words).map((w) => w.toLowerCase()).filter((w) => WORD.test(w)),
    requires: list(f.requires), optional: list(f.optional),
  };
}

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

/** Skills in `requires` that are off; the playbook must refuse to start while any are. */
export const missingSkills = (playbook: Playbook, activeSkillIds: string[]) => playbook.requires.filter((id) => !activeSkillIds.includes(id));

/** A sibling file of the effective playbook (a template or checklist its steps point at): the tenant's copy first, then the built-in one. */
export async function readPlaybookFile(tenantId: string, name: string, path: string): Promise<string | null> {
  const parts = path.replace(/\/$/, "").split("/");
  if (!validName(name)) return null;
  checkSegments(parts);
  if (!(await loadPlaybook(tenantId, name))) return null;
  const own = await workspaceStore().read(tenantId, `${TENANT_PLAYBOOKS_DIR}/${name}/${parts.join("/")}`).catch(() => null);
  if (own) return own.content;
  const file = resolve(BUILTIN_PLAYBOOKS_DIR, name, ...parts);
  if (!file.startsWith(resolve(BUILTIN_PLAYBOOKS_DIR) + sep)) return null;
  try { return statSync(file).isFile() ? readFileSync(file, "utf8") : null; } catch { return null; }
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
  sourceMessageId: string;
  startedAt: string;
  [field: string]: unknown;
}
export type BindingPlace = { guildId: string; channelId: string; threadId: string };

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

/** The playbook a thread is bound to while the binding is active, or null. */
export async function boundPlaybook(tenantId: string, place: BindingPlace): Promise<{ playbook: Playbook; binding: PlaybookBinding } | null> {
  const found = await readBinding(tenantId, place).catch(() => null);
  if (found?.binding.status !== "active") return null;
  const playbook = await loadPlaybook(tenantId, found.binding.playbook);
  return playbook ? { playbook, binding: found.binding } : null;
}
