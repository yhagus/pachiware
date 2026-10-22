import { expect } from "bun:test";
import { unzipSync } from "fflate";
import { discordScenario, type Scenario } from "./support/discordScenario";
import { attachment } from "./support/images";
import { pdf } from "./support/documents";

const GENERAL = "guilds/guild-1/channels/channel-1", DIREKSI = "guilds/guild-1/channels/channel-3";
/** Every tool result of the turn as the model read it: the refusal text, or the result itself. */
const results = (turn: any) => JSON.stringify(turn.toolResults.map((r: any) => r.error ?? r));
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
/** Every file the bot attached in this scenario, in the order it posted them. */
const attached = (s: Scenario) => s.discord.botMessages.flatMap((m) => m.files);

async function ask(s: Scenario, paths: string[], options: { channel?: string } = {}) {
  s.model.script({ tool: "sendFiles", args: { paths } }, results);
  await s.discord.send(`${s.discord.mention} kirim filenya`, options);
  return s.discord.botMessages.at(-1)!;
}

discordScenario("one named file is attached to the reply as it is, and the model reads only its name and size", async (s) => {
  await s.guildSettings({ useThreads: false });
  await s.workspace.write(`${GENERAL}/notes/plan.md`, "# Plan\nShip on Friday.\n");
  const reply = await ask(s, ["channel/notes/plan.md"]);
  expect(JSON.parse(reply.content)).toEqual([{ attachment: { id: expect.any(String), name: "plan.md", bytes: 23, files: ["channel/notes/plan.md"] } }]);
  expect(reply.files.map((f) => f.name)).toEqual(["plan.md"]);
  expect(text(new Uint8Array(reply.files[0].attachment))).toBe("# Plan\nShip on Friday.\n");
});

discordScenario("a folder goes as one zip of its files, without the text the bot extracted beside a PDF unless that text is named", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.clock.set("2026-10-22T10:00:00+07:00");
  const report = attachment(s, "report.pdf", pdf(["Quarterly report"]), { contentType: "application/pdf" });
  s.model.script("Filed.");
  await s.discord.send(`${s.discord.mention} here is the report`, { attachments: [report] });
  await s.workspace.write(`${GENERAL}/files/budget.csv`, "item,cost\nvenue,100\n");

  const folder = (await ask(s, ["channel/files"])).files;
  expect(folder.map((f) => f.name)).toEqual(["files-2026-10-22.zip"]);
  const entries = unzipSync(new Uint8Array(folder[0].attachment));
  expect(Object.keys(entries).sort()).toEqual(["budget.csv", "report.pdf"]);
  expect(text(entries["budget.csv"]!)).toBe("item,cost\nvenue,100\n");
  expect(entries["report.pdf"]).toEqual(pdf(["Quarterly report"]));

  const named = (await ask(s, ["channel/files/report.md", "channel/files/budget.csv"])).files;
  expect(Object.keys(unzipSync(new Uint8Array(named[0].attachment))).sort()).toEqual(["budget.csv", "report.md"]);
});

discordScenario("files from several folders keep their folders inside the zip", async (s) => {
  await s.guildSettings({ useThreads: false });
  s.clock.set("2026-10-22T10:00:00+07:00");
  await s.workspace.write(`${GENERAL}/notes/plan.md`, "# Plan\n");
  await s.workspace.write(`${GENERAL}/minutes/2026-10-21-kickoff.md`, "# Kickoff\n");
  const [zip] = (await ask(s, ["channel/notes/plan.md", "channel/minutes/2026-10-21-kickoff.md"])).files;
  expect(zip.name).toBe("files-2026-10-22.zip");
  expect(Object.keys(unzipSync(new Uint8Array(zip.attachment))).sort()).toEqual(["minutes/2026-10-21-kickoff.md", "notes/plan.md"]);
});

discordScenario("a non-quotable channel's file is refused alike whether it exists or not, and nothing is attached", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  s.discord.channel("channel-1").name = "general";
  s.discord.channel("channel-3").name = "direksi";
  s.discord.hide("channel-3");
  await s.workspace.write(`${DIREKSI}/minutes/2026-10-14-board.md`, "# Board\nWe decided the pricing for Q4.\n");
  const refused = "Files from there cannot be shown in this channel. Do not say what or where they are; suggest asking in a DM instead.";
  expect(JSON.parse((await ask(s, ["#direksi/minutes/2026-10-14-board.md"])).content)).toEqual([refused]);
  expect(JSON.parse((await ask(s, ["#direksi/minutes/2026-10-15-nothing.md"])).content)).toEqual([refused]);
  expect(attached(s)).toEqual([]);
  // In its own channel the same file goes.
  expect((await ask(s, ["channel/minutes/2026-10-14-board.md"], { channel: "channel-3" })).files.map((f) => f.name)).toEqual(["2026-10-14-board.md"]);
});

discordScenario("more than 50 files, or more than 10 MB after zipping, is refused with the count or size, and nothing is attached", async (s) => {
  await s.guildSettings({ language: "en", useThreads: false });
  for (let i = 1; i <= 51; i++) await s.workspace.write(`${GENERAL}/notes/many/${String(i).padStart(2, "0")}.md`, `note ${i}\n`);
  expect(JSON.parse((await ask(s, ["channel/notes/many"])).content)).toEqual(["That is 51 files; I send at most 50 at once. Name fewer files or a smaller folder."]);

  const { workspaceStore } = await import("@pachiware/skills");
  const { randomBytes } = await import("node:crypto");
  for (const name of ["a.bin", "b.bin"]) await workspaceStore().writeBytes(s.tenant.id, `${GENERAL}/files/big/${name}`, randomBytes(6 * 1024 * 1024));
  const [refusal] = JSON.parse((await ask(s, ["channel/files/big"])).content);
  expect(refusal).toMatch(/^The files come to 12\.\d MB zipped, over the 10 MB Discord takes in one upload\. Name fewer files\.$/);
  expect(attached(s)).toEqual([]);
});

discordScenario("a refusal to send is in Indonesian where the place speaks it", async (s) => {
  await s.guildSettings({ language: "id", useThreads: false });
  expect(JSON.parse((await ask(s, ["channel/notes/kosong"])).content)).toEqual(["Tidak ada file untuk dikirim di channel/notes/kosong."]);
});
