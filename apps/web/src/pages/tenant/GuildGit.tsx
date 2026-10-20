import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Guild, type GuildGit, type GitRule } from "@/lib/api";

type Account = GuildGit["accounts"][number];
type Draft = Record<string, { on: boolean; patterns: string }>;

// `fallback` is what a switched-on account starts with when it has no rule yet; for channels that is the server's patterns, since a channel can only narrow them.
const toDraft = (accounts: Account[], rules: GitRule[], fallback: GitRule[] = []): Draft =>
  Object.fromEntries(accounts.map((a) => {
    const r = rules.find((x) => x.gitAccountId === a.id), base = fallback.find((x) => x.gitAccountId === a.id);
    return [a.id, { on: !!r, patterns: (r ?? base)?.repoPatterns.join(", ") ?? "*" }];
  }));
const toRules = (draft: Draft): GitRule[] =>
  Object.entries(draft).filter(([, d]) => d.on).map(([gitAccountId, d]) => ({ gitAccountId, repoPatterns: d.patterns.split(",").map((p) => p.trim()).filter(Boolean) }));

function Rules({ accounts, draft, onChange, idPrefix }: { accounts: Account[]; draft: Draft; onChange: (d: Draft) => void; idPrefix: string }) {
  return (
    <ul className="space-y-2">
      {accounts.map((a) => { const d = draft[a.id] ?? { on: false, patterns: "*" }; return (
        <li key={a.id} className="space-y-1 rounded-md border p-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="size-4 cursor-pointer rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={d.on} onChange={(e) => onChange({ ...draft, [a.id]: { ...d, on: e.target.checked } })} />
            {a.name} <span className="font-normal text-muted-foreground">· {a.provider} · {a.username}</span>
          </label>
          {d.on && (
            <div className="space-y-1 pl-6">
              <Label htmlFor={`${idPrefix}-${a.id}`} className="text-xs">Repositories</Label>
              <Input id={`${idPrefix}-${a.id}`} value={d.patterns} onChange={(e) => onChange({ ...draft, [a.id]: { ...d, patterns: e.target.value } })} placeholder="* or org/*, org/api" />
            </div>
          )}
        </li>
      ); })}
    </ul>
  );
}

export function GuildGitAccess({ botId, guild }: { botId: string; guild: Guild }) {
  const [data, setData] = useState<GuildGit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<Draft>({});
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [channel, setChannel] = useState<Draft>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.getGuildGit(botId, guild.id).then((r) => { setData(r); setServer(toDraft(r.accounts, r.server)); setError(null); }).catch((e) => setError(e.message)), [botId, guild.id]);
  useEffect(() => { setData(null); setChannelIds([]); void load(); }, [load]);

  const onServer = data?.accounts.filter((a) => data.server.some((r) => r.gitAccountId === a.id)) ?? [];
  // One channel selected: edit its own rule. Several: start from the server's accounts and apply what you set to all of them.
  useEffect(() => { if (data && channelIds.length <= 1) setChannel(toDraft(onServer, data.channels[channelIds[0] ?? ""] ?? [], data.server)); }, [data, channelIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (rules: GitRule[], chans: string[], done: string) => {
    setBusy(true);
    const failed: string[] = [];
    for (const id of chans) {
      try { await api.saveGuildGit(botId, guild.id, rules, id); }
      catch (e) { failed.push(`#${guild.channels.find((c) => c.id === id)?.name ?? id}: ${(e as Error).message}`); }
    }
    if (failed.length) toast.error(`Not saved for ${failed.length} of ${chans.length} channels. ${failed[0]}`); else toast.success(done);
    await load();
    setBusy(false);
  };
  const toggleChannel = (id: string, on: boolean) => setChannelIds(on ? [...channelIds, id] : channelIds.filter((c) => c !== id));
  const textChannels = guild.channels.filter((c) => c.type === "text");

  if (error) return <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 p-4 text-sm"><p>Could not load git access: {error}</p><Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button></div>;
  if (!data) return <div role="status"><p className="sr-only">Loading git access</p><Skeleton className="h-24" /></div>;
  if (!data.accounts.length) return <p className="text-sm text-muted-foreground">No git accounts are attached to this integration. Attach one above first.</p>;
  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-labelledby="git-server">
        <h3 id="git-server" className="text-sm font-medium">This server</h3>
        <p className="text-xs text-muted-foreground">Git is off here until you switch an account on. List repositories with <code>*</code> wildcards, separated by commas.</p>
        <Rules accounts={data.accounts} draft={server} onChange={setServer} idPrefix="srv" />
        <Button size="sm" disabled={busy} onClick={() => save(toRules(server), [""], "Git access saved")}>{busy ? "Saving" : "Save server access"}</Button>
      </section>
      <section className="space-y-2" aria-labelledby="git-channel">
        <h3 id="git-channel" className="text-sm font-medium">Narrow specific channels</h3>
        <p className="text-xs text-muted-foreground">Tick the channels to narrow, set what they may use, then save. A channel can only use less than the server allows. Threads follow their channel. A channel with no rule follows the server.</p>
        {onServer.length === 0 ? <p className="text-sm text-muted-foreground">Switch an account on for the server first.</p> : (
          <>
            <ul className="max-h-56 overflow-y-auto rounded-md border p-1">
              {textChannels.map((c) => (
                <li key={c.id}><label className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-muted sm:min-h-9">
                  <input type="checkbox" className="size-4 shrink-0 cursor-pointer rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={channelIds.includes(c.id)} onChange={(e) => toggleChannel(c.id, e.target.checked)} />
                  <span className="min-w-0 flex-1 break-words"># {c.name}</span>
                  {data.channels[c.id] && <span className="shrink-0 text-xs text-muted-foreground">own rule</span>}
                </label></li>
              ))}
            </ul>
            {channelIds.length > 0 && (
              <>
                <p aria-live="polite" className="text-xs text-muted-foreground">{channelIds.length === 1 ? "Editing this channel's rule." : `Applies to ${channelIds.length} channels and replaces their current rules.`}</p>
                <Rules accounts={onServer} draft={channel} onChange={setChannel} idPrefix="chan" />
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy || !toRules(channel).length} onClick={() => save(toRules(channel), channelIds, "Channel access saved")}>{busy ? "Saving" : `Save for ${channelIds.length} ${channelIds.length === 1 ? "channel" : "channels"}`}</Button>
                  {channelIds.some((id) => data.channels[id]) && <Button variant="ghost" disabled={busy} onClick={() => save([], channelIds.filter((id) => data.channels[id]), "Channels follow the server")}>Use server rule</Button>}
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
