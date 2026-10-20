import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router";
import { FlaskConical, Kanban, Pencil, Plus, Trash2, X } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { api, type PlaneAccount, type PlaneChecks, type PlaneServer, type PlaneVersion, type PlaneWorkspace, type Tenant } from "@/lib/api";
import { planeHost } from "@/lib/plane";
import { useLastShown } from "@/hooks/use-last-shown";
import { PlaneChecklist, PlanePlayground, WorkspaceResult } from "./PlanePlayground";

const EMPTY = { name: "", baseUrl: "", workspaces: [] as PlaneWorkspace[], apiKey: "", planeVersion: "" };
// Mirrors slugOf and MAX_PLANE_WORKSPACES in apps/agent/src/routes/admin/planeAccounts.ts.
const SLUG = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const MAX_WORKSPACES = 20;

export function TenantPlaneAccounts() {
  const tenant = useOutletContext<Tenant>();
  const [accounts, setAccounts] = useState<PlaneAccount[] | null>(null);
  const [editing, setEditing] = useState<PlaneAccount | "new" | null>(null);
  const shown = useLastShown(editing);
  const [form, setForm] = useState(EMPTY);
  const [slug, setSlug] = useState("");
  const [slugError, setSlugError] = useState("");
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState<PlaneChecks | null>(null);
  const [testing, setTesting] = useState(false);
  const [trying, setTrying] = useState<PlaneAccount | null>(null);
  // A Test result describes the settings it ran with, so any edit clears it.
  useEffect(() => { setProbe(null); }, [form]);
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
  // The release the Plane at the form's base URL reports; a later answer replaces an earlier one only if it was asked later.
  const [server, setServer] = useState<PlaneServer | null>(null);
  const asked = useRef(0);
  const readServer = (baseUrl: string, preselect: boolean) => {
    const n = ++asked.current;
    setServer(null);
    api.readPlaneServer(baseUrl).then((r) => {
      if (n !== asked.current) return;
      setServer(r.server);
      if (preselect && r.server?.suggested) setForm((f) => ({ ...f, planeVersion: r.server!.suggested! }));
    }).catch(() => {});
  };

  const open = (a: PlaneAccount | "new") => {
    setForm(a === "new" ? { ...EMPTY, planeVersion: versions.at(-1)?.id ?? "" } : { name: a.name, baseUrl: a.baseUrl ?? "", workspaces: a.workspaces, apiKey: "", planeVersion: a.planeVersion });
    setSlug(""); setSlugError("");
    setEditing(a);
    readServer(a === "new" ? "" : a.baseUrl ?? "", a === "new");
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.workspaces.length) { setSlugError("Add at least one Plane workspace."); return; }
    const body = { name: form.name.trim(), baseUrl: form.baseUrl.trim() || null, workspaces: form.workspaces, ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}), ...(chosen ? { planeVersion: chosen.id } : {}) };
    setSaving(true);
    try {
      const r = editing === "new" ? await api.createPlaneAccount(tenant.id, body) : await api.updatePlaneAccount((editing as PlaneAccount).id, body);
      toast.success(`Saved. Connected as ${r.planeAccount.planeUserName}`);
      if (r.planeAccount.versionNote) toast.warning(r.planeAccount.versionNote, { duration: 10000 });
      setEditing(null); await load();
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  };
  const runTest = async () => {
    setTesting(true);
    try {
      setProbe((await api.testPlaneAccount({ baseUrl: form.baseUrl.trim() || null, apiKey: form.apiKey.trim() || undefined, accountId: editing !== "new" ? editing?.id : undefined, planeVersion: chosen?.id, workspaces: form.workspaces })).checks);
    } catch (e: any) { toast.error(e.message); } finally { setTesting(false); }
  };
  const remove = async (a: PlaneAccount) => {
    try { await api.deletePlaneAccount(a.id); toast.success("Plane account deleted"); await load(); } catch (e: any) { toast.error(e.message); }
  };
  const hostChanged = shown !== "new" && !!shown && (form.baseUrl.trim() || null) !== shown.baseUrl;
  const addSlug = () => {
    const s = slug.trim().toLowerCase().replace(/^\/+|\/+$/g, "");
    if (!SLUG.test(s)) return setSlugError("A slug has letters, digits, - and _, as in the Plane workspace's address.");
    if (form.workspaces.some((w) => w.slug === s)) return setSlugError(`${s} is already listed.`);
    setForm({ ...form, workspaces: [...form.workspaces, { slug: s, enabled: true }] });
    setSlug(""); setSlugError("");
  };
  const setWorkspace = (s: string, enabled: boolean) => setForm({ ...form, workspaces: form.workspaces.map((w) => (w.slug === s ? { ...w, enabled } : w)) });
  // Removing a saved workspace deletes its Plane access rules, which switching it off would keep.
  const removed = shown && shown !== "new" ? shown.workspaces.filter((w) => !form.workspaces.some((x) => x.slug === w.slug)) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">A Plane account is one API key on Plane's cloud or your own server, acting as one Plane user in every Plane workspace that user belongs to. List the Plane workspaces integrations may use. Several integrations can share an account. Self-hosted servers must be on Allowed hosts in <Link to="/settings" className="underline underline-offset-2">Settings</Link>.</p>
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
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{a.name}</div><div className="truncate text-xs text-muted-foreground">{planeHost(a.baseUrl)}</div></div>
                  </div>
                  <ul aria-label="Plane workspaces" className="flex flex-wrap gap-1.5">
                    {a.workspaces.map((w) => <li key={w.slug}><Badge variant={w.enabled ? "secondary" : "outline"} className="font-mono">{w.slug}{!w.enabled && <span className="font-sans text-muted-foreground">· off</span>}</Badge></li>)}
                  </ul>
                  <p className="break-words text-xs">Connected as <span className="font-medium">{a.planeUserName}</span></p>
                  <div>{versionBadge(a.planeVersion)}</div>
                  {a.versionNote && <p className="break-words text-xs text-amber-700 dark:text-amber-400">{a.versionNote}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {a.bots.length === 0 ? <span className="text-xs text-muted-foreground">Not used by any integration</span> : a.bots.map((b) => <Badge key={b.id} variant="outline">{b.name}</Badge>)}
                  </div>
                  {a.bots.length > 0 && <p className="text-xs text-muted-foreground">To delete this account, first detach it from the integrations above.</p>}
                  <div className="mt-auto flex justify-end border-t pt-3">
                    <IconButton label="Playground" onClick={() => setTrying(a)}><FlaskConical /></IconButton>
                    <IconButton label="Edit" onClick={() => open(a)}><Pencil /></IconButton>
                    {a.bots.length === 0 && <ConfirmAction trigger={<IconButton label="Delete" className="text-destructive hover:text-destructive"><Trash2 /></IconButton>}
                      title={`Delete ${a.name}?`} description="The stored API key is removed." confirmLabel="Delete" danger onConfirm={() => remove(a)} />}
                  </div>
                </CardContent></Card>
              ))}
            </div>}

      <PlanePlayground account={trying} onClose={() => setTrying(null)} />
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <form onSubmit={save} className="space-y-5">
            <DialogHeader><DialogTitle>{shown === "new" ? "Add Plane account" : "Edit Plane account"}</DialogTitle><DialogDescription className="sr-only">Plane account settings</DialogDescription></DialogHeader>
            <div className="space-y-2"><Label htmlFor="pn">Name</Label><Input id="pn" required placeholder="e.g. Acme Plane" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="pb">Base URL (optional)</Label><Input id="pb" type="url" placeholder="https://plane.example.com" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} onBlur={() => readServer(form.baseUrl.trim(), shown === "new")} />
              <p className="text-xs text-muted-foreground">Leave blank for Plane's cloud. Set it for a self-hosted Plane, where raising API_KEY_RATE_LIMIT (60 a minute by default) helps a busy bot.{hostChanged && " Changing the base URL requires entering the API key again."}</p></div>
            <div className="space-y-2"><Label htmlFor="pv">Plane version</Label>
              <Select value={chosen ? chosen.id : ""} onValueChange={(v) => setForm({ ...form, planeVersion: v })}>
                <SelectTrigger id="pv" className="w-full"><SelectValue placeholder="Choose a Plane version" /></SelectTrigger>
                <SelectContent>{versions.map((v) => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">The Plane release your server runs. It decides which tools the bot can use there, so change it here after you upgrade Plane.{chosen && ` ${chosen.label} was checked against ${chosen.checkedAgainst}.`}</p>
              {server && (server.suggested === chosen?.id
                ? <p className="text-xs text-muted-foreground">This Plane runs {server.release}.</p>
                : <p className="text-xs text-amber-700 dark:text-amber-400">This Plane runs {server.release}, {server.suggested ? `which ${versionOf(server.suggested)?.label ?? server.suggested} covers.` : "which no Plane version here covers yet. Some tools may fail."}</p>)}</div>
            <div className="space-y-2"><Label htmlFor="ps">Plane workspaces</Label>
              <div className="flex gap-2">
                <Input id="ps" autoComplete="off" spellCheck={false} placeholder="acme" aria-describedby="ps-help" aria-invalid={!!slugError} value={slug}
                  onChange={(e) => { setSlug(e.target.value); setSlugError(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSlug(); } }} />
                <Button type="button" variant="outline" disabled={!slug.trim() || form.workspaces.length >= MAX_WORKSPACES} onClick={addSlug}>Add</Button>
              </div>
              {slugError && <p role="alert" className="text-xs text-destructive">{slugError}</p>}
              <p id="ps-help" className="text-xs text-muted-foreground">The part after the host in a Plane workspace's address, as in app.plane.so/<span className="font-mono">acme</span>/. The key opens every Plane workspace its Plane user belongs to, but Plane cannot list them, so add each one here. Integrations can use only the ones switched on; at most {MAX_WORKSPACES}.</p>
              {form.workspaces.length > 0 && (
                <ul className="divide-y rounded-md border">
                  {form.workspaces.map((w) => (
                    <li key={w.slug} className="flex min-h-11 items-center gap-3 py-1 pr-1 pl-3">
                      <div className="min-w-0 flex-1 py-1">
                        <div className="break-all font-mono text-sm">{w.slug}</div>
                        {probe?.workspaces.find((r) => r.slug === w.slug) && <WorkspaceResult check={probe.workspaces.find((r) => r.slug === w.slug)!} />}
                      </div>
                      <Switch checked={w.enabled} onCheckedChange={(v) => setWorkspace(w.slug, v)} aria-label={`Integrations may use ${w.slug}`} />
                      <IconButton type="button" label={`Remove ${w.slug}`} onClick={() => setForm({ ...form, workspaces: form.workspaces.filter((x) => x.slug !== w.slug) })}><X /></IconButton>
                    </li>
                  ))}
                </ul>
              )}
              {removed.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Saving removes {removed.map((w) => w.slug).join(", ")} and its Plane access rules in every integration. Switch a Plane workspace off instead to keep them.</p>}</div>
            <div className="space-y-2"><Label htmlFor="pk">API key</Label><Input id="pk" type="password" autoComplete="off" required={shown === "new" || hostChanged} placeholder={shown !== "new" && !hostChanged ? "Leave blank to keep current" : ""} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
              <p className="text-xs text-muted-foreground">The bot can do whatever this key's Plane user can. Use a dedicated Plane user, added only to the Plane projects it needs as a Member (Admin only for intake triage or project admin), and give the key an expiry. The key is checked with Plane on save and never shown again.</p></div>
            {probe && <PlaneChecklist checks={probe} workspaces={false} />}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={testing || saving} onClick={runTest}>{testing ? "Testing…" : "Test"}</Button>
              <Button disabled={saving}>{saving ? "Checking with Plane" : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
