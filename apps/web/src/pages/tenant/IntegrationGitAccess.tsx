import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Guild } from "@/lib/api";
import { AttachedAccounts, gitOption, type AccountOption } from "./AttachedAccounts";
import { GuildGitAccess } from "./GuildGit";
import { useIntegration } from "./IntegrationDetail";

export function IntegrationGitAccess() {
  const { bot, tenant } = useIntegration();
  const [data, setData] = useState<{ connected: boolean; guilds: Guild[] } | null>(null);
  const [accounts, setAccounts] = useState<AccountOption[] | null>(null);
  useEffect(() => { api.getBotGuilds(bot.id).then(setData).catch((e) => toast.error(e.message)); }, [bot.id]);
  useEffect(() => { api.listGitAccounts(tenant.id).then((r) => setAccounts(r.gitAccounts.map(gitOption))).catch((e) => toast.error(e.message)); }, [tenant.id]);

  return (
    <div className="space-y-5">
      <AttachedAccounts field="gitAccountIds" title="Git accounts" noun="git accounts" page="git-accounts" help="Each one stays off in a server until you switch it on below." options={accounts} />
      {!data ? <Skeleton className="h-16" />
        : !data.connected || !data.guilds.length ? <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">Git access is set per server once the bot is connected to one.</p>
        : <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Choose which git accounts and repositories the bot may use in each server.</p>
            {data.guilds.map((g) => (
              <Card key={g.id} className="py-0">
                <CardContent className="px-0">
                  <details className="group">
                    <summary className="flex list-none items-center gap-3 p-4 font-medium [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0 flex-1 truncate">{g.name}</span>
                      <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                    </summary>
                    {/* Keyed by the attached accounts, so a server's access reloads after they change. */}
                    <div className="border-t p-4"><GuildGitAccess key={bot.gitAccountIds.join()} botId={bot.id} guild={g} /></div>
                  </details>
                </CardContent>
              </Card>
            ))}
          </div>}
    </div>
  );
}
