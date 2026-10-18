import { useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, type AvailabilityRule, type PlaybookSummary, type SkillTool, type Tenant, type TenantSkill, type ToolEffect } from "@/lib/api";
import { EFFECTS, effectCounts, sections, targetKey } from "@/lib/skills";

/** Target keys of the tenant's `off` rules, e.g. "tool:createTask" or "effect:danger". */
type Off = Set<string>;
/** Target keys of the tenant's `on` rules; only a default-off playbook can have one. */
type On = Set<string>;
type SwitchKind = "playbook" | "tool" | "effect";

function Effects({ off, onChange }: { off: Off | null; onChange: (effect: ToolEffect, on: boolean) => void }) {
  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <div className="p-4 pb-3">
          <div className="font-medium">Effects</div>
          <div className="text-xs text-muted-foreground">Switching an effect off hides every tool with that effect, in every skill, from every bot of this tenant. Tools added later are covered too.</div>
        </div>
        <ul className="divide-y border-t">
          {(Object.keys(EFFECTS) as ToolEffect[]).map((e) => (
            <li key={e} className="flex items-center gap-3 px-4 py-3">
              <Badge variant={EFFECTS[e].variant}>{EFFECTS[e].label}</Badge>
              <div className="min-w-0 flex-1 text-xs text-muted-foreground">{EFFECTS[e].means}</div>
              <Switch checked={!off?.has(targetKey("effect", e))} disabled={!off} onCheckedChange={(v: boolean) => onChange(e, v)} aria-label={`${EFFECTS[e].label} tools available`} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Why a playbook's chain keeps it from starting. A loaded playbook switched off is read from the live switches, so the line follows a
 * toggle on this page; a missing playbook or a broken chain comes from the agent. Its own switch already shows when it is off itself.
 */
function cannotStart(p: PlaybookSummary, isOff: (name: string) => boolean, names: Set<string>): string | null {
  const offLoad = p.chain.find(isOff);
  if (offLoad) return `loads ${offLoad} (off)`;
  if (p.cause?.off === "loads" && !names.has(p.cause.playbook)) return `loads ${p.cause.playbook}, which does not exist`;
  if (p.cause?.off === "chain") return p.cause.problem;
  return null;
}

/**
 * A playbook switched off cannot start for any bot of this tenant; its tools go with it. `skillName` names the skills it needs.
 * A default-off playbook's switch is its tenant `on` rule instead (`on` holds those keys): off means no rule, so it falls back to off.
 */
function Playbooks({ playbooks, off, on, skillName, onChange }: { playbooks: PlaybookSummary[]; off: Off | null; on: On | null; skillName: (id: string) => string; onChange: (playbook: PlaybookSummary, on: boolean) => void }) {
  const byName = new Map(playbooks.map((p) => [p.name, p]));
  const names = new Set(byName.keys());
  const isOn = (p: PlaybookSummary) => (p.defaultOff ? !!on?.has(targetKey("playbook", p.name)) : !off?.has(targetKey("playbook", p.name)));
  const isOff = (name: string) => { const p = byName.get(name); return !!p && !isOn(p); };
  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <div className="p-4 pb-3">
          <div className="font-medium">Playbooks</div>
          <div className="text-xs text-muted-foreground">Switching a playbook off stops it, and every playbook that loads it, from starting for every bot of this tenant, and hides the tools that serve it.</div>
        </div>
        <ul className="divide-y border-t">
          {playbooks.map((p) => {
            const blocked = cannotStart(p, isOff, names);
            return (
              <li key={p.name} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="break-all font-mono text-sm">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                  {!p.start && <div className="text-xs text-muted-foreground">Reference: other playbooks load it; nobody starts it directly.</div>}
                  {p.requires.length > 0 && <div className="text-xs text-muted-foreground">Needs {p.requires.map(skillName).join(", ")}.</div>}
                  {p.loads.length > 0 && <div className="break-words text-xs text-muted-foreground">Loads {(p.chain.length ? p.chain : p.loads).join(", ")}.</div>}
                  {p.defaultOff && <div className="text-xs text-muted-foreground">Off until you switch it on here. Bots, servers, and channels can still turn it off.</div>}
                  {blocked && <div className="break-words text-xs font-medium">Cannot start: {blocked}.</div>}
                </div>
                <Switch checked={isOn(p)} disabled={!off} onCheckedChange={(v: boolean) => onChange(p, v)} aria-label={`${p.name} playbook available`} />
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * `off` is null until the tenant's rules load; playbook tools follow their playbook and get no switch. A tool whose effect is off cannot be switched on here.
 * An administration tool starts off and is on only with a tenant `on` rule.
 */
function Tools({ skill, off, on, onChange }: { skill: TenantSkill; off: Off | null; on: On | null; onChange: (tool: SkillTool, on: boolean) => void }) {
  const effectOff = (t: SkillTool) => !!off?.has(targetKey("effect", t.effect));
  const isOn = (t: SkillTool) => !effectOff(t) && (t.defaultOff ? !!on?.has(targetKey("tool", t.name)) : !off?.has(targetKey("tool", t.name)));
  const offCount = off ? skill.tools.filter((t: SkillTool) => !t.playbook && !isOn(t)).length : 0;
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
                    {effectOff(t) && <div className="text-xs font-medium">Off: {EFFECTS[t.effect].label} tools are switched off above.</div>}
                    {t.defaultOff && !effectOff(t) && <div className="text-xs text-muted-foreground">Administration: off until you switch it on here, so the model is not sent it on every call.</div>}
                  </div>
                  <Badge variant={EFFECTS[t.effect].variant}>{EFFECTS[t.effect].label}</Badge>
                  {!t.playbook && <Switch checked={isOn(t)} disabled={!off || effectOff(t)} onCheckedChange={(v: boolean) => onChange(t, v)} aria-label={`${t.name} available`} />}
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
  const [playbooks, setPlaybooks] = useState<PlaybookSummary[]>([]);
  const [off, setOff] = useState<Off | null>(null);
  const [on, setOn] = useState<On | null>(null);
  useEffect(() => {
    api.listSkills(tenant.id)
      .then((r: { skills: TenantSkill[]; playbooks: PlaybookSummary[] }) => { setList(r.skills); setPlaybooks(r.playbooks); })
      .catch((e: Error) => { toast.error(e.message); setList([]); });
  }, [tenant.id]);
  useEffect(() => {
    const keys = (rules: AvailabilityRule[], value: AvailabilityRule["value"]) => new Set(rules.filter((x) => x.value === value).map((x) => targetKey(x.kind, x.name)));
    api.listAvailability({ tenantId: tenant.id })
      .then((r: { rules: AvailabilityRule[] }) => { setOff(keys(r.rules, "off")); setOn(keys(r.rules, "on")); })
      .catch((e: Error) => toast.error(`Tool and playbook switches unavailable: ${e.message}`));
  }, [tenant.id]);

  // A default-off playbook or tool is switched on with a tenant `on` rule and back off by clearing it; an `on` replaces any `off` rule it had.
  const switchDefaultOff = (kind: "playbook" | "tool", name: string, v: boolean) => {
    const k = targetKey(kind, name);
    const set = (x: boolean) => {
      setOn((o) => { const next = new Set(o); if (x) next.add(k); else next.delete(k); return next; });
      if (x) setOff((o) => { const next = new Set(o); next.delete(k); return next; });
    };
    set(v);
    (v ? api.setAvailability({ tenantId: tenant.id }, { kind, name, value: "on" }) : api.clearAvailability({ tenantId: tenant.id }, kind, name))
      .catch((e: Error) => { set(!v); toast.error(e.message); });
  };

  const switchRule = (kind: SwitchKind, name: string, on: boolean) => {
    const set = (v: boolean) => setOff((o) => { const next = new Set(o); if (v) next.delete(targetKey(kind, name)); else next.add(targetKey(kind, name)); return next; });
    set(on);
    (on ? api.clearAvailability({ tenantId: tenant.id }, kind, name) : api.setAvailability({ tenantId: tenant.id }, { kind, name, value: "off" }))
      .catch((e: Error) => { set(!on); toast.error(e.message); });
  };

  const switchSkill = (s: TenantSkill, on: boolean) => {
    const set = (v: boolean) => setList((l) => l && l.map((x) => (x.id === s.id ? { ...x, isEnabled: v } : x)));
    set(on);
    api.setSkillEnabled(tenant.id, s.id, on).catch((e: Error) => { set(!on); toast.error(e.message); });
  };
  const skillName = (id: string) => list?.find((s) => s.id === id)?.name ?? id;

  if (!list) return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (!list.length) return <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">No skills available.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Skills the assistant may use for this tenant. A disabled skill's tools are hidden from the model. A tool switched off here is hidden from every bot of this tenant; playbook tools follow their playbook.</p>
      <Effects off={off} onChange={(e, on) => switchRule("effect", e, on)} />
      {playbooks.length > 0 && <Playbooks playbooks={playbooks} off={off} on={on} skillName={skillName} onChange={(p, v) => (p.defaultOff ? switchDefaultOff("playbook", p.name, v) : switchRule("playbook", p.name, v))} />}
      {list.map((s) => (
        <Card key={s.id} className="py-0">
          <CardContent className="px-0">
            <div className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.description} · {s.toolCount} tools</div>
              </div>
              <Switch checked={s.isEnabled} onCheckedChange={(v: boolean) => switchSkill(s, v)} aria-label={`${s.name} enabled`} />
            </div>
            {s.tools.length > 0 && <Tools skill={s} off={off} on={on} onChange={(t, v) => (t.defaultOff ? switchDefaultOff("tool", t.name, v) : switchRule("tool", t.name, v))} />}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
