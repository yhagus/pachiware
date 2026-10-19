import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { attachment } from "./support/images";

// An HTML page is a Document read through the Markdown beside it, as a PDF is (#264): its script is never searched, its body is.

const FILES = "guilds/guild-1/channels/channel-1/files";
const turnOf = (s: any, call = 0) => s.model.calls[call]!.at(-2)!.content as string;
/** A page as a browser saves it: a title, a script holding a word found nowhere else, a nav, and the body's one fact. */
const PAGE = new TextEncoder().encode(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sinar Printing price list</title>
  <script>window.analyticsKey = "quokkameter";</script>
</head>
<body>
  <nav><a href="/">Home</a> · <a href="/contact">Contact</a></nav>
  <p>Brochures cost Rp 4.000.000 for 2,000 copies, delivered in five working days.</p>
</body>
</html>
`);
const MARKDOWN = "# Sinar Printing price list\n\n[Home](/) · [Contact](/contact)\n\nBrochures cost Rp 4.000.000 for 2,000 copies, delivered in five working days.\n";
const paths = (result: any) => (result.matches ?? result.kept ?? []).map((m: any) => m.path);

discordScenario("an HTML page sent to the bot is filed with its text as Markdown beside it; search and recall find its body, never its script", async (s) => {
  await s.guildSettings({ language: "en" });
  const page = attachment(s, "prices.html", PAGE, { contentType: "text/html; charset=utf-8" });
  s.model.script(
    "Kept.",
    { tool: "readFile", args: { path: "channel/files/prices.md" } }, (turn) => turn.toolResults[0].content,
    [{ tool: "searchFiles", args: { query: "brochures", path: "channel/files" } }, { tool: "searchFiles", args: { query: "quokkameter", path: "channel/files" } }],
    (turn) => JSON.stringify(turn.toolResults.map(paths)),
    [{ tool: "recall", args: { queries: ["brochure copies"] } }, { tool: "recall", args: { queries: ["quokkameter"] } }],
    (turn) => JSON.stringify(turn.toolResults.map(paths)),
  );
  await s.discord.send(`${s.discord.mention} keep this html, I'll ask you what's in it some day`, { attachments: [page] });
  expect(turnOf(s)).toBe("Alice (<@user-alice>): keep this html, I'll ask you what's in it some day [file: prices.html saved as channel/files/prices.html; text in channel/files/prices.md]");
  expect(await s.workspace.list(FILES)).toEqual([`${FILES}/prices.html`, `${FILES}/prices.md`]);

  await s.discord.send(`${s.discord.mention} what's in that page?`);
  expect(s.discord.botMessages.at(-1)?.content).toBe(MARKDOWN.trim());

  await s.discord.send(`${s.discord.mention} which file has the brochure price?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual([["channel/files/prices.md"], []]);

  await s.discord.send(`${s.discord.mention} did we keep a brochure price somewhere?`);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual([["channel/files/prices.md"], []]);
});

discordScenario("saveAttachment files an HTML page with its Markdown, and keepAsNote keeps that Markdown, not the page's HTML", async (s) => {
  s.clock.set("2026-10-19T03:00:00Z");
  await s.guildSettings({ alwaysChannelIds: ["channel-1"], language: "en" });
  const page = attachment(s, "prices.htm", PAGE, { contentType: "text/html" });
  s.model.script("Seen.");
  const post = await s.discord.send("the vendor's price page", { attachments: [page] });
  expect(await s.workspace.list(FILES)).toEqual([]);

  s.model.script(
    { tool: "saveAttachment", args: { messageId: post.id } }, (turn) => `Saved as ${turn.toolResults[0].path ?? turn.toolResults[0].error}, text in ${turn.toolResults[0].text}`,
    { tool: "keepAsNote", args: { document: "channel/files/prices.htm", path: "channel/notes/sinar-prices.md" } }, (turn) => `Kept as ${turn.toolResults[0].path ?? turn.toolResults[0].error}`,
  );
  await s.discord.send(`${s.discord.mention} save that file`, { author: s.discord.bob });
  expect(s.discord.botMessages.at(-1)?.content).toBe("Saved as channel/files/prices.htm, text in channel/files/prices.md");
  expect(await s.workspace.read(`${FILES}/prices.md`)).toBe(MARKDOWN);

  await s.discord.send(`${s.discord.mention} keep the price page as a note`, { author: s.discord.bob });
  expect(s.discord.botMessages.at(-1)?.content).toBe("Kept as channel/notes/sinar-prices.md");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/notes/sinar-prices.md")).toBe(
    `---\nsource: "channel/files/prices.htm"\nauthor: "Alice"\naskedBy: "Bob"\ndate: "2026-10-19"\n---\n${MARKDOWN}`,
  );
});

discordScenario("readFile on the page itself reads the Markdown its filing recorded, whole, with or without a question, and a page this short never asks the model", async (s) => {
  await s.guildSettings({ language: "en" });
  // An earlier prices.md is in files/, so the page's text is filed as prices-2.md: only the filing record says so.
  await s.workspace.write(`${FILES}/prices.md`, "Last year's prices, typed by hand.\n");
  const page = attachment(s, "prices.html", PAGE, { contentType: "text/html" });
  s.model.script("Kept.");
  await s.discord.send(`${s.discord.mention} keep this page`, { attachments: [page] });
  expect(await s.workspace.read(`${FILES}/prices-2.md`)).toBe(MARKDOWN);

  s.model.script(
    [{ tool: "readFile", args: { path: "channel/files/prices.html" } }, { tool: "readFile", args: { path: "channel/files/prices.html", question: "How much do brochures cost?" } }],
    (turn) => JSON.stringify(turn.toolResults.map((r: any) => ({ path: r.path, content: r.content, answer: r.answer }))),
  );
  const asked = s.model.calls.length;
  await s.discord.send(`${s.discord.mention} how much do brochures cost?`);
  expect(s.model.calls.length - asked).toBe(2);
  expect(JSON.parse(s.discord.botMessages.at(-1)!.content)).toEqual([{ path: "channel/files/prices-2.md", content: MARKDOWN }, { path: "channel/files/prices-2.md", content: MARKDOWN }]);
});
