import { DEFAULT_PLAYBOOK_WORKERS, MAX_PLAYBOOK_WORKERS, MIN_PLAYBOOK_WORKERS, repositories } from "@pachiware/db";
import type { RepositoryTool } from "./changelog.js";
import type { WorkerOutcome, Workers } from "../types.js";

/**
 * What an API changelog's workers share, whether they map its changed files (ADR 0026) or trace its endpoints (ADR 0024): the budget, the
 * repository reads, how many run at once, and the loop that hands them work while the turn has time.
 */

/** A worker's steps and time (ADR 0024), and the least a turn must have left to start one; tests shorten them. */
export const workerBudget = { steps: 20, ms: 5 * 60_000, leastMs: 60_000 };
/** The repository reads a worker is offered: reading, diffing and searching files, not comparing or listing commits. */
export const WORKER_READS: RepositoryTool[] = ["repoReadFile", "repoFileDiff", "repoSearchCode", "repoTree"];

/** How many workers a changelog runs at once: the tenant's `playbookWorkers`, mapping and tracing workers alike. */
export async function workerLimit(tenantId: string) {
  const config = await repositories().agentConfig.get(tenantId);
  return Math.max(MIN_PLAYBOOK_WORKERS, Math.min(MAX_PLAYBOOK_WORKERS, Number(config?.settings?.playbookWorkers) || DEFAULT_PLAYBOOK_WORKERS));
}

/** What stopped the work short, so what is left waits: the model or a service failing, the asker's Stop, or the turn's time. */
export type Halt = NonNullable<WorkerOutcome["halted"]> | "time";

/** Whether the turn's time, not the worker's own, cut it short: it was given less than its whole budget and ran out of it. */
export const cutByTurn = (outcome: WorkerOutcome, ms: number) => outcome.ranOut === "time" && ms < workerBudget.ms;

/** Why a worker ended before `doing` ("mapping it", "recording it") when it spent its own steps or time, as the draft keeps the reason; else null. */
export function ranOut(outcome: WorkerOutcome, doing: string) {
  if (outcome.ranOut === "steps") return `its worker used all ${workerBudget.steps} steps before ${doing}`;
  if (outcome.ranOut === "time") return `its worker ran out of its ${Math.round(workerBudget.ms / 60_000)} minutes before ${doing}`;
  return null;
}

/**
 * Runs workers on what `source` hands out, at most `limit` at once, each given the turn's time left up to its budget, while at least
 * `leastMs` is left. `work` runs one and says what halted it, if anything: then no more start. Returns the first halt, or null when the
 * source ran dry.
 */
export async function fanOut<T>(workers: Workers, limit: number, source: { more(): boolean; take(): T }, work: (item: T, ms: number) => Promise<Halt | null>): Promise<Halt | null> {
  let halted: Halt | null = null;
  const slot = async () => {
    while (!halted && source.more()) {
      const left = workers.timeLeft();
      if (left < workerBudget.leastMs) { halted = "time"; return; }
      const halt = await work(source.take(), Math.min(workerBudget.ms, left));
      halted ??= halt;
    }
  };
  await Promise.all(Array.from({ length: limit }, slot));
  return halted;
}
