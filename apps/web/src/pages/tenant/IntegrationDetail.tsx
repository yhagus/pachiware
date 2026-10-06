import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useOutletContext, useParams } from "react-router";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Bot, type Tenant } from "@/lib/api";
import { platformOf } from "@/lib/platforms";
import { label } from "@/lib/utils";

const statusVariant = (s: string) => (s === "connected" ? "secondary" : s === "error" ? "destructive" : "outline");

export function IntegrationDetail() {
  const tenant = useOutletContext<Tenant>();
  const { botId = "" } = useParams();
  const { pathname } = useLocation();
  const [bot, setBot] = useState<Bot | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api.getBot(botId).then((r) => { if (r.bot.tenantId !== tenant.id) throw new Error("Integration not found"); setBot(r.bot); setError(""); }).catch((e) => setError(e.message)), [botId, tenant.id]);
  useEffect(() => { void load(); const t = setInterval(() => !document.hidden && void load(), 10000); return () => clearInterval(t); }, [load]);

  const back = <Link to={`/tenants/${tenant.id}/integrations`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Integrations</Link>;
  if (error && !bot) return <div className="space-y-5">{back}<p role="alert" className="text-sm text-destructive">{error}</p></div>;
  if (!bot) return <div className="space-y-5">{back}<Skeleton className="h-16" /></div>;

  const p = platformOf(bot.platform);
  return (
    <div className="space-y-5">
      {back}
      <div className="flex items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><p.icon className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{bot.name}</h2>
          <div className="text-xs text-muted-foreground">{p.name}</div>
        </div>
        <Badge variant={statusVariant(bot.connectionStatus)}>{label(bot.connectionStatus)}</Badge>
      </div>
      <div className="flex flex-col gap-5 lg:flex-row lg:gap-7.5">
        <div key={pathname} className="min-w-0 flex-1 animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none"><Outlet context={{ bot, tenant }} /></div>
        <nav aria-label={`${p.name} sections`} className="order-first flex gap-1 overflow-x-auto lg:order-last lg:w-52 lg:shrink-0 lg:flex-col lg:border-l lg:pl-4">
          {p.sections.map(({ path, label: text, icon: Icon }) => (
            <NavLink key={path} to={path} className={({ isActive }) => `flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}>
              <Icon className="size-4" /> {text}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

export type IntegrationContext = { bot: Bot; tenant: Tenant };
export const useIntegration = () => useOutletContext<IntegrationContext>();
