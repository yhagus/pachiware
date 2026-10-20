/**
 * Plane stores descriptions and comments as HTML only. What Plane sends back reaches the model as Markdown, through
 * `planeMarkdown`; Markdown from the model goes to Plane through `planeHtml`.
 */
import { Marked } from "marked";
import { turndown } from "../htmlMarkdown.js";

/**
 * Plane writes mentions and images as empty elements, which turndown drops, so they pass through as placeholder words.
 * A mention carries the user's id; `names` turns it into a name.
 */
function planeComponents(html: string, names: Map<string, string>): { html: string; restore: (md: string) => string } {
  const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1] ?? "";
  const texts: string[] = [];
  const hold = (text: string) => `planecomponent${texts.push(text) - 1}x`;
  const out = html
    .replace(/<mention-component\b[^>]*>(?:\s*<\/mention-component>)?/gi, (tag) => hold(`@${names.get(attr(tag, "entity_identifier")) ?? "member"}`))
    .replace(/<image-component\b[^>]*>(?:\s*<\/image-component>)?/gi, (tag) => hold(`[image${attr(tag, "alt") ? `: ${attr(tag, "alt")}` : ""}]`));
  return { html: out, restore: (md) => md.replace(/planecomponent(\d+)x/g, (_m, i) => texts[Number(i)] ?? "") };
}

/** Plane HTML as Markdown. Empty paragraphs and Plane's empty description ("<p></p>") come back as "". */
export function planeMarkdown(html: string | null | undefined, names: Map<string, string> = new Map()): string {
  if (!html || !html.trim()) return "";
  const held = planeComponents(html, names);
  return held.restore(turndown.turndown(held.html)).replace(/\n{3,}/g, "\n\n").trim();
}

/** A value that may be HTML (activity values on a description), as Markdown, cut to `max` characters. */
export function planeText(value: unknown, max = 500): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "string" && /<[a-z][\s\S]*>/i.test(value) ? planeMarkdown(value) : String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Text made safe to place inside Plane HTML, such as a name in the origin line. */
export const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Plane v1.3.1 keeps comment HTML as sent, without sanitizing it (v1.4.2 sanitizes it as it does descriptions), so raw HTML in
// the model's Markdown is shown as text and a link keeps only an http(s) or mailto address.
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html({ text, block }) { return block ? `<p>${escapeHtml(text.trim())}</p>` : escapeHtml(text); },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      return /^(https?:|mailto:)/i.test(href) ? `<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${text}</a>` : text;
    },
  },
});

/** Markdown from the model as the HTML Plane stores. */
export function planeHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  return marked.parse(markdown, { async: false }).replace(/>\n+</g, "><").trim();
}
