/**
 * Plane stores descriptions and comments as HTML only. What Plane sends back reaches the model as Markdown, through
 * `planeMarkdown`; Markdown from the model goes to Plane through its counterpart when write tools need it.
 */
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "_" });

// An image's address may be a presigned download link, which must never reach the channel: only its alt text is kept.
turndown.addRule("image", { filter: "img", replacement: (_c, node) => `[image${(node as any).getAttribute?.("alt") ? `: ${(node as any).getAttribute("alt")}` : ""}]` });
turndown.addRule("planeImage", { filter: (node) => node.nodeName === "IMAGE-COMPONENT", replacement: () => "[image]" });

// Mentions in Plane's editor carry the user's id; the names passed to the current call turn it into a name.
let mentionNames = new Map<string, string>();
turndown.addRule("mention", {
  filter: (node) => node.nodeName === "MENTION-COMPONENT",
  replacement: (_c, node) => `@${mentionNames.get(String((node as any).getAttribute?.("entity_identifier") ?? "")) ?? "member"}`,
});

/** Plane HTML as Markdown. Empty paragraphs and Plane's empty description ("<p></p>") come back as "". */
export function planeMarkdown(html: string | null | undefined, names: Map<string, string> = new Map()): string {
  if (!html || !html.trim()) return "";
  mentionNames = names;
  return turndown.turndown(html).replace(/\n{3,}/g, "\n\n").trim();
}

/** A value that may be HTML (activity values on a description), as Markdown, cut to `max` characters. */
export function planeText(value: unknown, max = 500): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "string" && /<[a-z][\s\S]*>/i.test(value) ? planeMarkdown(value) : String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
