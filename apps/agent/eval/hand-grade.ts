/**
 * Hand grades for the judge (#49): a person grades a sample of the judge's items blind, and the judge's agreement with them is computed.
 *
 *   bun apps/agent/eval/hand-grade.ts sample <run> [count]   writes <run>/hand-grades.yaml: `count` items (20 at least, 24 by default)
 *   bun apps/agent/eval/hand-grade.ts agree <run> [file]     prints how often the judge agrees with the grades given, kept as hand-agreement.md
 *   bun apps/agent/eval/hand-grade.ts keep <run> [file]      adds the graded items to calibration/<rubric>.yaml, which rejudge.ts reads
 *
 * `<run>` is a daily-behaviour run folder whose trials the judge graded: a run judged over HTTP, or the `rejudged-<rubric>/` folder an
 * offline judging wrote. Each item is one question the judge answered, `fact <n>`, `behaviour` or `supported`, written out word for word
 * with everything the judge saw, and without the judge's verdict. The sample is the same for the same run: spread over the briefs in turn,
 * and as many items the judge answered no as yes while both last, so a judge that says yes to everything cannot agree by default.
 * Items the judge left unknown are not sampled: an unknown never agrees, and most are questions it was never asked.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { loadEveryAssistantFixture, type AssistantFixture } from "./assistantFixtures";
import { judgeQuestions, type AssistantJudged } from "./assistantJudge";
import { agreementText, key, verdictsOf, type CalibrationItem } from "./calibration";
import type { TrialResult } from "./compare";
import { EVAL_DIR } from "./repository";

export const MIN_ITEMS = 20, DEFAULT_ITEMS = 24;
const FILE = "hand-grades.yaml";

export interface HandItem { id: number; trial: string; turn?: number; criterion: string; human: "yes" | "no" | null; note: string; question: string }
export interface HandGrades { run: string; rubric: string; instructions: string; items: HandItem[] }

/** The run a folder belongs to: its own name, or its parent's for a `rejudged-<rubric>/` folder, as calibration items name runs. */
export const runName = (dir: string) => (basename(dir).startsWith("rejudged-") ? basename(dirname(dir)) : basename(dir));

function readRun(dir: string): { rubric: string; trials: Map<string, AssistantJudged> } {
  const report = join(dir, "report.json");
  if (!existsSync(report)) throw new Error(`${dir} has no report.json: hand grades read a run the judge has graded`);
  const meta = JSON.parse(readFileSync(report, "utf8"));
  if (meta.kind !== "assistant") throw new Error(`${dir} is an issue-draft run; hand grades sample daily-behaviour runs`);
  const trials = new Map<string, AssistantJudged>();
  for (const file of readdirSync(join(dir, "trials")).filter((f) => f.endsWith(".json")).sort()) {
    trials.set(file.slice(0, -".json".length), (JSON.parse(readFileSync(join(dir, "trials", file), "utf8")) as TrialResult).result as AssistantJudged);
  }
  return { rubric: String(meta.rubricVersion), trials };
}

const rank = (run: string, item: { trial: string; criterion: string; turn?: number }) => createHash("sha256").update(`${run}/${item.trial}/${key(item.criterion, item.turn)}`).digest("hex");

/** A blind sample of `count` judge items from the run in `dir`, each with the question the judge was asked; the same every time for the same run. */
export function sample(dir: string, count = DEFAULT_ITEMS, fixtures: AssistantFixture[] = loadEveryAssistantFixture()): HandGrades {
  if (!Number.isInteger(count) || count < MIN_ITEMS) throw new Error(`Sample ${MIN_ITEMS} items at least: a rubric freezes only on ${MIN_ITEMS} graded items or more`);
  const run = runName(dir), { rubric, trials } = readRun(dir), byName = new Map(fixtures.map((f) => [f.name, f]));
  let system = "";
  const pool = [...trials].flatMap(([trial, result]) => {
    const fixture = byName.get(result.fixture);
    if (!fixture) throw new Error(`${trial}: no brief named ${result.fixture}`);
    const verdicts = verdictsOf(result);
    return judgeQuestions(result, fixture).flatMap((q) => {
      const verdict = verdicts.get(key(q.criterion, q.turn));
      system = q.system;
      return verdict === "yes" || verdict === "no" ? [{ trial, brief: result.fixture, criterion: q.criterion, ...(q.turn !== undefined && { turn: q.turn }), verdict, question: q.user }] : [];
    });
  });
  if (pool.length < count) throw new Error(`The run has ${pool.length} items the judge answered yes or no; ${count} were asked for`);
  // Each verdict's items spread over the briefs in turn, then "no" and "yes" items alternate while both last.
  const spread = (items: typeof pool) => {
    const byBrief = new Map<string, typeof pool>();
    for (const item of [...items].sort((a, b) => rank(run, a).localeCompare(rank(run, b)))) byBrief.set(item.brief, [...(byBrief.get(item.brief) ?? []), item]);
    const queues = [...byBrief.keys()].sort().map((b) => byBrief.get(b)!), out: typeof pool = [];
    while (queues.some((q) => q.length)) for (const q of queues) if (q.length) out.push(q.shift()!);
    return out;
  };
  const no = spread(pool.filter((i) => i.verdict === "no")), yes = spread(pool.filter((i) => i.verdict === "yes")), picked: typeof pool = [];
  while (picked.length < count) {
    const [first, second] = picked.length % 2 ? [yes, no] : [no, yes];
    picked.push((first.length ? first : second).shift()!);
  }
  return {
    run, rubric, instructions: system,
    items: picked.map(({ trial, criterion, turn, question }, i) => ({ id: i + 1, trial, ...(turn !== undefined && { turn }), criterion, human: null, note: "", question })),
  };
}

/** A block scalar that keeps any text as it is, indented under its key. */
const block = (text: string, indent: string) => `|2-\n${text.split("\n").map((l) => (l ? `${indent}  ${l}` : "")).join("\n")}`;
const quoted = (text: string) => JSON.stringify(text);

export function handGradesText(g: HandGrades): string {
  return [
    `# Hand grades for run ${g.run}, rubric ${g.rubric} (#49). README.md, "Grading the judge by hand".`,
    "# For each item, read the instructions and the question, then answer it yourself as the judge would: set human to yes or no,",
    "# and write a note on anything unclear. Grade from what the question shows, nothing else, and never look at the judge's verdict first.",
    "# Leave human empty to skip an item. Then: bun apps/agent/eval/hand-grade.ts agree <run>",
    `run: ${quoted(g.run)}`,
    `rubric: ${quoted(g.rubric)}`,
    `instructions: ${block(g.instructions, "")}`,
    "items:",
    ...g.items.map((i) => [
      `  - id: ${i.id}`,
      `    trial: ${quoted(i.trial)}`,
      ...(i.turn !== undefined ? [`    turn: ${i.turn}`] : []),
      `    criterion: ${quoted(i.criterion)}`,
      `    human: ${i.human ?? ""}`,
      `    note: ${quoted(i.note)}`,
      `    question: ${block(i.question, "    ")}`,
    ].join("\n")),
  ].join("\n") + "\n";
}

/** The items of a hand-grades file that a person graded, as calibration items of its run; the rest are counted as left. */
export function gradedItems(text: string): { run: string; rubric: string; graded: CalibrationItem[]; left: number } {
  const raw = Bun.YAML.parse(text) as any;
  if (typeof raw?.run !== "string" || !Array.isArray(raw.items)) throw new Error("A hand-grades file has a run and a list of items");
  const graded: CalibrationItem[] = [];
  let left = 0;
  for (const item of raw.items) {
    const human = item?.human === true ? "yes" : item?.human === false ? "no" : item?.human;
    if (human === null || human === undefined || human === "") { left++; continue; }
    if (human !== "yes" && human !== "no") throw new Error(`Item ${item.id}: human is yes, no, or empty to skip it, not ${human}`);
    graded.push({ run: raw.run, trial: String(item.trial), ...(Number.isInteger(item.turn) && { turn: item.turn }), criterion: String(item.criterion), human, ...(item.note ? { note: String(item.note) } : {}) });
  }
  return { run: raw.run, rubric: String(raw.rubric), graded, left };
}

/** How often the judge's verdicts in `dir` agree with the grades in `file`, and how many items are still ungraded. */
export function agreement(dir: string, file = join(dir, FILE)): string {
  const { run, rubric, graded, left } = gradedItems(readFileSync(file, "utf8")), { trials } = readRun(dir);
  if (run !== runName(dir)) throw new Error(`${file} grades run ${run}, not ${runName(dir)}`);
  const text = agreementText(rubric, run, trials, graded, basename(file)) ?? `No item of ${basename(file)} is graded yet.`;
  return left ? `${text}\n\n${left} items are not graded yet.` : text;
}

/** Adds the graded items of `file` to calibration/<rubric>.yaml, keeping its comments; an item already there is not added twice. */
export function keep(file: string, calibration = join(EVAL_DIR, "calibration")): { path: string; added: number } {
  const { rubric, graded } = gradedItems(readFileSync(file, "utf8")), path = join(calibration, `${rubric}.yaml`);
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const existing = ((before && Bun.YAML.parse(before)) || []) as CalibrationItem[];
  const id = (i: CalibrationItem) => `${i.run}/${i.trial}/${key(i.criterion, i.turn)}`, seen = new Set(existing.map(id));
  const fresh = graded.filter((i) => !seen.has(id(i)));
  const all = [...existing, ...fresh];
  const comments = before.split("\n").filter((l) => l.startsWith("#"));
  const line = (i: CalibrationItem) => `- { run: ${quoted(i.run)}, trial: ${quoted(i.trial)}, ${i.turn !== undefined ? `turn: ${i.turn}, ` : ""}criterion: ${quoted(i.criterion)}, human: ${i.human}${i.note ? `, note: ${quoted(i.note)}` : ""} }`;
  writeFileSync(path, [...comments, ...(all.length ? all.map(line) : ["[]"])].join("\n") + "\n");
  return { path, added: fresh.length };
}

if (import.meta.main) {
  const [command, dir, extra] = process.argv.slice(2);
  if (command === "sample" && dir) {
    const out = join(dir, FILE);
    if (existsSync(out)) throw new Error(`${out} exists; grade it, or move it away to sample again`);
    const grades = sample(dir, extra ? Number(extra) : DEFAULT_ITEMS);
    writeFileSync(out, handGradesText(grades));
    console.log(`${grades.items.length} items to grade: ${out}`);
  } else if (command === "agree" && dir) {
    const text = agreement(dir, extra ?? join(dir, FILE));
    writeFileSync(join(dir, "hand-agreement.md"), `${text}\n`);
    console.log(text);
  } else if (command === "keep" && dir) {
    const { path, added } = keep(extra ?? join(dir, FILE));
    console.log(`${added} graded items added to ${path}`);
  } else throw new Error("Usage: hand-grade.ts sample <run> [count] | agree <run> [file] | keep <run> [file]");
}
