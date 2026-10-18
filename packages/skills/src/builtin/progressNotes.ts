import type { SkillContext } from "../types.js";
import { DEFAULT_TIMEZONE, wallClock } from "../clock.js";

/** A Progress note: who reported what about a task, and on which date (YYYY-MM-DD in the place's time zone). */
export interface ProgressNote { on: string; by: string; text: string }
export const NOTES_HEADING = "## Progress notes";
const NOTE_LINE = /^- (\d{4}-\d{2}-\d{2}) (.+?): (.*)$/;
/** One note as the task file and the detail view print it: `- 2026-03-10 Alice: called the venue`. */
export const noteLine = (n: ProgressNote) => `- ${n.on} ${n.by}: ${n.text}`;
/** A note by the person speaking this turn, dated today in the place's time zone. Text and name are kept to one line so the file reads back the same. */
export function progressNote(ctx: Pick<SkillContext, "userName" | "userId" | "timezone">, text: unknown): ProgressNote {
  const line = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!line) throw new Error("Progress note text is required");
  if (line.length > 1000) throw new Error("Progress note is too long (max 1000 characters)");
  const w = wallClock(ctx.timezone ?? DEFAULT_TIMEZONE), pad = (n: number) => String(n).padStart(2, "0");
  const by = (ctx.userName || ctx.userId || "someone").replace(/:\s+/g, " ").replace(/\s+/g, " ").trim();
  return { on: `${w.year}-${pad(w.month)}-${pad(w.day)}`, by, text: line };
}
/**
 * A task body split into its description and its Progress notes. The notes section is the last `## Progress notes` heading
 * when every line after it is a note (a line that is not continues the note above); otherwise the whole body is the description.
 */
export function parseBody(text: string): { description: string | null; notes: ProgressNote[]; history: HistoryLine[] } {
  const { rest: body, history } = splitHistory(text);
  const lines = body.split(/\r?\n/), at = lines.findLastIndex((l) => l.trim() === NOTES_HEADING);
  const notes: ProgressNote[] = [];
  for (const line of at < 0 ? [] : lines.slice(at + 1).map((l) => l.trim()).filter(Boolean)) {
    const m = NOTE_LINE.exec(line);
    if (m) notes.push({ on: m[1]!, by: m[2]!, text: m[3]! });
    else if (notes.length) notes.at(-1)!.text += ` ${line}`;
    else return { description: body.trim() || null, notes: [], history };
  }
  return { description: (at < 0 ? body : lines.slice(0, at).join("\n")).trim() || null, notes, history };
}
/** The body a task file stores: the description, then the notes section when there are notes, then the History section when there is history. */
export function renderBody(description: string | null, notes: readonly ProgressNote[] = [], history: readonly HistoryLine[] = []): string {
  const section = notes.length ? `${NOTES_HEADING}\n${notes.map(noteLine).join("\n")}\n` : "";
  const body = description ? `${description}\n${section && `\n${section}`}` : section || "\n";
  return history.length ? `${body.trimEnd() ? `${body.trimEnd()}\n\n` : ""}${HISTORY_HEADING}\n${history.map(historyLine).join("\n")}\n` : body;
}

/** A change the bot made to a task's fields: when (in the place's zone), who asked, and what changed (#250). It is the task's record, not a Progress note. */
export interface HistoryLine { at: string; by: string; text: string }
export const HISTORY_HEADING = "## History";
const HISTORY_LINE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) (.+?): (.*)$/;
/** One line as the task file prints it: `- 2026-10-19 10:02 Alice: status pending → completed`. */
export const historyLine = (h: HistoryLine) => `- ${h.at} ${h.by}: ${h.text}`;
/** A history line by the person speaking this turn, at this minute in the place's time zone. */
export function historyEntry(ctx: Pick<SkillContext, "userName" | "userId" | "timezone">, text: string): HistoryLine {
  const w = wallClock(ctx.timezone ?? DEFAULT_TIMEZONE), pad = (n: number) => String(n).padStart(2, "0");
  const by = (ctx.userName || ctx.userId || "someone").replace(/:\s+/g, " ").replace(/\s+/g, " ").trim();
  return { at: `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}:${pad(w.minute)}`, by, text: text.replace(/\s+/g, " ").trim() };
}
/** The History section, when the body ends with one whose every line is a history line; the body before it is the rest. */
function splitHistory(body: string): { rest: string; history: HistoryLine[] } {
  const lines = body.split(/\r?\n/), at = lines.findLastIndex((l) => l.trim() === HISTORY_HEADING);
  if (at < 0) return { rest: body, history: [] };
  const history: HistoryLine[] = [];
  for (const line of lines.slice(at + 1).map((l) => l.trim()).filter(Boolean)) {
    const m = HISTORY_LINE.exec(line);
    if (!m) return { rest: body, history: [] };
    history.push({ at: m[1]!, by: m[2]!, text: m[3]! });
  }
  return { rest: lines.slice(0, at).join("\n"), history };
}
