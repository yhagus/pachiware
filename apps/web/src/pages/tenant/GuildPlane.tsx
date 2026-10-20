import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ALL_PLANE_PROJECTS, type Guild, type GuildPlane, type PlaneProject, type PlaneRule } from "@/lib/api";
import { planeHost } from "@/lib/plane";

type Account = GuildPlane["accounts"][number];
/** One switched-on Plane workspace of an attached account: what a row switches on and scopes. */
type Target = { key: string; account: Account; slug: string };
type Choice = { on: boolean; all: boolean; ids: string[] };
type Draft = Record<string, Choice>;
/** Each workspace's Plane projects as Plane lists them, or the error that stopped the list. */
type Projects = Record<string, PlaneProject[] | { error: string }>;

const keyOf = (r: { planeAccountId: string; workspaceSlug: string }) => `${r.planeAccountId}/${r.workspaceSlug}`;
const targetsOf = (accounts: Account[]): Target[] =>
  accounts.flatMap((account) => account.workspaces.filter((w) => w.enabled).map((w) => ({ key: keyOf({ planeAccountId: account.id, workspaceSlug: w.slug }), account, slug: w.slug })));
/** Rules for workspaces switched off in Plane accounts: not shown here, and sent back unchanged so a save keeps them. */
const hiddenRules = (accounts: Account[], targets: Target[], rules: PlaneRule[]) =>
  rules.filter((r) => !targets.some((t) => t.key === keyOf(r)) && accounts.some((a) => a.id === r.planeAccountId && a.workspaces.some((w) => w.slug === r.workspaceSlug)));

const isAll = (ids: string[]) => ids.includes(ALL_PLANE_PROJECTS);
// `fallback` is what a switched-on workspace starts with when it has no rule yet; for channels that is the guild's rule, since a channel can only narrow it.
const toDraft = (targets: Target[], rules: PlaneRule[], fallback: PlaneRule[] = []): Draft =>
  Object.fromEntries(targets.map((t) => {
    const r = rules.find((x) => keyOf(x) === t.key) ?? fallback.find((x) => keyOf(x) === t.key);
    const ids = r?.projectIds ?? [ALL_PLANE_PROJECTS];
    return [t.key, { on: rules.some((x) => keyOf(x) === t.key), all: isAll(ids), ids: isAll(ids) ? [] : ids }];
  }));
const toRules = (targets: Target[], draft: Draft): PlaneRule[] =>
  targets.flatMap((t) => {
    const d = draft[t.key];
    return d?.on && (d.all || d.ids.length) ? [{ planeAccountId: t.account.id, workspaceSlug: t.slug, projectIds: d.all ? [ALL_PLANE_PROJECTS] : d.ids }] : [];
  });

const box = "size-4 shrink-0 cursor-pointer rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** `limit` is the guild rule a channel rule must sit inside: absent for the guild itself. */
function Rules({ targets, draft, onChange, projects, limit }: { targets: Target[]; draft: Draft; onChange: (d: Draft) => void; projects: Projects; limit?: PlaneRule[] }) {
  return (
    <ul className="space-y-2">
      {targets.map(({ key, account: a, slug }) => {
        const d = draft[key] ?? { on: false, all: !limit, ids: [] };
        const set = (c: Partial<Choice>) => onChange({ ...draft, [key]: { ...d, ...c } });
        const guildIds = limit?.find((r) => keyOf(r) === key)?.projectIds;
        const allAllowed = !guildIds || isAll(guildIds);
        const listed = projects[key];
        const options = Array.isArray(listed) ? listed.filter((p) => allAllowed || guildIds!.includes(p.id)) : [];
        return (
          <li key={key} className="space-y-2 rounded-md border p-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input type="checkbox" className={box} checked={d.on} onChange={(e) => set({ on: e.target.checked, all: e.target.checked ? d.all && allAllowed : d.all })} />
              <span className="min-w-0 break-words">{a.name} <span className="font-normal text-muted-foreground">· {planeHost(a.baseUrl)} · {slug} · as {a.planeUserName}</span></span>
            </label>
            {d.on && (
              <fieldset className="space-y-1 pl-6">
                <legend className="sr-only">Plane projects of {a.name}, Plane workspace {slug}</legend>
                {allAllowed && <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" className={box} checked={d.all} onChange={(e) => set({ all: e.target.checked })} />All Plane projects, including ones created later
                </label>}
                {!d.all && (listed === undefined
                  ? <p role="status" className="text-xs text-muted-foreground">Loading Plane projects</p>
                  : "error" in listed
                  ? <p role="alert" className="text-xs text-destructive">Could not list Plane projects: {listed.error}</p>
                  : options.length === 0
                  ? <p className="text-xs text-muted-foreground">This account's Plane user sees no Plane projects in {slug}{limit ? " that the server allows" : ""}.</p>
                  : <ul className="max-h-48 overflow-y-auto rounded-md border p-1">
                      {options.map((p) => (
                        <li key={p.id}><label className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-muted sm:min-h-9">
                          <input type="checkbox" className={box} checked={d.ids.includes(p.id)} onChange={(e) => set({ ids: e.target.checked ? [...d.ids, p.id] : d.ids.filter((x) => x !== p.id) })} />
                          <span className="font-mono text-xs text-muted-foreground">{p.identifier}</span><span className="min-w-0 break-words">{p.name}</span>
                        </label></li>
                      ))}
                    </ul>)}
                {d.on && !d.all && !d.ids.length && <p className="text-xs text-muted-foreground">Pick at least one Plane project, or this Plane workspace stays off.</p>}
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

  const load = useCallback(() => api.getGuildPlane(botId, guild.id).then((r) => { setData(r); setGuildDraft(toDraft(targetsOf(r.accounts), r.guild)); setError(null); }).catch((e) => setError(e.message)), [botId, guild.id]);
  useEffect(() => { setData(null); setChannelIds([]); void load(); }, [load]);
  const targets = data ? targetsOf(data.accounts) : [];
  const targetKeys = targets.map((t) => t.key).join();
  useEffect(() => {
    for (const key of targetKeys ? targetKeys.split(",") : []) {
      const [id, slug] = key.split("/") as [string, string];
      api.listPlaneProjects(id, slug).then((r) => setProjects((p) => ({ ...p, [key]: r.projects }))).catch((e) => setProjects((p) => ({ ...p, [key]: { error: e.message } })));
    }
  }, [targetKeys]);

  const onGuild = targets.filter((t) => data?.guild.some((r) => keyOf(r) === t.key));
  // One channel selected: edit its own rule. Several: start from the guild's rule and apply what you set to all of them.
  useEffect(() => { if (data && channelIds.length <= 1) setChannel(toDraft(onGuild, data.channels[channelIds[0] ?? ""] ?? [], data.guild)); }, [data, channelIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each scope keeps its rules for switched-off workspaces, unless it is going back to the server's rule.
  const save = async (rules: PlaneRule[], chans: string[], done: string, keepHidden = true) => {
    setBusy(true);
    const failed: string[] = [];
    for (const id of chans) {
      const kept = keepHidden && data ? hiddenRules(data.accounts, targets, id ? data.channels[id] ?? [] : data.guild) : [];
      try { await api.saveGuildPlane(botId, guild.id, [...rules, ...kept], id); }
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
  if (!data.accounts.length) return <p className="text-sm text-muted-foreground">No Plane accounts are attached to this integration. Attach one above first.</p>;
  if (!targets.length) return <p className="text-sm text-muted-foreground">Every Plane workspace of the attached Plane accounts is switched off. Switch one on in the tenant's Plane accounts first.</p>;
  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-labelledby="plane-guild">
        <h3 id="plane-guild" className="text-sm font-medium">This server</h3>
        <p className="text-xs text-muted-foreground">Plane is off here until you switch a Plane workspace on and pick its Plane projects.</p>
        <Rules targets={targets} draft={guildDraft} onChange={setGuildDraft} projects={projects} />
        <Button size="sm" disabled={busy} onClick={() => save(toRules(targets, guildDraft), [""], "Plane access saved")}>{busy ? "Saving" : "Save server access"}</Button>
      </section>
      <section className="space-y-2" aria-labelledby="plane-channel">
        <h3 id="plane-channel" className="text-sm font-medium">Narrow specific channels</h3>
        <p className="text-xs text-muted-foreground">Tick the channels to narrow, pick what they may use, then save. A channel can only use less than the server allows. Threads follow their channel. A channel with no rule follows the server.</p>
        {onGuild.length === 0 ? <p className="text-sm text-muted-foreground">Switch a Plane workspace on for the server first.</p> : (
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
                <Rules targets={onGuild} draft={channel} onChange={setChannel} projects={projects} limit={data.guild} />
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy || !toRules(onGuild, channel).length} onClick={() => save(toRules(onGuild, channel), channelIds, "Channel access saved")}>{busy ? "Saving" : `Save for ${channelIds.length} ${channelIds.length === 1 ? "channel" : "channels"}`}</Button>
                  {channelIds.some((id) => data.channels[id]) && <Button variant="ghost" disabled={busy} onClick={() => save([], channelIds.filter((id) => data.channels[id]), "Channels follow the server", false)}>Use server rule</Button>}
                </div>
                {channelIds.some((id) => hiddenRules(data.accounts, targets, data.channels[id] ?? []).length > 0) && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">{channelIds.length === 1 ? "This channel also has" : "Some of these channels also have"} rules for Plane workspaces switched off in Plane accounts. Saving here keeps them; Use server rule removes them too.</p>
                )}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
