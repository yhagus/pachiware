import TurndownService from "turndown";

/** HTML as Markdown, set up once for Plane's descriptions and comments and for HTML Documents. */
export const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "_" });

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

// An image keeps only its alt text: its address may be a presigned download link, which must never reach the channel, or the
// base64 data address a saved page inlines, which would fill the text.
turndown.addRule("image", { filter: "img", replacement: (_c, node) => `[image${(node as any).getAttribute?.("alt") ? `: ${(node as any).getAttribute("alt")}` : ""}]` });
