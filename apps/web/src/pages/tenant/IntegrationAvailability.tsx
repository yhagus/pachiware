import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type AvailabilityKind, type AvailabilityLevel, type AvailabilityLevelName, type AvailabilityValue, type Guild, type InheritedAvailability, type LevelAvailability, type PlaybookSummary, type SkillTool, type SlashStatus, type TenantSkill, type ToolEffect } from "@/lib/api";
import { EFFECTS, effectCounts, sections, targetKey as key } from "@/lib/skills";
import { useIntegration } from "@/pages/tenant/IntegrationDetail";

type Level = Exclude<AvailabilityLevelName, "tenant">;
type Choice = AvailabilityValue | "inherit";
/** What a target ends up as at this level once its own rule and the levels above are applied. */
type Outcome = "on" | "off" | "opt_in" | "waiting";

const WHERE: Record<AvailabilityLevelName, string> = { tenant: "the tenant", bot: "the bot", guild: "the server", channel: "the channel" };
const KIND: Record<AvailabilityKind, string> = { playbook: "Playbook", skill: "Skill", tool: "Tool", effect: "Effect" };

/**
 * The controls a level may use: opt-in only at a bot or server, on only beneath an opt-in, and neither while something above turns the target off
 * (`offAbove` covers a tool's skill and effect too). A rule already set stays listed so the select shows the truth.
 */
function choices(level: Level, inherited: InheritedAvailability | undefined, own: AvailabilityValue | undefined, offAbove: boolean): Choice[] {
  const list: Choice[] = ["inherit", "off"];
  if (level !== "channel" && !offAbove) list.push("opt_in");
  if (level !== "bot" && inherited?.optIn && !offAbove) list.push("on");
  if (own && !list.includes(own)) list.push(own);
  return list;
}

function choiceLabel(c: Choice, level: Level, inheritedOutcome: Outcome): string {
  if (c === "inherit") return `Inherit (${inheritedOutcome === "on" ? "on" : inheritedOutcome === "waiting" ? "waiting for opt-in" : "off"})`;
  if (c === "off") return "Off";
  if (c === "opt_in") return level === "bot" ? "Opt-in per server" : "Opt-in per channel";
  return "On here";
}

/** One sentence on what the levels above leave this target, or null when they leave it plainly on. */
function inheritedNote(i: InheritedAvailability | undefined, level: Level): string | null {
  if (!i) return null;
  if (i.kind === "skill" && i.off === "tenant") return "Switched off for the tenant on the Skills page.";
  if (i.off) return `Off at ${WHERE[i.off]}.`;
  if (i.optIn && !i.available) return `Opt-in at ${WHERE[i.optIn]}: off until ${level === "guild" ? "this server or a channel" : "this channel"} turns it on.`;
  if (i.optIn) return `Opt-in at ${WHERE[i.optIn]}, turned on for this server.`;
  return null;
}

/** Why a playbook has no slash command in this server, or null when it has one (its row shows a badge) or the view is not a server's. */
function slashNote(s: SlashStatus | undefined): string | null {
  if (!s || s.status === "registered") return null;
  if (s.status === "name_unusable") return "No slash command: Discord takes only names of 1 to 32 lowercase letters, digits, - or _.";
  if (s.reason === "reference") return "No slash command: a reference that other playbooks load, never started on its own.";
  // Off above this server already has its own note naming the level.
  return s.level === "guild" ? "No slash command here: this server turns it off." : "No slash command here.";
}

function RuleSelect({ id, level, inherited, own, offAbove, busy, onPick, label }: { id: string; level: Level; inherited: InheritedAvailability | undefined; own: AvailabilityValue | undefined; offAbove: boolean; busy: boolean; onPick: (c: Choice) => void; label: string }) {
  const from: Outcome = !inherited || inherited.available ? "on" : inherited.off ? "off" : "waiting";
  return (
    <Select value={own ?? "inherit"} disabled={busy} onValueChange={(v: string) => onPick(v as Choice)}>
      <SelectTrigger id={id} aria-label={label} className={`h-11 w-full shrink-0 sm:h-9 sm:w-52 ${own ? "border-foreground/40 font-medium" : ""}`}><SelectValue /></SelectTrigger>
      <SelectContent>{choices(level, inherited, own, offAbove).map((c) => <SelectItem key={c} value={c}>{choiceLabel(c, level, from)}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function Row({ title, mono, description, badge, notes, control }: { title: string; mono?: boolean; description?: string; badge?: ReactNode; notes: (string | null | false)[]; control: ReactNode }) {
  const shown = notes.filter(Boolean) as string[];
  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={mono ? "break-all font-mono text-sm" : "text-sm font-medium"}>{title}</span>
          {badge}
        </div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
        {shown.map((n) => <div key={n} className="text-xs font-medium">{n}</div>)}
      </div>
      {control}
    </li>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <div className="p-4 pb-2">
          <h3 className="font-medium">{title}</h3>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <ul className="divide-y border-t px-4">{children}</ul>
      </CardContent>
    </Card>
  );
}

/** A collapsed list of tools; `count` says how many have a rule at this level. */
function Fold({ title, summary, count, children, nested }: { title: string; summary: string; count: number; children: ReactNode; nested?: boolean }) {
  return (
    <details className={nested ? "group/sec" : "group/tools border-t"}>
      <summary className={`flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm focus-visible:outline-2 focus-visible:outline-ring sm:min-h-9 [&::-webkit-details-marker]:hidden ${nested ? "py-1" : "px-4 py-2"}`}>
        <ChevronRight className={`size-4 shrink-0 text-muted-foreground transition-transform ${nested ? "group-open/sec:rotate-90" : "group-open/tools:rotate-90"}`} />
        <span className={nested ? "text-xs font-medium" : "font-medium"}>{title}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{summary}{count > 0 && ` · ${count} set here`}</span>
      </summary>
      <div className={nested ? "pl-6" : "border-t px-4 py-1"}>{children}</div>
    </details>
  );
}

export function IntegrationAvailability() {
  const { bot, tenant } = useIntegration();
  const [params, setParams] = useSearchParams();
  const guildId = params.get("guild") ?? "", channelId = guildId ? params.get("channel") ?? "" : "";
  const levelName: Level = channelId ? "channel" : guildId ? "guild" : "bot";
  const level: AvailabilityLevel = useMemo(() => ({ botId: bot.id, guildId: guildId || undefined, channelId: channelId || undefined }), [bot.id, guildId, channelId]);

  const [guilds, setGuilds] = useState<{ connected: boolean; guilds: Guild[] } | null>(null);
  const [catalogue, setCatalogue] = useState<{ skills: TenantSkill[]; playbooks: PlaybookSummary[] } | null>(null);
  const [state, setState] = useState<LevelAvailability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { api.getBotGuilds(bot.id).then(setGuilds).catch(() => setGuilds({ connected: false, guilds: [] })); }, [bot.id]);
  const load = useCallback(() => {
    setError(null);
    return Promise.all([catalogue ? catalogue : api.listSkills(tenant.id), api.listAvailability(level)])
      .then(([c, s]) => { setCatalogue(c); setState(s); })
      .catch((e: Error) => setError(e.message));
  }, [tenant.id, level]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setState(null); void load(); }, [load]);

  const guild = guilds?.guilds.find((g) => g.id === guildId);
  const channels = guild?.channels.filter((c) => c.type === "text") ?? [];
  const channel = channels.find((c) => c.id === channelId);
  const place = levelName === "channel" ? `#${channel?.name ?? channelId}` : levelName === "guild" ? guild?.name ?? guildId : bot.name;
  const pickLevel = (g: string, c = "") => setParams(g ? (c ? { guild: g, channel: c } : { guild: g }) : {}, { replace: true });

  const own = new Map(state?.rules.map((r) => [key(r.kind, r.name), r.value]));
  const inherited = new Map(state?.inherited.map((i) => [key(i.kind, i.name), i]));
  const outcome = (kind: AvailabilityKind, name: string): Outcome => {
    const o = own.get(key(kind, name)), i = inherited.get(key(kind, name));
    if (o === "off" || i?.off) return "off";
    if (o === "on" || o === "opt_in") return o;
    return i && !i.available ? "waiting" : "on";
  };
  const slashStatus = new Map<string, SlashStatus>(state?.slash?.map((s: SlashStatus) => [s.playbook, s]));
  const skillName = (id: string) => catalogue?.skills.find((s) => s.id === id)?.name ?? id;

  const pick = async (kind: AvailabilityKind, name: string, c: Choice) => {
    setBusy(key(kind, name));
    try { setState(c === "inherit" ? await api.clearAvailability(level, kind, name) : await api.setAvailability(level, { kind, name, value: c })); }
    catch (e) { toast.error(`${KIND[kind]} ${name}: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };
  const offAbove = (kind: AvailabilityKind, name: string) => !!inherited.get(key(kind, name))?.off;
  /** `also` are targets whose off above covers this one too: a tool's skill and effect. */
  const control = (kind: AvailabilityKind, name: string, label: string, also: [AvailabilityKind, string][] = []) => (
    <RuleSelect id={`rule-${kind}-${name}`} level={levelName} inherited={inherited.get(key(kind, name))} own={own.get(key(kind, name))} offAbove={[[kind, name] as [AvailabilityKind, string], ...also].some(([k, n]) => offAbove(k, n))}
      busy={busy === key(kind, name)} onPick={(c) => void pick(kind, name, c)} label={`${label} at this level`} />
  );
  const note = (kind: AvailabilityKind, name: string) => inheritedNote(inherited.get(key(kind, name)), levelName);
  const offWhy = (o: Outcome, what: string, many = false) => (o === "off" ? `Off: ${what} ${many ? "are" : "is"} off here.` : o === "waiting" ? `Off: ${what} ${many ? "wait" : "waits"} for an opt-in here.` : null);

  const toolRow = (s: TenantSkill) => (t: SkillTool) => (
    <Row key={t.name} title={t.name} mono description={t.description} badge={<Badge variant={EFFECTS[t.effect].variant}>{EFFECTS[t.effect].label}</Badge>}
      notes={[!t.playbook && note("tool", t.name), offWhy(outcome("effect", t.effect), `${EFFECTS[t.effect].label} tools`, true), t.playbook ? `Follows the ${t.playbook} playbook; it has no rule of its own.` : null]}
      control={t.playbook ? null : control("tool", t.name, t.name, [["skill", s.id], ["effect", t.effect]])} />
  );
  const setHere = (tools: SkillTool[]) => tools.filter((t) => own.has(key("tool", t.name))).length;

  const levelHint = {
    bot: `Rules here apply in every server and channel of ${bot.name}. Opt-in keeps a target off in each server until that server or one of its channels turns it on.`,
    guild: "Rules here apply in every channel of this server. Opt-in keeps a target off in each channel until that channel turns it on.",
    channel: "Rules here apply in this channel and its threads.",
  }[levelName];

  return (
    <div className="space-y-4">
      <Card className="py-0">
        <CardContent className="space-y-3 p-4">
          <div>
            <h3 className="font-medium">Rules for {place}</h3>
            <p className="text-xs text-muted-foreground">{levelHint} A rule can only narrow what the levels above allow; Inherit removes this level's rule.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="level-server" className="text-xs">Server</Label>
              <Select value={guildId || "all"} disabled={!guilds?.guilds.length} onValueChange={(v: string) => pickLevel(v === "all" ? "" : v)}>
                <SelectTrigger id="level-server" className="h-11 w-full sm:h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every server (bot rules)</SelectItem>
                  {guilds?.guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  {guildId && !guild && <SelectItem value={guildId}>{guildId}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            {guildId && (
              <div className="min-w-0 space-y-1">
                <Label htmlFor="level-channel" className="text-xs">Channel</Label>
                <Select value={channelId || "all"} onValueChange={(v: string) => pickLevel(guildId, v === "all" ? "" : v)}>
                  <SelectTrigger id="level-channel" className="h-11 w-full sm:h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Every channel (server rules)</SelectItem>
                    {channels.map((c) => <SelectItem key={c.id} value={c.id}># {c.name}</SelectItem>)}
                    {channelId && !channel && <SelectItem value={channelId}>{channelId}</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {guilds && !guilds.guilds.length && <p className="text-xs text-muted-foreground">Servers and channels appear here once the bot is connected to one. Bot rules already apply to all of them.</p>}
        </CardContent>
      </Card>

      {error ? (
        <div role="alert" className="space-y-3 rounded-lg border border-destructive/40 p-4 text-sm">
          <p>Could not load the rules for {place}: {error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button>
        </div>
      ) : !state || !catalogue ? (
        <div role="status" className="space-y-3"><p className="sr-only">Loading rules</p>{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <>
          <Card className="py-0">
            <CardContent className="grid gap-4 p-4 md:grid-cols-2">
              <section aria-labelledby="set-here" className="min-w-0 space-y-2">
                <h3 id="set-here" className="text-sm font-medium">Set here</h3>
                {state.rules.length === 0 ? <p className="text-xs text-muted-foreground">No rules at this level. Everything follows the levels above.</p> : (
                  <ul className="space-y-1">
                    {state.rules.map((r) => (
                      <li key={key(r.kind, r.name)} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 break-words"><span className="text-muted-foreground">{KIND[r.kind]}</span> {r.kind === "skill" ? skillName(r.name) : r.name}: {choiceLabel(r.value, levelName, "on")}</span>
                        <Button variant="ghost" size="sm" className="h-11 sm:h-8" disabled={busy === key(r.kind, r.name)} onClick={() => void pick(r.kind, r.name, "inherit")} aria-label={`Clear the ${r.name} rule`}>Clear</Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section aria-labelledby="from-above" className="min-w-0 space-y-2">
                <h3 id="from-above" className="text-sm font-medium">From above</h3>
                {state.inherited.length === 0 ? <p className="text-xs text-muted-foreground">Nothing is off or opt-in above this level.</p> : (
                  <ul className="space-y-1">
                    {state.inherited.map((i) => (
                      <li key={key(i.kind, i.name)} className="text-sm break-words"><span className="text-muted-foreground">{KIND[i.kind]}</span> {i.kind === "skill" ? skillName(i.name) : i.name}: {inheritedNote(i, levelName) ?? "On."}</li>
                    ))}
                  </ul>
                )}
              </section>
            </CardContent>
          </Card>

          <Section title="Effects" hint="An effect rule covers every tool with that effect, including playbook tools and tools added later.">
            {(Object.keys(EFFECTS) as ToolEffect[]).map((e) => (
              <Row key={e} title={`${EFFECTS[e].label} tools`} description={EFFECTS[e].means} notes={[note("effect", e)]} control={control("effect", e, `${EFFECTS[e].label} tools`)} />
            ))}
          </Section>

          {catalogue.playbooks.length > 0 && (
            <Section title="Playbooks" hint={`A playbook starts only where it and every skill it needs are on. Its tools follow it.${state.slash ? " The slash command badge shows it is in this server's / picker; channel rules are checked when someone uses it." : ""}`}>
              {catalogue.playbooks.map((p) => {
                const blocked = p.requires.filter((id) => outcome("skill", id) === "off" || outcome("skill", id) === "waiting").map(skillName);
                const slash = slashStatus.get(p.name);
                return <Row key={p.name} title={p.name} description={p.description} badge={slash?.status === "registered" && <Badge variant="outline" className="font-mono">/{p.name}</Badge>}
                  notes={[note("playbook", p.name), blocked.length > 0 && `Cannot start here: needs ${blocked.join(", ")}, which ${blocked.length === 1 ? "is" : "are"} off.`, slashNote(slash)]} control={control("playbook", p.name, `${p.name} playbook`)} />;
              })}
            </Section>
          )}

          {catalogue.skills.map((s) => {
            const skillOff = offWhy(outcome("skill", s.id), s.name);
            return (
              <Card key={s.id} className="py-0">
                <CardContent className="px-0">
                  <ul className="px-4"><Row title={s.name} description={s.description} notes={[note("skill", s.id), skillOff && !note("skill", s.id) && skillOff]} control={control("skill", s.id, s.name)} /></ul>
                  {s.tools.length > 0 && (
                    <Fold title="Tools" summary={effectCounts(s.tools)} count={setHere(s.tools)}>
                      {skillOff && <p className="pt-2 text-xs font-medium">Every tool below is off here while {s.name} is.</p>}
                      {sections(s).map((sec) => sec.title && s.groups.length ? (
                        <Fold key={sec.title} nested title={sec.title} summary={`${sec.tools.length} tools`} count={setHere(sec.tools)}>
                          <ul className="divide-y">{sec.tools.map(toolRow(s))}</ul>
                        </Fold>
                      ) : (
                        <section key={sec.title ?? "all"}>
                          {sec.title && <h4 className="pt-2 text-xs font-medium text-muted-foreground">{sec.title} · {sec.tools.length}</h4>}
                          <ul className="divide-y">{sec.tools.map(toolRow(s))}</ul>
                        </section>
                      ))}
                    </Fold>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
