import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Hash, SlidersHorizontal, Megaphone, MessagesSquare, Mic, Volume2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Guild, type GuildChannel } from "@/lib/api";
import { CopyId } from "@/components/CopyId";
import { GuildInstructions } from "./GuildInstructions";
import { ChannelConversations } from "./ChannelConversations";
import { useIntegration } from "./IntegrationDetail";

const ICONS: Record<GuildChannel["type"], LucideIcon> = { text: Hash, voice: Volume2, announcement: Megaphone, stage: Mic, forum: MessagesSquare };

function Channels({ channels, onOpen }: { channels: GuildChannel[]; onOpen: (c: GuildChannel) => void }) {
  if (!channels.length) return <p className="px-4 pb-4 text-sm text-muted-foreground">No channels visible to this bot.</p>;
  const groups = new Map<string, GuildChannel[]>();
  for (const c of channels) groups.set(c.category ?? "", [...(groups.get(c.category ?? "") ?? []), c]);
  return (
    <div className="space-y-3 border-t px-4 py-3">
      {[...groups].map(([category, list]) => (
        <div key={category} className="space-y-1">
          {category && <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{category}</div>}
          <ul>
            {list.map((c) => { const Icon = ICONS[c.type]; return (
              <li key={c.id} className="flex items-center gap-2 py-1 text-sm">
                <button type="button" onClick={() => onOpen(c)} className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted" title="View conversations"><Icon className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{c.name}</span></button>
                <CopyId value={c.id} />
              </li>
            ); })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function IntegrationServers() {
  const { bot } = useIntegration();
  const [channel, setChannel] = useState<GuildChannel | null>(null);
  const [editing, setEditing] = useState<Guild | null>(null);
  const [data, setData] = useState<{ connected: boolean; guilds: Guild[] } | null>(null);
  const load = useCallback(() => api.getBotGuilds(bot.id).then(setData).catch((e) => toast.error(e.message)), [bot.id]);
  useEffect(() => { void load(); const t = setInterval(() => !document.hidden && void load(), 15000); return () => clearInterval(t); }, [load, bot.connectionStatus]);

  if (!data) return <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (!data.connected) return <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">Servers appear once the bot is connected.{!bot.isEnabled && " This integration is disabled."}</p>;
  if (!data.guilds.length) return <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">The bot hasn't been added to any server yet.</p>;
  return (
    <div className="space-y-3">
      {data.guilds.map((g) => (
        <Card key={g.id} className="py-0">
          <CardContent className="px-0">
            <details className="group">
              <summary className="flex list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
                {g.icon ? <img src={g.icon} alt="" className="size-9 rounded-lg" /> : <div className="grid size-9 place-items-center rounded-lg bg-muted text-sm font-medium">{g.name.charAt(0)}</div>}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{g.name}</div>
                  <div className="text-xs text-muted-foreground">{g.memberCount.toLocaleString()} members · {g.channels.length} channels</div>
                </div>
                {!g.allowed && <Badge variant="outline">Ignored</Badge>}
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <div className="flex justify-end border-t px-4 py-2"><Button variant="outline" size="sm" onClick={() => setEditing(g)}><SlidersHorizontal /> Settings</Button></div>
              <Channels channels={g.channels} onOpen={setChannel} />
            </details>
          </CardContent>
        </Card>
      ))}
      <GuildInstructions botId={bot.id} guild={editing} onClose={() => setEditing(null)} />
      <ChannelConversations botId={bot.id} channel={channel} onClose={() => setChannel(null)} />
    </div>
  );
}
