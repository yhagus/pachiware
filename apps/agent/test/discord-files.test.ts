import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { attachment, image } from "./support/images";
import { pdf } from "./support/documents";

const turnOf = (s: any, call = 0) => s.model.calls[call]!.at(-2)!.content as string;

discordScenario("a PDF sent with a mention is filed under files/ and the turn names the path", async (s) => {
  const report = attachment(s, "report.pdf", pdf(["Quarterly report"]), { contentType: "application/pdf" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} here is the report`, { attachments: [report] });
  expect(turnOf(s)).toBe("Alice (<@user-alice>): here is the report [file: report.pdf saved as channel/files/report.pdf; text in channel/files/report.md]");
  expect(s.http.requests.map((r) => r.url)).toEqual([report.url]);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/files")).toEqual(["guilds/guild-1/channels/channel-1/files/report.md", "guilds/guild-1/channels/channel-1/files/report.pdf"]);
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/files/report.pdf")).toBe(new TextDecoder().decode(pdf(["Quarterly report"])));
});

discordScenario("a second file with the same name is kept beside the first as -2", async (s) => {
  const first = attachment(s, "report.pdf", pdf(["v1"]), { contentType: "application/pdf" });
  const second = attachment(s, "report.pdf", pdf(["v2"]), { contentType: "application/pdf" });
  s.model.script("Filed.", "Filed again.");
  await s.discord.send(`${s.discord.mention} v1`, { attachments: [first] });
  await s.discord.send(`${s.discord.mention} v2`, { attachments: [second] });
  expect(turnOf(s, 1)).toBe("Alice (<@user-alice>): v2 [file: report.pdf saved as channel/files/report-2.pdf; text in channel/files/report-2.md]");
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/files")).toEqual(["guilds/guild-1/channels/channel-1/files/report-2.md", "guilds/guild-1/channels/channel-1/files/report-2.pdf", "guilds/guild-1/channels/channel-1/files/report.md", "guilds/guild-1/channels/channel-1/files/report.pdf"]);
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/files/report.md")).toBe("v1\n");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/files/report-2.md")).toBe("v2\n");
});

discordScenario("a 12 MB file and a file of another type stay placeholders with the reason; images are unchanged", async (s) => {
  const big = attachment(s, "archive.pdf", null, { contentType: "application/pdf", size: 12 * 1024 * 1024 });
  const tool = attachment(s, "setup.exe", null, { contentType: "application/octet-stream", size: 500 });
  const shot = await image(s, "screenshot.png", 300, 200);
  s.model.script("Noted.");
  const ask = await s.discord.send(`${s.discord.mention} keep these`, { attachments: [big, tool, shot] });
  expect(turnOf(s)).toBe(`Alice (<@user-alice>): keep these [file: archive.pdf (message ${ask.id}): not filed: over 10 MB] [file: setup.exe (message ${ask.id}): not filed: not a PDF, DOCX, XLSX, CSV, MD or TXT] [image: screenshot.png, 300×200]`);
  expect(s.http.requests).toEqual([]);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/files")).toEqual([]);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Noted.\nI can't see images with this profile.");
});

discordScenario("in an always-on channel a file sent without addressing the bot keeps a placeholder with the message id", async (s) => {
  await s.guildSettings({ alwaysChannelIds: ["channel-1"] });
  const report = attachment(s, "report.pdf", pdf(["Friday"]), { contentType: "application/pdf" });
  s.model.script("Seen.");
  const post = await s.discord.send("the report for Friday", { attachments: [report] });
  expect(turnOf(s)).toBe(`Alice (<@user-alice>): the report for Friday [file: report.pdf (message ${post.id})]`);
  expect(s.http.requests).toEqual([]);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/files")).toEqual([]);
});

discordScenario("a file sent in a DM is filed under the DM's folder", async (s) => {
  const dm = s.discord.channel("dm-alice", { dm: true });
  const notes = attachment(s, "notes.md", new TextEncoder().encode("# Notes\n"), { contentType: "text/markdown" });
  s.model.script("Filed.");
  await s.discord.send("my notes", { channel: dm, attachments: [notes] });
  expect(turnOf(s)).toBe("my notes [file: notes.md saved as dm/files/notes.md]");
  expect(await s.workspace.read("dms/user-alice/files/notes.md")).toBe("# Notes\n");
});

const saved = (turn: any) => (turn.toolResults[0].error ? `refused: ${turn.toolResults[0].error}` : `Saved as ${turn.toolResults[0].path}`);

discordScenario("in an always-on channel a file posted to colleagues is left alone; saveAttachment on that message files it", async (s) => {
  await s.guildSettings({ alwaysChannelIds: ["channel-1"] });
  const report = attachment(s, "report.pdf", pdf(["v1"]), { contentType: "application/pdf" });
  s.model.script("Seen.");
  const post = await s.discord.send("the report for Friday", { attachments: [report] });
  expect(turnOf(s)).toBe(`Alice (<@user-alice>): the report for Friday [file: report.pdf (message ${post.id})]`);
  expect(s.http.requests).toEqual([]);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/files")).toEqual([]);

  s.model.script({ tool: "saveAttachment", args: { messageId: post.id } }, saved);
  await s.discord.send(`${s.discord.mention} save that file`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Saved as channel/files/report.pdf");
  expect(s.http.requests.map((r) => r.url)).toEqual([report.url]);
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/files/report.pdf")).toBe(new TextDecoder().decode(pdf(["v1"])));
});

discordScenario("saveAttachment picks the attachment by name, keeps a taken name beside the first, and refuses the same files the turn would", async (s) => {
  await s.guildSettings({ alwaysChannelIds: ["channel-1"], language: "en" });
  const first = attachment(s, "report.pdf", pdf(["v1"]), { contentType: "application/pdf" });
  const second = attachment(s, "report.pdf", pdf(["v2"]), { contentType: "application/pdf" });
  const notes = attachment(s, "notes.md", null, { contentType: "text/markdown", size: 40 });
  const tool = attachment(s, "setup.exe", null, { contentType: "application/octet-stream", size: 500 });
  s.model.script("Filed.", "Seen.");
  await s.discord.send(`${s.discord.mention} v1`, { attachments: [first] });
  const post = await s.discord.send("v2, my notes and the installer", { attachments: [second, notes, tool] });

  s.model.script({ tool: "saveAttachment", args: { messageId: post.id } }, saved);
  await s.discord.send(`${s.discord.mention} save the files from that message`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("refused: That message holds several files: report.pdf, notes.md. Say which one.");

  s.model.script({ tool: "saveAttachment", args: { messageId: post.id, name: "report.pdf" } }, saved);
  await s.discord.send(`${s.discord.mention} save the report`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Saved as channel/files/report-2.pdf");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/files/report-2.pdf")).toBe(new TextDecoder().decode(pdf(["v2"])));

  s.model.script({ tool: "saveAttachment", args: { messageId: post.id, name: "setup.exe" } }, saved);
  await s.discord.send(`${s.discord.mention} and the installer`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("refused: not filed: not a PDF, DOCX, XLSX, CSV, MD or TXT");

  s.model.script({ tool: "saveAttachment", args: { messageId: "999999" } }, saved);
  await s.discord.send(`${s.discord.mention} save the file from message 999999`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("refused: I can't find that message in this channel.");
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/files")).toEqual(["guilds/guild-1/channels/channel-1/files/report-2.md", "guilds/guild-1/channels/channel-1/files/report-2.pdf", "guilds/guild-1/channels/channel-1/files/report.md", "guilds/guild-1/channels/channel-1/files/report.pdf"]);
});
