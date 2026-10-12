import { useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, type AvailabilityRule, type SkillTool, type Tenant, type TenantSkill, type ToolEffect } from "@/lib/api";

const EFFECTS: Record<ToolEffect, { label: string; variant: "outline" | "secondary" | "destructive" }> = {
  read: { label: "Read", variant: "outline" },
  write: { label: "Write", variant: "secondary" },
  danger: { label: "Danger", variant: "destructive" },
};

/** Grouped skills (Git) list one section per group; the rest are one flat list. Playbook tools always come last, in their own section. */
function sections(s: TenantSkill): { title?: string; tools: SkillTool[] }[] {
  const general = s.tools.filter((t: SkillTool) => !t.playbook), playbook = s.tools.filter((t: SkillTool) => t.playbook);
  const main = s.groups.length ? s.groups.map((g: string) => ({ title: g, tools: general.filter((t: SkillTool) => t.group === g) })) : [{ tools: general }];
  return [...main, { title: "Playbook tools", tools: playbook }].filter((x) => x.tools.length);
}

const effectCounts = (tools: SkillTool[]) =>
  (Object.keys(EFFECTS) as ToolEffect[]).map((e) => [e, tools.filter((t) => t.effect === e).length] as const).filter(([, n]) => n).map(([e, n]) => `${n} ${e}`).join(" · ");

/** `off` is null until the tenant's rules load; playbook tools follow their playbook and get no switch. */
function Tools({ skill, off, onToggle }: { skill: TenantSkill; off: Set<string> | null; onToggle: (tool: SkillTool, on: boolean) => void }) {
  const offCount = off ? skill.tools.filter((t: SkillTool) => off.has(t.name)).length : 0;
  return (
    <details className="group border-t">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="font-medium">Tools</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{effectCounts(skill.tools)}{offCount > 0 && ` · ${offCount} off`}</span>
      </summary>
      <div className="space-y-4 border-t px-4 py-3">
        {sections(skill).map((sec) => (
          <section key={sec.title ?? "all"}>
            {sec.title && <h3 className="text-xs font-medium text-muted-foreground">{sec.title} · {sec.tools.length}</h3>}
            <ul className="divide-y">
              {sec.tools.map((t) => (
                <li key={t.name} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="break-all font-mono text-sm">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.description}</div>
                  </div>
                  <Badge variant={EFFECTS[t.effect].variant}>{EFFECTS[t.effect].label}</Badge>
                  {!t.playbook && <Switch checked={!off?.has(t.name)} disabled={!off} onCheckedChange={(v: boolean) => onToggle(t, v)} aria-label={`${t.name} available`} />}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}

export function TenantSkills() {
  const tenant = useOutletContext<Tenant>();
  const [list, setList] = useState<TenantSkill[] | null>(null);
  const [off, setOff] = useState<Set<string> | null>(null);
  useEffect(() => { api.listSkills(tenant.id).then((r: { skills: TenantSkill[] }) => setList(r.skills)).catch((e: Error) => { toast.error(e.message); setList([]); }); }, [tenant.id]);
  useEffect(() => {
    api.listAvailability({ tenantId: tenant.id })
      .then((r: { rules: AvailabilityRule[] }) => setOff(new Set(r.rules.filter((x) => x.kind === "tool" && x.value === "off").map((x) => x.name))))
      .catch((e: Error) => toast.error(`Tool switches unavailable: ${e.message}`));
  }, [tenant.id]);

  const toggleTool = (t: SkillTool, on: boolean) => {
    const set = (v: boolean) => setOff((o) => { const next = new Set(o); if (v) next.delete(t.name); else next.add(t.name); return next; });
    set(on);
    (on ? api.clearAvailability({ tenantId: tenant.id }, "tool", t.name) : api.setAvailability({ tenantId: tenant.id }, { kind: "tool", name: t.name, value: "off" }))
      .catch((e: Error) => { set(!on); toast.error(e.message); });
  };

  const toggle = (s: TenantSkill, on: boolean) => {
    const set = (v: boolean) => setList((l) => l && l.map((x) => (x.id === s.id ? { ...x, isEnabled: v } : x)));
    set(on);
    api.setSkillEnabled(tenant.id, s.id, on).catch((e: Error) => { set(!on); toast.error(e.message); });
  };

  if (!list) return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (!list.length) return <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">No skills available.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Skills the assistant may use for this tenant. A disabled skill's tools are hidden from the model. A tool switched off here is hidden from every bot of this tenant; playbook tools follow their playbook. Danger tools cannot be undone or change access, security, or settings.</p>
      {list.map((s) => (
        <Card key={s.id} className="py-0">
          <CardContent className="px-0">
            <div className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.description} · {s.toolCount} tools</div>
              </div>
              <Switch checked={s.isEnabled} onCheckedChange={(v: boolean) => toggle(s, v)} aria-label={`${s.name} enabled`} />
            </div>
            {s.tools.length > 0 && <Tools skill={s} off={off} onToggle={toggleTool} />}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
