import type { SkillContext, ToolDefinition, ToolHandler, ToolPolicy } from "../types.js";
import { chainSaveProblem, guildPlaybooks, guildPlaybooksDir, listPlaybooks, loadPlaybook, parseFrontmatter, parsePlaybook, playbookCatalogue, playbooksChanged, removePlaybookFolder, renderFrontmatter, slashNameUsable, PLAYBOOK_FILE, type Playbook } from "../playbooks.js";
import { confirmWrite, DANGER_PREFIX } from "../writeConfirmation.js";
import { audit, injectionPhrases } from "../guardrails.js";
import { workspaceStore } from "../workspace/store.js";
import { checkSegments } from "../workspace/paths.js";
import { now } from "../clock.js";
import { textIn, type Strings } from "../language.js";

/**
 * A server's own playbooks, made from chat (ADR 0021): `savePlaybook` creates or changes one, `deletePlaybook` deletes one, each only after
 * the asker presses Confirm on a card showing the whole change. Built-in and tenant playbooks change only in the console.
 */
export const SAVE_PLAYBOOK = "savePlaybook", DELETE_PLAYBOOK = "deletePlaybook";
export const PLAYBOOK_TOOLS = [SAVE_PLAYBOOK, DELETE_PLAYBOOK];
/** How many playbooks a server may keep of its own. */
export const MAX_SERVER_PLAYBOOKS = 25;
export const MAX_PLAYBOOK_BODY = 6000;
const MAX_DESCRIPTION = 100, MAX_WORDS = 3, PREVIEW = 1500, DIFF = 1200;
/** The skills a playbook made in chat may require, by id with the name people see; a test holds it to the registry. */
export const PLAYBOOK_SKILLS: Record<string, string> = {
  discord_management: "Discord Management", git_repositories: "Git Repositories", plane: "Plane", reminders: "Reminders", task_management: "Task Management", workspace: "Workspace",
};
const WORD = /^[\p{L}\p{N}_-]{1,32}$/u;

export const guildPlaybookPolicy: Record<string, ToolPolicy> = {
  [SAVE_PLAYBOOK]: { effect: "write", confirmsInternally: true },
  [DELETE_PLAYBOOK]: { effect: "danger", confirmsInternally: true },
};

export const guildPlaybookTools: ToolDefinition[] = [
  {
    name: SAVE_PLAYBOOK,
    description: `Saves a playbook for this server: steps the bot follows when someone starts it with /name or "@bot word: …". People may call it a skill, an SOP, a template or a workflow. Before your first draft, read making-playbooks/PLAYBOOK.md with readPlaybookFile. To change one this server made, read its PLAYBOOK.md first, pass its version, and leave out what stays the same. Built-in and tenant playbooks change only in the console. Nothing is saved until the asker presses Confirm on the card that appears.`,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The slash command: 1 to 32 lowercase letters, digits, - or _, e.g. release-notes" },
        description: { type: "string", description: "One line of at most 100 characters: what it does, shown beside the command" },
        body: { type: "string", description: `The steps in Markdown, at most ${MAX_PLAYBOOK_BODY} characters, without a --- header` },
        words: { type: "array", items: { type: "string" }, description: `Up to ${MAX_WORDS} trigger words that start it as "@bot word: …"` },
        requires: { type: "array", items: { type: "string", enum: Object.keys(PLAYBOOK_SKILLS) }, description: "Skills whose tools the steps call" },
        loads: { type: "array", items: { type: "string" }, description: "Other playbooks whose steps join this one's" },
        run: { type: "string", enum: ["thread", "in-place"], description: "thread (the default) opens a thread for the work; in-place answers where it was started" },
        version: { type: "string", description: "The version readPlaybookFile gave; required to change an existing one" },
      },
      required: ["name"],
    },
  },
  {
    name: DELETE_PLAYBOOK,
    description: "Deletes a playbook this server made, after the asker presses Confirm. Threads following it stop at their next message. Built-in and tenant playbooks are removed only in the console.",
    parameters: { type: "object", properties: { name: { type: "string", description: "The playbook's name" } }, required: ["name"] },
  },
];

const say = (ctx: SkillContext) => textIn(ctx.askerLanguage ?? ctx.language);
const strings = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) throw new Error(`${field} must be a list`);
  return [...new Set(value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean))];
};
/** Text a card quotes: no line of it can ping anyone. */
const quiet = (text: string) => text.replace(/@/g, "@​");
const day = (iso: unknown) => (typeof iso === "string" ? iso.slice(0, 10) : "");

async function askerName(ctx: SkillContext) {
  return ctx.userName || (ctx.discord && ctx.userId ? (await ctx.discord.getMember(ctx.userId).catch(() => null))?.displayName : undefined) || ctx.userId || "unknown";
}

/** The lines that changed between two bodies: the shared first and last lines dropped, the rest as - and + lines, cut to `max` characters. */
export function bodyChanges(before: string, after: string, max = DIFF): string {
  const a = before.split("\n"), b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const lines = [...a.slice(start, endA).map((l) => `- ${l}`), ...b.slice(start, endB).map((l) => `+ ${l}`)].join("\n");
  return lines.length > max ? `${lines.slice(0, max)}…` : lines;
}

const preview = (body: string) => (body.length > PREVIEW ? `${body.slice(0, PREVIEW)}…` : body).split("\n").map((l) => `> ${l}`).join("\n");
/** Inside a code block, three backticks would end it early. */
const fenced = (text: string) => `\`\`\`diff\n${text.replace(/```/g, "'''")}\n\`\`\``;

interface Draft { name: string; description: string; body: string; words: string[]; requires: string[]; loads: string[]; run: "thread" | "in-place" }

function newSummary(t: Strings, server: string, d: Draft) {
  return quiet([
    `**/${d.name}**: ${d.description}`,
    t.playbookAppliesTo(server),
    t.playbookStartWith(d.name, d.words),
    t.playbookRuns(d.run),
    ...(d.requires.length ? [t.playbookNeeds(d.requires.map((id) => PLAYBOOK_SKILLS[id] ?? id))] : []),
    ...(d.loads.length ? [t.playbookLoadsLine(d.loads)] : []),
    t.playbookSteps(d.body.length),
    preview(d.body),
  ].join("\n"));
}

function changeSummary(t: Strings, server: string, old: Playbook, d: Draft, made: string | null) {
  const shown = (v: string[]) => (v.length ? v.join(", ") : t.none);
  const fields: [keyof Strings["playbookFields"], string, string][] = [
    ["description", old.description, d.description],
    ["words", shown(old.words), shown(d.words)],
    ["requires", shown(old.requires.map((id) => PLAYBOOK_SKILLS[id] ?? id)), shown(d.requires.map((id) => PLAYBOOK_SKILLS[id] ?? id))],
    ["loads", shown(old.loads), shown(d.loads)],
    ["run", t.playbookRunName(old.run), t.playbookRunName(d.run)],
  ];
  return quiet([
    `**/${d.name}**`,
    t.playbookAppliesTo(server),
    ...fields.filter(([, a, b]) => a !== b).map(([field, a, b]) => `${t.playbookFields[field]}: ${a} → ${b}`),
    ...(old.body !== d.body ? [t.playbookStepsChanged, fenced(bodyChanges(old.body, d.body))] : []),
    ...(made ? [made] : []),
  ].join("\n"));
}

/** Checks the save, builds the file and the card; throws to refuse. It runs when the card is offered and again on Confirm. */
async function prepareSave(args: Record<string, any>, ctx: SkillContext) {
  const t = say(ctx), dir = guildPlaybooksDir(ctx.guildId);
  if (!dir || !ctx.guildId) throw new Error(t.playbooksOnlyInServer);
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!slashNameUsable(name)) throw new Error(t.playbookNameRule(name));
  const catalogue = await playbookCatalogue(ctx.tenantId);
  if (catalogue.some((p) => p.name === name)) throw new Error(t.playbookNameTaken(name));
  const path = `${dir}/${name}/${PLAYBOOK_FILE}`;
  const file = await workspaceStore().read(ctx.tenantId, path).catch(() => null);
  const version = typeof args.version === "string" ? args.version : undefined;
  if (file && version === undefined) throw new Error(t.playbookReadFirst(name));
  if (file && version !== file.version) throw new Error(t.playbookChangedSinceRead(name));
  if (!file && version !== undefined) throw new Error(t.playbookNotHere(name));
  if (!file && (await workspaceStore().list(ctx.tenantId, dir).catch(() => [])).filter((e) => e.type === "dir").length >= MAX_SERVER_PLAYBOOKS) throw new Error(t.playbookLimit(MAX_SERVER_PLAYBOOKS));
  const old = file ? parsePlaybook(name, file.content, "guild") : null;
  const kept = (file && parseFrontmatter(file.content)?.fields) || {};

  const text = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
  const description = text(args.description)?.replace(/\s+/g, " ") ?? old?.description ?? "";
  if (!description || description.length > MAX_DESCRIPTION) throw new Error(t.playbookDescriptionRule);
  const body = text(args.body) ?? old?.body ?? "";
  if (!body || body.length > MAX_PLAYBOOK_BODY || parseFrontmatter(`${body}\n`)) throw new Error(t.playbookBodyRule(MAX_PLAYBOOK_BODY));
  const words = args.words === undefined ? old?.words ?? [] : strings(args.words, "words").map((w) => w.toLowerCase());
  if (words.length > MAX_WORDS || words.some((w) => !WORD.test(w))) throw new Error(t.playbookWordsRule);
  const requires = args.requires === undefined ? old?.requires ?? [] : strings(args.requires, "requires");
  const unknown = requires.filter((id) => !(id in PLAYBOOK_SKILLS));
  if (unknown.length) throw new Error(t.playbookUnknownSkills(unknown, Object.keys(PLAYBOOK_SKILLS)));
  const loads = args.loads === undefined ? old?.loads ?? [] : strings(args.loads, "loads");
  if (args.run !== undefined && args.run !== "thread" && args.run !== "in-place") throw new Error(t.playbookRunRule);
  const run: Draft["run"] = args.run ?? old?.run ?? "thread";
  const same = (a: string[], b: string[]) => a.join("\n") === b.join("\n");
  if (old && old.description === description && old.body === body && same(old.words, words) && same(old.requires, requires) && same(old.loads, loads) && old.run === run) throw new Error(t.playbookNothingChanged(name));

  // Every lookup by word takes the first match, so a word or a name may start only one playbook here.
  const before = await listPlaybooks(ctx.tenantId, ctx.guildId, catalogue), others = before.filter((p) => p.name !== name);
  for (const word of [...words, name]) {
    const owner = others.find((p) => p.words.includes(word) || (word !== name && p.start && p.name === word));
    if (owner) throw new Error(t.playbookWordTaken(word, owner.name));
  }
  const missing = loads.find((l) => !others.some((p) => p.name === l));
  if (missing) throw new Error(t.playbookLoadsMissing(missing));
  const phrases = injectionPhrases(`${description}\n${body}`).map((p) => p.text);
  if (phrases.length) throw new Error(t.playbookInjection(phrases));

  // Fields only the console sets (closes, optional, a menu…) stay as an admin left them.
  const at = new Date(now()).toISOString(), who = { id: ctx.userId ?? "", name: await askerName(ctx) };
  const trigger: Record<string, unknown> = typeof kept.trigger === "object" && kept.trigger ? { ...(kept.trigger as Record<string, unknown>) } : {};
  delete trigger.word; delete trigger.words;
  if (words.length) trigger.word = words;
  const fields: Record<string, unknown> = {
    ...kept, name, description,
    trigger: Object.keys(trigger).length ? trigger : undefined,
    requires: requires.length ? requires : undefined,
    loads: loads.length ? loads : undefined,
    run: run === "in-place" ? run : undefined,
    ...(file ? { updatedBy: who, updatedAt: at } : { createdBy: who, createdAt: at }),
  };
  const content = renderFrontmatter(fields, `${body}\n`);
  const saved = parsePlaybook(name, content, "guild");
  if (!saved) throw new Error(t.playbookBodyRule(MAX_PLAYBOOK_BODY));
  const problem = chainSaveProblem(saved, before);
  if (problem) throw new Error(`Not saved: ${problem}.`);

  const draft: Draft = { name, description, body, words, requires, loads, run }, server = ctx.guildName ?? t.thisServer;
  const by = kept.createdBy as { name?: unknown } | undefined;
  const made = typeof by?.name === "string" ? t.playbookMadeBy(by.name, day(kept.createdAt)) : null;
  return {
    title: old ? t.playbookChangeTitle : t.playbookNewTitle,
    summary: old ? changeSummary(t, server, old, draft, made) : newSummary(t, server, draft),
    run: async () => {
      await workspaceStore().write(ctx.tenantId, path, content, version);
      playbooksChanged(ctx.tenantId);
      await audit(ctx, "playbook_saved", { guildId: ctx.guildId, channelId: ctx.channelId, name, change: old ? "changed" : "created" });
      return { saved: true, name, created: !old, words, run };
    },
  };
}

async function prepareDelete(args: Record<string, any>, ctx: SkillContext) {
  const t = say(ctx), dir = guildPlaybooksDir(ctx.guildId);
  if (!dir || !ctx.guildId) throw new Error(t.playbooksOnlyInServer);
  const name = typeof args.name === "string" ? args.name.trim() : "";
  try { checkSegments([name]); } catch { throw new Error(t.playbookNotHere(name)); }
  if ((await playbookCatalogue(ctx.tenantId)).some((p) => p.name === name)) throw new Error(t.playbookNameTaken(name));
  const folder = `${dir}/${name}`;
  if (!(await workspaceStore().list(ctx.tenantId, dir).catch(() => [])).some((e) => e.type === "dir" && e.path === folder)) throw new Error(t.playbookNotHere(name));
  const fields = parseFrontmatter((await workspaceStore().read(ctx.tenantId, `${folder}/${PLAYBOOK_FILE}`).catch(() => null))?.content ?? "")?.fields ?? {};
  const by = fields.createdBy as { name?: unknown } | undefined;
  return {
    title: t.playbookDeleteTitle,
    summary: quiet([`${DANGER_PREFIX}${t.playbookDeleteLine(name, ctx.guildName ?? t.thisServer)}`, t.playbookDeleteWarning, ...(typeof by?.name === "string" ? [t.playbookMadeBy(by.name, day(fields.createdAt))] : [])].join("\n")),
    run: async () => {
      await removePlaybookFolder(ctx.tenantId, folder);
      playbooksChanged(ctx.tenantId);
      await audit(ctx, "playbook_deleted", { guildId: ctx.guildId, channelId: ctx.channelId, name });
      return { deleted: true, name };
    },
  };
}

export const guildPlaybookHandlers: Record<string, ToolHandler> = {
  [SAVE_PLAYBOOK]: (args, ctx) => confirmWrite(ctx, { tool: SAVE_PLAYBOOK, args, ownConfirmation: true }, () => prepareSave(args, ctx)),
  [DELETE_PLAYBOOK]: (args, ctx) => confirmWrite(ctx, { tool: DELETE_PLAYBOOK, args, ownConfirmation: true }, () => prepareDelete(args, ctx)),
};

/** The version of a server's own PLAYBOOK.md, which savePlaybook needs to change it; none for any other playbook. */
export async function serverPlaybookVersion(ctx: SkillContext, name: string): Promise<string | undefined> {
  const dir = guildPlaybooksDir(ctx.guildId);
  if (!dir || (await loadPlaybook(ctx.tenantId, name, ctx.guildId))?.source !== "guild") return undefined;
  return (await workspaceStore().read(ctx.tenantId, `${dir}/${name}/${PLAYBOOK_FILE}`).catch(() => null))?.version;
}

/** Every playbook a server made, as the console lists it, with whether a tenant or built-in playbook of its name hides it. */
export async function serverPlaybooks(tenantId: string, guildId: string) {
  const taken = new Set((await playbookCatalogue(tenantId)).map((p) => p.name));
  return (await guildPlaybooks(tenantId, guildId)).map((p) => ({
    name: p.name, description: p.description, words: p.words, requires: p.requires, start: p.start,
    ...(p.createdBy ? { createdBy: p.createdBy } : {}), ...(p.createdAt ? { createdAt: p.createdAt } : {}), hidden: taken.has(p.name),
  }));
}

/** The servers that made a playbook of this name, by their folder label when the bot wrote one, else their id. */
export async function serversWithPlaybook(tenantId: string, name: string): Promise<string[]> {
  const guilds = (await workspaceStore().list(tenantId, "guilds").catch(() => [])).filter((e) => e.type === "dir");
  const found = await Promise.all(guilds.map(async (g) => {
    const dir = guildPlaybooksDir(g.path.split("/").pop());
    if (!dir || !(await workspaceStore().list(tenantId, dir).catch(() => [])).some((e) => e.type === "dir" && e.path === `${dir}/${name}`)) return null;
    return (await workspaceStore().read(tenantId, `${g.path}/.name`).catch(() => null))?.content.trim() || g.path.split("/").pop()!;
  }));
  return found.filter((g): g is string => !!g);
}
