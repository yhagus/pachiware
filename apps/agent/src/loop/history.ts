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

// Stored tool rows are replayed on every later turn, so they keep only what names the outcome; the live turn reads the full result.
export const STORED_TOOL_RESULT = 800;
const KEPT_FIELD = /^(success|id|title|name|path|from|to|status|url|number|line|message|total|count|removed|pending|summary|version|level|error)$|Id$/;
// An error or message can say what to do next (a refused bulk: make the same calls again after the yes), so it keeps more.
const REASON_FIELD = /^(message|error)$/;
const KEPT_ITEMS = 10, KEPT_TEXT = 160, KEPT_REASON = 600, KEPT_DEPTH = 3;

function shorten(value: unknown, depth: number, maxText = KEPT_TEXT): unknown {
  if (typeof value === "string") return value.length > maxText ? `${value.slice(0, maxText)}…` : value;
  if (value === null || typeof value !== "object") return value;
  if (depth >= KEPT_DEPTH) return undefined;
  if (Array.isArray(value)) {
    const items = value.slice(0, KEPT_ITEMS).map((item) => shorten(item, depth + 1)).filter((item) => item !== undefined);
    if (!items.length) return undefined;
    return value.length > KEPT_ITEMS ? [...items, `+${value.length - KEPT_ITEMS} more`] : items;
  }
  const kept: Record<string, unknown> = {}, omitted: string[] = [];
  for (const [key, field] of Object.entries(value)) {
    const short = KEPT_FIELD.test(key) || (field !== null && typeof field === "object") ? shorten(field, depth + 1, REASON_FIELD.test(key) ? KEPT_REASON : KEPT_TEXT) : undefined;
    if (short === undefined) omitted.push(key);
    else kept[key] = short;
  }
  if (!Object.keys(kept).length && depth > 0) return undefined;
  // Named so the model knows to call the tool again rather than guess what was there.
  if (omitted.length) kept.omitted = omitted;
  return kept;
}

/** Success or error plus the result's identifying fields (ids, titles, paths, status), as JSON of at most STORED_TOOL_RESULT characters. */
export function storedToolResult(result: { success: boolean; data?: unknown; error?: string }): string {
  const data = shorten(result.data, 0);
  const { success: _success, ...fields } = data !== null && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : data === undefined ? {} : { data };
  // A tool that refused on its own (an ambiguous name, "Nothing was changed") still returns; its result says so.
  const short = !result.success ? { success: false, error: shorten(result.error ?? "failed", 0, KEPT_REASON) }
    : { success: (result.data as { success?: unknown } | undefined)?.success !== false, ...fields };
  const json = JSON.stringify(short);
  return json.length > STORED_TOOL_RESULT ? `${json.slice(0, STORED_TOOL_RESULT)}…[shortened; call the tool again for details]` : json;
}
