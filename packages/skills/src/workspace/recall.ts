import type { SkillContext, ToolDefinition, ToolResult } from "../types.js";
import { DEFAULT_TIMEZONE, isoInZone } from "../clock.js";
import { textIn } from "../language.js";
import { jumpLink, parseFrontmatter } from "../playbooks.js";
import { agentPaths } from "./paths.js";
import { dateRange, nameDate, queriesTerms, wordingsOf } from "./search.js";
import { rankKept, readableSources, sourcePath, type Source } from "./sources.js";
import { workspaceStore } from "./store.js";

/**
 * "Was X discussed, decided, done?" in one call (#211): Kept material, Tasks of every status, git issues, pull requests and commits,
 * and Plane Work items. The Tasks, git and Plane parts run `listTasks`, `repoSearchWork` and `workItemList` through the registry, and
 * only when the model could call them here, so recall reaches nothing they would not. Every item carries a ref (K, T, G, P and a number)
 * with a label and, when the server can build one, a link; refs never repeat within a turn.
 */

export const RECALL_PART = 10;
const MAX_QUERIES = 5, LINES = 2, LINE_CHARS = 160, TITLE_CHARS = 80;
/** Under the loop's 12,000-character cut, with room for the wrapper it adds. */
export const RECALL_BUDGET = 11_000;

export const recallTool: ToolDefinition = {
  name: "recall",
  description: "Answers \"was X discussed, decided or done?\" in one call: searches the kept material (Minutes, Daily logs, Decisions, Notes, Documents) of this place and of every other channel you may read from here, the Tasks of every status, and, where they are open here, git issues, pull requests and commits and Plane Work items. Pass 2 to 5 wordings in queries: Indonesian, English and same-meaning words. Every item has a ref, a label naming its channel and date, and a url when it has one. A kept file marked partial holds only some of the words; nothingStrong means no kept file holds every word of any wording. nothingFound names the parts searched without a match, unavailable the parts not searched here and why. notShownHere counts matches that cannot be shown in this channel; follow its suggestion and never guess what or where they are.",
  parameters: {
    type: "object",
    properties: {
      queries: { type: "array", items: { type: "string" }, description: "2 to 5 wordings of the same question, e.g. [\"normalisasi audio\", \"audio normalization\", \"loudness\"]" },
      since: { type: "string", description: "Only kept material dated on or after this day, YYYY-MM-DD" },
      until: { type: "string", description: "Only kept material dated on or before this day, YYYY-MM-DD" },
      channel: { type: "string", description: "Only this channel's kept material and Tasks, e.g. \"#marketing\"; leave it out to search every channel you may read from here" },
    },
    required: ["queries"],
  },
};

type Cited = { ref: string; label: string; url?: string };
type Kind = "minutes" | "daily-log" | "decision" | "note" | "document";
const KIND_OF: Record<string, Kind> = { minutes: "minutes", "daily-logs": "daily-log", decisions: "decision", notes: "note", files: "document" };

/** The refs given so far in each turn, by letter, so a second call goes on numbering. The host passes one context object per turn. */
const turnRefs = new WeakMap<object, Record<string, number>>();
function refFor(ctx: SkillContext, letter: string) {
  const counts = turnRefs.get(ctx) ?? turnRefs.set(ctx, {}).get(ctx)!;
  counts[letter] = (counts[letter] ?? 0) + 1;
  return `${letter}${counts[letter]}`;
}

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const DISCORD_LINK = /https:\/\/discord\.com\/channels\/[^\s)>\]]+/;

/** The link a kept file is cited by: Minutes by their posted message, a Daily log match by the first message link on its matching lines. */
async function keptLink(tenantId: string, path: string, kind: Kind, lines: number[]): Promise<string | undefined> {
  if (kind !== "minutes" && kind !== "daily-log") return undefined;
  const file = await workspaceStore().read(tenantId, path).catch(() => null);
  if (!file) return undefined;
  if (kind === "minutes") {
    const head = parseFrontmatter(file.content)?.fields ?? {};
    return typeof head.postedIn === "string" && typeof head.messageId === "string" ? jumpLink(typeof head.guildId === "string" ? head.guildId : null, head.postedIn, head.messageId) : undefined;
  }
  const text = file.content.split("\n");
  for (const n of lines) { const found = DISCORD_LINK.exec(text[n - 1] ?? ""); if (found) return found[0]; }
  return undefined;
}

/** Runs one of the tools recall combines, when the model could call it here; the reason it is not searched otherwise. */
async function part(ctx: SkillContext, tool: string, args: Record<string, unknown>): Promise<{ data: any } | { unavailable: string }> {
  if (!ctx.tools?.here.has(tool)) return { unavailable: textIn(ctx.language).recallNotAvailable };
  const result: ToolResult = await ctx.tools.run(tool, args);
  return result.success ? { data: result.data } : { unavailable: result.error ?? textIn(ctx.language).recallNotAvailable };
}

export async function recall(args: Record<string, unknown>, ctx: SkillContext) {
  const t = textIn(ctx.language), zone = ctx.timezone ?? DEFAULT_TIMEZONE;
  const wordings = wordingsOf(undefined, args.queries).map((q) => q.trim()).filter(Boolean).slice(0, MAX_QUERIES), queries = queriesTerms(wordings);
  if (!queries.length) throw new Error(`Pass "queries": 2 to 5 wordings, such as ["normalisasi audio", "audio normalization", "loudness"]`);
  const within = dateRange(args.since, args.until, zone), store = workspaceStore();
  let sources = await readableSources(store, ctx);
  let only: Source | undefined;
  if (typeof args.channel === "string" && args.channel.trim()) sources = [only = sourcePath(ctx, sources, args.channel.trim(), true).source];

  const [kept, tasks, git, plane] = await Promise.all([
    rankKept(store, ctx.tenantId, sources, queries, within, RECALL_PART),
    part(ctx, "listTasks", { scope: "anywhere", queries: wordings, limit: RECALL_PART }),
    part(ctx, "repoSearchWork", { queries: wordings }),
    part(ctx, "workItemList", { queries: wordings, limit: RECALL_PART }),
  ]);

  const keptItems = await Promise.all(kept.matches.map(async (m) => {
    const rel = m.path.slice(m.source.folder.length + 1), kind = KIND_OF[rel.split("/")[0]!] ?? "document";
    const date = nameDate(m.path) || isoInZone(zone, m.modified).slice(0, 10), url = await keptLink(ctx.tenantId, m.path, kind, m.lines.map((l) => l.line));
    return {
      ref: refFor(ctx, "K"), label: `${m.source.label} · ${t.keptKinds[kind]} ${date}`, ...(url ? { url } : {}),
      path: agentPaths(m.source.root, m.source.folder)(m.path), lines: m.lines.slice(0, LINES).map((l) => ({ line: l.line, text: clip(l.text, LINE_CHARS) })),
      ...(m.strong ? {} : { partial: true as const }),
    };
  }));
  const taskGroups: any[] = "data" in tasks ? (tasks.data.groups ?? []).filter((g: any) => !only || g.group === only.label) : [];
  const taskItems = taskGroups.flatMap((g) => (g.tasks as any[]).map((task) => ({ ref: refFor(ctx, "T"), label: `${g.group} · ${t.taskCited(clip(task.title, TITLE_CHARS), task.status)}`, line: task.line })));
  const workItems = "data" in git ? (git.data.items as any[]).slice(0, RECALL_PART).map((w) => ({
    ref: refFor(ctx, "G"), label: `${w.repo} · ${t.workCited[w.kind] ?? w.kind} ${w.number !== undefined ? `#${w.number}` : w.sha} "${clip(w.title, TITLE_CHARS)}" (${w.state})`, url: w.url, date: w.date,
  })) : [];
  const planeItems = "data" in plane ? (plane.data.items as any[]).slice(0, RECALL_PART).map((w) => ({ ref: refFor(ctx, "P"), label: `${w.key} "${clip(w.name, TITLE_CHARS)}" (${w.state ?? "?"})`, url: w.url })) : [];

  const notShownHere = kept.notShown + ("data" in tasks ? tasks.data.notShownHere ?? 0 : 0);
  const unavailable = Object.fromEntries(([["tasks", tasks], ["git", git], ["plane", plane]] as const).flatMap(([name, p]) => ("unavailable" in p ? [[name, p.unavailable]] : [])));
  const nothingFound = [["kept", keptItems], ["tasks", taskItems], ["git", workItems], ["plane", planeItems]]
    .filter(([name, items]) => !(name as string in unavailable) && !(items as unknown[]).length).map(([name]) => name as string);
  const result = {
    kept: keptItems, tasks: taskItems, work: workItems, workItems: planeItems,
    ...(kept.nothingStrong ? { nothingStrong: true as const } : {}),
    ...(nothingFound.length ? { nothingFound } : {}),
    ...(Object.keys(unavailable).length ? { unavailable } : {}),
    ...(notShownHere ? { notShownHere, suggestion: t.notShownHere(notShownHere) } : {}),
  };
  return withinBudget(result);
}

/** Drops matching lines, then the lowest-ranked item of the longest part, until the result fits RECALL_BUDGET characters. */
function withinBudget<R extends { kept: { lines: unknown[] }[]; tasks: unknown[]; work: unknown[]; workItems: unknown[] }>(result: R): R & { cut?: true } {
  const size = () => JSON.stringify(result).length;
  if (size() <= RECALL_BUDGET) return result;
  for (const k of result.kept) k.lines = k.lines.slice(0, 1);
  const parts = [result.kept, result.tasks, result.work, result.workItems] as unknown[][];
  while (size() > RECALL_BUDGET) {
    const longest = parts.reduce((a, b) => (b.length > a.length ? b : a));
    if (!longest.length) break;
    longest.pop();
  }
  return { ...result, cut: true };
}
