import { useCallback, useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router";
import { GitBranch, Pencil, Plus, Trash2 } from "lucide-react";
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
import { api, type GitAccount, type Tenant } from "@/lib/api";

export const PROVIDERS = [{ id: "github", name: "GitHub" }, { id: "gitlab", name: "GitLab" }] as const;
export const providerName = (id: string) => PROVIDERS.find((p) => p.id === id)?.name ?? id;
const EMPTY = { name: "", provider: "github", baseUrl: "", token: "" };

export function TenantGitAccounts() {
  const tenant = useOutletContext<Tenant>();
  const [accounts, setAccounts] = useState<GitAccount[] | null>(null);
  const [editing, setEditing] = useState<GitAccount | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [loadError, setLoadError] = useState("");
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const ok = params.get("git"), err = params.get("git_error");
    if (!ok && !err) return;
    if (ok) toast.success(`Connected ${ok}`); else toast.error(err!);
    setParams({}, { replace: true });
  }, [params, setParams]);
  const load = useCallback(() => api.listGitAccounts(tenant.id).then((r) => { setAccounts(r.gitAccounts); setLoadError(""); }).catch((e) => setLoadError(e.message)), [tenant.id]);
  useEffect(() => { void load(); }, [load]);

  const open = (a: GitAccount | "new") => {
    setForm(a === "new" ? EMPTY : { name: a.name, provider: a.provider, baseUrl: a.baseUrl ?? "", token: "" });
    setEditing(a);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name: form.name.trim(), baseUrl: form.baseUrl.trim() || null, ...(form.token ? { token: form.token.trim() } : {}) };
    try {
      if (editing === "new") await api.createGitAccount(tenant.id, { ...body, provider: form.provider });
      else await api.updateGitAccount((editing as GitAccount).id, body);
      toast.success(editing === "new" ? "Git account connected" : "Git account updated"); setEditing(null); await load();
    } catch (err: any) { toast.error(err.message); }
  };
  const oauth = async (provider: string) => {
    try { window.location.href = (await api.startGitOAuth(tenant.id, { provider, baseUrl: form.baseUrl.trim() || null })).authorizeUrl; }
    catch (e: any) { toast.error(e.message); }
  };
  const remove = async (a: GitAccount) => {
    try { await api.deleteGitAccount(a.id); toast.success("Git account deleted"); await load(); } catch (e: any) { toast.error(e.message); }
  };
  const gitlab = form.provider === "gitlab";
  const hostChanged = editing !== "new" && !!editing && (form.baseUrl.trim() || null) !== editing.baseUrl;

  const hostField = (
            <div className="space-y-2"><Label htmlFor="gb">Host URL (optional)</Label><Input id="gb" type="url" placeholder={gitlab ? "https://gitlab.example.com" : "https://github.example.com"} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
              <p className="text-xs text-muted-foreground">Leave blank for {gitlab ? "gitlab.com" : "github.com"}. Set it for a self-hosted server (https only).{hostChanged && " Changing the host requires entering the token again."}</p></div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">A git account lets integrations read and change repositories. Each integration uses one account; several can share it. Allowed hosts and OAuth apps are in <Link to="/settings" className="underline underline-offset-2">Settings</Link>.</p>
        <Button onClick={() => open("new")}><Plus /> Connect account</Button>
      </div>
      {loadError
        ? <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 p-4 text-sm">
            <span className="text-destructive">Could not load git accounts: {loadError}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </div>
        : !accounts
        ? <div role="status" aria-live="polite">
            <p className="mb-3 text-sm text-muted-foreground">Loading git accounts</p>
            <div className="grid gap-3.75 sm:grid-cols-2 xl:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
          </div>
        : accounts.length === 0
          ? <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">No git accounts yet. Integrations cannot reach repositories until you connect one.</p>
          : <div className="grid gap-3.75 sm:grid-cols-2 xl:grid-cols-3">
              {accounts.map((a) => (
                <Card key={a.id} className="relative py-5"><CardContent className="flex h-full flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><GitBranch className="size-5" /></div>
                    <div className="min-w-0 flex-1"><Link to={a.id} className="block truncate font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring">{a.name}</Link><div className="truncate text-xs text-muted-foreground">{providerName(a.provider)}{a.baseUrl ? ` · ${new URL(a.baseUrl).host}` : ""}</div></div>
                  </div>
                  <code className="truncate font-mono text-xs">{a.username}</code>
                  <div className="flex flex-wrap gap-1.5">
                    {a.bots.length === 0 ? <span className="text-xs text-muted-foreground">Not used by any integration</span> : a.bots.map((b) => <Badge key={b.id} variant="outline">{b.name}</Badge>)}
                  </div>
                  {a.bots.length > 0 && <p className="text-xs text-muted-foreground">To delete this account, first set the integrations above to another account or none.</p>}
                  <div className="relative mt-auto flex justify-end border-t pt-3">
                    <IconButton label="Edit" onClick={() => open(a)}><Pencil /></IconButton>
                    {a.bots.length === 0 && <ConfirmAction trigger={<IconButton label="Delete" className="text-destructive hover:text-destructive"><Trash2 /></IconButton>}
                      title={`Delete ${a.name}?`} description="The stored token is removed." confirmLabel="Delete" danger onConfirm={() => remove(a)} />}
                  </div>
                </CardContent></Card>
              ))}
            </div>}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <form onSubmit={save} className="space-y-5">
            <DialogHeader><DialogTitle>{editing === "new" ? "Connect git account" : "Edit git account"}</DialogTitle><DialogDescription className="sr-only">Git account settings</DialogDescription></DialogHeader>
            {editing === "new" && <>
              {hostField}
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => oauth("github")}>Continue with GitHub</Button>
                <Button type="button" variant="outline" onClick={() => oauth("gitlab")}>Continue with GitLab</Button>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or use an access token<span className="h-px flex-1 bg-border" /></div>
            </>}
            <div className="space-y-2"><Label htmlFor="gn">Name</Label><Input id="gn" required placeholder="e.g. Work GitHub" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="gp">Provider</Label>
              <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })} disabled={editing !== "new"}>
                <SelectTrigger id="gp" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{PROVIDERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
              {editing !== "new" && <p className="text-xs text-muted-foreground">Provider cannot be changed. Create a new account instead.</p>}</div>
            {editing !== "new" && hostField}
            <div className="space-y-2"><Label htmlFor="gt">Access token</Label><Input id="gt" type="password" required={editing === "new" || hostChanged} placeholder={editing !== "new" && !hostChanged ? "Leave blank to keep current" : ""} value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
              <p className="text-xs text-muted-foreground">The bot can do whatever this token can. Prefer a token limited to the repositories it needs. It is checked with the provider on save.{hostChanged && " Changing the host requires entering the token again."}</p></div>
            <DialogFooter><Button>Save</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
