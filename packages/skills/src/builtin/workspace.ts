import type { SkillContext, SkillModule } from "../types.js";
import { resolvePath, visibleRoots } from "../workspace/paths.js";
import { workspaceStore, type WorkspaceStore } from "../workspace/store.js";
import { readPlaybookFile } from "../playbooks.js";
import { postBriefRound, postBriefRoundTool } from "../brief.js";
import { recordBriefAnswers, recordBriefAnswersTool, writeIssueDraft, writeIssueDraftTool } from "../issueDrafts.js";
import { describeBriefImages, describeBriefImagesTool } from "../briefImages.js";
import { ISSUE_DRAFT_PLAYBOOK } from "../grounding.js";
import { forget, memoryLevel, remember } from "../workspace/memory.js";
import { fileDocument, filesRoot, isDocument } from "../workspace/files.js";
import { textIn } from "../language.js";
import { hasPermission } from "../permissions.js";

const pathArg = { type: "string", description: 'Path starting with a folder name, e.g. "channel/notes/ideas.md"' };
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

/** Playbooks are the agent's rules, so chat cannot rewrite them; people edit them in the console. Case-folded for case-insensitive disks. */
function writable(path: unknown) {
  if (typeof path === "string" && path.split("/")[1]?.toLowerCase() === "playbooks") throw new Error("Files under playbooks/ cannot be changed from chat. Playbooks are edited in the console.");
  return path;
}

const TOP_FOLDERS = ["tasks", "notes", "decisions", "files", "minutes", "threads"], TOP_FILES = ["MEMORY.md", "glossary.md"];
/** A channel's or DM's top level is fixed so people find things in the console; deeper folders are free. */
function creatable(ctx: SkillContext, path: unknown) {
  writable(path);
  if (typeof path !== "string") return path;
  const [root, top, ...rest] = path.replace(/\/$/, "").split("/");
  if ((root === "channel" || root === "dm") && top !== undefined && !(rest.length ? TOP_FOLDERS.includes(top) : TOP_FILES.includes(top))) throw new Error(textIn(ctx.language).folderRefused([...TOP_FOLDERS, ...TOP_FILES]));
  return path;
}

export const workspaceSkill: SkillModule = {
  id: "workspace",
  name: "Workspace",
  description: "Keep notes and memory as Markdown files in this tenant's Workspace.",
  capabilities: ["workspace"],
  allowedScopes: ["tenant"],
  toolPolicy: { listFiles: { effect: "read" }, readFile: { effect: "read" }, searchFiles: { effect: "read" }, readPlaybookFile: { effect: "read" }, postBriefRound: { effect: "write", requiresConfirmation: false, playbook: ISSUE_DRAFT_PLAYBOOK }, recordBriefAnswers: { effect: "write", requiresConfirmation: false, playbook: ISSUE_DRAFT_PLAYBOOK }, writeIssueDraft: { effect: "write", requiresConfirmation: false, playbook: ISSUE_DRAFT_PLAYBOOK }, describeBriefImages: { effect: "write", requiresConfirmation: false, playbook: ISSUE_DRAFT_PLAYBOOK }, writeFile: { effect: "write", requiresConfirmation: false }, moveFile: { effect: "write", requiresConfirmation: false }, deleteFile: { effect: "danger", requiresConfirmation: true }, remember: { effect: "write", requiresConfirmation: false }, forget: { effect: "write", requiresConfirmation: false }, saveAttachment: { effect: "write", requiresConfirmation: false } },
  tools: [
    { name: "listFiles", description: "Lists files and folders in a Workspace folder.", parameters: { type: "object", properties: { path: pathArg }, required: ["path"] } },
    { name: "readFile", description: "Reads a Markdown file from the Workspace.", parameters: { type: "object", properties: { path: pathArg }, required: ["path"] } },
    { name: "writeFile", description: "Creates or replaces a Markdown file in the Workspace. Missing folders are created. To replace an existing file, pass the version from readFile.", parameters: { type: "object", properties: { path: pathArg, content: { type: "string", description: "Full file content" }, version: { type: "string", description: "Version returned by readFile; required when the file exists" } }, required: ["path", "content"] } },
    { name: "moveFile", description: "Moves or renames a file or folder. Refuses to overwrite.", parameters: { type: "object", properties: { from: pathArg, to: pathArg }, required: ["from", "to"] } },
    { name: "deleteFile", description: "Deletes a file, or an empty folder.", parameters: { type: "object", properties: { path: pathArg }, required: ["path"] } },
    { name: "searchFiles", description: "Finds files by name or text, case-insensitive, under a folder.", parameters: { type: "object", properties: { query: { type: "string", description: "Text to find" }, path: pathArg }, required: ["query", "path"] } },
    { name: "readPlaybookFile", description: "Reads a reference file of a playbook, such as a template or checklist one of its steps points at.", parameters: { type: "object", properties: { playbook: { type: "string", description: "Playbook name, e.g. issue-draft" }, path: { type: "string", description: 'File name inside the playbook folder, e.g. "template.md"' } }, required: ["playbook", "path"] } },
    { name: "remember", description: "Keeps one fact in Memory for later turns: a decision, how someone likes to be addressed or to work, a convention of the place. Writes a dated line with the asker's name; say nothing about it unless asked. Never keep private details or the conversation itself.", parameters: { type: "object", properties: { level: levelArg, text: { type: "string", description: "One line, in the asker's words" } }, required: ["level", "text"] } },
    { name: "forget", description: "Removes every Memory line containing the text, case-insensitively, and reports how many went.", parameters: { type: "object", properties: { level: levelArg, match: { type: "string", description: "Text the lines to remove contain" } }, required: ["level", "match"] } },
    { name: "saveAttachment", description: "Files one attachment of a message in this channel under files/, when a person asks to keep a file that was not sent to the bot. Same rules as files sent to the bot: PDF, DOCX, XLSX, CSV, MD or TXT, 10 MB at most, a taken name gets -2.", parameters: { type: "object", properties: { messageId: { type: "string", description: 'The message id from the file placeholder, e.g. "[file: report.pdf (message 123)]"' }, name: { type: "string", description: "Attachment name, when the message holds more than one file" } }, required: ["messageId"] } },
    postBriefRoundTool,
    recordBriefAnswersTool,
    writeIssueDraftTool,
    describeBriefImagesTool,
  ],
  handlers: {
    listFiles: async (args, ctx) => {
      const entries = await workspaceStore().list(ctx.tenantId, resolvePath(ctx, args.path, true));
      const name = String(args.path).split("/")[0]!, prefix = visibleRoots(ctx)[name]!;
      return { entries: entries.filter((e) => !e.path.split("/").pop()!.startsWith(".")).map((e) => ({ ...e, path: name + e.path.slice(prefix.length) })) };
    },
    readFile: async (args, ctx) => {
      const file = await workspaceStore().read(ctx.tenantId, resolvePath(ctx, args.path));
      if (!file) throw new Error(`File "${args.path}" not found.`);
      return { content: file.content, version: file.version };
    },
    writeFile: async (args, ctx) => {
      if (typeof args.content !== "string") throw new Error("content is required");
      const path = resolvePath(ctx, creatable(ctx, args.path));
      const { version } = await workspaceStore().write(ctx.tenantId, path, args.content, typeof args.version === "string" ? args.version : undefined);
      await labelFolder(ctx, String(args.path).split("/")[0]!);
      return { success: true, path: args.path, version };
    },
    moveFile: async (args, ctx) => {
      await workspaceStore().move(ctx.tenantId, resolvePath(ctx, writable(args.from)), resolvePath(ctx, creatable(ctx, args.to)));
      return { success: true, from: args.from, to: args.to };
    },
    deleteFile: async (args, ctx) => {
      await workspaceStore().remove(ctx.tenantId, resolvePath(ctx, writable(args.path)));
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
      const outcome = await fileDocument(ctx.tenantId, ctx, candidates[0]!);
      if ("reason" in outcome) throw new Error(t.notFiled[outcome.reason]);
      await labelFolder(ctx, filesRoot(ctx)!);
      const text = !outcome.text ? {} : "path" in outcome.text ? { text: outcome.text.path } : { note: t.textNotExtracted };
      return { path: outcome.path, name: candidates[0]!.name, messageId: message.id, ...text };
    },
    postBriefRound,
    recordBriefAnswers,
    writeIssueDraft,
    describeBriefImages,
    searchFiles: async (args, ctx) => {
      const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      if (!query) throw new Error("query is required");
      const name = String(args.path).split("/")[0]!, prefix = visibleRoots(ctx)[name]!;
      return { matches: await search(workspaceStore(), ctx.tenantId, resolvePath(ctx, args.path, true), query, (p) => name + p.slice(prefix.length)) };
    },
  },
};

const MAX_MATCHES = 50, MAX_SCANNED = 500;
/** ponytail: walks and reads files per query; add an index when a Workspace outgrows MAX_SCANNED files. */
async function search(store: WorkspaceStore, tenantId: string, root: string, query: string, show: (p: string) => string) {
  const matches: { path: string; line?: number; text?: string }[] = [];
  let scanned = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const e of await store.list(tenantId, dir)) {
      if (matches.length >= MAX_MATCHES || scanned >= MAX_SCANNED) return;
      if (e.path.split("/").pop()!.startsWith(".")) continue;
      if (e.type === "dir") { await walk(e.path); continue; }
      scanned++;
      if (e.path.toLowerCase().includes(query)) { matches.push({ path: show(e.path) }); continue; }
      const file = await store.read(tenantId, e.path).catch(() => null);
      const lines = file?.content.split("\n") ?? [];
      const i = lines.findIndex((l) => l.toLowerCase().includes(query));
      if (i >= 0) matches.push({ path: show(e.path), line: i + 1, text: lines[i]!.slice(0, 200) });
    }
  };
  await walk(root);
  return matches;
}
