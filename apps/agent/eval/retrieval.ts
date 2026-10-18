/**
 * Retrieval scored without a judge (#252): did the searches of a turn bring up the sources a good answer rests on? A turn's facts name
 * them as `gold`; the tool results of the turn, recorded by the runner, rank what was found, part by part, as the model saw it:
 * kept files (recall's `kept`, searchFiles' matches), Tasks (recall's `tasks`, listTasks' lines) and git work (recall's `work`,
 * repoSearchWork's items). A gold source counts as found at the best rank it reached in its own part, over every call of the turn.
 *
 * recall@5 is the share of a turn's gold sources found within the first 5 of their part; reciprocal rank is 1 over the best rank of any
 * of them within the first 10, 0 when none is. A trial averages its turns that name gold; a run averages trials per brief, then briefs.
 */

/** What one tool result showed, in order, per part. Kept files as `#<channel>/<path>`, Tasks as `task:<title>`, git items by URL. */
export interface Retrieved { tool: string; kept: string[]; tasks: string[]; work: string[] }
export interface TurnRetrieval { n: number; gold: number; found: number; recall: number; rr: number; /** Per gold source, the best rank it reached, 0 when not within 10. */ ranks: number[] }
export interface Retrieval { turns: TurnRetrieval[]; recallAt5: number; mrr: number }

export const K = 5, DEPTH = 10;

const json = (result: unknown) => (typeof result === "string" ? result : JSON.stringify(result ?? null));
const all = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((m) => JSON.parse(`"${m[1]!}"`) as string);
/** "#mobile · Task "Fix it" (in_progress)" or its Indonesian form: the title. */
const citedTitle = (label: string) => /(?:Task|Tugas) "(.*)" \(/.exec(label)?.[1] ?? label;
/** The title at the end of a task line, `status | due | assignee | id | title`. */
const lineTitle = (line: string) => line.split(" | ").slice(4).join(" | ") || line;

/**
 * The sources a tool result showed, or null for a tool that searches nothing. `home` is the brief's channel's name: a file shown under
 * `channel/` there is `#<home>/` here, the same file the gold names.
 */
export function retrievedOf(tool: string, result: unknown, home: string): Retrieved | null {
  const kept = (path: string) => path.replace(/^channel\//, `#${home}/`);
  const r = (typeof result === "object" && result ? result : {}) as Record<string, any>, text = json(result);
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  if (tool === "recall") return {
    tool, kept: list(r.kept).map((k) => kept(String(k.path ?? ""))), tasks: list(r.tasks).map((t) => `task:${citedTitle(String(t.label ?? ""))}`), work: list(r.work).map((w) => String(w.url ?? "")),
  };
  if (tool === "searchFiles") return { tool, kept: all(text, /"path":"((?:[^"\\]|\\.)+)"/g).map(kept), tasks: [], work: [] };
  if (tool === "listTasks") return { tool, kept: [], tasks: all(text, /"line":"((?:[^"\\]|\\.)+)"/g).map((l) => `task:${lineTitle(l)}`), work: [] };
  if (tool === "repoSearchWork") return { tool, kept: [], tasks: [], work: list(r.items).map((w) => String(w.url ?? "")) };
  return null;
}

const partOf = (source: string): keyof Omit<Retrieved, "tool"> => (source.startsWith("task:") ? "tasks" : /^https?:\/\//.test(source) ? "work" : "kept");
const same = (gold: string, shown: string) => {
  const g = gold.toLowerCase(), s = shown.toLowerCase();
  return g.startsWith("task:") ? s.startsWith("task:") && s.slice(5).includes(g.slice(5).trim()) : g.replace(/\/+$/, "") === s.replace(/\/+$/, "");
};

/** The best rank, from 1, that any of `alternatives` reached in its part over every result; 0 when none came within DEPTH. */
export function rankOf(alternatives: string[], results: Retrieved[]): number {
  let best = 0;
  for (const source of alternatives) for (const r of results) {
    const at = r[partOf(source)].slice(0, DEPTH).findIndex((shown) => same(source, shown)) + 1;
    if (at && (!best || at < best)) best = at;
  }
  return best;
}

/** recall@5 and reciprocal rank of one turn's results against its gold. */
export function scoreTurn(n: number, gold: (string | string[])[], results: Retrieved[]): TurnRetrieval {
  const ranks = gold.map((g) => rankOf(Array.isArray(g) ? g : [g], results));
  const found = ranks.filter((r) => r >= 1 && r <= K).length, best = Math.min(...ranks.filter((r) => r > 0));
  return { n, gold: gold.length, found, recall: gold.length ? found / gold.length : 0, rr: Number.isFinite(best) ? 1 / best : 0, ranks };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A trial's retrieval: every turn that names gold, scored against what that turn's searches showed; undefined when no turn names gold. */
export function retrievalOf(turns: { n: number; retrieved?: Retrieved[] }[], gold: ((string | string[])[] | undefined)[]): Retrieval | undefined {
  const scored = gold.flatMap((g, i) => (g?.length ? [scoreTurn(i + 1, g, turns.find((t) => t.n === i + 1)?.retrieved ?? [])] : []));
  return scored.length ? { turns: scored, recallAt5: mean(scored.map((t) => t.recall)), mrr: mean(scored.map((t) => t.rr)) } : undefined;
}
