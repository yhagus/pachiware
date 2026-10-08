import { useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, type Tenant, type TenantSkill } from "@/lib/api";

export function TenantSkills() {
  const tenant = useOutletContext<Tenant>();
  const [list, setList] = useState<TenantSkill[] | null>(null);
  useEffect(() => { api.listSkills(tenant.id).then((r) => setList(r.skills)).catch((e) => { toast.error(e.message); setList([]); }); }, [tenant.id]);

  const toggle = (s: TenantSkill, on: boolean) => {
    const set = (v: boolean) => setList((l) => l && l.map((x) => (x.id === s.id ? { ...x, isEnabled: v } : x)));
    set(on);
    api.setSkillEnabled(tenant.id, s.id, on).catch((e) => { set(!on); toast.error(e.message); });
  };

  if (!list) return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (!list.length) return <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">No skills available.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Skills the assistant may use for this tenant. A disabled skill's tools are hidden from the model.</p>
      {list.map((s) => (
        <Card key={s.id} className="py-0">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-muted-foreground">{s.description} · {s.toolCount} tools</div>
            </div>
            <Switch checked={s.isEnabled} onCheckedChange={(v) => toggle(s, v)} aria-label={`${s.name} enabled`} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
