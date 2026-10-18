import type { SkillContext, SkillModule } from "../types.js";
import { teamHandlers, teamTools } from "./team.js";
import { agentPaths, KEPT_FOLDERS, keptPath, placeRoot, resolvePath, visibleRoots } from "../workspace/paths.js";
import { workspaceStore } from "../workspace/store.js";
import { checkThreadWrite, threadAccess } from "../workspace/threads.js";
import { readPlaybookFile } from "../playbooks.js";
import { postBriefRound, postBriefRoundTool } from "../brief.js";
import { recordBriefAnswers, recordBriefAnswersTool, writeIssueDraft, writeIssueDraftTool } from "../issueDrafts.js";
import { describeBriefImages, describeBriefImagesTool } from "../briefImages.js";
import { ISSUE_DRAFT_PLAYBOOK } from "../grounding.js";
import { forget, memoryLevel, remember } from "../workspace/memory.js";
import { fileDocument, isDocument } from "../workspace/files.js";
import { keepNote, keptDocument, keptMessages, MAX_KEPT_MESSAGES } from "../workspace/notes.js";
import { addKeywords } from "../workspace/keywords.js";
import { capMatches, dateRange, queriesTerms, shownMatch, wordingsOf, type FileMatch } from "../workspace/search.js";
import { DEFAULT_TIMEZONE } from "../clock.js";
import { namesChannel, readableSources, searchSource, searchSources, sourcePath } from "../workspace/sources.js";
import { recall, recallTool } from "../workspace/recall.js";
import { textIn } from "../language.js";
import { hasPermission } from "../permissions.js";

const pathArg = { type: "string", description: 'Path starting with a folder name, e.g. "channel/notes/ideas.md"' };
const readPathArg = { type: "string", description: 'Path starting with a folder name, e.g. "channel/notes/ideas.md"; another channel\'s minutes, Daily logs, decisions, notes and files start with its name, e.g. "#marketing/minutes"' };
const levelArg = { type: "string", enum: ["channel", "guild"], description: 'Whose Memory: "channel" for this channel (the default), "guild" for the whole server (needs Manage Server). In a DM both mean the person\'s own Memory.' };

/** Guild Memory is read in every channel, so only someone who can manage the server may change it; the check is in the skill, not the prompt. */
function memoryLevelFor(ctx: SkillContext, requested: unknown) {
  const level = memoryLevel(ctx, requested);
  if (level === "guild" && !hasPermission(ctx, "ManageGuild")) throw new Error("Guild Memory can only be changed by someone with Manage Server.");
  return level;
}

/** A hidden \`.name\` file beside the id folder lets a person tell folders apart; it is best effort and never shown to the agent. */
export async function labelFolder(ctx: SkillContext, root: string) {
  const label = root === "channel" ? ctx.channelName && `#${ctx.channelName}` : root === "guild" ? ctx.guildName : root === "dm" ? ctx.userName || ctx.userId : undefined;
  if (!label) return;
  const dir = visibleRoots(ctx)[root]!, file = (root === "channel" ? dir : dir.replace(/\/shared$/, "")) + "/.name";
  try { if (!(await workspaceStore().read(ctx.tenantId, file))) await workspaceStore().write(ctx.tenantId, file, label.slice(0, 100)); } catch {}
}

/** Another channel's files are read only: they change in their own channel. */
function notElsewhere(ctx: SkillContext, path: unknown) {
  if (namesChannel(path)) throw new Error(textIn(ctx.language).sourceReadOnly);
}

/** Playbooks are the agent's rules, so chat cannot rewrite them; people edit them in the console. Case-folded for case-insensitive disks. */
function writable(ctx: SkillContext, path: unknown) {
  notElsewhere(ctx, path);
  if (typeof path === "string" && path.split("/")[1]?.toLowerCase() === "playbooks") throw new Error("Files under playbooks/ cannot be changed from chat. Playbooks are edited in the console.");
  return path;
}

/** The readable source a path names. Unless `counted`, one that may not be quoted here is refused before anything in it is read, so the refusal never says whether a file exists. */
async function namedSource(ctx: SkillContext, input: string, allowRoot = false, counted = false) {
  const named = sourcePath(ctx, await readableSources(workspaceStore(), ctx), input, allowRoot);
  if (!counted && !named.source.quotable) throw new Error(textIn(ctx.language).notQuotableHere);
  return named;
}

/** How many matches may not be shown here, and the place's suggestion to ask in a DM; nothing when every match may be shown. */
const notShown = (ctx: SkillContext, count: number) => (count ? { notShownHere: count, suggestion: textIn(ctx.language).notShownHere(count) } : {});

/** The tenant-relative path of a change, refused under a private thread's folder from outside that thread. */
function changeable(ctx: SkillContext, path: unknown) {
  const full = resolvePath(ctx, path);
  checkThreadWrite(ctx, full);
  return full;
}

const TOP_FOLDERS = ["tasks", ...KEPT_FOLDERS], TOP_FILES = ["MEMORY.md", "glossary.md"];
/** Kept material the agent writes itself: a file written under these gets topics and keywords in its head. */
const KEYWORDED_FOLDERS = ["notes", "decisions"];
/** A channel's or DM's top level is fixed so people find things in the console; deeper folders are free. A private thread's own folder holds only what it keeps.
 *  In a private thread, `channel/<kept folder>/...` becomes the thread's own (ADR 0009); the returned path is where the write goes. */
function creatable(ctx: SkillContext, requested: unknown) {
  const path = keptPath(ctx, writable(ctx, requested));
  if (typeof path !== "string") return path;
  const [root, top, ...rest] = path.replace(/\/$/, "").split("/");
  if (root === "thread" && top !== undefined && !(rest.length && KEPT_FOLDERS.includes(top))) throw new Error(textIn(ctx.language).folderRefused(KEPT_FOLDERS));
  if ((root === "channel" || root === "dm") && top !== undefined && !(rest.length ? TOP_FOLDERS.includes(top) : TOP_FILES.includes(top))) throw new Error(textIn(ctx.language).folderRefused([...TOP_FOLDERS, ...TOP_FILES]));
  return path;
}

/** The most of a file one readFile returns, measured as the JSON the loop sends, so a read never reaches the loop's tool result cap. */
const READ_LIMIT = 10_000;

const lineArg = (value: unknown, name: string) => {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw new Error(`${name} must be a line number, 1 or more.`);
  return n;
};

/** A whole small file as before (content and version, for writeFile's check); a range, or the head of a large file, within READ_LIMIT. */
function readPart(file: { content: string; version: string }, from: unknown, to: unknown) {
  const fromLine = lineArg(from, "fromLine"), toLine = lineArg(to, "toLine");
  const all = file.content.split("\n");
  if (all.at(-1) === "") all.pop();
  const totalLines = all.length;
  if (fromLine === undefined && toLine === undefined) {
    if (JSON.stringify(file.content).length <= READ_LIMIT) return { content: file.content, version: file.version };
    const kept: string[] = [];
    let size = 2;
    for (const line of all) {
      const next = JSON.stringify(line).length;
      if (size + next > READ_LIMIT && kept.length) break;
      kept.push(size + next > READ_LIMIT ? clip(line, READ_LIMIT - size - 2) : line);
      size += next;
    }
    return { content: kept.join("\n") + "\n", totalLines, nextLine: kept.length + 1, version: file.version };
  }
  const start = fromLine ?? 1, end = toLine ?? totalLines;
  if (start > totalLines) throw new Error(`fromLine ${start} is past the end: the file has ${totalLines} lines.`);
  if (end < start) throw new Error(`toLine ${end} is before fromLine ${start}.`);
  if (end > totalLines) throw new Error(`toLine ${end} is past the end: the file has ${totalLines} lines.`);
  const lines: { line: number; text: string }[] = [];
  let size = 0;
  for (let n = start; n <= end; n++) {
    const entry = { line: n, text: all[n - 1]! };
    const next = JSON.stringify(entry).length + 1;
    if (size + next > READ_LIMIT) {
      if (lines.length) break;
      entry.text = clip(entry.text, READ_LIMIT - 40);
    }
    lines.push(entry);
    size += next;
  }
  const last = lines.at(-1)!.line, more = last < end ? { nextLine: last + 1 } : {};
  return { fromLine: start, toLine: last, totalLines, ...more, lines, version: file.version };
}

/** A single line too long to return whole, cut so its JSON stays within `room`. */
function clip(line: string, room: number) {
  let cut = line.slice(0, Math.max(0, room));
  while (JSON.stringify(cut).length > room && cut) cut = cut.slice(0, Math.floor(cut.length * 0.9));
  return cut;
}

export const workspaceSkill: SkillModule = {
  id: "workspace",
  name: "Workspace",
  description: "Keep notes and memory as Markdown files in this tenant's Workspace.",
  capabilities: ["workspace"],
  allowedScopes: ["tenant"],
  toolPolicy: { listFiles: { effect: "read" }, readFile: { effect: "read" }, searchFiles: { effect: "read" }, recall: { effect: "read" }, readPlaybookFile: { effect: "read" }, postBriefRound: { effect: "write", requiresConfirmation: false, playbook: ISSUE_DRAFT_PLAYBOOK }, recordBriefAnswers: { effect: "write", requiresConfirmation: false, playbook: ISSUE_DRAFT_PLAYBOOK }, writeIssueDraft: { effect: "write", requiresConfirmation: false, playbook: ISSUE_DRAFT_PLAYBOOK }, describeBriefImages: { effect: "write", requiresConfirmation: false, playbook: ISSUE_DRAFT_PLAYBOOK }, writeFile: { effect: "write", requiresConfirmation: false }, moveFile: { effect: "write", requiresConfirmation: false }, deleteFile: { effect: "danger", requiresConfirmation: true }, remember: { effect: "write", requiresConfirmation: false }, forget: { effect: "write", requiresConfirmation: false }, saveAttachment: { effect: "write", requiresConfirmation: false }, keepAsNote: { effect: "write", requiresConfirmation: false }, setTeamMember: { effect: "write", requiresConfirmation: false }, teamRoster: { effect: "read" } },
  // Refused before Confirm is offered, since pressing it could never delete another channel's file.
  checks: { deleteFile: async (args, ctx) => notElsewhere(ctx, args.path) },
  tools: [
    { name: "listFiles", description: "Lists files and folders in a Workspace folder.", parameters: { type: "object", properties: { path: readPathArg }, required: ["path"] } },
    { name: "readFile", description: `Reads a text file from the Workspace: Markdown, CSV or TXT. A filed PDF, DOCX or XLSX, or a CSV over 256 KB, is read through the .md beside it (named in the file note as "text in ..."); an XLSX's .md holds each sheet as a table. fromLine and toLine (1-based, inclusive) read only those lines, each with its number: when searchFiles or recall gave a matching line, read around it, e.g. 20 lines before to 60 after. Without them, a file over ${READ_LIMIT.toLocaleString("en")} characters returns its first lines with totalLines and nextLine, the line to read from next. A range returns at most that much too, with nextLine when it stopped early.`, parameters: { type: "object", properties: { path: readPathArg, fromLine: { type: "integer", description: "First line to read, 1-based" }, toLine: { type: "integer", description: "Last line to read, inclusive; at most the file's last line" } }, required: ["path"] } },
    { name: "writeFile", description: "Creates or replaces a Markdown file in the Workspace. Missing folders are created. To replace an existing file, pass the version from readFile. Under notes/ and decisions/ the server then writes topics and keywords into the file's head, replacing any already there.", parameters: { type: "object", properties: { path: pathArg, content: { type: "string", description: "Full file content" }, version: { type: "string", description: "Version returned by readFile; required when the file exists" } }, required: ["path", "content"] } },
    { name: "moveFile", description: "Moves or renames a file or folder. Refuses to overwrite.", parameters: { type: "object", properties: { from: pathArg, to: pathArg }, required: ["from", "to"] } },
    { name: "deleteFile", description: "Deletes a file, or an empty folder.", parameters: { type: "object", properties: { path: pathArg }, required: ["path"] } },
    { name: "searchFiles", description: "Finds files that hold words of the queries in their name, their topics and keywords, or their text, in any order and case. Words match whole in any of their forms (\"normalisasi\", \"normalization\" and \"normalize\" meet; \"diimplementasikan\" meets \"implementasi\"; \"log\" never matches \"blog\"), common work words meet across Indonesian and English (\"rilis\" and \"release\", \"rapat\" and \"meeting\"), and filler words such as \"yang\", \"sudah\" or \"the\" are ignored; the words need not share a line and a file need not hold them all. Pass several wordings of the same question in queries (Indonesian, English, same-meaning words) to search them at once. Best match first: files holding more of a query's words and rarer ones, above all in their name, topics or keywords, then newest first by the date a file name starts with; at most 50 files, and when more matched, total and leftOut say how many. Each match gives up to three of the file's lines, those holding the most query words, with their line numbers. The text of a PDF, DOCX or XLSX is searched in the .md beside it. Without a path, searches the minutes, Daily logs, decisions, notes and files of this place and of every other channel you may read from here, grouped by channel. A match marked partial holds only some words of every query; nothingStrong means no match holds every word of any query, so nothing matched well: read before relying on a partial match, and say plainly when nothing answers the question. since and until keep only files dated in that range (the date a file name starts with, else the day it last changed). notShownHere counts matches that cannot be shown in this channel; follow its suggestion and never guess what or where they are.", parameters: { type: "object", properties: { query: { type: "string", description: "Words to find, e.g. \"pricing decision\"" }, queries: { type: "array", items: { type: "string" }, description: "Several wordings searched together, e.g. [\"normalisasi audio\", \"audio normalization\", \"loudness\"]" }, path: { type: "string", description: 'Folder to search, e.g. "channel/minutes" or "#marketing"; leave it out to search every channel you may read from here' }, since: { type: "string", description: "Only files dated on or after this day, YYYY-MM-DD" }, until: { type: "string", description: "Only files dated on or before this day, YYYY-MM-DD" } } } },
    recallTool,
    { name: "readPlaybookFile", description: "Reads a reference file of a playbook, such as a template or checklist one of its steps points at.", parameters: { type: "object", properties: { playbook: { type: "string", description: "Playbook name, e.g. issue-draft" }, path: { type: "string", description: 'File name inside the playbook folder, e.g. "template.md"' } }, required: ["playbook", "path"] } },
    { name: "remember", description: "Keeps one fact in Memory for later turns: a decision, how someone likes to be addressed or to work, a convention of the place. Writes a dated line with the asker's name. Mention it only when the person asked you to remember it. Never keep private details or the conversation itself.", parameters: { type: "object", properties: { level: levelArg, text: { type: "string", description: "One line, in the asker's words" } }, required: ["text"] } },
    { name: "forget", description: "Removes every Memory line containing the text, case-insensitively, and reports how many went.", parameters: { type: "object", properties: { level: levelArg, match: { type: "string", description: "Text the lines to remove contain" } }, required: ["match"] } },
    { name: "saveAttachment", description: "Files one attachment of a message in this channel under files/, when a person asks to keep a file that was not sent to the bot. Same rules as files sent to the bot: PDF, DOCX, XLSX, CSV, MD or TXT, 10 MB at most, a taken name gets -2. The result's text names the .md holding the text of a PDF, DOCX, XLSX or CSV over 256 KB.", parameters: { type: "object", properties: { messageId: { type: "string", description: 'The message id from the file placeholder, e.g. "[file: report.pdf (message 123)]"' }, name: { type: "string", description: "Attachment name, when the message holds more than one file" } }, required: ["messageId"] } },
    { name: "keepAsNote", description: `Keeps text a person gave you as a new Note, word for word: the server copies a Document's text (a PDF's, DOCX's or XLSX's extracted text), or the texts of messages in this channel or thread joined in the order given, under notes/, headed with who wrote it, who asked and the date, however long it is. Use it when a person asks to keep that text as it is; use writeFile for your own writing. Give exactly one source: document, or messageIds (at most ${MAX_KEPT_MESSAGES}), any person's messages. The Document stays in files/. Refuses a path that exists.`, parameters: { type: "object", properties: { document: { type: "string", description: 'The Document under files/, e.g. "channel/files/minutes.pdf"' }, messageIds: { type: "array", items: { type: "string" }, description: 'Message ids in reading order, from turn lines such as "Alice (message 123): ..."' }, path: { type: "string", description: 'The new Note under notes/, e.g. "channel/notes/2026-10-14-minutes.md"' } }, required: ["path"] } },
    ...teamTools,
    postBriefRoundTool,
    recordBriefAnswersTool,
    writeIssueDraftTool,
    describeBriefImagesTool,
  ],
  handlers: {
    ...teamHandlers,
    listFiles: async (args, ctx) => {
      if (namesChannel(args.path)) {
        const { source, path, shown } = await namedSource(ctx, args.path, true);
        const entries = (await workspaceStore().list(ctx.tenantId, path)).filter((e) => path !== source.folder || (e.type === "dir" && KEPT_FOLDERS.includes(e.path.split("/").pop()!)));
        return { entries: entries.filter((e) => !e.path.split("/").pop()!.startsWith(".")).map((e) => ({ ...e, path: shown(e.path) })) };
      }
      const dir = resolvePath(ctx, args.path, true), access = threadAccess(ctx);
      await access.check(dir);
      const entries = (await access.sort(await workspaceStore().list(ctx.tenantId, dir))).shown;
      const name = String(args.path).split("/")[0]!, shown = agentPaths(name, visibleRoots(ctx)[name]!);
      return { entries: entries.filter((e) => !e.path.split("/").pop()!.startsWith(".")).map((e) => ({ ...e, path: shown(e.path) })) };
    },
    readFile: async (args, ctx) => {
      const path = namesChannel(args.path) ? (await namedSource(ctx, args.path)).path : resolvePath(ctx, args.path);
      await threadAccess(ctx).check(path);
      const file = await workspaceStore().read(ctx.tenantId, path);
      if (!file) throw new Error(`File "${args.path}" not found.`);
      return readPart(file, args.fromLine, args.toLine);
    },
    writeFile: async (args, ctx) => {
      if (typeof args.content !== "string") throw new Error("content is required");
      const target = creatable(ctx, args.path);
      const full = changeable(ctx, target);
      const written = await workspaceStore().write(ctx.tenantId, full, args.content, typeof args.version === "string" ? args.version : undefined);
      const [root, top] = String(target).split("/");
      const version = KEYWORDED_FOLDERS.includes(top!) ? (await addKeywords(ctx.tenantId, full, ctx.complete)) ?? written.version : written.version;
      await labelFolder(ctx, root!);
      return { success: true, path: target, version };
    },
    moveFile: async (args, ctx) => {
      const to = creatable(ctx, args.to);
      await workspaceStore().move(ctx.tenantId, changeable(ctx, writable(ctx, args.from)), changeable(ctx, to));
      return { success: true, from: args.from, to };
    },
    deleteFile: async (args, ctx) => {
      await workspaceStore().remove(ctx.tenantId, changeable(ctx, writable(ctx, args.path)));
      return { success: true, path: args.path };
    },
    readPlaybookFile: async (args, ctx) => {
      if (typeof args.playbook !== "string" || typeof args.path !== "string") throw new Error("playbook and path are required");
      const content = await readPlaybookFile(ctx.tenantId, args.playbook, args.path);
      if (content === null) throw new Error(`Playbook file "${args.playbook}/${args.path}" not found.`);
      return { content };
    },
    remember: async (args, ctx) => {
      const text = typeof args.text === "string" ? args.text.replace(/\s+/g, " ").trim() : "";
      if (!text) throw new Error("text is required");
      const level = memoryLevelFor(ctx, args.level);
      const line = await remember(ctx, level, text, ctx.userName || ctx.userId || "unknown");
      await labelFolder(ctx, level);
      return { level, line };
    },
    forget: async (args, ctx) => {
      const match = typeof args.match === "string" ? args.match.trim() : "";
      if (!match) throw new Error("match is required");
      const level = memoryLevelFor(ctx, args.level);
      return { level, removed: await forget(ctx, level, match) };
    },
    saveAttachment: async (args, ctx) => {
      const t = textIn(ctx.language);
      const messageId = typeof args.messageId === "string" ? args.messageId.trim() : "";
      if (!messageId) throw new Error("messageId is required");
      const message = ctx.discord && ctx.channelId ? await ctx.discord.fetchMessage({ channelId: ctx.channelId, messageId }) : null;
      if (!message) throw new Error(t.saveNoMessage);
      const wanted = typeof args.name === "string" ? args.name.trim().toLowerCase() : "";
      // Without a name, an image beside one document is not an ambiguity: the document is meant.
      const documents = message.attachments.filter((a) => isDocument(a.name));
      const candidates = wanted ? message.attachments.filter((a) => a.name.toLowerCase() === wanted) : documents.length ? documents : message.attachments;
      if (!candidates.length) throw new Error(t.saveNoFile);
      if (candidates.length > 1) throw new Error(t.saveWhich(candidates.map((a) => a.name)));
      const outcome = await fileDocument(ctx.tenantId, ctx, candidates[0]!, { givenBy: { name: message.authorName, id: message.authorId }, complete: ctx.complete });
      if ("reason" in outcome) throw new Error(t.notFiled[outcome.reason]);
      await labelFolder(ctx, placeRoot(ctx)!);
      const text =!outcome.text ? {} : "path" in outcome.text ? { text: outcome.text.path } : { note: t.textNotExtracted };
      return { path: outcome.path, name: candidates[0]!.name, messageId: message.id, ...text };
    },
    keepAsNote: async (args, ctx) => {
      const t = textIn(ctx.language);
      const document = typeof args.document === "string" ? args.document.trim() : "";
      const hasDocument = document !== "", hasMessages = args.messageIds !== undefined;
      if (hasDocument && hasMessages) throw new Error(t.keepOneSource);
      if (!hasDocument && !hasMessages) throw new Error(t.keepNoSource);
      writable(ctx, args.path);
      // Only the Note is redirected into a private thread's folder: a parent channel Document stays readable where it is.
      const pieces = hasDocument ? [await keptDocument(ctx, document)] : await keptMessages(ctx, args.messageIds);
      const note = await keepNote(ctx, keptPath(ctx, args.path), pieces);
      await addKeywords(ctx.tenantId, resolvePath(ctx, note.path), ctx.complete);
      await labelFolder(ctx, placeRoot(ctx)!);
      return { success: true, path: note.path, source: document || pieces.map((p) => p.source) };
    },
    postBriefRound,
    recordBriefAnswers,
    writeIssueDraft,
    describeBriefImages,
    recall,
    searchFiles: async (args, ctx) => {
      const queries = queriesTerms(wordingsOf(args.query, args.queries)), terms = [...new Set(queries.flat())];
      if (!terms.length) throw new Error("query is required");
      const store = workspaceStore(), wanted = typeof args.path === "string" ? args.path.trim() : "";
      const within = dateRange(args.since, args.until, ctx.timezone ?? DEFAULT_TIMEZONE), inRange = <T extends FileMatch>(m: T[]) => (within ? m.filter(within) : m);
      if (!wanted) {
        const { notShown: hidden, ...found } = await searchSources(store, ctx.tenantId, await readableSources(store, ctx), queries, within);
        return { ...found, ...notShown(ctx, hidden) };
      }
      let found: (FileMatch & { shown: string })[], hidden = 0, searched: number, words: number;
      if (namesChannel(wanted)) {
        const { source, path } = await namedSource(ctx, wanted, true, true);
        ({ matches: found, searched, words } = await searchSource(store, ctx.tenantId, source, terms, path === source.folder ? source.folders : [path]));
        found = inRange(found);
        if (!source.quotable) return { matches: [], ...notShown(ctx, found.length) };
      } else {
        const root = resolvePath(ctx, wanted, true), access = threadAccess(ctx);
        await access.check(root);
        const name = wanted.split("/")[0]!, prefix = visibleRoots(ctx)[name]!, shown = agentPaths(name, prefix);
        const result = await store.searchFolder(ctx.tenantId, root, terms, (p) => p.slice(prefix.length + 1));
        const sorted = await access.sort(inRange(result.matches));
        found = sorted.shown.map((m) => ({ ...m, shown: shown(m.path) }));
        hidden = sorted.counted;
        searched = result.searched;
        words = result.words;
      }
      const { matches, total, leftOut, nothingStrong } = capMatches(found, queries, searched, words);
      return { matches: matches.map(shownMatch), ...(leftOut ? { total, leftOut } : {}), ...(nothingStrong ? { nothingStrong } : {}), ...notShown(ctx, hidden) };
    },
  },
};

