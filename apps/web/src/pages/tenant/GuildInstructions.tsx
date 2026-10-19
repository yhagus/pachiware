import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TimezoneInput } from "@/components/TimezoneInput";
import { IconButton } from "@/components/IconButton";
import { api, LANGUAGES, type DocSource, type Guild, type GuildConfig, type GuildGit, type Language } from "@/lib/api";
import { useLastShown } from "@/hooks/use-last-shown";

const MAX = 8000;
const INHERIT = "tenant";
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DEFAULT_DIGEST_HOUR = 8;
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
const ANY_ACCOUNT = "";
const DEFAULT_DOC_PATHS = "README.md, docs/**";
/** A doc source as edited: its paths as one comma-separated text, so typing a comma does not lose it. */
type DocDraft = { channelId: string; repo: string; account: string; paths: string };
const toDraft = (s: DocSource): DocDraft => ({ channelId: s.channelId, repo: s.repo, account: s.account ?? ANY_ACCOUNT, paths: s.paths.join(", ") });
const toSource = (d: DocDraft): DocSource => ({ channelId: d.channelId, repo: d.repo.trim(), ...(d.account ? { account: d.account } : {}), paths: d.paths.split(",").map((p) => p.trim()).filter(Boolean) });
const selectClass = "h-8 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function GuildInstructions({ botId, guild, onClose }: { botId: string; guild: Guild | null; onClose: () => void }) {
  const shown = useLastShown(guild);
  const [cfg, setCfg] = useState<GuildConfig | null>(null);
  const [savedLogs, setSavedLogs] = useState<string[]>([]);
  const [docs, setDocs] = useState<DocDraft[]>([]);
  const [accounts, setAccounts] = useState<GuildGit["accounts"]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!guild) return;
    setCfg(null); setError(null);
    let live = true;
    api.getGuildConfig(botId, guild.id).then((r) => { if (live) { setCfg(r.config); setSavedLogs(r.config.dailyLogChannels.map((d) => d.channelId)); setDocs(r.config.docSources.map(toDraft)); } }).catch((e) => live && setError(e.message));
    // Only names the accounts to choose from; without them a source reads with any account the channel allows.
    api.getGuildGit(botId, guild.id).then((r) => live && setAccounts(r.accounts)).catch(() => live && setAccounts([]));
    return () => { live = false; };
  }, [botId, guild, attempt]);

  const save = async () => {
    if (!guild || !cfg) return;
    setSaving(true);
    try { await api.saveGuildConfig(botId, guild.id, { ...cfg, docSources: docs.map(toSource) }); toast.success("Server instructions saved"); onClose(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setSaving(false); }
  };
  const toggleChannel = (id: string, on: boolean) => cfg && setCfg({ ...cfg, alwaysChannelIds: on ? [...cfg.alwaysChannelIds, id] : cfg.alwaysChannelIds.filter((c) => c !== id) });
  const digestOf = (id: string) => cfg?.digestChannels.find((d) => d.channelId === id);
  const toggleDigest = (id: string, on: boolean) => cfg && setCfg({ ...cfg, digestChannels: on ? [...cfg.digestChannels, { channelId: id, hour: DEFAULT_DIGEST_HOUR }] : cfg.digestChannels.filter((d) => d.channelId !== id) });
  const setDigestHour = (id: string, hour: number) => cfg && setCfg({ ...cfg, digestChannels: cfg.digestChannels.map((d) => (d.channelId === id ? { ...d, hour } : d)) });
  const logOf = (id: string) => cfg?.dailyLogChannels.find((d) => d.channelId === id);
  const toggleLog = (id: string, on: boolean) => cfg && setCfg({ ...cfg, dailyLogChannels: on ? [...cfg.dailyLogChannels, { channelId: id, backfill: true }] : cfg.dailyLogChannels.filter((d) => d.channelId !== id) });
  const setBackfill = (id: string, backfill: boolean) => cfg && setCfg({ ...cfg, dailyLogChannels: cfg.dailyLogChannels.map((d) => (d.channelId === id ? { ...d, backfill } : d)) });
  const textChannels = shown?.channels.filter((c) => c.type === "text") ?? [];
  const setDoc = (i: number, change: Partial<DocDraft>) => setDocs(docs.map((d, n) => (n === i ? { ...d, ...change } : d)));
  const addDoc = () => setDocs([...docs, { channelId: textChannels[0]?.id ?? "", repo: "", account: ANY_ACCOUNT, paths: DEFAULT_DOC_PATHS }]);

  return (
    <Sheet open={!!guild} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{shown?.name} instructions</SheetTitle>
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
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Daily Digest</legend>
                <p className="text-xs text-muted-foreground">At the chosen hour, posts this channel's tasks due today and the ones already late. A day with nothing to report posts nothing. Hours follow the server's time zone.</p>
                {textChannels.length === 0 ? <p className="text-sm text-muted-foreground">No text channels visible to this bot.</p> : (
                  <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                    {textChannels.map((c) => {
                      const digest = digestOf(c.id);
                      return (
                        <li key={c.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                            <input type="checkbox" className="size-4 cursor-pointer rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={!!digest} onChange={(e) => toggleDigest(c.id, e.target.checked)} />
                            <span className="truncate"># {c.name}</span>
                          </label>
                          {digest && (
                            <select aria-label={`Digest hour for #${c.name}`} value={digest.hour} onChange={(e) => setDigestHour(c.id, Number(e.target.value))}
                              className="h-8 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                              {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                            </select>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Daily logs</legend>
                <p className="text-xs text-muted-foreground">Every night after midnight, writes a record of the day's talk in this channel that people can ask about later. It is never posted. Turning it on posts one notice in the channel. Another bot of this tenant cannot log the same channel. In a channel without Daily logs, talk nobody asked the bot to keep cannot be found after a day; the bot says so when a search there finds nothing.</p>
                {textChannels.length === 0 ? <p className="text-sm text-muted-foreground">No text channels visible to this bot.</p> : (
                  <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
                    {textChannels.map((c) => {
                      const log = logOf(c.id);
                      return (
                        <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded px-1 py-1 text-sm hover:bg-muted">
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                            <input type="checkbox" className="size-4 cursor-pointer rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={!!log} onChange={(e) => toggleLog(c.id, e.target.checked)} />
                            <span className="truncate"># {c.name}</span>
                          </label>
                          {log && !savedLogs.includes(c.id) && (
                            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                              <input type="checkbox" className="size-4 cursor-pointer rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={log.backfill} onChange={(e) => setBackfill(c.id, e.target.checked)} />
                              Also write the last 30 days
                            </label>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Documentation from repositories</legend>
                <p className="text-xs text-muted-foreground">Copies the text files (.md, .mdx, .markdown, .txt, .rst, .adoc) on a repository's default branch that match the paths into the channel's files, so people can ask about them there. Copied right after saving and refreshed every night; a file deleted in the repository is deleted here too. The channel's git access must allow the repository. At most 200 files per repository, each under 256 KB.</p>
                {textChannels.length === 0 ? <p className="text-sm text-muted-foreground">No text channels visible to this bot.</p> : (
                  <>
                    {docs.length > 0 && (
                      <ul className="space-y-2">
                        {docs.map((d, i) => (
                          <li key={i} className="space-y-2 rounded-md border p-2">
                            <div className="flex items-center gap-2">
                              <select aria-label="Channel" value={d.channelId} onChange={(e) => setDoc(i, { channelId: e.target.value })} className={`${selectClass} min-w-0 flex-1`}>
                                {!textChannels.some((c) => c.id === d.channelId) && <option value={d.channelId}>{d.channelId}</option>}
                                {textChannels.map((c) => <option key={c.id} value={c.id}># {c.name}</option>)}
                              </select>
                              <IconButton label="Remove repository" className="text-destructive hover:text-destructive" onClick={() => setDocs(docs.filter((_, n) => n !== i))}><Trash2 /></IconButton>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="space-y-1">
                                <Label htmlFor={`doc-repo-${i}`} className="text-xs">Repository</Label>
                                <Input id={`doc-repo-${i}`} value={d.repo} onChange={(e) => setDoc(i, { repo: e.target.value })} placeholder="owner/name" />
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor={`doc-account-${i}`} className="text-xs">Git account</Label>
                                <select id={`doc-account-${i}`} value={d.account} onChange={(e) => setDoc(i, { account: e.target.value })} className={`${selectClass} h-9 w-full`}>
                                  <option value={ANY_ACCOUNT}>Any account allowed there</option>
                                  {d.account && !accounts.some((a) => a.name === d.account) && <option value={d.account}>{d.account}</option>}
                                  {accounts.map((a) => <option key={a.id} value={a.name}>{a.name} · {a.provider}</option>)}
                                </select>
                              </div>
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor={`doc-paths-${i}`} className="text-xs">Paths</Label>
                              <Input id={`doc-paths-${i}`} value={d.paths} onChange={(e) => setDoc(i, { paths: e.target.value })} placeholder="README.md, docs/**, adr/*.md" />
                              <p className="text-xs text-muted-foreground">Separated by commas. * stays inside one folder, ** reaches every folder below.</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Button variant="outline" size="sm" onClick={addDoc}><Plus /> Add a repository</Button>
                  </>
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
