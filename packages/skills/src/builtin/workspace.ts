import type { SkillContext, SkillModule } from "../types.js";
import { KEPT_FOLDERS, keptPath, resolvePath, visibleRoots } from "../workspace/paths.js";
import { workspaceStore } from "../workspace/store.js";
import { checkThreadWrite, threadAccess } from "../workspace/threads.js";
import { readPlaybookFile } from "../playbooks.js";
import { postBriefRound, postBriefRoundTool } from "../brief.js";
import { recordBriefAnswers, recordBriefAnswersTool, writeIssueDraft, writeIssueDraftTool } from "../issueDrafts.js";
import { describeBriefImages, describeBriefImagesTool } from "../briefImages.js";
import { ISSUE_DRAFT_PLAYBOOK } from "../grounding.js";
import { forget, memoryLevel, remember } from "../workspace/memory.js";
import { fileDocument, filesRoot, isDocument } from "../workspace/files.js";
import { keepNote, keptDocument, keptMessages, MAX_KEPT_MESSAGES } from "../workspace/notes.js";
import { MAX_MATCHES, newestFirst, queryWords, type FileMatch, type LineHit } from "../workspace/search.js";
import { namesChannel, readableSources, sourcePath, type Source } from "../workspace/sources.js";
import { textIn } from "../language.js";
import { hasPermission } from "../permissions.js";

const pathArg = { type: "string", description: 'Path starting with a folder name, e.g. "channel/notes/ideas.md"' };
const readPathArg = { type: "string", description: 'Path starting with a folder name, e.g. "channel/notes/ideas.md"; another channel\'s minutes, decisions, notes and files start with its name, e.g. "#marketing/minutes"' };
const levelArg = { type: "string", enum: ["channel", "guild"], description: 'Whose Memory: "channel" for this channel, "guild" for the whole server (needs Manage Server). In a DM both mean the person\'s own Memory.' };

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

type Shown = { path: string; lines: LineHit[] };
/** Matches newest first, at most MAX_MATCHES, with the total and how many were left out. */
function capped<T extends FileMatch & { shown: string }>(found: T[]) {
  const kept = newestFirst(found).slice(0, MAX_MATCHES);
  return { kept, total: found.length, leftOut: found.length - kept.length };
}
const shownMatch = (m: FileMatch & { shown: string }): Shown => ({ path: m.shown, lines: m.lines });

/** Every match of the words in a source's kept folders, each with the path the agent reads it by. */
async function searchSource(ctx: SkillContext, source: Source, folders: string[], words: string[]) {
  const shown = (path: string) => source.root + path.slice(source.folder.length);
  const found = await Promise.all(folders.map((folder) => workspaceStore().searchFolder(ctx.tenantId, folder, words, (p) => p.slice(source.folder.length + 1))));
  return found.flat().map((m) => ({ ...m, source, shown: shown(m.path) }));
}

/** The tenant-relative path of a change, refused under a private thread's folder from outside that thread. */
function changeable(ctx: SkillContext, path: unknown) {
  const full = resolvePath(ctx, path);
  checkThreadWrite(ctx, full);
  return full;
}

const TOP_FOLDERS = ["tasks", ...KEPT_FOLDERS], TOP_FILES = ["MEMORY.md", "glossary.md"];
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

export const workspaceSkill: SkillModule = {
  id: "workspace",
  name: "Workspace",
  description: "Keep notes and memory as Markdown files in this tenant's Workspace.",
  capabilities: ["workspace"],
  allowedScopes: ["tenant"],
  toolPolicy: { listFiles: { effect: "read" }, readFile: { effect: "read" }, searchFiles: { effect: "read" }, readPlaybookFile: { effect: "read" }, postBriefRound: { effect: "write", requiresConfirmation: false, playbook: ISSUE_DRAFT_PLAYBOOK }, recordBriefAnswers: { effect: "write", requiresConfirmation: false, playbook: ISSUE_DRAFT_PLAYBOOK }, writeIssueDraft: { effect: "write", requiresConfirmation: false, playbook: ISSUE_DRAFT_PLAYBOOK }, describeBriefImages: { effect: "write", requiresConfirmation: false, playbook: ISSUE_DRAFT_PLAYBOOK }, writeFile: { effect: "write", requiresConfirmation: false }, moveFile: { effect: "write", requiresConfirmation: false }, deleteFile: { effect: "danger", requiresConfirmation: true }, remember: { effect: "write", requiresConfirmation: false }, forget: { effect: "write", requiresConfirmation: false }, saveAttachment: { effect: "write", requiresConfirmation: false }, keepAsNote: { effect: "write", requiresConfirmation: false } },
  // Refused before Confirm is offered, since pressing it could never delete another channel's file.
  checks: { deleteFile: async (args, ctx) => notElsewhere(ctx, args.path) },
  tools: [
    { name: "listFiles", description: "Lists files and folders in a Workspace folder.", parameters: { type: "object", properties: { path: readPathArg }, required: ["path"] } },
    { name: "readFile", description: "Reads a text file from the Workspace: Markdown, CSV or TXT. A filed PDF, DOCX or XLSX, or a CSV over 256 KB, is read through the .md beside it (named in the file note as \"text in ...\"); an XLSX's .md holds each sheet as a table.", parameters: { type: "object", properties: { path: readPathArg }, required: ["path"] } },
    { name: "writeFile", description: "Creates or replaces a Markdown file in the Workspace. Missing folders are created. To replace an existing file, pass the version from readFile.", parameters: { type: "object", properties: { path: pathArg, content: { type: "string", description: "Full file content" }, version: { type: "string", description: "Version returned by readFile; required when the file exists" } }, required: ["path", "content"] } },
    { name: "moveFile", description: "Moves or renames a file or folder. Refuses to overwrite.", parameters: { type: "object", properties: { from: pathArg, to: pathArg }, required: ["from", "to"] } },
    { name: "deleteFile", description: "Deletes a file, or an empty folder.", parameters: { type: "object", properties: { path: pathArg }, required: ["path"] } },
    { name: "searchFiles", description: "Finds files that hold every word of the query somewhere in their name or text, in any order and case; the words need not share a line. Each match gives up to three of the file's lines, those holding the most query words, with their line numbers. The text of a PDF, DOCX or XLSX is searched in the .md beside it. Newest first by the date a file name starts with, at most 50 files; when more matched, total and leftOut say how many. Without a path, searches the minutes, decisions, notes and files of this place and of every other channel you may read from here, grouped by channel. notShownHere counts matches that cannot be shown in this channel; follow its suggestion and never guess what or where they are.", parameters: { type: "object", properties: { query: { type: "string", description: "Words to find, e.g. \"pricing decision\"" }, path: { type: "string", description: 'Folder to search, e.g. "channel/minutes" or "#marketing"; leave it out to search every channel you may read from here' } }, required: ["query"] } },
    { name: "readPlaybookFile", description: "Reads a reference file of a playbook, such as a template or checklist one of its steps points at.", parameters: { type: "object", properties: { playbook: { type: "string", description: "Playbook name, e.g. issue-draft" }, path: { type: "string", description: 'File name inside the playbook folder, e.g. "template.md"' } }, required: ["playbook", "path"] } },
    { name: "remember", description: "Keeps one fact in Memory for later turns: a decision, how someone likes to be addressed or to work, a convention of the place. Writes a dated line with the asker's name; say nothing about it unless asked. Never keep private details or the conversation itself.", parameters: { type: "object", properties: { level: levelArg, text: { type: "string", description: "One line, in the asker's words" } }, required: ["level", "text"] } },
    { name: "forget", description: "Removes every Memory line containing the text, case-insensitively, and reports how many went.", parameters: { type: "object", properties: { level: levelArg, match: { type: "string", description: "Text the lines to remove contain" } }, required: ["level", "match"] } },
    { name: "saveAttachment", description: "Files one attachment of a message in this channel under files/, when a person asks to keep a file that was not sent to the bot. Same rules as files sent to the bot: PDF, DOCX, XLSX, CSV, MD or TXT, 10 MB at most, a taken name gets -2. The result's text names the .md holding the text of a PDF, DOCX, XLSX or CSV over 256 KB.", parameters: { type: "object", properties: { messageId: { type: "string", description: 'The message id from the file placeholder, e.g. "[file: report.pdf (message 123)]"' }, name: { type: "string", description: "Attachment name, when the message holds more than one file" } }, required: ["messageId"] } },
    { name: "keepAsNote", description: `Keeps text a person gave you as a new Note, word for word: the server copies a Document's text (a PDF's, DOCX's or XLSX's extracted text), or the texts of messages in this channel or thread joined in the order given, under notes/, headed with who wrote it, who asked and the date, however long it is. Use it when a person asks to keep that text as it is; use writeFile for your own writing. Give exactly one source: document, or messageIds (at most ${MAX_KEPT_MESSAGES}), any person's messages. The Document stays in files/. Refuses a path that exists.`, parameters: { type: "object", properties: { document: { type: "string", description: 'The Document under files/, e.g. "channel/files/minutes.pdf"' }, messageIds: { type: "array", items: { type: "string" }, description: 'Message ids in reading order, from turn lines such as "Alice (message 123): ..."' }, path: { type: "string", description: 'The new Note under notes/, e.g. "channel/notes/2026-10-14-minutes.md"' } }, required: ["path"] } },
    postBriefRoundTool,
    recordBriefAnswersTool,
    writeIssueDraftTool,
    describeBriefImagesTool,
  ],
  handlers: {
    listFiles: async (args, ctx) => {
      if (namesChannel(args.path)) {
        const { source, path, shown } = await namedSource(ctx, args.path, true);
        const entries = (await workspaceStore().list(ctx.tenantId, path)).filter((e) => path !== source.folder || (e.type === "dir" && KEPT_FOLDERS.includes(e.path.split("/").pop()!)));
        return { entries: entries.filter((e) => !e.path.split("/").pop()!.startsWith(".")).map((e) => ({ ...e, path: shown(e.path) })) };
      }
      const dir = resolvePath(ctx, args.path, true), access = threadAccess(ctx);
      await access.check(dir);
      const entries = await access.filter(await workspaceStore().list(ctx.tenantId, dir));
      const name = String(args.path).split("/")[0]!, prefix = visibleRoots(ctx)[name]!;
      return { entries: entries.filter((e) => !e.path.split("/").pop()!.startsWith(".")).map((e) => ({ ...e, path: name + e.path.slice(prefix.length) })) };
    },
    readFile: async (args, ctx) => {
      const path = namesChannel(args.path) ? (await namedSource(ctx, args.path)).path : resolvePath(ctx, args.path);
      await threadAccess(ctx).check(path);
      const file = await workspaceStore().read(ctx.tenantId, path);
      if (!file) throw new Error(`File "${args.path}" not found.`);
      return { content: file.content, version: file.version };
    },
    writeFile: async (args, ctx) => {
      if (typeof args.content !== "string") throw new Error("content is required");
      const target = creatable(ctx, args.path);
      const { version } = await workspaceStore().write(ctx.tenantId, changeable(ctx, target), args.content, typeof args.version === "string" ? args.version : undefined);
      await labelFolder(ctx, String(target).split("/")[0]!);
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
      const outcome = await fileDocument(ctx.tenantId, ctx, candidates[0]!, { givenBy: { name: message.authorName, id: message.authorId } });
      if ("reason" in outcome) throw new Error(t.notFiled[outcome.reason]);
      await labelFolder(ctx, filesRoot(ctx)!);
      const text = !outcome.text ? {} : "path" in outcome.text ? { text: outcome.text.path } : { note: t.textNotExtracted };
      return { path: outcome.path, name: candidates[0]!.name, messageId: message.id, ...text };
    },
    keepAsNote: async (args, ctx) => {
      const t = textIn(ctx.language);
      const document = typeof args.document === "string" ? args.document.trim() : "";
      const hasDocument = document !== "", hasMessages = args.messageIds !== undefined;
      if (hasDocument && hasMessages) throw new Error(t.keepOneSource);
      if (!hasDocument && !hasMessages) throw new Error(t.keepNoSource);
      writable(ctx, args.path);
      const pieces = hasDocument ? [await keptDocument(ctx, keptPath(ctx, document))] : await keptMessages(ctx, args.messageIds);
      const kept = await keepNote(ctx, keptPath(ctx, args.path), pieces);
      await labelFolder(ctx, filesRoot(ctx)!);
      return { success: true, path: kept.path, source: document || pieces.map((p) => p.source) };
    },
    postBriefRound,
    recordBriefAnswers,
    writeIssueDraft,
    describeBriefImages,
    searchFiles: async (args, ctx) => {
      const words = queryWords(typeof args.query === "string" ? args.query : "");
      if (!words.length) throw new Error("query is required");
      const wanted = typeof args.path === "string" ? args.path.trim() : "";
      if (!wanted) {
        // Every source: grouped by channel in the order their newest kept match comes.
        const sources = await readableSources(workspaceStore(), ctx);
        const all = (await Promise.all(sources.map((s) => searchSource(ctx, s, s.folders, words)))).flat();
        const { kept, total, leftOut } = capped(all.filter((m) => m.source.quotable));
        const groups = sources.map((s) => ({ s, matches: kept.filter((m) => m.source === s) })).filter((g) => g.matches.length)
          .sort((a, b) => kept.indexOf(a.matches[0]!) - kept.indexOf(b.matches[0]!));
        return { groups: groups.map((g) => ({ channel: g.s.label, matches: g.matches.map(shownMatch) })), total, leftOut, ...notShown(ctx, all.length - total) };
      }
      let found: (FileMatch & { shown: string })[];
      if (namesChannel(wanted)) {
        const { source, path } = await namedSource(ctx, wanted, true, true);
        found = await searchSource(ctx, source, path === source.folder ? source.folders : [path], words);
        if (!source.quotable) return { matches: [], ...notShown(ctx, found.length) };
      } else {
        const root = resolvePath(ctx, wanted, true), access = threadAccess(ctx);
        await access.check(root);
        const name = wanted.split("/")[0]!, prefix = visibleRoots(ctx)[name]!;
        found = (await access.filter(await workspaceStore().searchFolder(ctx.tenantId, root, words, (p) => p.slice(prefix.length + 1)))).map((m) => ({ ...m, shown: name + m.path.slice(prefix.length) }));
      }
      const { kept, total, leftOut } = capped(found);
      return { matches: kept.map(shownMatch), ...(leftOut ? { total, leftOut } : {}) };
    },
  },
};

