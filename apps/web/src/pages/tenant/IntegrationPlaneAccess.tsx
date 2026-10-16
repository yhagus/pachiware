import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Guild } from "@/lib/api";
import { GuildPlaneAccess } from "./GuildPlane";
import { useIntegration } from "./IntegrationDetail";

export function IntegrationPlaneAccess() {
  const { bot } = useIntegration();
  const [data, setData] = useState<{ connected: boolean; guilds: Guild[] } | null>(null);
  useEffect(() => { api.getBotGuilds(bot.id).then(setData).catch((e) => toast.error(e.message)); }, [bot.id]);

  if (!data) return <Skeleton className="h-16" />;
  if (!data.connected || !data.guilds.length) return <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">Plane access is set per server once the bot is connected to one.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Choose which Plane accounts and Plane projects the bot may use in each server.</p>
      {data.guilds.map((g) => (
        <Card key={g.id} className="py-0">
          <CardContent className="px-0">
            <details className="group">
              <summary className="flex list-none items-center gap-3 p-4 font-medium [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <div className="border-t p-4"><GuildPlaneAccess botId={bot.id} guild={g} /></div>
            </details>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
