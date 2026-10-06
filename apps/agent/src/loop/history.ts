export const HISTORY_SIZE = 30;
export const HISTORY_STEP = 10;

// A plain "last 30" window slides every turn, which changes the prompt prefix each time and defeats provider prompt caching.
// Advancing the start in steps keeps the prefix identical for HISTORY_STEP messages at a time.
export function historyOffset(total: number, size = HISTORY_SIZE, step = HISTORY_STEP) {
  return Math.floor(Math.max(0, total - size) / step) * step;
}

// A tool result without the assistant call before it is rejected by providers, so drop a leading orphan.
export function dropLeadingOrphans<T extends { role: string }>(rows: T[]): T[] {
  let i = 0;
  while (i < rows.length && rows[i].role === "tool") i++;
  return rows.slice(i);
}
