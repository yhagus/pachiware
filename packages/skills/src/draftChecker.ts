/**
 * Deterministic checks of an issue draft against the anatomy and the detail budget. Pure: the same
 * function gates a draft before the bot posts it and grades drafts in the eval.
 */
export const DRAFT_LIMITS = { title: 70, acceptanceCriteria: 7, openQuestions: 5, body: 4096 } as const;
/** Section headings in the order a draft holds them. */
export const DRAFT_SECTIONS = ["Summary", "Current behaviour", "Desired behaviour", "Acceptance criteria", "Out of scope", "Open questions", "Blocked by"] as const;
export const REQUIRED_SECTIONS = ["Summary", "Desired behaviour", "Acceptance criteria", "Out of scope"] as const;
export const FOOTER_MARK = "Drafted by";

export type DraftRule = "title" | "body" | "section" | "order" | "empty" | "acceptanceCriteria" | "openQuestions" | "paths" | "footer";
export interface DraftViolation { rule: DraftRule; message: string }

const EMPTY = /^(n\/?a|none|-|tbd)\.?$/i;
/** A slash path ending in a file extension, or a file with a line number ("session.ts:42"). */
const PATH = /(?<![\w/.-])((?:[\w.-]+\/)+[\w-]+\.[A-Za-z]\w{0,5}(?::\d+)?|[\w-]+\.[A-Za-z]\w{0,5}:\d+)(?![\w/])/g;

/** Every way the draft breaks the anatomy or the budget; empty when it is fine. */
export function checkDraft({ title, body }: { title: string; body: string }): DraftViolation[] {
  const out: DraftViolation[] = [];
  const add = (rule: DraftRule, message: string) => out.push({ rule, message });

  const t = title.trim();
  if (!t) add("title", "The title is empty.");
  else if (t.length > DRAFT_LIMITS.title) add("title", `The title is ${t.length} characters; at most ${DRAFT_LIMITS.title}.`);
  else if (/^\[[^\]]*\]/.test(t)) add("title", "The title starts with a [Category] prefix; labels carry the category.");
  if (body.length > DRAFT_LIMITS.body) add("body", `The body is ${body.length} characters; it must fit one embed of ${DRAFT_LIMITS.body}.`);

  // The footer follows the last horizontal rule; everything above it is sections.
  const rule = body.lastIndexOf("\n---\n");
  const footer = rule < 0 ? "" : body.slice(rule + 5);
  const main = rule < 0 ? body : body.slice(0, rule);
  const sections: { name: string; text: string }[] = [];
  for (const line of main.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) sections.push({ name: heading[1]!, text: "" });
    else if (sections.length) sections.at(-1)!.text += `${line}\n`;
    else if (line.trim()) { add("section", "Text sits before the first section; start with ## Summary."); break; }
  }

  const known = sections.filter((s) => (DRAFT_SECTIONS as readonly string[]).includes(s.name));
  for (const s of sections) if (!known.includes(s)) add("section", `"${s.name}" is not a section of the anatomy (${DRAFT_SECTIONS.join(", ")}).`);
  for (const name of REQUIRED_SECTIONS) if (!known.some((s) => s.name === name)) add("section", `The ${name} section is missing.`);
  const seen = new Set<string>();
  for (const s of known) { if (seen.has(s.name)) add("section", `The ${s.name} section appears twice.`); seen.add(s.name); }
  const order = known.map((s) => DRAFT_SECTIONS.indexOf(s.name as (typeof DRAFT_SECTIONS)[number]));
  if (order.some((o, i) => i && o < order[i - 1]!)) add("order", `Sections are out of order; keep ${DRAFT_SECTIONS.join(", ")}.`);
  for (const s of known) if (!s.text.trim() || EMPTY.test(s.text.trim())) add("empty", `The ${s.name} section is empty; leave an empty optional section out.`);

  const criteria = known.find((s) => s.name === "Acceptance criteria");
  if (criteria?.text.trim()) {
    const items = criteria.text.split("\n").filter((l) => l.trim());
    if (items.some((l) => !/^- \[ \] \S/.test(l))) add("acceptanceCriteria", "Every acceptance criterion is a \"- [ ] \" task-list item.");
    else if (items.length > DRAFT_LIMITS.acceptanceCriteria) add("acceptanceCriteria", `There are ${items.length} acceptance criteria; at most ${DRAFT_LIMITS.acceptanceCriteria}.`);
  }

  const open = known.find((s) => s.name === "Open questions");
  if (open?.text.trim()) {
    const need = /\*\*Still need from [^\n]*\*\*\n([\s\S]*)$/.exec(open.text);
    const established = /\*\*Established so far:\*\*/.test(open.text);
    const asks = need ? need[1]!.split("\n").filter((l) => /^- /.test(l)) : [];
    if (!need && !established) add("openQuestions", "Open questions take the needs-info shape: **Established so far:** and **Still need from @author:**.");
    else if (asks.length > DRAFT_LIMITS.openQuestions) add("openQuestions", `There are ${asks.length} open questions; at most ${DRAFT_LIMITS.openQuestions}.`);
    else if (asks.some((l) => !l.includes("➡️"))) add("openQuestions", "Every open question carries a recommended answer after ➡️.");
  }

  // Paths go stale while an issue waits; links may hold them, and the footer's Context used lists them on purpose.
  const prose = main.replace(/\]\([^)]*\)/g, "]").replace(/https?:\/\/\S+/g, "");
  const paths = [...new Set([...prose.matchAll(PATH)].map((m) => m[1]!))];
  if (paths.length) add("paths", `The body names the file path${paths.length > 1 ? "s" : ""} ${paths.join(", ")}; name the concept (type, function, glossary term) instead.`);

  if (!footer.includes(FOOTER_MARK)) add("footer", `The footer ("${FOOTER_MARK} … from a brief by …") is missing after a --- line.`);
  return out;
}
