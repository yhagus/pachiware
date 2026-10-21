import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import { FlaskConical, Pencil, Plus, Trash2 } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ConfirmAction";
import { IconButton } from "@/components/IconButton";
import { ProviderLogo } from "@/components/ProviderLogo";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type ApiFormat, type Profile, type ProfileChecks, type ProfileProvider, type Tenant } from "@/lib/api";
import { useLastShown } from "@/hooks/use-last-shown";
import { ProfileChecklist, ProfilePlayground } from "./ProfilePlayground";
import { MAX_MODELS, ProfileModels } from "./ProfileModels";

// Mirrors PROVIDERS and DEFAULT_MODELS in apps/agent/src/llm/providers.ts. Only BYOK names its own address and API format.
export const PROVIDERS: { id: ProfileProvider; name: string; hint: string }[] = [
  { id: "openai", name: "OpenAI", hint: "gpt-4o" },
  { id: "anthropic", name: "Anthropic", hint: "claude-sonnet-5-5" },
  { id: "deepseek", name: "DeepSeek", hint: "deepseek-flash" },
  { id: "custom", name: "BYOK", hint: "Model name from your provider" },
];
export const providerName = (id: string) => PROVIDERS.find((p) => p.id === id)?.name ?? id;
// Mirrors API_FORMATS in apps/agent/src/llm/providers.ts. Only a BYOK profile picks one.
export const API_FORMATS: { id: ApiFormat; name: string; path: string }[] = [
  { id: "chat_completions", name: "Chat Completions", path: "/chat/completions" },
  { id: "responses", name: "Responses", path: "/responses" },
  { id: "messages", name: "Messages", path: "/messages" },
];
export const profileLabel = (p: Pick<Profile, "provider" | "apiFormat">) =>
  p.provider === "custom" ? `${providerName(p.provider)} · ${API_FORMATS.find((f) => f.id === p.apiFormat)?.name ?? p.apiFormat}` : providerName(p.provider);
const EMPTY = { name: "", provider: "openai" as ProfileProvider, apiFormat: "chat_completions" as ApiFormat, models: [] as string[], baseUrl: "", apiKey: "", acceptsImages: false };

export function TenantProfiles() {
  const tenant = useOutletContext<Tenant>();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [editing, setEditing] = useState<Profile | "new" | null>(null);
  const shown = useLastShown(editing);
  const [form, setForm] = useState(EMPTY);
  // A model typed but not yet added; Save and Test take it as the next one.
  const [draft, setDraft] = useState("");
  const [fetched, setFetched] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [probe, setProbe] = useState<ProfileChecks | null>(null);
  const [trying, setTrying] = useState<Profile | null>(null);
  const [testing, setTesting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(() => api.listProfiles(tenant.id).then((r) => { setProfiles(r.profiles); setLoadError(null); }).catch((e) => setLoadError(e.message)), [tenant.id]);
  useEffect(() => { void load(); }, [load]);

  const open = (p: Profile | "new") => {
    setForm(p === "new" ? EMPTY : { name: p.name, provider: p.provider, apiFormat: p.apiFormat, models: [p.model, ...p.fallbackModels], baseUrl: p.baseUrl ?? "", apiKey: "", acceptsImages: p.acceptsImages });
    setDraft(""); setFetched([]); setProbe(null); setEditing(p);
  };
  // A Test result describes the connection it ran with, so changing that connection clears it.
  const edit = (patch: Partial<typeof EMPTY>) => { setForm((f) => ({ ...f, ...patch })); setProbe(null); };
  const custom = form.provider === "custom";
  const typed = draft.trim();
  const models = typed && !form.models.includes(typed) && form.models.length < MAX_MODELS ? [...form.models, typed] : form.models;
  const connection = () => ({
    provider: form.provider, ...(custom ? { apiFormat: form.apiFormat, baseUrl: form.baseUrl.trim() || undefined } : {}),
    apiKey: form.apiKey || undefined, profileId: editing !== "new" ? editing?.id : undefined,
  });
  const runTest = async () => {
    setTesting(true);
    try { setProbe((await api.testProfile({ ...connection(), model: models[0] })).checks); } catch (e: any) { toast.error(e.message); } finally { setTesting(false); }
  };
  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const r = await api.listProfileModels(connection());
      setFetched(r.models); toast.success(`${r.models.length} models found`);
    } catch (e: any) { toast.error(e.message); } finally { setLoadingModels(false); }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      name: form.name.trim(), provider: form.provider, model: models[0], fallbackModels: models.slice(1), acceptsImages: form.acceptsImages,
      baseUrl: custom ? form.baseUrl.trim() : null, ...(custom ? { apiFormat: form.apiFormat } : {}), ...(form.apiKey ? { apiKey: form.apiKey.trim() } : {}),
    };
    try {
      if (editing === "new") await api.createProfile(tenant.id, body); else await api.updateProfile((editing as Profile).id, body);
      toast.success(editing === "new" ? "Profile created" : "Profile updated"); setEditing(null); await load();
    } catch (err: any) { toast.error(err.message); }
  };
  const remove = async (p: Profile) => {
    try { await api.deleteProfile(p.id); toast.success("Profile deleted"); await load(); } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">A profile is one provider and the models it answers with, in order. Integrations pick the profile they answer with.</p>
        <Button onClick={() => open("new")}><Plus /> New profile</Button>
      </div>
      {loadError && !profiles
        ? <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">Profiles could not be loaded: {loadError}<Button variant="outline" onClick={() => void load()}>Retry</Button></div>
        : !profiles
        ? <div className="grid gap-3.75 sm:grid-cols-2 xl:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
        : profiles.length === 0
          ? <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">No profiles yet. Integrations use the tenant default model until you add one.</p>
          : <div className="grid gap-3.75 sm:grid-cols-2 xl:grid-cols-3">
              {profiles.map((p) => (
                <Card key={p.id} className="py-5"><CardContent className="flex h-full flex-col gap-3">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><ProviderLogo provider={p.provider} /></div>
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{profileLabel(p)}{p.acceptsImages ? " · Vision" : ""}</div></div>
                    {!p.hasApiKey && <Badge variant="outline">No key</Badge>}
                  </div>
                  <code className="truncate font-mono text-xs">{p.model}{p.fallbackModels.length > 0 && <span className="text-muted-foreground"> → {p.fallbackModels.join(" → ")}</span>}</code>
                  <div className="mt-auto flex justify-end border-t pt-3">
                    <IconButton label="Playground" onClick={() => setTrying(p)}><FlaskConical /></IconButton>
                    <IconButton label="Edit" onClick={() => open(p)}><Pencil /></IconButton>
                    <ConfirmAction trigger={<IconButton label="Delete" className="text-destructive hover:text-destructive"><Trash2 /></IconButton>}
                      title={`Delete ${p.name}?`} description="Integrations using this profile go back to the tenant default model." confirmLabel="Delete" danger onConfirm={() => remove(p)} />
                  </div>
                </CardContent></Card>
              ))}
            </div>}

      <ProfilePlayground profile={trying} onClose={() => setTrying(null)} />
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <form onSubmit={save} className="space-y-5">
            <DialogHeader><DialogTitle>{shown === "new" ? "New profile" : "Edit profile"}</DialogTitle><DialogDescription className="sr-only">Model profile settings</DialogDescription></DialogHeader>
            <div className="space-y-2"><Label id="pp">Provider</Label>
              <RadioGroupPrimitive.Root aria-labelledby="pp" value={form.provider} onValueChange={(v) => { edit({ provider: v as ProfileProvider }); setFetched([]); }} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PROVIDERS.map((p) => (
                  <RadioGroupPrimitive.Item key={p.id} value={p.id}
                    className="flex flex-col items-center gap-2 rounded-lg border px-2 py-3 text-sm font-medium outline-none transition-[color,background-color,box-shadow] hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:border-primary data-[state=checked]:bg-accent data-[state=checked]:shadow-[inset_0_0_0_1px_var(--primary)]">
                    <ProviderLogo provider={p.id} className="size-6" />{p.name}
                  </RadioGroupPrimitive.Item>
                ))}
              </RadioGroupPrimitive.Root></div>
            <div className="space-y-2"><Label htmlFor="pn">Name</Label><Input id="pn" required placeholder="e.g. Support bot" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            {custom && <>
              <div className="space-y-2"><Label htmlFor="pb">Base URL</Label><Input id="pb" type="url" required placeholder="https://your-provider.example/v1" value={form.baseUrl} onChange={(e) => edit({ baseUrl: e.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="pf">API format</Label>
                <Select value={form.apiFormat} onValueChange={(v) => edit({ apiFormat: v as ApiFormat })}>
                  <SelectTrigger id="pf" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{API_FORMATS.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} <span className="font-mono text-xs text-muted-foreground">{f.path}</span></SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">The request shape your server expects. Most OpenAI-compatible servers take Chat Completions; Test tells you when the answer looks like another one.</p></div>
            </>}
            <div className="space-y-2"><Label htmlFor="pk">API key</Label><Input id="pk" type="password" placeholder={shown !== "new" && shown?.hasApiKey ? "Leave blank to keep current" : ""} value={form.apiKey} onChange={(e) => edit({ apiKey: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="pm">Models</Label>
              <ProfileModels id="pm" models={form.models} onChange={(m) => edit({ models: m })} draft={draft} onDraftChange={setDraft} options={fetched}
                placeholder={PROVIDERS.find((p) => p.id === form.provider)?.hint} fetching={loadingModels} canFetch={!custom || !!form.baseUrl.trim()} onFetch={fetchModels} /></div>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="size-4 cursor-pointer rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={form.acceptsImages} onChange={(e) => setForm((f) => ({ ...f, acceptsImages: e.target.checked }))} />
              Vision
            </label>
            {probe && <ProfileChecklist checks={probe} />}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={testing || !models.length || (custom && !form.baseUrl.trim())} onClick={runTest}>{testing ? "Testing…" : "Test"}</Button>
              <Button>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
