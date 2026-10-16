import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ConfirmAction";
import { IconButton } from "@/components/IconButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PROVIDERS, providerName } from "@/pages/tenant/TenantGitAccounts";
import { api, type GitOAuthApp } from "@/lib/api";

// Platform-wide: applies to every tenant, so it lives apart from the account list.
function AllowedHosts() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => { api.getAllowedHosts().then((r) => setText(r.hosts.join("\n"))).catch((e) => toast.error(e.message)); }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { const r = await api.saveAllowedHosts((text ?? "").split(/\s+/).filter(Boolean)); setText(r.hosts.join("\n")); toast.success("Allowed hosts saved"); } catch (err: any) { toast.error(err.message); }
  };
  return (
    <form onSubmit={save} className="space-y-2 rounded-lg border p-4">
      <Label htmlFor="ah">Allowed hosts (all tenants)</Label>
      <textarea id="ah" rows={3} autoComplete="off" spellCheck={false} disabled={text === null} placeholder="gitlab.example.com" value={text ?? ""} onChange={(e) => setText(e.target.value)}
        className="w-full rounded-md border bg-transparent px-3 py-2 font-mono text-sm focus-visible:outline-2 focus-visible:outline-ring" />
      <p className="text-xs text-muted-foreground">One host per line, with a port if needed. When empty, any https host is accepted. When set, git accounts and Plane accounts on self-hosted servers can only use these hosts. A self-hosted Plane on plain http must be listed here.</p>
      <Button size="sm" disabled={text === null}>Save hosts</Button>
    </form>
  );
}

// One OAuth app per git host; this is what the "Continue with" buttons use.
function OAuthApps() {
  const [data, setData] = useState<{ redirectUri: string; apps: GitOAuthApp[] } | null>(null);
  const [form, setForm] = useState({ provider: "github", baseUrl: "", clientId: "", clientSecret: "" });
  const load = useCallback(() => api.listGitOAuthApps().then(setData).catch((e) => toast.error(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api.createGitOAuthApp({ ...form, baseUrl: form.baseUrl.trim() || undefined }); setForm({ ...form, baseUrl: "", clientId: "", clientSecret: "" }); toast.success("OAuth app saved"); await load(); } catch (err: any) { toast.error(err.message); }
  };
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <h3 className="text-sm font-medium">OAuth apps (all tenants)</h3>
      <p className="text-xs text-muted-foreground">Each git host needs its own OAuth app. Callback URL to use when registering it: <code className="break-all font-mono">{data?.redirectUri ?? "..."}</code></p>
      {data?.apps.map((a) => (
        <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
          <span>{providerName(a.provider)} · {a.baseUrl || (a.provider === "github" ? "github.com" : "gitlab.com")} · <span className="font-mono text-xs">{a.clientId}</span></span>
          <ConfirmAction trigger={<IconButton label="Delete" className="text-destructive hover:text-destructive"><Trash2 /></IconButton>} title="Delete this OAuth app?" description="Accounts connected through it stop refreshing and must be reconnected." confirmLabel="Delete" danger onConfirm={async () => { try { await api.deleteGitOAuthApp(a.id); await load(); } catch (e: any) { toast.error(e.message); } }} />
        </div>
      ))}
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-2">
        <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
          <SelectTrigger aria-label="Provider" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{PROVIDERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
        <Input aria-label="Host URL" type="url" placeholder="Host URL (blank = github.com / gitlab.com)" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
        <Input aria-label="Client ID" required placeholder="Client ID" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} />
        <Input aria-label="Client secret" required type="password" placeholder="Client secret" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} />
        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground sm:col-span-2">
          {form.provider === "github"
            ? <><p className="font-medium text-foreground">Where to get these on GitHub</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                  <li>Open <a className="underline underline-offset-2" href={`${form.baseUrl.trim().replace(/\/+$/, "") || "https://github.com"}/settings/developers`} target="_blank" rel="noreferrer">Settings → Developer settings → OAuth Apps</a> and choose <b>New OAuth App</b>.</li>
                  <li>Any name and homepage. Set <b>Authorization callback URL</b> to the callback URL above.</li>
                  <li><b>Client ID</b> is on the app page. Click <b>Generate a new client secret</b> for the <b>Client secret</b>; GitHub shows it only once.</li>
                </ol></>
            : <><p className="font-medium text-foreground">Where to get these on GitLab</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                  <li>Open <a className="underline underline-offset-2" href={`${form.baseUrl.trim().replace(/\/+$/, "") || "https://gitlab.com"}/-/user_settings/applications`} target="_blank" rel="noreferrer">User Settings → Applications</a> and choose <b>Add new application</b>.</li>
                  <li>Set <b>Redirect URI</b> to the callback URL above, tick the <code>api</code> scope, keep <b>Confidential</b> checked.</li>
                  <li>GitLab then shows the <b>Application ID</b> (enter it as Client ID) and the <b>Secret</b>.</li>
                </ol></>}
          <p className="mt-1">For a self-hosted server, enter its Host URL above first; the link then points to your server.</p>
        </div>
        <Button size="sm" className="sm:col-span-2 sm:w-fit">Add OAuth app</Button>
      </form>
    </div>
  );
}

export function Settings() {
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Git</h2>
        <p className="text-sm text-muted-foreground">Platform-wide: applies to every tenant. Allow a self-hosted host first, then add its OAuth app, then connect accounts from a tenant.</p>
      </div>
      <AllowedHosts />
      <OAuthApps />
    </div>
  );
}
