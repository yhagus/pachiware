/**
 * Citations are rendered by the server (ADR 0014): a tool gives each source a ref ("K1", "G2") with a label and, when it can build
 * one, a link; the model writes only the ref, and the final reply gets the label and link in its place. Any link left in the reply
 * must appear in what the model was given this turn, or it goes.
 */

/** A source as a tool cited it. */
export type Citation = { label: string; url?: string };

const REF = /^[KTGPR]\d+$/;
/** A bracket holding a ref, that is not the text of a Markdown link: "[K1]", "[K2/K1]", "[K1 was only a pricing decision]". */
const BRACKET_WITH_REF = /\[([^[\]\n]*\b[KTGPR]\d+\b[^[\]\n]*)\](?!\()/g;
const BETWEEN_REFS = /\s*[,/;&+]\s*|\s+(?:and|dan)\s+|\s+/;

/** Every `{ ref, label, url? }` a tool result holds, at any depth, by ref. The first one given for a ref wins. */
export function citationsIn(results: unknown[]): Map<string, Citation> {
  const found = new Map<string, Citation>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) { for (const v of value) walk(v); return; }
    if (!value || typeof value !== "object") return;
    const o = value as Record<string, unknown>;
    if (typeof o.ref === "string" && REF.test(o.ref) && typeof o.label === "string" && !found.has(o.ref)) {
      found.set(o.ref, { label: o.label, ...(typeof o.url === "string" ? { url: o.url } : {}) });
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(results);
  return found;
}

/** A label as the text of a Markdown link: brackets would end it early. */
const linkText = (label: string) => label.replace(/[[\]]/g, "");

/**
 * The reply with each known ref replaced by its label, linked when it has a link ("[#audio · Minutes 2026-09-01](<https://…>)"; the
 * angle brackets keep Discord from previewing it), and every unknown ref-shaped token removed; `unknown` names those. A bracket of
 * several refs ("[K2/K1]") renders each; a bracket holding words of the model's own beside a ref is an aside and goes whole.
 */
export function renderCitations(reply: string, citations: Map<string, Citation>): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  let removed = false;
  const render = (ref: string) => {
    const c = citations.get(ref);
    if (!c) { unknown.push(ref); return ""; }
    return c.url ? `[${linkText(c.label)}](<${c.url}>)` : c.label;
  };
  const text = reply.replace(BRACKET_WITH_REF, (_, inside: string) => {
    const refs = inside.trim().split(BETWEEN_REFS);
    const shown = refs.every((r) => REF.test(r)) ? refs.map(render).filter(Boolean).join(" ") : "";
    if (!shown) removed = true;
    return shown;
  });
  return { text: removed ? tidy(text) : text, unknown };
}

const LINK = /\[([^\]\n]*)\]\(<?(https?:\/\/[^\s)>]+)>?\)|<?(https?:\/\/[^\s<>)\]]+)>?/g;
const TRAILING = /[.,;:!?'"]+$/;

/**
 * The reply without the links that appear nowhere in `known` (the tool results of the turn and every message the model was sent):
 * a masked link keeps its text, a bare link goes. With `keep`, nothing is removed and `dropped` still names them.
 */
export function checkLinks(reply: string, known: string, keep = false): { text: string; dropped: string[] } {
  const dropped: string[] = [];
  const text = reply.replace(LINK, (match, masked: string | undefined, maskedUrl: string | undefined, bare: string | undefined) => {
    if (maskedUrl) {
      if (known.includes(maskedUrl)) return match;
      dropped.push(maskedUrl);
      return keep ? match : masked ?? "";
    }
    const url = bare!.replace(TRAILING, ""), after = bare!.slice(url.length);
    if (known.includes(url)) return match;
    dropped.push(url);
    return keep ? match : after;
  });
  return { text: dropped.length && !keep ? tidy(text) : text, dropped };
}

/** Spaces a removal left behind: doubled, or before punctuation, or at a line's end. */
const tidy = (text: string) => text.replace(/[ \t]{2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").replace(/[ \t]+$/gm, "");
