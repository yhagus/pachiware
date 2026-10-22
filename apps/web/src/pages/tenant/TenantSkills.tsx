import { useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import { ChevronRight, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api, type AvailabilityRule, type PlaybookSummary, type SkillTool, type Tenant, type TenantSkill, type ToolEffect } from "@/lib/api";
import { EFFECTS, effectCounts, hasAll, searchWords, sections, targetKey } from "@/lib/skills";

/** Target keys of the tenant's `off` rules, e.g. "tool:createTask" or "effect:danger". */
type Off = Set<string>;
/** Target keys of the tenant's `on` rules; only a default-off playbook can have one. */
type On = Set<string>;
type SwitchKind = "playbook" | "tool" | "effect";
/** One row of a category: a skill with the tools a search left (opened when only its tools matched), or a playbook. */
type Item = { kind: "skill"; skill: TenantSkill; tools: SkillTool[]; open: boolean } | { kind: "playbook"; playbook: PlaybookSummary };
const ALL = "__all";

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

const Kind = ({ children }: { children: string }) => <Badge variant="outline" className="text-muted-foreground">{children}</Badge>;

/** A playbook switched off cannot start for any bot of this tenant; its tools go with it. `skillName` names the skills it needs. */
function PlaybookRow({ p, on, blocked, skillName, disabled, onChange }: { p: PlaybookSummary; on: boolean; blocked: string | null; skillName: (id: string) => string; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="break-all font-mono text-sm">{p.name}</span><Kind>Playbook</Kind></div>
        <div className="text-xs text-muted-foreground">{p.description}</div>
        {!p.start && <div className="text-xs text-muted-foreground">Reference: other playbooks load it; nobody starts it directly.</div>}
        {p.requires.length > 0 && <div className="text-xs text-muted-foreground">Needs {p.requires.map(skillName).join(", ")}.</div>}
        {p.loads.length > 0 && <div className="break-words text-xs text-muted-foreground">Loads {(p.chain.length ? p.chain : p.loads).join(", ")}.</div>}
        {p.defaultOff && <div className="text-xs text-muted-foreground">Off until you switch it on here. Bots, servers, and channels can still turn it off.</div>}
        {blocked && <div className="break-words text-xs font-medium">Cannot start: {blocked}.</div>}
      </div>
      <Switch checked={on} disabled={disabled} onCheckedChange={onChange} aria-label={`${p.name} playbook available`} />
    </li>
  );
}

/**
 * `off` is null until the tenant's rules load; playbook tools follow their playbook and get no switch. A tool whose effect is off cannot be switched on here.
 * An administration tool starts off and is on only with a tenant `on` rule. `shown` are the tools a search left; `open` starts the list open.
 */
function Tools({ skill, shown, open, off, on, onChange }: { skill: TenantSkill; shown: SkillTool[]; open: boolean; off: Off | null; on: On | null; onChange: (tool: SkillTool, on: boolean) => void }) {
  const effectOff = (t: SkillTool) => !!off?.has(targetKey("effect", t.effect));
  const isOn = (t: SkillTool) => !effectOff(t) && (t.defaultOff ? !!on?.has(targetKey("tool", t.name)) : !off?.has(targetKey("tool", t.name)));
  const offCount = off ? skill.tools.filter((t: SkillTool) => !t.playbook && !isOn(t)).length : 0;
  const matching = shown.length < skill.tools.length ? ` · ${shown.length} matching` : "";
  return (
    <details className="group border-t" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="font-medium">Tools</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{effectCounts(skill.tools)}{offCount > 0 && ` · ${offCount} off`}{matching}</span>
      </summary>
      <div className="space-y-4 border-t px-4 py-3">
        {sections({ ...skill, tools: shown }).map((sec) => (
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
  const [categories, setCategories] = useState<string[]>([]);
  const [off, setOff] = useState<Off | null>(null);
  const [on, setOn] = useState<On | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);
  useEffect(() => {
    api.listSkills(tenant.id)
      .then((r) => { setList(r.skills); setPlaybooks(r.playbooks); setCategories(r.categories); })
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
  if (!list.length && !playbooks.length) return <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">No skills available.</p>;

  // A default-off playbook's switch is its tenant `on` rule; the rest are on until an `off` rule. Chains are read over every playbook, not the filtered ones.
  const byName = new Map(playbooks.map((p) => [p.name, p]));
  const names = new Set(byName.keys());
  const playbookOn = (p: PlaybookSummary) => (p.defaultOff ? !!on?.has(targetKey("playbook", p.name)) : !off?.has(targetKey("playbook", p.name)));
  const playbookOff = (name: string) => { const p = byName.get(name); return !!p && !playbookOn(p); };

  // A skill matches on its own words (all its tools shown), or through some of its tools (only those shown, opened).
  const words = searchWords(query);
  const skillItem = (s: TenantSkill): Item | null => {
    if (!words.length || hasAll(words, s.name, s.description, s.category)) return { kind: "skill", skill: s, tools: s.tools, open: false };
    const tools = s.tools.filter((t) => hasAll(words, s.name, s.description, t.name, t.description, t.group));
    return tools.length ? { kind: "skill", skill: s, tools, open: true } : null;
  };
  const playbookMatches = (p: PlaybookSummary) => !words.length || hasAll(words, p.name, p.description, p.category, ...p.loads, ...p.requires.map(skillName));
  const inCategory = (c: string): number => list.filter((s) => s.category === c).length + playbooks.filter((p) => p.category === c).length;
  const groups = categories.filter((c) => category === ALL || c === category).map((c) => ({
    name: c,
    items: [
      ...list.filter((s) => s.category === c).map(skillItem).filter((x): x is Item => !!x),
      ...playbooks.filter((p) => p.category === c && playbookMatches(p)).map((p): Item => ({ kind: "playbook", playbook: p })),
    ],
  })).filter((g) => g.items.length);
  const filtering = words.length > 0 || category !== ALL;
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Skills give the assistant its tools; playbooks are procedures a person starts by name. A disabled skill's tools are hidden from the model. A tool or playbook switched off here is off for every bot of this tenant: a playbook switched off also stops every playbook that loads it, and playbook tools follow their playbook.</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" className="pl-9" placeholder="Search skills, playbooks and tools" aria-label="Search skills, playbooks and tools" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-60" aria-label="Filter by category"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c} value={c}>{c} · {inCategory(c)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="sr-only" aria-live="polite">{filtering ? `${shown} shown` : ""}</p>
      {!filtering && <Effects off={off} onChange={(e, on) => switchRule("effect", e, on)} />}
      {groups.map((g) => (
        <Card key={g.name} className="py-0">
          <CardContent className="px-0">
            <h2 className="flex items-baseline gap-2 p-4 pb-3 font-medium">{g.name} <span className="text-xs font-normal text-muted-foreground">{g.items.length}</span></h2>
            <ul className="divide-y border-t">
              {g.items.map((item) => item.kind === "playbook" ? (
                <PlaybookRow key={`playbook:${item.playbook.name}`} p={item.playbook} on={playbookOn(item.playbook)} blocked={cannotStart(item.playbook, playbookOff, names)} skillName={skillName} disabled={!off}
                  onChange={(v) => (item.playbook.defaultOff ? switchDefaultOff("playbook", item.playbook.name, v) : switchRule("playbook", item.playbook.name, v))} />
              ) : (
                <li key={`skill:${item.skill.id}`}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{item.skill.name}</span><Kind>Skill</Kind></div>
                      <div className="text-xs text-muted-foreground">{item.skill.description} · {item.skill.toolCount} tools</div>
                    </div>
                    <Switch checked={item.skill.isEnabled} onCheckedChange={(v: boolean) => switchSkill(item.skill, v)} aria-label={`${item.skill.name} enabled`} />
                  </div>
                  {item.skill.tools.length > 0 && (
                    // Keyed by the search, so a new search opens or closes the list again.
                    <Tools key={words.join(" ")} skill={item.skill} shown={item.tools} open={item.open} off={off} on={on}
                      onChange={(t, v) => (t.defaultOff ? switchDefaultOff("tool", t.name, v) : switchRule("tool", t.name, v))} />
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
      {filtering && !groups.length && (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          <p>Nothing matches{words.length ? ` "${query.trim()}"` : ""}{category !== ALL ? ` in ${category}` : ""}.</p>
          <Button variant="link" onClick={() => { setQuery(""); setCategory(ALL); }}>Clear the search and filter</Button>
        </div>
      )}
    </div>
  );
}
