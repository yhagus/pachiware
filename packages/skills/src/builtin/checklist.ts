/** One step of a task's checklist: a Markdown task-list line in its description, `- [ ] text` or `- [x] text`. */
export interface ChecklistItem { text: string; done: boolean }

const ITEM = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(\S.*)$/, FENCE = /^\s*(```|~~~)/;

/** The checklist lines of a description with their line index, outside code fences. */
function itemLines(lines: string[]): { at: number; item: ChecklistItem }[] {
  const out: { at: number; item: ChecklistItem }[] = [];
  let fenced = false;
  lines.forEach((line, at) => {
    if (FENCE.test(line)) { fenced = !fenced; return; }
    const m = !fenced && ITEM.exec(line);
    if (m) out.push({ at, item: { text: m[4]!.trim(), done: m[2] !== " " } });
  });
  return out;
}

/** The checklist in a task description, in order; empty when it has none. */
export const checklistOf = (description: string | null | undefined): ChecklistItem[] => (description ? itemLines(description.split("\n")).map((l) => l.item) : []);

/** The suffix a task line puts after the title: ` (2/5)` for two of five items done, nothing without a checklist. */
export function checklistSuffix(description: string | null | undefined): string {
  const items = checklistOf(description);
  return items.length ? ` (${items.filter((i) => i.done).length}/${items.length})` : "";
}

/** One item as the detail view prints it, numbered from 1 so a person can name it by position: `2. [x] Send the invitations`. */
export const checklistLine = (item: ChecklistItem, position: number) => `${position}. [${item.done ? "x" : " "}] ${item.text}`;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The description with one item ticked (`done`) or unticked. `item` names it by position counting from 1, or by its text in any
 * letter case, or by a part of its text that only one item contains. Throws, changing nothing, when no single item fits.
 */
export function tickItem(description: string | null, item: unknown, done: boolean): { description: string; item: ChecklistItem; done: number; total: number } {
  const lines = (description ?? "").split("\n"), items = itemLines(lines);
  if (!items.length) throw new Error("This task has no checklist.");
  const named = typeof item === "number" ? String(item) : typeof item === "string" ? item.trim() : "";
  if (!named) throw new Error("Name the checklist item by its text or its position.");
  let hit: (typeof items)[number] | undefined;
  if (/^#?\d+$/.test(named)) {
    hit = items[Number(named.replace("#", "")) - 1];
    if (!hit) throw new Error(`There is no checklist item ${named}: the checklist has ${items.length} items.`);
  } else {
    const q = norm(named), exact = items.filter((i) => norm(i.item.text) === q), part = items.filter((i) => norm(i.item.text).includes(q));
    const fits = exact.length ? exact : part;
    if (!fits.length) throw new Error(`No checklist item matches "${named.slice(0, 80)}".`);
    if (fits.length > 1) throw new Error(`"${named.slice(0, 80)}" matches several checklist items: ${fits.map((i) => `"${i.item.text}"`).join(", ")}. Name one by its position.`);
    hit = fits[0]!;
  }
  lines[hit.at] = lines[hit.at]!.replace(ITEM, (_, open: string, _mark: string, close: string, text: string) => `${open}${done ? "x" : " "}${close}${text}`);
  const after = checklistOf(lines.join("\n"));
  return { description: lines.join("\n"), item: { ...hit.item, done }, done: after.filter((i) => i.done).length, total: after.length };
}
