import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import { Brain, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import { api, type Profile, type Tenant } from "@/lib/api";

export const PROVIDERS = [{ id: "openai", name: "OpenAI (ChatGPT)" }, { id: "custom", name: "Custom provider" }] as const;
export const providerName = (id: string) => PROVIDERS.find((p) => p.id === id)?.name ?? id;
const EMPTY = { name: "", provider: "openai", model: "", baseUrl: "", apiKey: "" };

export function TenantProfiles() {
  const tenant = useOutletContext<Tenant>();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const load = useCallback(() => api.listProfiles(tenant.id).then((r) => setProfiles(r.profiles)).catch((e) => toast.error(e.message)), [tenant.id]);
  useEffect(() => { void load(); }, [load]);

  const open = (p: Profile | "new") => {
    setForm(p === "new" ? EMPTY : { name: p.name, provider: p.provider, model: p.model, baseUrl: p.baseUrl ?? "", apiKey: "" });
    setModels([]); setEditing(p);
  };
  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const r = await api.listProfileModels({ provider: form.provider, baseUrl: form.baseUrl.trim() || undefined, apiKey: form.apiKey || undefined, profileId: editing !== "new" ? editing?.id : undefined });
      setModels(r.models); toast.success(`${r.models.length} models found`);
    } catch (e: any) { toast.error(e.message); } finally { setLoadingModels(false); }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name: form.name.trim(), provider: form.provider, model: form.model.trim(), baseUrl: form.baseUrl.trim() || null, ...(form.apiKey ? { apiKey: form.apiKey.trim() } : {}) };
    try {
      if (editing === "new") await api.createProfile(tenant.id, body); else await api.updateProfile((editing as Profile).id, body);
      toast.success(editing === "new" ? "Profile created" : "Profile updated"); setEditing(null); await load();
    } catch (err: any) { toast.error(err.message); }
  };
  const remove = async (p: Profile) => {
    try { await api.deleteProfile(p.id); toast.success("Profile deleted"); await load(); } catch (e: any) { toast.error(e.message); }
  };
  const custom = form.provider === "custom";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">A profile is one model from one provider. Integrations pick the profile they answer with.</p>
        <Button onClick={() => open("new")}><Plus /> New profile</Button>
      </div>
      {!profiles
        ? <div className="grid gap-3.75 sm:grid-cols-2 xl:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
        : profiles.length === 0
          ? <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">No profiles yet. Integrations use the tenant default model until you add one.</p>
          : <div className="grid gap-3.75 sm:grid-cols-2 xl:grid-cols-3">
              {profiles.map((p) => (
                <Card key={p.id} className="py-5"><CardContent className="flex h-full flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><Brain className="size-5" /></div>
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{providerName(p.provider)}</div></div>
                    {!p.hasApiKey && <Badge variant="outline">No key</Badge>}
                  </div>
                  <code className="truncate font-mono text-xs">{p.model}</code>
                  <div className="mt-auto flex justify-end border-t pt-3">
                    <IconButton label="Edit" onClick={() => open(p)}><Pencil /></IconButton>
                    <ConfirmAction trigger={<IconButton label="Delete" className="text-destructive hover:text-destructive"><Trash2 /></IconButton>}
                      title={`Delete ${p.name}?`} description="Integrations using this profile go back to the tenant default model." confirmLabel="Delete" danger onConfirm={() => remove(p)} />
                  </div>
                </CardContent></Card>
              ))}
            </div>}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <form onSubmit={save} className="space-y-5">
            <DialogHeader><DialogTitle>{editing === "new" ? "New profile" : "Edit profile"}</DialogTitle><DialogDescription className="sr-only">Model profile settings</DialogDescription></DialogHeader>
            <div className="space-y-2"><Label htmlFor="pn">Name</Label><Input id="pn" required placeholder="e.g. Support bot" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="pp">Provider</Label>
              <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v })}>
                <SelectTrigger id="pp" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{PROVIDERS.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-2"><Label htmlFor="pb">Base URL{custom ? "" : " (optional)"}</Label><Input id="pb" type="url" required={custom} placeholder={custom ? "https://your-provider.example/v1" : "https://api.openai.com/v1"} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="pk">API key</Label><Input id="pk" type="password" placeholder={editing !== "new" && editing?.hasApiKey ? "Leave blank to keep current" : ""} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="pm">Model</Label>
              <div className="flex gap-2">
                <Input id="pm" required list="profile-models" className="flex-1" placeholder={custom ? "Model name from your provider" : "gpt-4o"} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                <IconButton label="Fetch models" variant="outline" type="button" disabled={loadingModels || (custom && !form.baseUrl.trim())} onClick={fetchModels}><RefreshCw className={loadingModels ? "animate-spin" : ""} /></IconButton>
              </div>
              <datalist id="profile-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
              <p className="text-xs text-muted-foreground">Fetch lists models from the base URL and API key above. You can also type one.</p></div>
            <DialogFooter><Button>Save</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
