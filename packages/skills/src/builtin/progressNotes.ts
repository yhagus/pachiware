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
export function parseBody(body: string): { description: string | null; notes: ProgressNote[] } {
  const lines = body.split(/\r?\n/), at = lines.findLastIndex((l) => l.trim() === NOTES_HEADING);
  const notes: ProgressNote[] = [];
  for (const line of at < 0 ? [] : lines.slice(at + 1).map((l) => l.trim()).filter(Boolean)) {
    const m = NOTE_LINE.exec(line);
    if (m) notes.push({ on: m[1]!, by: m[2]!, text: m[3]! });
    else if (notes.length) notes.at(-1)!.text += ` ${line}`;
    else return { description: body.trim() || null, notes: [] };
  }
  return { description: (at < 0 ? body : lines.slice(0, at).join("\n")).trim() || null, notes };
}
/** The body a task file stores: the description, then the notes section when there are notes. */
export function renderBody(description: string | null, notes: readonly ProgressNote[] = []): string {
  const section = notes.length ? `${NOTES_HEADING}\n${notes.map(noteLine).join("\n")}\n` : "";
  return description ? `${description}\n${section && `\n${section}`}` : section || "\n";
}
