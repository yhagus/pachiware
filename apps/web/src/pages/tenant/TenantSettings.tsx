import { useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TimezoneInput } from "@/components/TimezoneInput";
import { api, LANGUAGES, type Language, type Tenant, type TenantSettings as Settings } from "@/lib/api";

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
        <h2 className="text-lg font-semibold">Time zone and language</h2>
        <p className="text-sm text-muted-foreground">The defaults for every server of this tenant. A server can set its own under its settings.</p>
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
          <Button size="sm" disabled={saving || !settings.timezone}>{saving ? "Saving" : "Save settings"}</Button>
        </form>
      )}
    </div>
  );
}
