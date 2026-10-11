import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalResult } from "./run";

export interface RunMeta { profile: { provider: string; model: string }; repo: string; commit: string; startedAt: string }

/** Writes `report.json` (everything) and `report.md` (a summary to read) into `dir`. */
export function writeReport(dir: string, meta: RunMeta, results: EvalResult[]) {
  mkdirSync(dir, { recursive: true });
  const passed = results.filter((r) => r.passed).length;
  writeFileSync(join(dir, "report.json"), `${JSON.stringify({ ...meta, summary: { briefs: results.length, passed }, results }, null, 2)}\n`);
  const seconds = (ms?: number) => (ms === undefined ? "" : `${Math.round(ms / 1000)} s`);
  const md = [
    `# Issue-draft eval, ${meta.startedAt}`,
    "",
    `Profile: ${meta.profile.provider} / ${meta.profile.model}. Repository: ${meta.repo} at \`${meta.commit.slice(0, 7)}\`.`,
    "",
    `Code checks passed for ${passed} of ${results.length} briefs.`,
    "",
    "| Brief | Drafts | Code checks | Time | Tokens in / out |",
    "|---|---|---|---|---|",
    ...results.map((r) => `| ${r.fixture} | ${r.drafts.length} | ${r.passed ? "pass" : `${r.failures.length} failed`} | ${seconds(r.ms)} | ${r.tokens ? `${r.tokens.prompt} / ${r.tokens.completion}` : ""} |`),
    ...results.filter((r) => !r.passed).flatMap((r) => ["", `## ${r.fixture}`, "", ...r.failures.map((f) => `- ${f.draft === null ? "" : `Draft ${f.draft}, `}${f.check}: ${f.message}`)]),
  ];
  writeFileSync(join(dir, "report.md"), `${md.join("\n")}\n`);
}
