import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownUp, Cpu, Database, Eye, EyeOff, HardDrive, MemoryStick, Plug, Users, Zap, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type HealthResponse, type InfrastructureData, type Stats } from "@/lib/api";

const ok = (s?: string) => !!s && s.startsWith("healthy");
const gb = (n: number) => `${(n / 1073741824).toFixed(1)} GB`;
const size = (n?: number | null) => n == null ? undefined : n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(n < 10485760 ? 2 : 1)} MB`;
const rate = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB/s` : `${Math.round(n / 1024)} KB/s`);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3"><h2 className="text-sm font-medium text-muted-foreground">{title}</h2>{children}</section>;
}

function Service({ icon: Icon, name, engine, healthy, url, raw, size }: { icon: LucideIcon; name: string; engine: string; healthy: boolean; size?: string; url?: string; raw?: string }) {
  const [show, setShow] = useState(false);
  return (
    <Card><CardContent className="space-y-2">
      <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" /> {name}</span>
        <Badge variant={healthy ? "secondary" : "destructive"}>{healthy ? "Connected" : "Down"}</Badge></div>
      <div className="text-lg font-semibold">{engine}</div>
      {size && <div className="text-xs text-muted-foreground">Size: {size}</div>}
      {url && (
        <div className="flex items-center gap-1">
          <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{show ? raw ?? url : url}</code>
          <Button size="icon" variant="ghost" className="size-7" onClick={() => setShow(!show)} aria-label={show ? "Hide URL" : "Show URL"}>{show ? <EyeOff /> : <Eye />}</Button>
        </div>
      )}
    </CardContent></Card>
  );
}

function Metric({ icon: Icon, label, value, detail, percent }: { icon: LucideIcon; label: string; value: string; detail?: string; percent?: number }) {
  return (
    <Card><CardContent className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="size-4" /> {label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {percent !== undefined && <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} /></div>}
      {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
    </CardContent></Card>
  );
}

export function Overview() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [infra, setInfra] = useState<InfrastructureData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [stale, setStale] = useState(false);
  const busy = useRef(false);
  const load = useCallback(async (first = false) => {
    if (busy.current || document.hidden) return;
    busy.current = true;
    try {
      const [h, s, i] = await Promise.all([api.getHealth(), api.getStats(), first ? api.getInfrastructure() : null]);
      setHealth(h); setStats(s); if (i) setInfra(i.infrastructure); setStale(false);
    } catch { setStale(true); } finally { busy.current = false; }
  }, []);
  useEffect(() => {
    void load(true);
    const t = setInterval(load, 3000);
    const onVisible = () => !document.hidden && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  if (!health || !infra || !stats) return stale
    ? <p role="alert" className="text-sm text-destructive">Can't reach the server.</p>
    : <div className="grid gap-5 sm:grid-cols-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>;

  const { system: sys } = stats;
  const inMemory = health.services.redis.includes("in-memory");
  const io = sys.diskIo;
  return (
    <div className="space-y-7.5">
      {stale && <p role="status" className="text-sm text-amber-500">Connection lost. Retrying…</p>}
      <Section title="Storage">
        <div className="grid gap-5 sm:grid-cols-2">
          <Service icon={Database} name="Database" healthy={ok(health.services.database)} engine={infra.databaseDialect === "sqlite" ? "SQLite" : "PostgreSQL"} url={infra.databaseDialect === "sqlite" ? undefined : infra.databaseUrl} raw={infra.rawDatabaseUrl} size={size(stats.storage.dbBytes)} />
          {inMemory
            ? <Service icon={Zap} name="Cache" healthy engine="In-memory" size={size(stats.storage.cacheBytes)} />
            : <Service icon={Zap} name="Cache" healthy={ok(health.services.redis)} engine="Redis" url={infra.redisUrl} raw={infra.rawRedisUrl} size={size(stats.storage.cacheBytes)} />}
        </div>
      </Section>
      <Separator />
      <Section title="Usage">
        <div className="grid gap-5 sm:grid-cols-2">
          <Metric icon={Users} label="Tenants" value={String(stats.tenants)} />
          <Metric icon={Plug} label="Integrations" value={String(stats.bots)} />
        </div>
      </Section>
      <Separator />
      <Section title="System">
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <Metric icon={Cpu} label="CPU" value={`${sys.cpu.percent}%`} detail={`${sys.cpu.cores} cores`} percent={sys.cpu.percent} />
          <Metric icon={MemoryStick} label="RAM" value={`${Math.round((sys.memory.used / sys.memory.total) * 100)}%`} detail={`${gb(sys.memory.used)} / ${gb(sys.memory.total)}`} percent={(sys.memory.used / sys.memory.total) * 100} />
          <Metric icon={HardDrive} label="Disk" value={`${Math.round((sys.disk.used / sys.disk.total) * 100)}%`} detail={`${gb(sys.disk.used)} / ${gb(sys.disk.total)}`} percent={(sys.disk.used / sys.disk.total) * 100} />
          <Metric icon={ArrowDownUp} label="Disk I/O" value={io ? `↓ ${rate(io.readBps)}` : "–"} detail={io ? `↑ ${rate(io.writeBps)}` : "Not available on this OS"} />
        </div>
      </Section>
    </div>
  );
}
