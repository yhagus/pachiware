import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimezoneInput } from "@/components/TimezoneInput";
import { api, LANGUAGES, type Guild, type GuildConfig, type Language } from "@/lib/api";

const MAX = 8000;
const INHERIT = "tenant";

export function GuildInstructions({ botId, guild, onClose }: { botId: string; guild: Guild | null; onClose: () => void }) {
  const [cfg, setCfg] = useState<GuildConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setCfg(null); setError(null);
    if (!guild) return;
    let live = true;
    api.getGuildConfig(botId, guild.id).then((r) => live && setCfg(r.config)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [botId, guild, attempt]);

  const save = async () => {
    if (!guild || !cfg) return;
    setSaving(true);
    try { await api.saveGuildConfig(botId, guild.id, cfg); toast.success("Server instructions saved"); onClose(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };
  const toggleChannel = (id: string, on: boolean) => cfg && setCfg({ ...cfg, alwaysChannelIds: on ? [...cfg.alwaysChannelIds, id] : cfg.alwaysChannelIds.filter((c) => c !== id) });
  const textChannels = guild?.channels.filter((c) => c.type === "text") ?? [];

  return (
    <Sheet open={!!guild} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{guild?.name} instructions</SheetTitle>
          <SheetDescription>Added to the assistant's system prompt for this server only.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          {error ? (
            <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 p-4 text-sm">
              <p>Could not load the instructions: {error}</p>
              <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
            </div>
          ) : !cfg ? (
            <div className="space-y-2" role="status"><p className="text-sm text-muted-foreground">Loading instructions</p><Skeleton className="h-40" /></div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="guild-prompt">Server instructions</Label>
                <textarea id="guild-prompt" value={cfg.systemPrompt} maxLength={MAX} rows={12} onChange={(e) => setCfg({ ...cfg, systemPrompt: e.target.value })}
                  placeholder="Tone, language, what this community is about, rules the assistant should follow." className="w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <p aria-live="polite" className={`text-xs ${cfg.systemPrompt.length > MAX * 0.95 ? "text-destructive" : "text-muted-foreground"}`}>{cfg.systemPrompt.length}/{MAX}</p>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="guild-threads">Reply in threads</Label>
                  <p className="text-xs text-muted-foreground">A mention opens a thread, and the conversation continues there without mentions.</p>
                </div>
                <Switch id="guild-threads" checked={cfg.useThreads} onCheckedChange={(v) => setCfg({ ...cfg, useThreads: v })} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="guild-tz">Time zone</Label>
                  <TimezoneInput id="guild-tz" value={cfg.timezone ?? ""} placeholder="Tenant default" onChange={(v) => setCfg({ ...cfg, timezone: v || null })} />
                  <p className="text-xs text-muted-foreground">What "today" and "Friday" mean here. Empty keeps the tenant's.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="guild-lang">Language</Label>
                  <Select value={cfg.language ?? INHERIT} onValueChange={(v) => setCfg({ ...cfg, language: v === INHERIT ? null : (v as Language) })}>
                    <SelectTrigger id="guild-lang" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={INHERIT}>Tenant default</SelectItem>
                      {LANGUAGES.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">For posts the bot writes on its own. Replies still follow each message.</p>
                </div>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Always respond in</legend>
                <p className="text-xs text-muted-foreground">Answers every message in these channels, no mention needed.</p>
                {textChannels.length === 0 ? <p className="text-sm text-muted-foreground">No text channels visible to this bot.</p> : (
                  <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                    {textChannels.map((c) => (
                      <li key={c.id}><label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                        <input type="checkbox" className="size-4 cursor-pointer rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={cfg.alwaysChannelIds.includes(c.id)} onChange={(e) => toggleChannel(c.id, e.target.checked)} /># {c.name}
                      </label></li>
                    ))}
                  </ul>
                )}
              </fieldset>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!cfg || !!error || saving}>{saving ? "Saving" : "Save"}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
