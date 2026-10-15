import { expect } from "bun:test";
import { discordScenario } from "./support/discordScenario";
import { attachment } from "./support/images";
import { docx, pdf } from "./support/documents";

const kept = (turn: any) => (turn.toolResults[0].error ? `refused: ${turn.toolResults[0].error}` : `Kept as ${turn.toolResults[0].path}`);

discordScenario("Bob keeps the minutes PDF Alice sent as a Note: the body is its text, the head says who wrote it, who asked and when, and the PDF stays", async (s) => {
  s.clock.set("2026-10-15T03:00:00Z");
  const minutes = attachment(s, "minutes.pdf", pdf(["Minutes of 14 October", "Badges arrive on the 20th"]), { contentType: "application/pdf" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} minutes from yesterday`, { attachments: [minutes] });

  s.model.script({ tool: "keepAsNote", args: { document: "channel/files/minutes.pdf", path: "channel/notes/2026-10-14-minutes.md" } }, kept);
  await s.discord.send(`${s.discord.mention} keep those minutes as a note`, { author: s.discord.bob });
  expect(s.discord.botMessages.at(-1)?.content).toBe("Kept as channel/notes/2026-10-14-minutes.md");
  const text = await s.workspace.read("guilds/guild-1/channels/channel-1/files/minutes.md");
  expect(text).toBe("Minutes of 14 October\nBadges arrive on the 20th\n");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/notes/2026-10-14-minutes.md")).toBe(
    `---\nsource: "channel/files/minutes.pdf"\nauthor: "Alice"\naskedBy: "Bob"\ndate: "2026-10-15"\n---\n${text}`,
  );
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/files")).toEqual(["guilds/guild-1/channels/channel-1/files/minutes.md", "guilds/guild-1/channels/channel-1/files/minutes.pdf"]);
});

discordScenario("an email pasted as message.txt, far longer than a tool argument may be, is kept whole and unchanged", async (s) => {
  s.clock.set("2026-10-15T03:00:00Z");
  const email = Array.from({ length: 400 }, (_, i) => `Line ${i + 1}: the vendor confirms delivery of batch ${i + 1} on schedule.`).join("\n") + "\n";
  expect(email.length).toBeGreaterThan(3 * 8000);
  const pasted = attachment(s, "message.txt", new TextEncoder().encode(email), { contentType: "text/plain; charset=utf-8" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} the vendor's email`, { attachments: [pasted] });

  s.model.script({ tool: "keepAsNote", args: { document: "channel/files/message.txt", path: "channel/notes/vendor-email.md" } }, kept);
  await s.discord.send(`${s.discord.mention} keep that email as a note, word for word`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("Kept as channel/notes/vendor-email.md");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/notes/vendor-email.md")).toBe(`---\nsource: "channel/files/message.txt"\nauthor: "Alice"\naskedBy: "Alice"\ndate: "2026-10-15"\n---\n${email}`);
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/files/message.txt")).toBe(email);
});

discordScenario("a DOCX filed with saveAttachment names its poster as the Note's author; a file put in files/ some other way names none", async (s) => {
  s.clock.set("2026-10-15T03:00:00Z");
  await s.guildSettings({ alwaysChannelIds: ["channel-1"] });
  const plan = attachment(s, "plan.docx", docx(["Launch plan", "Ship on the 20th"]), { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  s.model.script("Seen.");
  const post = await s.discord.send("the launch plan", { attachments: [plan] });
  s.model.script({ tool: "saveAttachment", args: { messageId: post.id } }, (turn) => `Saved as ${turn.toolResults[0].path}`);
  await s.discord.send(`${s.discord.mention} save that file`, { author: s.discord.bob });

  s.model.script({ tool: "keepAsNote", args: { document: "channel/files/plan.docx", path: "channel/notes/launch-plan.md" } }, kept);
  await s.discord.send(`${s.discord.mention} keep the plan as a note`, { author: s.discord.bob });
  expect(s.discord.botMessages.at(-1)?.content).toBe("Kept as channel/notes/launch-plan.md");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/notes/launch-plan.md")).toBe(`---\nsource: "channel/files/plan.docx"\nauthor: "Alice"\naskedBy: "Bob"\ndate: "2026-10-15"\n---\nLaunch plan\n\nShip on the 20th\n`);

  await s.workspace.write("guilds/guild-1/channels/channel-1/files/agenda.md", "# Agenda\n");
  s.model.script({ tool: "keepAsNote", args: { document: "channel/files/agenda.md", path: "channel/notes/agenda.md" } }, kept);
  await s.discord.send(`${s.discord.mention} keep the agenda as a note`, { author: s.discord.bob });
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/notes/agenda.md")).toBe(`---\nsource: "channel/files/agenda.md"\naskedBy: "Bob"\ndate: "2026-10-15"\n---\n# Agenda\n`);
});

discordScenario("keepAsNote refuses a target that exists and writes nothing", async (s) => {
  await s.guildSettings({ language: "en" });
  const notes = attachment(s, "notes.txt", new TextEncoder().encode("Second draft of the plan\n"), { contentType: "text/plain" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} the plan`, { attachments: [notes] });
  await s.workspace.write("guilds/guild-1/channels/channel-1/notes/plan.md", "First draft, kept last week\n");

  s.model.script({ tool: "keepAsNote", args: { document: "channel/files/notes.txt", path: "channel/notes/plan.md" } }, kept);
  await s.discord.send(`${s.discord.mention} keep it as a note`);
  expect(s.discord.botMessages.at(-1)?.content).toBe("refused: channel/notes/plan.md already exists. Pick another name; I never replace a file this way.");
  expect(await s.workspace.read("guilds/guild-1/channels/channel-1/notes/plan.md")).toBe("First draft, kept last week\n");
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/notes")).toEqual(["guilds/guild-1/channels/channel-1/notes/plan.md"]);
});

discordScenario("keepAsNote refuses a source outside the place's files/ and a target outside its notes/", async (s) => {
  await s.guildSettings({ language: "en" });
  const notes = attachment(s, "notes.txt", new TextEncoder().encode("The plan\n"), { contentType: "text/plain" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} the plan`, { attachments: [notes] });
  await s.workspace.write("shared/notes/plan.md", "Tenant-wide plan\n");

  const attempts = [
    [{ document: "tenant/notes/plan.md", path: "channel/notes/plan.md" }, "refused: Only a Document under channel/files/ can be kept as a Note."],
    [{ document: "channel/files/../../channel-2/files/x.txt", path: "channel/notes/plan.md" }, 'refused: Invalid name ".."'],
    [{ document: "channel/files/notes.txt", path: "channel/decisions/plan.md" }, "refused: A Note is kept under channel/notes/."],
    [{ document: "channel/files/notes.txt", path: "guild/notes/plan.md" }, "refused: A Note is kept under channel/notes/."],
    [{ document: "channel/files/missing.txt", path: "channel/notes/plan.md" }, "refused: There is no Document at channel/files/missing.txt."],
  ] as const;
  for (const [args, reply] of attempts) {
    s.model.script({ tool: "keepAsNote", args }, kept);
    await s.discord.send(`${s.discord.mention} keep it`);
    expect(s.discord.botMessages.at(-1)?.content).toBe(reply);
  }
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/notes")).toEqual([]);
  expect(await s.workspace.list("guilds/guild-1/channels/channel-1/decisions")).toEqual([]);
  expect(await s.workspace.list("guilds/guild-1/shared/notes")).toEqual([]);
});
