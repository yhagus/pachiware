import { useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TimezoneInput } from "@/components/TimezoneInput";
import { api, LANGUAGES, type Language, type Tenant, type TenantSettings as Settings } from "@/lib/api";

const MAX_IDLE_HOURS = 720;
const validHours = (h: number) => Number.isInteger(h) && h >= 0 && h <= MAX_IDLE_HOURS;
const MAX_RETRY_WAIT_SECONDS = 600;
const validWait = (s: number) => Number.isInteger(s) && s >= 0 && s <= MAX_RETRY_WAIT_SECONDS;
const MAX_WORKERS = 5;
const validWorkers = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_WORKERS;

export function TenantSettings() {
  const tenant = useOutletContext<Tenant>();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setSettings(null); setError(null);
    let live = true;
    api.getTenantSettings(tenant.id).then((r) => live && setSettings(r.settings)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [tenant.id, attempt]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try { setSettings((await api.saveTenantSettings(tenant.id, settings)).settings); toast.success("Settings saved"); }
    catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Tenant defaults</h2>
        <p className="text-sm text-muted-foreground">The defaults for every server of this tenant. A server can set its own time zone and language under its settings.</p>
      </div>
      {error ? (
        <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 p-4 text-sm">
          <p>Could not load the settings: {error}</p>
          <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
        </div>
      ) : !settings ? (
        <div className="space-y-2" role="status"><p className="text-sm text-muted-foreground">Loading settings</p><Skeleton className="h-24" /></div>
      ) : (
        <form onSubmit={save} className="space-y-4 rounded-lg border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tenant-tz">Time zone</Label>
              <TimezoneInput id="tenant-tz" value={settings.timezone} onChange={(v) => setSettings({ ...settings, timezone: v })} />
              <p className="text-xs text-muted-foreground">An IANA name such as Asia/Jakarta. Dates the bot reads and writes follow it; DMs always use it.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tenant-lang">Language</Label>
              <Select value={settings.language} onValueChange={(v) => setSettings({ ...settings, language: v as Language })}>
                <SelectTrigger id="tenant-lang" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">For posts the bot writes on its own, such as reminders and provider errors. Replies follow the language of each message.</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tenant-idle">Fresh conversation after</Label>
            <div className="flex items-center gap-2">
              <Input id="tenant-idle" type="number" inputMode="numeric" min={0} max={MAX_IDLE_HOURS} step={1} className="w-24" aria-invalid={!validHours(settings.conversationIdleHours)}
                value={Number.isNaN(settings.conversationIdleHours) ? "" : settings.conversationIdleHours} onChange={(e) => setSettings({ ...settings, conversationIdleHours: e.target.valueAsNumber })} />
              <span className="text-sm text-muted-foreground">hours</span>
            </div>
            <p className="text-xs text-muted-foreground">When nobody has talked with the bot in a channel, thread or DM for this long, its next message there starts a fresh conversation without the earlier chat. Memory, tasks and files stay. 0 keeps every conversation going; at most {MAX_IDLE_HOURS}.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tenant-retry">Model retry wait</Label>
            <div className="flex items-center gap-2">
              <Input id="tenant-retry" type="number" inputMode="numeric" min={0} max={MAX_RETRY_WAIT_SECONDS} step={1} className="w-24" aria-invalid={!validWait(settings.modelRetryWaitSeconds)}
                value={Number.isNaN(settings.modelRetryWaitSeconds) ? "" : settings.modelRetryWaitSeconds} onChange={(e) => setSettings({ ...settings, modelRetryWaitSeconds: e.target.valueAsNumber })} />
              <span className="text-sm text-muted-foreground">seconds</span>
            </div>
            <p className="text-xs text-muted-foreground">When an API changelog the bot is working on by itself cannot reach the model, the bot tries once more after this wait. If that fails too, the changelog pauses and its asker is told. 0 pauses at once; at most {MAX_RETRY_WAIT_SECONDS}.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tenant-workers">Changelog workers</Label>
            <div className="flex items-center gap-2">
              <Input id="tenant-workers" type="number" inputMode="numeric" min={1} max={MAX_WORKERS} step={1} className="w-24" aria-invalid={!validWorkers(settings.playbookWorkers)}
                value={Number.isNaN(settings.playbookWorkers) ? "" : settings.playbookWorkers} onChange={(e) => setSettings({ ...settings, playbookWorkers: e.target.valueAsNumber })} />
              <span className="text-sm text-muted-foreground">at once</span>
            </div>
            <p className="text-xs text-muted-foreground">How many workers an API changelog runs at the same time, mapping its changed files or tracing its endpoints, each with its own model calls. More finishes sooner but sends more requests at once to the model provider, whose rate limit the tenant's bots share. From 1 to {MAX_WORKERS}.</p>
          </div>
          <Button size="sm" disabled={saving || !settings.timezone || !validHours(settings.conversationIdleHours) || !validWait(settings.modelRetryWaitSeconds) || !validWorkers(settings.playbookWorkers)}>{saving ? "Saving" : "Save settings"}</Button>
        </form>
      )}
    </div>
  );
}
