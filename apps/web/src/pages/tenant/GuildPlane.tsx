import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ALL_PLANE_PROJECTS, type Guild, type GuildPlane, type PlaneProject, type PlaneRule } from "@/lib/api";
import { planeHost } from "./TenantPlaneAccounts";

type Account = GuildPlane["accounts"][number];
type Choice = { on: boolean; all: boolean; ids: string[] };
type Draft = Record<string, Choice>;
/** Each account's Plane projects as Plane lists them, or the error that stopped the list. */
type Projects = Record<string, PlaneProject[] | { error: string }>;

const isAll = (ids: string[]) => ids.includes(ALL_PLANE_PROJECTS);
// `fallback` is what a switched-on account starts with when it has no rule yet; for channels that is the guild's rule, since a channel can only narrow it.
const toDraft = (accounts: Account[], rules: PlaneRule[], fallback: PlaneRule[] = []): Draft =>
  Object.fromEntries(accounts.map((a) => {
    const r = rules.find((x) => x.planeAccountId === a.id) ?? fallback.find((x) => x.planeAccountId === a.id);
    const ids = r?.projectIds ?? [ALL_PLANE_PROJECTS];
    return [a.id, { on: rules.some((x) => x.planeAccountId === a.id), all: isAll(ids), ids: isAll(ids) ? [] : ids }];
  }));
const toRules = (draft: Draft): PlaneRule[] =>
  Object.entries(draft).filter(([, d]) => d.on && (d.all || d.ids.length)).map(([planeAccountId, d]) => ({ planeAccountId, projectIds: d.all ? [ALL_PLANE_PROJECTS] : d.ids }));

const box = "size-4 shrink-0 cursor-pointer rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** `limit` is the guild rule a channel rule must sit inside: absent for the guild itself. */
function Rules({ accounts, draft, onChange, projects, limit }: { accounts: Account[]; draft: Draft; onChange: (d: Draft) => void; projects: Projects; limit?: PlaneRule[] }) {
  return (
    <ul className="space-y-2">
      {accounts.map((a) => {
        const d = draft[a.id] ?? { on: false, all: !limit, ids: [] };
        const set = (c: Partial<Choice>) => onChange({ ...draft, [a.id]: { ...d, ...c } });
        const guildIds = limit?.find((r) => r.planeAccountId === a.id)?.projectIds;
        const allAllowed = !guildIds || isAll(guildIds);
        const listed = projects[a.id];
        const options = Array.isArray(listed) ? listed.filter((p) => allAllowed || guildIds!.includes(p.id)) : [];
        return (
          <li key={a.id} className="space-y-2 rounded-md border p-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input type="checkbox" className={box} checked={d.on} onChange={(e) => set({ on: e.target.checked, all: e.target.checked ? d.all && allAllowed : d.all })} />
              <span className="min-w-0 break-words">{a.name} <span className="font-normal text-muted-foreground">· {planeHost(a.baseUrl)} · {a.workspaceSlug} · as {a.planeUserName}</span></span>
            </label>
            {d.on && (
              <fieldset className="space-y-1 pl-6">
                <legend className="sr-only">Plane projects of {a.name}</legend>
                {allAllowed && <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className={box} checked={d.all} onChange={(e) => set({ all: e.target.checked })} />All Plane projects, including ones created later
                </label>}
                {!d.all && (listed === undefined
                  ? <p role="status" className="text-xs text-muted-foreground">Loading Plane projects</p>
                  : "error" in listed
                  ? <p role="alert" className="text-xs text-destructive">Could not list Plane projects: {listed.error}</p>
                  : options.length === 0
                  ? <p className="text-xs text-muted-foreground">This account's Plane user sees no Plane projects{limit ? " that the server allows" : ""}.</p>
                  : <ul className="max-h-48 overflow-y-auto rounded-md border p-1">
                      {options.map((p) => (
                        <li key={p.id}><label className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-muted sm:min-h-9">
                          <input type="checkbox" className={box} checked={d.ids.includes(p.id)} onChange={(e) => set({ ids: e.target.checked ? [...d.ids, p.id] : d.ids.filter((x) => x !== p.id) })} />
                          <span className="font-mono text-xs text-muted-foreground">{p.identifier}</span><span className="min-w-0 break-words">{p.name}</span>
                        </label></li>
                      ))}
                    </ul>)}
                {d.on && !d.all && !d.ids.length && <p className="text-xs text-muted-foreground">Pick at least one Plane project, or this account stays off.</p>}
              </fieldset>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function GuildPlaneAccess({ botId, guild }: { botId: string; guild: Guild }) {
  const [data, setData] = useState<GuildPlane | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Projects>({});
  const [guildDraft, setGuildDraft] = useState<Draft>({});
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [channel, setChannel] = useState<Draft>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.getGuildPlane(botId, guild.id).then((r) => { setData(r); setGuildDraft(toDraft(r.accounts, r.guild)); setError(null); }).catch((e) => setError(e.message)), [botId, guild.id]);
  useEffect(() => { setData(null); setChannelIds([]); void load(); }, [load]);
  const accountIds = data?.accounts.map((a) => a.id).join() ?? "";
  useEffect(() => {
    for (const id of accountIds ? accountIds.split(",") : []) {
      api.listPlaneProjects(id).then((r) => setProjects((p) => ({ ...p, [id]: r.projects }))).catch((e) => setProjects((p) => ({ ...p, [id]: { error: e.message } })));
    }
  }, [accountIds]);

  const onGuild = data?.accounts.filter((a) => data.guild.some((r) => r.planeAccountId === a.id)) ?? [];
  // One channel selected: edit its own rule. Several: start from the guild's rule and apply what you set to all of them.
  useEffect(() => { if (data && channelIds.length <= 1) setChannel(toDraft(onGuild, data.channels[channelIds[0] ?? ""] ?? [], data.guild)); }, [data, channelIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (rules: PlaneRule[], chans: string[], done: string) => {
    setBusy(true);
    const failed: string[] = [];
    for (const id of chans) {
      try { await api.saveGuildPlane(botId, guild.id, rules, id); }
      catch (e) { failed.push(`${id ? `#${guild.channels.find((c) => c.id === id)?.name ?? id}` : "server"}: ${(e as Error).message}`); }
    }
    if (failed.length) toast.error(`Not saved for ${failed.length} of ${chans.length}. ${failed[0]}`); else toast.success(done);
    await load();
    setBusy(false);
  };
  const toggleChannel = (id: string, on: boolean) => setChannelIds(on ? [...channelIds, id] : channelIds.filter((c) => c !== id));
  const textChannels = guild.channels.filter((c) => c.type === "text");

  if (error) return <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 p-4 text-sm"><p>Could not load Plane access: {error}</p><Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button></div>;
  if (!data) return <div role="status"><p className="sr-only">Loading Plane access</p><Skeleton className="h-24" /></div>;
  if (!data.accounts.length) return <p className="text-sm text-muted-foreground">No Plane accounts are attached to this integration. Attach some in the integration's settings first.</p>;
  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-labelledby="plane-guild">
        <h3 id="plane-guild" className="text-sm font-medium">This server</h3>
        <p className="text-xs text-muted-foreground">Plane is off here until you switch an account on and pick its Plane projects.</p>
        <Rules accounts={data.accounts} draft={guildDraft} onChange={setGuildDraft} projects={projects} />
        <Button size="sm" disabled={busy} onClick={() => save(toRules(guildDraft), [""], "Plane access saved")}>{busy ? "Saving" : "Save server access"}</Button>
      </section>
      <section className="space-y-2" aria-labelledby="plane-channel">
        <h3 id="plane-channel" className="text-sm font-medium">Narrow specific channels</h3>
        <p className="text-xs text-muted-foreground">Tick the channels to narrow, pick what they may use, then save. A channel can only use less than the server allows. Threads follow their channel. A channel with no rule follows the server.</p>
        {onGuild.length === 0 ? <p className="text-sm text-muted-foreground">Switch an account on for the server first.</p> : (
          <>
            <ul className="max-h-56 overflow-y-auto rounded-md border p-1">
              {textChannels.map((c) => (
                <li key={c.id}><label className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-muted sm:min-h-9">
                  <input type="checkbox" className={box} checked={channelIds.includes(c.id)} onChange={(e) => toggleChannel(c.id, e.target.checked)} />
                  <span className="min-w-0 flex-1 break-words"># {c.name}</span>
                  {data.channels[c.id] && <span className="shrink-0 text-xs text-muted-foreground">own rule</span>}
                </label></li>
              ))}
            </ul>
            {channelIds.length > 0 && (
              <>
                <p aria-live="polite" className="text-xs text-muted-foreground">{channelIds.length === 1 ? "Editing this channel's rule." : `Applies to ${channelIds.length} channels and replaces their current rules.`}</p>
                <Rules accounts={onGuild} draft={channel} onChange={setChannel} projects={projects} limit={data.guild} />
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
