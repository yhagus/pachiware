import { useCallback, useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router";
import { Kanban, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ConfirmAction";
import { IconButton } from "@/components/IconButton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type PlaneAccount, type PlaneVersion, type Tenant } from "@/lib/api";
import { planeHost } from "@/lib/plane";
import { useLastShown } from "@/hooks/use-last-shown";

const EMPTY = { name: "", baseUrl: "", workspaceSlug: "", apiKey: "", planeVersion: "" };

export function TenantPlaneAccounts() {
  const tenant = useOutletContext<Tenant>();
  const [accounts, setAccounts] = useState<PlaneAccount[] | null>(null);
  const [editing, setEditing] = useState<PlaneAccount | "new" | null>(null);
  const shown = useLastShown(editing);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [versions, setVersions] = useState<PlaneVersion[]>([]);
  const load = useCallback(() => api.listPlaneAccounts(tenant.id).then((r) => { setAccounts(r.planeAccounts); setLoadError(""); }).catch((e) => setLoadError(e.message)), [tenant.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api.listPlaneVersions().then((r) => setVersions(r.planeVersions)).catch((e) => toast.error(e.message)); }, []);
  const versionOf = (id: string) => versions.find((v) => v.id === id);
  // Until the list loads, an account's version reads as its id; once loaded, one the server does not know is marked.
  const versionBadge = (id: string) => versionOf(id)
    ? <Badge variant="secondary">{versionOf(id)!.label}</Badge>
    : <Badge variant={versions.length ? "destructive" : "secondary"}>{versions.length ? `Unknown Plane version "${id}"` : `Plane ${id}`}</Badge>;
  const chosen = versionOf(form.planeVersion);

  const open = (a: PlaneAccount | "new") => {
    setForm(a === "new" ? { ...EMPTY, planeVersion: versions.at(-1)?.id ?? "" } : { name: a.name, baseUrl: a.baseUrl ?? "", workspaceSlug: a.workspaceSlug, apiKey: "", planeVersion: a.planeVersion });
    setEditing(a);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name: form.name.trim(), baseUrl: form.baseUrl.trim() || null, workspaceSlug: form.workspaceSlug.trim(), ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}), ...(chosen ? { planeVersion: chosen.id } : {}) };
    setSaving(true);
    try {
      const r = editing === "new" ? await api.createPlaneAccount(tenant.id, body) : await api.updatePlaneAccount((editing as PlaneAccount).id, body);
      toast.success(`Saved. Connected as ${r.planeAccount.planeUserName}`); setEditing(null); await load();
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  };
  const remove = async (a: PlaneAccount) => {
    try { await api.deletePlaneAccount(a.id); toast.success("Plane account deleted"); await load(); } catch (e: any) { toast.error(e.message); }
  };
  const hostChanged = shown !== "new" && !!shown && (form.baseUrl.trim() || null) !== shown.baseUrl;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">A Plane account opens one Plane workspace, on Plane's cloud or your own server, as one Plane user. Several integrations can share it. Self-hosted servers must be on Allowed hosts in <Link to="/settings" className="underline underline-offset-2">Settings</Link>.</p>
        <Button onClick={() => open("new")}><Plus /> Add Plane account</Button>
      </div>
      {loadError
        ? <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 p-4 text-sm">
            <span className="text-destructive">Could not load Plane accounts: {loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </div>
        : !accounts
        ? <div role="status" aria-live="polite">
            <p className="mb-3 text-sm text-muted-foreground">Loading Plane accounts</p>
            <div className="grid gap-3.75 sm:grid-cols-2 xl:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
          </div>
        : accounts.length === 0
          ? <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">No Plane accounts yet. Integrations cannot reach Plane until you add one.</p>
          : <div className="grid gap-3.75 sm:grid-cols-2 xl:grid-cols-3">
              {accounts.map((a) => (
                <Card key={a.id} className="py-5"><CardContent className="flex h-full flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><Kanban className="size-5" /></div>
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{a.name}</div><div className="truncate text-xs text-muted-foreground">{planeHost(a.baseUrl)} · {a.workspaceSlug}</div></div>
                  </div>
                  <p className="break-words text-xs">Connected as <span className="font-medium">{a.planeUserName}</span></p>
                  <div>{versionBadge(a.planeVersion)}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {a.bots.length === 0 ? <span className="text-xs text-muted-foreground">Not used by any integration</span> : a.bots.map((b) => <Badge key={b.id} variant="outline">{b.name}</Badge>)}
                  </div>
                  {a.bots.length > 0 && <p className="text-xs text-muted-foreground">To delete this account, first detach it from the integrations above.</p>}
                  <div className="mt-auto flex justify-end border-t pt-3">
                    <IconButton label="Edit" onClick={() => open(a)}><Pencil /></IconButton>
                    {a.bots.length === 0 && <ConfirmAction trigger={<IconButton label="Delete" className="text-destructive hover:text-destructive"><Trash2 /></IconButton>}
                      title={`Delete ${a.name}?`} description="The stored API key is removed." confirmLabel="Delete" danger onConfirm={() => remove(a)} />}
                  </div>
                </CardContent></Card>
              ))}
            </div>}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <form onSubmit={save} className="space-y-5">
            <DialogHeader><DialogTitle>{shown === "new" ? "Add Plane account" : "Edit Plane account"}</DialogTitle><DialogDescription className="sr-only">Plane account settings</DialogDescription></DialogHeader>
            <div className="space-y-2"><Label htmlFor="pn">Name</Label><Input id="pn" required placeholder="e.g. Acme Plane" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="pb">Base URL (optional)</Label><Input id="pb" type="url" placeholder="https://plane.example.com" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
              <p className="text-xs text-muted-foreground">Leave blank for Plane's cloud. Set it for a self-hosted Plane, where raising API_KEY_RATE_LIMIT (60 a minute by default) helps a busy bot.{hostChanged && " Changing the base URL requires entering the API key again."}</p></div>
            <div className="space-y-2"><Label htmlFor="pv">Plane version</Label>
              <Select value={chosen ? chosen.id : ""} onValueChange={(v) => setForm({ ...form, planeVersion: v })}>
                <SelectTrigger id="pv" className="w-full"><SelectValue placeholder="Choose a Plane version" /></SelectTrigger>
                <SelectContent>{versions.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">The Plane release your server runs. It decides which tools the bot can use there, so change it here after you upgrade Plane.{chosen && ` ${chosen.label} was checked against ${chosen.checkedAgainst}.`}</p></div>
            <div className="space-y-2"><Label htmlFor="ps">Workspace slug</Label><Input id="ps" required autoComplete="off" spellCheck={false} placeholder="acme" value={form.workspaceSlug} onChange={(e) => setForm({ ...form, workspaceSlug: e.target.value })} />
              <p className="text-xs text-muted-foreground">The part after the host in your Plane workspace's address, as in app.plane.so/<span className="font-mono">acme</span>/.</p></div>
            <div className="space-y-2"><Label htmlFor="pk">API key</Label><Input id="pk" type="password" autoComplete="off" required={shown === "new" || hostChanged} placeholder={shown !== "new" && !hostChanged ? "Leave blank to keep current" : ""} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
              <p className="text-xs text-muted-foreground">The bot can do whatever this key's Plane user can. Use a dedicated Plane user, added only to the Plane projects it needs as a Member (Admin only for intake triage or project admin), and give the key an expiry. The key is checked with Plane on save and never shown again.</p></div>
            <DialogFooter><Button disabled={saving}>{saving ? "Checking with Plane" : "Save"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
