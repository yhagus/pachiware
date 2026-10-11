import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import Markdown from "react-markdown";
import { ChevronRight, Copy, FilePlus, FileText, Folder, FolderPlus, Lock, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmAction } from "@/components/ConfirmAction";
import { IconButton } from "@/components/IconButton";
import { api, type Tenant, type WorkspaceEntry } from "@/lib/api";

const LABELS: Record<string, string> = { shared: "Tenant shared", guilds: "Guilds", dms: "Direct messages", channels: "Channels", tasks: "Tasks" };
// "playbooks" at the root is the read-only folder of built-in playbooks; the tenant's own live in "shared/playbooks".
const PATH_LABELS: Record<string, string> = { playbooks: "Built-in playbooks", "shared/playbooks": "Playbooks" };
const crumb = (p: string) => p.split("/").pop()!;
const label = (p: string) => PATH_LABELS[p] ?? LABELS[crumb(p)] ?? crumb(p);

export function TenantWorkspace() {
  const tenant = useOutletContext<Tenant>();
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<WorkspaceEntry[] | null>(null);
  const [builtins, setBuiltins] = useState<WorkspaceEntry[]>([]);
  const [open, setOpen] = useState<{ path: string; content: string; version: string; readOnly?: boolean } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const load = useCallback(() => api.workspaceTree(tenant.id, dir).then((r) => setEntries(r.entries)).catch((e) => { toast.error(e.message); setEntries([]); }), [tenant.id, dir]);
  useEffect(() => { setEntries(null); void load(); }, [load]);
  const loadBuiltins = useCallback(() => api.workspaceTree(tenant.id, "playbooks").then((r) => setBuiltins(r.entries)).catch(() => setBuiltins([])), [tenant.id]);
  useEffect(() => { void loadBuiltins(); }, [loadBuiltins]);

  const readOnly = dir === "playbooks" || dir.startsWith("playbooks/");
  const inPlaybook = /^(shared\/)?playbooks\/([^/]+)/.exec(dir);
  const playbook = inPlaybook && { name: inPlaybook[2]!, builtin: !inPlaybook[1], ofBuiltin: builtins.find((b) => crumb(b.path) === inPlaybook[2]) };

  const show = async (path: string) => {
    try { const f = await api.workspaceRead(tenant.id, path); setOpen({ path, ...f }); setDraft(null); setConflict(false); } catch (e) { toast.error((e as Error).message); }
  };
  const act = async (job: () => Promise<unknown>, done: string) => { try { await job(); toast.success(done); await load(); return true; } catch (e) { toast.error((e as Error).message); return false; } };

  const save = async () => {
    if (!open || draft === null) return;
    try {
      const { version } = await api.workspaceWrite(tenant.id, open.path, draft, open.version);
      setOpen({ ...open, content: draft, version }); setDraft(null); setConflict(false); toast.success("Saved");
    } catch (e) {
      const msg = (e as Error).message;
      if (/changed/i.test(msg)) setConflict(true); else toast.error(msg);
    }
  };
  const create = (kind: "file" | "folder") => {
    const name = window.prompt(kind === "file" ? "New file name (e.g. notes.md)" : "New folder name");
    if (!name) return;
    const path = [dir, name.trim()].filter(Boolean).join("/");
    if (kind === "file") void act(() => api.workspaceWrite(tenant.id, path.endsWith(".md") ? path : `${path}.md`, ""), "File created");
    else void act(async () => { await api.workspaceWrite(tenant.id, `${path}/README.md`, `# ${name.trim()}\n`); await api.workspaceWrite(tenant.id, `${path}/.name`, name.trim()); }, "Folder created");
  };
  const rename = (e: WorkspaceEntry) => {
    const name = window.prompt("New path (use / to move into another folder)", e.path);
    if (name && name !== e.path) void act(async () => { await api.workspaceMove(tenant.id, e.path, name.trim()); if (open?.path === e.path) setOpen(null); }, "Moved");
  };
  // These change folders, so they skip act's reload of the current one.
  const copyPlaybook = async (name: string) => {
    try {
      const { path } = await api.copyPlaybook(tenant.id, name);
      await loadBuiltins(); setDir(path); await show(`${path}/PLAYBOOK.md`);
      toast.success("Copied. Edit the copy to change how the bot runs this playbook.");
    } catch (e) { toast.error((e as Error).message); }
  };
  const deletePlaybook = async (name: string, builtin: boolean) => {
    try {
      await api.deletePlaybook(tenant.id, name);
      if (open?.path.startsWith(`shared/playbooks/${name}/`)) setOpen(null);
      await loadBuiltins(); setDir(builtin ? `playbooks/${name}` : "shared/playbooks");
      toast.success(builtin ? "Override deleted. The bot follows the built-in playbook again." : "Playbook deleted");
    } catch (e) { toast.error((e as Error).message); }
  };

  const parts = dir ? dir.split("/") : [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Everything the assistant keeps for this tenant as files: tasks, notes and memory. You see all servers and channels; the assistant sees only its own channel and the shared folders. Playbooks are edited only here: the assistant can read them but not change them.</p>
      <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" className="rounded px-1 hover:bg-muted" onClick={() => setDir("")}>Workspace</button>
        {parts.map((p, i) => (<span key={i} className="flex items-center gap-1"><ChevronRight className="size-3 text-muted-foreground" /><button type="button" className="rounded px-1 hover:bg-muted" onClick={() => setDir(parts.slice(0, i + 1).join("/"))}>{label(parts.slice(0, i + 1).join("/"))}</button></span>))}
        {!readOnly && (
          <span className="ml-auto flex gap-1">
            <IconButton label="New file" onClick={() => create("file")}><FilePlus /></IconButton>
            <IconButton label="New folder" onClick={() => create("folder")}><FolderPlus /></IconButton>
          </span>
        )}
      </nav>
      {playbook && (
        <section aria-label="Playbook" className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3 text-sm sm:flex-row sm:items-center">
          {playbook.builtin ? (<>
            <p className="flex min-w-0 flex-1 gap-2"><Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span><span className="font-medium">{playbook.name}</span> is built in and read-only. {playbook.ofBuiltin?.overridden ? "This tenant has its own copy, and the bot follows the copy." : "To change it, copy it into this tenant's playbooks and edit the copy."}</span></p>
            {playbook.ofBuiltin?.overridden
              ? <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setDir(`shared/playbooks/${playbook.name}`)}>Open the copy</Button>
              : <Button className="min-h-11 sm:min-h-9" onClick={() => void copyPlaybook(playbook.name)}><Copy /> Copy as override</Button>}
          </>) : (<>
            <p className="min-w-0 flex-1">{playbook.ofBuiltin
              ? <>This copy overrides the built-in <span className="font-medium">{playbook.name}</span> playbook, and the bot follows it. Saved changes reach the bot's commands right away.</>
              : <><span className="font-medium">{playbook.name}</span> is this tenant's own playbook. Saved changes reach the bot's commands right away.</>}</p>
            <ConfirmAction
              trigger={<Button variant="outline" className="min-h-11 sm:min-h-9"><Trash2 /> {playbook.ofBuiltin ? "Delete override" : "Delete playbook"}</Button>}
              title={playbook.ofBuiltin ? `Delete the ${playbook.name} override?` : `Delete the ${playbook.name} playbook?`}
              description={playbook.ofBuiltin ? "Every file in this copy is removed, and the bot goes back to the built-in playbook." : "Every file in this playbook is removed, and the bot stops offering it."}
              confirmLabel="Delete" danger onConfirm={() => void deletePlaybook(playbook.name, !!playbook.ofBuiltin)} />
          </>)}
        </section>
      )}
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 lg:w-80 lg:shrink-0">
          {!entries ? <Skeleton className="h-24" /> : !entries.length ? <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">Nothing here yet.</p> : (
            <ul className="divide-y rounded-lg border">
              {entries.filter((e) => !crumb(e.path).startsWith(".")).map((e) => (
                <li key={e.path} className="flex items-center gap-1 pr-1">
                  <button type="button" onClick={() => (e.type === "dir" ? setDir(e.path) : void show(e.path))} className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm hover:bg-muted ${open?.path === e.path ? "bg-muted font-medium" : ""}`}>
                    {e.type === "dir" ? <Folder className="size-4 shrink-0 text-muted-foreground" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
                    <span className="truncate">{label(e.path)}</span>
                  </button>
                  {e.readOnly ? (
                    (e.path === "playbooks" || e.overridden) && <span className="shrink-0 px-2 text-xs text-muted-foreground">{e.overridden ? "Overridden" : "Read-only"}</span>
                  ) : (<>
                    <IconButton label={`Rename or move ${crumb(e.path)}`} onClick={() => rename(e)}><Pencil /></IconButton>
                    <ConfirmAction trigger={<IconButton label={`Delete ${crumb(e.path)}`}><Trash2 /></IconButton>} title={`Delete ${crumb(e.path)}?`} description={e.type === "dir" ? "Only an empty folder can be deleted." : "The file is removed for good."} confirmLabel="Delete" danger onConfirm={() => void act(async () => { await api.workspaceDelete(tenant.id, e.path); if (open?.path === e.path) setOpen(null); }, "Deleted")} />
                  </>)}
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* lg:w-0 keeps a long frontmatter line from widening the page; the preview scrolls it instead. */}
        <div className="min-w-0 flex-1 lg:w-0">
          {!open ? <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">Pick a file to read or edit it.</p> : (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center gap-2"><h3 className="min-w-0 flex-1 truncate font-medium">{open.path}</h3>
                {open.readOnly ? <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" aria-hidden /> Read-only</span>
                  : draft === null ? <Button size="sm" variant="outline" onClick={() => setDraft(open.content)}><Pencil /> Edit</Button> : (<><Button size="sm" variant="ghost" onClick={() => { setDraft(null); setConflict(false); }}>Cancel</Button><Button size="sm" onClick={() => void save()}>Save</Button></>)}
              </div>
              {conflict && (
                <div role="alert" className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
                  <p>The assistant or someone else changed this file after you opened it. Your edit was not saved.</p>
                  <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void show(open.path)}>Reload the latest</Button><Button size="sm" variant="ghost" onClick={() => setConflict(false)}>Keep editing</Button></div>
                </div>
              )}
              {draft !== null ? (
                <textarea aria-label={`Edit ${open.path}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={18} className="w-full rounded-md border bg-background p-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-ring" />
              ) : (
                <article className="max-w-none space-y-2 break-words text-sm [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2"><Markdown>{open.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, (fm) => "```yaml\n" + fm.trim() + "\n```\n")}</Markdown></article>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
