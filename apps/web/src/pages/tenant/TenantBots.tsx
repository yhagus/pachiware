import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router";
import { ArrowLeft, ChevronLeft, ChevronRight, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
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
import { api, type Bot, type GitAccount, type PlaneAccount, type Profile, type Tenant } from "@/lib/api";
import { PLATFORMS, emptyValues, platformOf, toInput, valuesOf, type Platform } from "@/lib/platforms";
import { label } from "@/lib/utils";
import { useLastShown } from "@/hooks/use-last-shown";

const PAGE_SIZE = 12;
const statusVariant = (s: string) => (s === "connected" ? "secondary" : s === "error" ? "destructive" : "outline");

// platform is null on the wizard's first step (picking a platform); editing an existing integration skips straight to its form.
type Editing = { platform: Platform | null; bot?: Bot };

function IntegrationCard({ bot, profileName, gitNames, onEdit, onDelete, run }: { bot: Bot; profileName?: string; gitNames: string[]; onEdit: () => void; onDelete: () => void; run: (op: () => Promise<unknown>, ok: string) => void }) {
  const p = platformOf(bot.platform);
  const Icon = p.icon;
  const scopes = bot.guildIds.length || "All";
  return (
    <Card className="py-5">
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><Icon className="size-5" /></div>
          <Link to={bot.id} className="min-w-0 flex-1 rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
            <div className="truncate font-medium hover:underline">{bot.name}</div>
            <div className="text-xs text-muted-foreground">{p.name}</div>
          </Link>
          <Badge variant={statusVariant(bot.connectionStatus)}>{label(bot.connectionStatus)}</Badge>
        </div>
        <div className="min-h-9 space-y-1 text-xs text-muted-foreground">
          <div>Profile: {profileName ?? "Tenant default"}</div>
          <div>Git accounts: {gitNames.length ? gitNames.join(", ") : "None"}</div>
          {p.fields.some((f) => f.key === "guildIds") && <div>{scopes} {p.scopeLabel}</div>}
          {bot.lastError && <div className="line-clamp-2 text-destructive">{bot.lastError}</div>}
        </div>
        <div className="mt-auto flex items-center justify-between border-t pt-3">
          {bot.isEnabled
            ? <ConfirmAction trigger={<Switch checked aria-label={`Disable ${bot.name}`} />} title={`Disable ${bot.name}?`} description="It disconnects until it is enabled again." confirmLabel="Disable" danger onConfirm={() => run(() => api.updateBot(bot.id, { isEnabled: false }), "Disabled")} />
            : <Switch checked={false} onCheckedChange={() => run(() => api.updateBot(bot.id, { isEnabled: true }), "Enabled")} aria-label={`Enable ${bot.name}`} />}
          <div className="flex">
            <ConfirmAction trigger={<IconButton label="Restart"><RefreshCw /></IconButton>} title={`Restart ${bot.name}?`} description="It disconnects briefly and reconnects." confirmLabel="Restart"
              onConfirm={() => run(async () => { const r = await api.restartBot(bot.id); if (r.success === false) throw new Error(r.error || r.message); }, "Restarted")} />
            <IconButton label="Edit" onClick={onEdit}><Pencil /></IconButton>
            <IconButton label="Delete" className="text-destructive hover:text-destructive" onClick={onDelete}><Trash2 /></IconButton>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TenantBots() {
  const tenant = useOutletContext<Tenant>();
  const [data, setData] = useState<{ bots: Bot[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const shown = useLastShown(editing);
  const [form, setForm] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [profileId, setProfileId] = useState("default");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [gitAccountIds, setGitAccountIds] = useState<string[]>([]);
  const [gitAccounts, setGitAccounts] = useState<GitAccount[]>([]);
  const [planeAccountIds, setPlaneAccountIds] = useState<string[]>([]);
  const [planeAccounts, setPlaneAccounts] = useState<PlaneAccount[]>([]);
  const [deleting, setDeleting] = useState<Bot | null>(null);
  const shownDeleting = useLastShown(deleting);
  const seq = useRef(0);

  useEffect(() => { const t = setTimeout(() => { setQ(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const r = await api.listBots(tenant.id, { page, pageSize: PAGE_SIZE, q, platform });
      if (id !== seq.current) return;
      const last = Math.max(1, Math.ceil(r.total / PAGE_SIZE));
      if (page > last) setPage(last); else setData(r);
    } catch (e: any) { if (id === seq.current) toast.error(e.message); }
  }, [tenant.id, page, q, platform]);
  useEffect(() => { void load(); const t = setInterval(() => !document.hidden && void load(), 10000); return () => clearInterval(t); }, [load]);

  useEffect(() => { api.listProfiles(tenant.id).then((r) => setProfiles(r.profiles)).catch(() => {}); }, [tenant.id]);
  useEffect(() => { api.listGitAccounts(tenant.id).then((r) => setGitAccounts(r.gitAccounts)).catch(() => {}); }, [tenant.id]);
  useEffect(() => { api.listPlaneAccounts(tenant.id).then((r) => setPlaneAccounts(r.planeAccounts)).catch(() => {}); }, [tenant.id]);

  const openEdit = (p: Platform, bot?: Bot) => {
    setForm(bot ? valuesOf(p, bot) : emptyValues(p)); setName(bot?.name ?? ""); setEnabled(bot?.isEnabled ?? true); setProfileId(bot?.profileId ?? "default"); setGitAccountIds(bot?.gitAccountIds ?? []); setPlaneAccountIds(bot?.planeAccountIds ?? []); setEditing({ platform: p, bot });
  };
  const run = async (op: () => Promise<unknown>, ok: string) => {
    try { await op(); toast.success(ok); await load(); return true; } catch (e: any) { toast.error(e.message); return false; }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const { platform: p, bot } = editing;
    if (!p) return;
    const body = { name, isEnabled: enabled, profileId: profileId === "default" ? null : profileId, gitAccountIds, planeAccountIds, ...toInput(p, form) };
    const ok = bot ? await run(() => api.updateBot(bot.id, body), "Integration updated") : await run(() => api.createBot(tenant.id, { ...body, platform: p.id }), "Integration created");
    if (ok) setEditing(null);
  };

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = !!q || !!platform;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search integrations" aria-label="Search integrations" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={platform || "all"} onValueChange={(v) => { setPlatform(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-44" aria-label="Filter by platform"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {PLATFORMS.map((p) => <SelectItem key={p.id} value={p.id}><p.icon /> {p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button className="ml-auto" onClick={() => setEditing({ platform: null })}><Plus /> Add integration</Button>
      </div>

      {!data
        ? <div className="grid gap-3.75 sm:grid-cols-2 xl:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-44" />)}</div>
        : data.bots.length === 0
          ? <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">{filtered ? "No integrations match your filters." : "No integrations yet. Add one to connect this tenant to a platform."}</p>
          : <div className="grid gap-3.75 sm:grid-cols-2 xl:grid-cols-3">
              {data.bots.map((b) => <IntegrationCard key={b.id} bot={b} profileName={profiles.find((x) => x.id === b.profileId)?.name} gitNames={b.gitAccountIds.map((id) => gitAccounts.find((x) => x.id === id)?.name).filter((n): n is string => !!n)} run={run} onEdit={() => openEdit(platformOf(b.platform), b)} onDelete={() => setDeleting(b)} />)}
            </div>}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
          <div className="flex items-center gap-1">
            <IconButton label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /></IconButton>
            <span className="px-2">Page {page} of {pages}</span>
            <IconButton label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight /></IconButton>
          </div>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {shown && !shown.platform && (
            <div className="space-y-5">
              <DialogHeader><DialogTitle>Choose a platform</DialogTitle><DialogDescription>Each platform has its own setup.</DialogDescription></DialogHeader>
              <div className="grid gap-2">
                {PLATFORMS.map((p) => (
                  <button key={p.id} type="button" onClick={() => openEdit(p)} className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><p.icon className="size-5" /></span>
                    <span className="min-w-0"><span className="block font-medium">{p.name}</span><span className="block text-xs text-muted-foreground">{p.description}</span></span>
                    <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {shown?.platform && (
            <form onSubmit={save} className="space-y-5">
              <DialogHeader>
                <DialogTitle>{shown.bot ? "Edit" : "Add"} {shown.platform.name} integration</DialogTitle>
                <DialogDescription className="sr-only">{shown.platform.name} settings</DialogDescription>
              </DialogHeader>
              <div className="space-y-2"><Label htmlFor="in">Name</Label><Input id="in" required value={name} onChange={(e) => setName(e.target.value)} /></div>
              {shown.platform.fields.map((f) => (
                <div key={f.key} className="space-y-2"><Label htmlFor={`f-${f.key}`}>{f.label}</Label>
                  <Input id={`f-${f.key}`} type={f.secret ? "password" : "text"} required={f.secret && !shown.bot}
                    placeholder={f.secret && shown.bot ? "Leave blank to keep current" : f.placeholder} value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} /></div>
              ))}
              <div className="space-y-2"><Label htmlFor="ipf">Profile</Label>
                <Select value={profileId} onValueChange={setProfileId}>
                  <SelectTrigger id="ipf" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="default">Tenant default</SelectItem>{profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {p.model}</SelectItem>)}</SelectContent>
                </Select></div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Git accounts</legend>
                {gitAccounts.length === 0 ? <p className="text-sm text-muted-foreground">No git accounts yet. Connect one under Git accounts.</p> : (
                  <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                    {gitAccounts.map((a) => (
                      <li key={a.id}><label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                        <input type="checkbox" className="size-4 cursor-pointer rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={gitAccountIds.includes(a.id)}
                          onChange={(e) => setGitAccountIds(e.target.checked ? [...gitAccountIds, a.id] : gitAccountIds.filter((x) => x !== a.id))} />{a.name} · {a.username}
                      </label></li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">Attached accounts are off everywhere until you enable them per server under Servers. Removing one also removes its server and channel settings.</p>
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Plane accounts</legend>
                {planeAccounts.length === 0 ? <p className="text-sm text-muted-foreground">No Plane accounts yet. Add one under Plane accounts.</p> : (
                  <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
                    {planeAccounts.map((a) => (
                      <li key={a.id}><label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                        <input type="checkbox" className="size-4 cursor-pointer rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={planeAccountIds.includes(a.id)}
                          onChange={(e) => setPlaneAccountIds(e.target.checked ? [...planeAccountIds, a.id] : planeAccountIds.filter((x) => x !== a.id))} />{a.name} · {a.workspaceSlug}
                      </label></li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">Plane stays off in every server until you pick Plane projects for it under Plane access. Removing an account also removes its server and channel settings.</p>
              </fieldset>
              <div className="flex items-center gap-2"><Switch id="ie" checked={enabled} onCheckedChange={setEnabled} /><Label htmlFor="ie">Enabled</Label></div>
              <DialogFooter className="sm:justify-between">
                {shown.bot ? <span /> : <Button type="button" variant="ghost" onClick={() => setEditing({ platform: null })}><ArrowLeft /> Back</Button>}
                <Button>Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete {shownDeleting?.name}?</AlertDialogTitle><AlertDialogDescription>It disconnects and its credentials are removed.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleting && run(() => api.deleteBot(deleting.id), "Integration deleted")}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
