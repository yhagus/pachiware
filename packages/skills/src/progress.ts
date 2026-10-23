import { textIn, type Language } from "./language.js";
import type { OpenDraft } from "./openapi/changelog.js";

/**
 * How a long turn's progress reads to a person (#345): each step as a fixed phrase with what it touched, never a tool's name, and for a
 * playbook the stage its work has reached. A tool with no phrase here is not shown.
 */
export type StepKind = "repository" | "changes" | "diff" | "read" | "definition" | "search" | "folder" | "history" | "work" | "notes" | "tasks" | "channel" | "record" | "check" | "publish" | "files";
export type Step = { kind: StepKind; subject?: string };

/** A file's name without its folders or extension, e.g. "http-client.controller". */
const fileName = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().replace(/\/+$/, "").split("/").pop()!.replace(/\.[A-Za-z0-9]+$/, "") || undefined : undefined);
const word = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 60) : undefined);

const STEPS: Record<string, (a: Record<string, unknown>) => Step> = {
  gitAccounts: () => ({ kind: "repository" }), playbookRepositories: () => ({ kind: "repository" }), repoList: () => ({ kind: "repository" }),
  startChangelog: (a) => ({ kind: "changes", subject: word(a.repo) }), repoCompare: (a) => ({ kind: "changes", subject: word(a.repo) }),
  repoFileDiff: (a) => ({ kind: "diff", subject: fileName(a.path) }), repoMergeRequestDiff: () => ({ kind: "diff" }),
  repoReadFile: (a) => ({ kind: "read", subject: fileName(a.path) }),
  repoFindDefinition: (a) => ({ kind: "definition", subject: word(a.name) }),
  repoSearchCode: (a) => ({ kind: "search", subject: word(a.query) }),
  repoTree: (a) => ({ kind: "folder", subject: fileName(a.path) ?? word(a.repo) }),
  repoCommit: () => ({ kind: "history" }), repoCommits: () => ({ kind: "history" }),
  repoIssues: () => ({ kind: "work" }), repoIssue: () => ({ kind: "work" }), repoComments: () => ({ kind: "work" }), repoSearchWork: () => ({ kind: "work" }),
  repoMergeRequests: () => ({ kind: "work" }), repoMergeRequest: () => ({ kind: "work" }),
  readFile: (a) => ({ kind: "read", subject: fileName(a.path) }), listFiles: () => ({ kind: "notes" }), searchFiles: () => ({ kind: "notes" }), recall: () => ({ kind: "notes" }),
  listTasks: () => ({ kind: "tasks" }), showTask: () => ({ kind: "tasks" }), taskSummary: () => ({ kind: "tasks" }),
  readChannelHistory: () => ({ kind: "channel" }), readMessage: () => ({ kind: "channel" }),
  putChangelogOperation: (a) => ({ kind: "record", subject: typeof a.method === "string" && typeof a.path === "string" ? `${a.method.toUpperCase()} ${a.path}` : undefined }),
  finishChangelog: () => ({ kind: "check" }), publishOpenApi: () => ({ kind: "publish" }), sendFiles: () => ({ kind: "files" }),
};

/** The step a tool call is, or null for one a person need not see. */
export const stepOf = (tool: string, args: unknown): Step | null => STEPS[tool]?.(args && typeof args === "object" ? args as Record<string, unknown> : {}) ?? null;

/** Steps of one kind in a row, as one line: the subject when there is one, else how many. */
export function stepLine(kind: StepKind, subjects: (string | undefined)[], language?: Language): string {
  const t = textIn(language).progress.steps[kind], named = [...new Set(subjects.filter((s): s is string => !!s))];
  return named.length > 1 ? t.many(named.length) : t.one(named[0]);
}

/**
 * The stages a playbook's work goes through, in order, and the tools that reach each. The stage shown is the furthest one reached;
 * contract-diff also counts the endpoints it has recorded.
 */
const STAGES: Record<string, { stage: string; tools: string[] }[]> = {
  "contract-diff": [
    { stage: "range", tools: ["startChangelog"] },
    { stage: "conventions", tools: ["readPlaybookFile"] },
    { stage: "reading", tools: ["repoCompare", "repoFileDiff", "repoReadFile", "repoTree"] },
    { stage: "tracing", tools: ["repoSearchCode", "repoFindDefinition", "traceEndpoints", "putChangelogOperation", "putChangelogComponents"] },
    { stage: "checking", tools: ["finishChangelog"] },
    { stage: "publishing", tools: ["publishOpenApi"] },
  ],
};

/** Where a playbook's work stands: the furthest stage its tools reached so far, or -1 before any. */
export function stageIndex(playbook: string | undefined, tool: string, current: number): number {
  const at = (playbook ? STAGES[playbook] : undefined)?.findIndex((s) => s.tools.includes(tool)) ?? -1;
  return Math.max(current, at);
}

/** The stage line, with how many endpoints are recorded once the work traces them; null when the playbook names no stages or none is reached. */
export function stageLine(playbook: string | undefined, index: number, recorded: number, language?: Language): string | null {
  const stage = playbook && index >= 0 ? STAGES[playbook]?.[index]?.stage : undefined;
  if (!stage) return null;
  const t = textIn(language).progress;
  const name = t.stages[stage as keyof typeof t.stages] ?? stage;
  return recorded > 0 && stage === "tracing" ? `${name} · ${t.recorded(recorded)}` : name;
}

/** How long a turn has run, as people say it: seconds under a minute, else whole minutes. */
export function elapsed(ms: number, language?: Language): string {
  const t = textIn(language).progress, s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? t.seconds(s) : t.minutes(Math.floor(s / 60));
}

/** The most of a failed endpoint's reason its progress line shows. */
const REASON_SHOWN = 100;

/**
 * An open Changelog draft's lines in its progress message: how many changed files are done, and how far its candidate endpoints are
 * traced, with the latest results as their workers recorded them (#343). Null when it has neither.
 */
export function draftProgress(d: Pick<OpenDraft, "changedFiles" | "examined" | "setAside" | "left" | "candidates">, language?: Language): string | null {
  const t = textIn(language).progress, lines: string[] = [];
  if (d.left !== undefined && d.changedFiles !== undefined) lines.push(t.files(d.examined! + d.setAside!, d.changedFiles));
  const c = d.candidates;
  if (c) {
    lines.push(t.endpoints(c.traced + c.failed, c.traced + c.failed + c.waiting, c.failed));
    const reason = (text: string) => (text.length > REASON_SHOWN ? `${text.slice(0, REASON_SHOWN - 1)}…` : text);
    for (const r of c.latest) lines.push(`-# ${r.endpoint} · ${"failed" in r ? t.unverified(reason(r.failed)) : "unchanged" in r ? t.unchanged : t.traced(r.impact, r.changes)}`);
  }
  return lines.length ? lines.join("\n") : null;
}
