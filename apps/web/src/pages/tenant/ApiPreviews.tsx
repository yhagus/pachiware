import { useCallback, useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmAction } from "@/components/ConfirmAction";
import { api, type ApiPreview, type Bot, type Guild, type Tenant } from "@/lib/api";
import { useIntegration } from "@/pages/tenant/IntegrationDetail";

/** A tenant's API previews, or one bot's: each page's address, where and by whom it was published, and a way to revoke it. */
function PreviewList({ tenant, bot }: { tenant: Tenant; bot?: Bot }) {
  const [list, setList] = useState<ApiPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [shownBot, setShownBot] = useState("all");
  const [guilds, setGuilds] = useState<Record<string, Guild[]>>({});
  const asked = useRef(new Set<string>());

  const load = useCallback(() => api.listApiPreviews(tenant.id, bot?.id).then((r) => { setList(r.previews); setError(null); }).catch((e: Error) => setError(e.message)), [tenant.id, bot?.id]);
  useEffect(() => { void load(); }, [load]);
  // Server and channel names come from each bot's live gateway; a bot that is not connected shows the ids.
  useEffect(() => {
    for (const id of new Set((list ?? []).map((p) => p.botId))) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      api.getBotGuilds(id).then((r) => setGuilds((g) => ({ ...g, [id]: r.guilds })), () => {});
    }
  }, [list]);

  const where = (p: ApiPreview) => {
    if (!p.guildId) return "Direct message";
    const guild = guilds[p.botId]?.find((g) => g.id === p.guildId), channel = guild?.channels.find((c) => c.id === p.channelId);
    return `${guild?.name ?? p.guildId} · ${channel ? `#${channel.name}` : p.channelId}`;
  };
  const copy = (p: ApiPreview) => navigator.clipboard.writeText(p.url).then(() => toast.success("Link copied"), () => toast.error("Copy failed"));
  const revoke = async (p: ApiPreview) => {
    setBusy(p.id);
    try { await api.revokeApiPreview(tenant.id, p.id); setList((l) => l?.filter((x) => x.id !== p.id) ?? l); toast.success("API preview revoked"); }
    catch (e) { toast.error(`Could not revoke the API preview: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };

  const bots = [...new Map((list ?? []).map((p) => [p.botId, p.botName ?? p.botId])).entries()];
  const shown = (list ?? []).filter((p) => bot || shownBot === "all" || p.botId === shownBot);
  const who = bot?.name ?? "a bot";

  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <div className="flex flex-wrap items-start gap-3 p-4 pb-2">
          <div className="min-w-0 flex-1">
            <h3 className="font-medium">API previews</h3>
            <p className="text-xs text-muted-foreground">Public pages of OpenAPI documents {who} published from chat, such as API changelogs. Anyone with a link can open it without signing in; each shows its document as it was when published. Revoking a link stops it at once.</p>
          </div>
          {!bot && bots.length > 1 && (
            <Select value={shownBot} onValueChange={setShownBot}>
              <SelectTrigger className="w-48" aria-label="Filter by bot"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All bots</SelectItem>
                {bots.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        {error ? (
          <div role="alert" className="space-y-3 border-t p-4 text-sm">
            <p>Could not load the API previews: {error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button>
          </div>
        ) : !list ? (
          <div role="status" className="space-y-3 border-t p-4"><p className="sr-only">Loading API previews</p>{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : shown.length === 0 ? (
          <p className="border-t px-4 py-10 text-center text-sm text-muted-foreground">No API previews. One appears here when someone asks {who} in chat to show or share an OpenAPI document, such as an API changelog.</p>
        ) : (
          <ul className="divide-y border-t px-4">
            {shown.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={p.url} target="_blank" rel="noreferrer" className="min-w-0 break-words text-sm font-medium underline-offset-4 hover:underline">{p.title}</a>
                    {p.version && <Badge variant="outline" className="font-mono">{p.version}</Badge>}
                  </div>
                  <dl className="grid gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-[auto_1fr]">
                    {!bot && <><dt>Bot</dt><dd className="text-foreground">{p.botName ?? p.botId}</dd></>}
                    <dt>Where</dt><dd className="break-all">{where(p)}</dd>
                    <dt>Published by</dt><dd>{p.createdByName ?? p.createdById ?? "Unknown"}</dd>
                    <dt>When</dt><dd>{new Date(p.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</dd>
                    <dt>From</dt><dd className="break-all font-mono">{p.sourcePath}</dd>
                    <dt>Link</dt><dd className="break-all font-mono">{p.url}</dd>
                  </dl>
                </div>
                <div className="flex shrink-0 gap-1 self-start">
                  <Button variant="ghost" size="sm" className="h-11 sm:h-8" onClick={() => void copy(p)} aria-label={`Copy the link to "${p.title}"`}>Copy link</Button>
                  <Button asChild variant="ghost" size="sm" className="h-11 sm:h-8"><a href={p.url} target="_blank" rel="noreferrer" aria-label={`Open "${p.title}"`}>Open</a></Button>
                  <ConfirmAction
                    trigger={<Button variant="ghost" size="sm" className="h-11 sm:h-8" disabled={busy === p.id} aria-label={`Revoke the link to "${p.title}"`}>Revoke</Button>}
                    title="Revoke this API preview?" description={`The link to "${p.title}" stops working at once, for everyone who has it. The file in the Workspace stays, and ${p.botName ?? "the bot"} can publish it again as a new link.`}
                    confirmLabel="Revoke the link" danger onConfirm={() => void revoke(p)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Every bot's API previews of the tenant, under the tenant's sections. */
export function TenantApiPreviews() {
  return <PreviewList tenant={useOutletContext<Tenant>()} />;
}

/** One bot's API previews, under the bot's sections. */
export function IntegrationApiPreviews() {
  const { bot, tenant } = useIntegration();
  return <PreviewList tenant={tenant} bot={bot} />;
}
