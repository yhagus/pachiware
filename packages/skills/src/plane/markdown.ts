/**
 * Plane stores descriptions and comments as HTML only. What Plane sends back reaches the model as Markdown, through
 * `planeMarkdown`; Markdown from the model goes to Plane through its counterpart when write tools need it.
 */
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "_" });

// List items with one space after the marker ("- a", "1. a") instead of turndown's padded "-   a", which reads oddly in Discord.
turndown.addRule("listItem", {
  filter: "li",
  replacement: (content, node, options) => {
    const parent = node.parentNode as any;
    const ordered = parent?.nodeName === "OL";
    const prefix = ordered ? `${Number(parent.getAttribute("start") || 1) + Array.prototype.indexOf.call(parent.children, node)}. ` : `${options.bulletListMarker} `;
    const body = content.replace(/^\n+/, "").replace(/\n+$/, "\n").replace(/\n/gm, `\n${" ".repeat(prefix.length)}`);
    return prefix + body + (node.nextSibling && !/\n$/.test(body) ? "\n" : "");
  },
});

// An image's address may be a presigned download link, which must never reach the channel: only its alt text is kept.
turndown.addRule("image", { filter: "img", replacement: (_c, node) => `[image${(node as any).getAttribute?.("alt") ? `: ${(node as any).getAttribute("alt")}` : ""}]` });

/**
 * Plane's editor writes mentions and images as empty custom elements, which turndown drops as blank. They become
 * placeholder words before the conversion and their text after it, so turndown neither drops nor escapes them.
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
