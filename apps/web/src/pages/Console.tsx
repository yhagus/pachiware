import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { ArrowDown, ChevronDown, Copy, Download, Eraser, Pause, Play, RefreshCw, Search, WrapText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IconButton } from "@/components/IconButton";
import { cn } from "@/lib/utils";
import {
  LOG_LEVELS, compile, downloadLogs, fetchLogs, followLogs, logLine, matchParts, passes, runStart, textMatcher,
  type LogEntry, type LogFilters, type LogLevel, type LogPage, type StreamState,
} from "@/lib/logs";

const RANGES = [
  { id: "15m", label: "Last 15 minutes", ms: 15 * 60_000 },
  { id: "1h", label: "Last hour", ms: 3_600_000 },
  { id: "24h", label: "Last 24 hours", ms: 86_400_000 },
  { id: "7d", label: "Last 7 days", ms: 7 * 86_400_000 },
  { id: "custom", label: "Custom range", ms: 0 },
] as const;
const DEFAULT_RANGE = "24h";
/** Lines read from history; the server keeps the newest. */
const HISTORY_LIMIT = 2000;
/** Lines kept on the page; once live lines pass it the oldest leave the view. */
const MAX_SHOWN = 5000;
const LEVEL_NAME: Record<LogLevel, string> = { error: "Error", warn: "Warn", info: "Info", debug: "Debug" };
const LEVEL_CLASS: Record<LogLevel, string> = {
  error: "font-semibold text-red-700 dark:text-red-400",
  warn: "font-semibold text-amber-700 dark:text-amber-400",
  info: "text-muted-foreground",
  debug: "text-muted-foreground/70",
};

type TimeFormat = "local" | "utc" | "relative";
const TIME_WIDTH: Record<TimeFormat, string> = { local: "19ch", utc: "24ch", relative: "11ch" };

// Display choices are this viewer's own; storage can be missing (private window), so every access is guarded.
const pref = (key: string, fallback: string) => { try { return localStorage.getItem(`pachiware.console.${key}`) ?? fallback; } catch { return fallback; } };
const savePref = (key: string, value: string) => { try { localStorage.setItem(`pachiware.console.${key}`, value); } catch { /* kept for this visit only */ } };

/** The filters, as the address bar holds them so a view can be bookmarked or shared. */
type View = { range: string; from: string; to: string; levels: LogLevel[]; sources: string[]; q: string; regex: boolean; caseSensitive: boolean };
function viewOf(params: URLSearchParams): View {
  const range = params.get("range");
  return {
    range: RANGES.some((r) => r.id === range) ? range! : DEFAULT_RANGE,
    from: params.get("from") ?? "", to: params.get("to") ?? "",
    levels: (params.get("level") ?? "").split(",").filter((l): l is LogLevel => LOG_LEVELS.includes(l as LogLevel)),
    sources: (params.get("source") ?? "").split(",").filter(Boolean),
    q: params.get("q") ?? "", regex: params.get("regex") === "1", caseSensitive: params.get("case") === "1",
  };
}

const isoOf = (local: string) => { const d = new Date(local); return local && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined; };
/** What the server is asked: a preset range ends now and starts its length before. */
function filtersOf(v: View): LogFilters {
  const preset = RANGES.find((r) => r.id === v.range)!;
  return {
    from: v.range === "custom" ? isoOf(v.from) : new Date(Date.now() - preset.ms).toISOString(),
    to: v.range === "custom" ? isoOf(v.to) : undefined,
    levels: v.levels, sources: v.sources, q: v.q, regex: v.regex, caseSensitive: v.caseSensitive,
  };
}

function formatTime(iso: string, mode: TimeFormat, now: number): string {
  const d = new Date(iso);
  if (mode === "utc") return `${iso.slice(0, 23).replace("T", " ")}Z`;
  if (mode === "relative") {
    const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
    return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86_400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86_400)} d ago`;
  }
  const clock = `${d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  return d.toDateString() === new Date().toDateString() ? clock : `${d.toLocaleDateString([], { month: "short", day: "2-digit" })} ${clock}`;
}

type Search = { q: string; regex: boolean; caseSensitive: boolean };
function Highlight({ text, search }: { text: string; search: Search }) {
  if (!search.q) return <>{text}</>;
  return <>{matchParts(text, search.q, search.regex, search.caseSensitive).map((p, i) =>
    p.hit ? <mark key={i} className="rounded-sm bg-yellow-200 text-inherit dark:bg-yellow-400/30">{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>)}</>;
}

/** `now` changes only for "Time ago", so a row renders again only when what it shows changes. */
const Row = memo(function Row({ entry, timeFormat, now, wrap, search, expanded, onToggle }: {
  entry: LogEntry; timeFormat: TimeFormat; now: number; wrap: boolean; search: Search; expanded: boolean; onToggle: (id: string) => void;
}) {
  const [first, ...more] = entry.text.split("\n");
  return (
    <div className={cn("flex flex-wrap gap-x-3 px-3 hover:bg-muted sm:grid sm:grid-cols-[var(--time)_5ch_13ch_var(--message)]", entry.level === "error" && "bg-red-500/5")}>
      <time dateTime={entry.time} title={entry.time} className="tabular-nums text-muted-foreground">{formatTime(entry.time, timeFormat, now)}</time>
      <span className={LEVEL_CLASS[entry.level]}>{entry.level.toUpperCase()}</span>
      <span className="truncate text-muted-foreground" title={entry.source}>[<Highlight text={entry.source} search={search} />]</span>
      <div className={cn("basis-full sm:basis-auto", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}>
        <Highlight text={first ?? ""} search={search} />
        {more.length > 0 && expanded && <>{"\n"}<Highlight text={more.join("\n")} search={search} /></>}
        {more.length > 0 && (
          <button type="button" onClick={() => onToggle(entry.id)} aria-expanded={expanded} className="ml-2 rounded-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">
            {expanded ? "show less" : `+${more.length} line${more.length > 1 ? "s" : ""}`}
          </button>
        )}
      </div>
    </div>
  );
});

function Toggle({ label, pressed, onClick, children }: { label: string; pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" size="icon-xs" variant={pressed ? "secondary" : "ghost"} aria-label={label} aria-pressed={pressed} onClick={onClick} className="font-mono">{children}</Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function LiveState({ live, state, paused, pending }: { live: boolean; state: StreamState | "off"; paused: boolean; pending: number }) {
  if (!live) return <span>Not live: this range ends in the past</span>;
  if (paused) return <span>Paused{pending ? ` · ${pending.toLocaleString()} new` : ""}</span>;
  if (state === "live") return <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" aria-hidden />Live</span>;
  if (state === "retrying") return <span className="text-amber-700 dark:text-amber-400">Connection lost, reconnecting</span>;
  return <span>Connecting</span>;
}

export function Console() {
  const [params, setParams] = useSearchParams();
  const view = viewOf(params);
  const key = JSON.stringify(view);
  const update = useCallback((patch: Record<string, string | null>) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    return next;
  }, { replace: true }), [setParams]);

  // The search box follows the address bar, which takes the text after a pause in typing.
  const [search, setSearch] = useState(view.q);
  useEffect(() => { setSearch(view.q); }, [view.q]);
  useEffect(() => {
    if (search === view.q) return;
    const timer = setTimeout(() => update({ q: search || null }), 300);
    return () => clearTimeout(timer);
  }, [search, view.q, update]);
  const badRegex = view.regex && !!search && !compile(search, "");

  const live = view.range !== "custom" || !view.to;
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [page, setPage] = useState<LogPage | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [stream, setStream] = useState<StreamState | "off">("off");
  const [paused, setPaused] = useState(false);
  const [pending, setPending] = useState(0);
  const [trimmed, setTrimmed] = useState(false);
  const [liveSources, setLiveSources] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(() => (["local", "utc", "relative"].includes(pref("time", "local")) ? pref("time", "local") as TimeFormat : "local"));
  const [wrap, setWrap] = useState(() => pref("wrap", "on") === "on");
  const [following, setFollowing] = useState(true);
  const [reload, setReload] = useState(0);
  const [cleared, setCleared] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Live lines wait here and join the view four times a second; while paused they are held instead.
  const incoming = useRef<LogEntry[]>([]);
  const held = useRef<LogEntry[]>([]);
  const shownIds = useRef(new Set<string>());
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const append = useCallback((fresh: LogEntry[]) => {
    setEntries((current) => {
      const next = current.concat(fresh);
      if (next.length <= MAX_SHOWN) return next;
      setTrimmed(true);
      return next.slice(-MAX_SHOWN);
    });
  }, []);

  useEffect(() => {
    if (badRegex) { setLoading(false); return; }
    const ctl = new AbortController();
    const filters = filtersOf(view);
    setLoading(true); setError(""); setStream("off"); setCleared(false);
    incoming.current = []; held.current = []; setPending(0); setTrimmed(false); setLiveSources([]);
    fetchLogs(filters, HISTORY_LIMIT, ctl.signal).then((result) => {
      shownIds.current = new Set(result.entries.map((e) => e.id));
      setEntries(result.entries); setPage(result); setExpanded(new Set()); setLoading(false); setFollowing(true);
      if (!live) return;
      const text = textMatcher(filters.q, filters.regex, filters.caseSensitive);
      void followLogs({ run: result.run, after: result.cursor }, {
        log: (e) => { if (passes(e, filters, text)) incoming.current.push(e); },
        state: setStream,
      }, ctl.signal);
    }).catch((e) => { if (!ctl.signal.aborted) { setError(e.message); setLoading(false); } });
    return () => ctl.abort();
    // `key` stands for the whole view; `live` and `badRegex` follow from it.
  }, [key, reload]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!incoming.current.length) return;
      const fresh = incoming.current.filter((e) => !shownIds.current.has(e.id));
      incoming.current = [];
      if (!fresh.length) return;
      for (const e of fresh) shownIds.current.add(e.id);
      setLiveSources((s) => { const add = fresh.map((e) => e.source).filter((x) => !s.includes(x)); return add.length ? [...new Set([...s, ...add])] : s; });
      if (pausedRef.current) {
        held.current.push(...fresh);
        if (held.current.length > MAX_SHOWN) held.current.splice(0, held.current.length - MAX_SHOWN);
        setPending(held.current.length);
      } else append(fresh);
    }, 250);
    return () => clearInterval(timer);
  }, [append]);

  useEffect(() => {
    if (timeFormat !== "relative") return;
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, [timeFormat]);

  const resume = () => { setPaused(false); append(held.current); held.current = []; setPending(0); };

  // Following the newest line until the reader scrolls up; scrolling back to the bottom follows again.
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (following && panel.current) panel.current.scrollTop = panel.current.scrollHeight; }, [entries, following, wrap, expanded]);
  const onScroll = () => {
    const el = panel.current!;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== following) setFollowing(atBottom);
  };

  const searchBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable;
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); searchBox.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleRow = useCallback((id: string) => setExpanded((s) => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; }), []);
  const searchShown = useMemo<Search>(() => ({ q: badRegex ? "" : view.q, regex: view.regex, caseSensitive: view.caseSensitive }), [badRegex, view.q, view.regex, view.caseSensitive]);
  const counts = useMemo(() => ({ error: entries.filter((e) => e.level === "error").length, warn: entries.filter((e) => e.level === "warn").length }), [entries]);
  const sources = useMemo(() => [...new Set([...(page?.sources ?? []), ...liveSources, ...view.sources])].sort(), [page, liveSources, view.sources]);
  const activeLevels = view.levels.length ? view.levels : LOG_LEVELS;
  const filtered = !!view.q || view.levels.length > 0 || view.sources.length > 0;

  const toggleLevel = (level: LogLevel) => {
    const next = activeLevels.includes(level) ? activeLevels.filter((l) => l !== level) : [...activeLevels, level];
    update({ level: next.length === LOG_LEVELS.length ? null : LOG_LEVELS.filter((l) => next.includes(l)).join(",") });
  };
  const toggleSource = (source: string, on: boolean) => {
    const next = on ? [...view.sources, source] : view.sources.filter((s) => s !== source);
    update({ source: next.length ? next.join(",") : null });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(entries.map(logLine).join("\n")); toast.success(`Copied ${entries.length.toLocaleString()} line${entries.length === 1 ? "" : "s"}`); }
    catch { toast.error("The browser did not allow copying. Select the lines and copy them instead."); }
  };
  const download = async () => {
    try { await downloadLogs(filtersOf(view)); } catch (e: any) { toast.error(`Could not download the logs: ${e.message}`); }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Everything the agent process writes, as its terminal shows it. New lines appear live; earlier ones are kept in daily files for {page?.retentionDays ?? 7} days
        {page?.dir && <> in <span className="break-all font-mono text-xs">{page.dir}</span></>}. Keys and tokens are masked.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 basis-full sm:basis-auto sm:min-w-64 sm:flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input ref={searchBox} aria-label="Search the logs" placeholder="Search the logs (press / )" value={search} spellCheck={false}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setSearch(""); }}
            aria-invalid={badRegex || undefined} aria-describedby={badRegex ? "console-regex-error" : undefined} className="pl-8 pr-16 font-mono" />
          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-0.5">
            <Toggle label="Match case" pressed={view.caseSensitive} onClick={() => update({ case: view.caseSensitive ? null : "1" })}>Aa</Toggle>
            <Toggle label="Regular expression" pressed={view.regex} onClick={() => update({ regex: view.regex ? null : "1" })}>.*</Toggle>
          </div>
        </div>
        <Select value={view.range} onValueChange={(v) => update({ range: v === DEFAULT_RANGE ? null : v, ...(v === "custom" ? {} : { from: null, to: null }) })}>
          <SelectTrigger aria-label="Time range" className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{RANGES.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}</SelectContent>
        </Select>
        {view.range === "custom" && <>
          <Input type="datetime-local" aria-label="From" value={view.from} onChange={(e) => update({ from: e.target.value || null })} className="w-auto" />
          <Input type="datetime-local" aria-label="To, or blank for now" title="Leave blank to follow new lines" value={view.to} onChange={(e) => update({ to: e.target.value || null })} className="w-auto" />
        </>}
        <div role="group" aria-label="Levels shown" className="flex gap-1">
          {LOG_LEVELS.map((level) => {
            const on = activeLevels.includes(level);
            return (
              <Button key={level} type="button" size="sm" variant={on ? "secondary" : "ghost"} aria-pressed={on} disabled={on && activeLevels.length === 1}
                onClick={() => toggleLevel(level)} className={cn(on ? "" : "text-muted-foreground line-through decoration-muted-foreground/50")}>{LEVEL_NAME[level]}</Button>
            );
          })}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="max-w-60"><span className="truncate">{view.sources.length ? `Sources: ${view.sources.join(", ")}` : "All sources"}</span><ChevronDown /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
            <DropdownMenuLabel>Sources in this range</DropdownMenuLabel>
            <DropdownMenuCheckboxItem checked={!view.sources.length} onSelect={(e) => e.preventDefault()} onCheckedChange={() => update({ source: null })}>All sources</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            {sources.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">None yet: no lines in this range.</p>}
            {sources.map((s) => (
              <DropdownMenuCheckboxItem key={s} checked={view.sources.includes(s)} onSelect={(e) => e.preventDefault()} onCheckedChange={(on) => toggleSource(s, on === true)} className="font-mono">{s}</DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {badRegex && <p id="console-regex-error" className="text-xs text-red-700 dark:text-red-400">That is not a valid regular expression, so the lines shown are from the last search that was.</p>}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <p aria-live="polite">
          {loading ? "Reading the agent's logs" : `${entries.length.toLocaleString()} line${entries.length === 1 ? "" : "s"}`}
          {counts.error > 0 && ` · ${counts.error.toLocaleString()} error${counts.error === 1 ? "" : "s"}`}
          {counts.warn > 0 && ` · ${counts.warn.toLocaleString()} warning${counts.warn === 1 ? "" : "s"}`}
          {page?.truncated && !loading && ` · the newest ${HISTORY_LIMIT.toLocaleString()} matching lines; narrow the range or search to see older ones`}
          {trimmed && ` · older lines left the view; download to keep them all`}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1"><LiveState live={live} state={stream} paused={paused} pending={pending} /></span>
          {live && <IconButton label={paused ? "Resume the live tail" : "Pause the live tail"} onClick={() => (paused ? resume() : setPaused(true))}>{paused ? <Play /> : <Pause />}</IconButton>}
          <IconButton label={wrap ? "Show long lines on one line" : "Wrap long lines"} aria-pressed={wrap} onClick={() => { setWrap(!wrap); savePref("wrap", wrap ? "off" : "on"); }}><WrapText /></IconButton>
          <Select value={timeFormat} onValueChange={(v) => { setTimeFormat(v as TimeFormat); savePref("time", v); setNow(Date.now()); }}>
            <SelectTrigger size="sm" aria-label="Timestamps" className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="local">Local time</SelectItem>
              <SelectItem value="utc">UTC</SelectItem>
              <SelectItem value="relative">Time ago</SelectItem>
            </SelectContent>
          </Select>
          <IconButton label="Copy the lines shown" onClick={copy} disabled={!entries.length}><Copy /></IconButton>
          <IconButton label="Download every matching line as a .log file" onClick={download}><Download /></IconButton>
          <IconButton label="Clear the view (the log files are kept)" onClick={() => { setEntries([]); setTrimmed(false); setExpanded(new Set()); setCleared(true); }} disabled={!entries.length}><Eraser /></IconButton>
        </div>
      </div>

      <div className="relative">
        <div ref={panel} onScroll={onScroll} role="log" aria-live="off" aria-label="Agent log lines" tabIndex={0}
          style={{ "--time": TIME_WIDTH[timeFormat], "--message": wrap ? "minmax(0,1fr)" : "max-content" } as React.CSSProperties}
          className="h-[60svh] overflow-auto rounded-lg border bg-muted/30 py-2 font-mono text-xs leading-5 focus-visible:outline-2 focus-visible:outline-ring sm:h-[calc(100svh-17rem)] sm:min-h-80">
          {error
            ? <div role="alert" className="flex flex-wrap items-center gap-3 px-3 font-sans text-sm">
                <span className="text-red-700 dark:text-red-400">Could not read the logs: {error}</span>
                <Button size="sm" variant="outline" onClick={() => setReload((n) => n + 1)}><RefreshCw /> Try again</Button>
              </div>
            : loading && !entries.length
              ? <p className="px-3 text-muted-foreground">Reading the agent's logs</p>
              : !entries.length
                ? <div className="flex flex-wrap items-center gap-3 px-3 font-sans text-sm text-muted-foreground">
                    {cleared
                      ? <span>View cleared. New lines appear here as the agent writes them; the log files still hold the earlier ones.</span>
                      : filtered
                      ? <><span>No lines match these filters in this range.</span><Button size="sm" variant="outline" onClick={() => { setSearch(""); update({ q: null, level: null, source: null }); }}>Clear the filters</Button></>
                      : <span>{live ? "No lines in this range yet. New ones appear here as the agent writes them." : "The agent wrote nothing in this range."}</span>}
                  </div>
                : <div className={cn(!wrap && "min-w-max")}>
                    {entries.map((e, i) => (
                      <Fragment key={e.id}>
                        {i > 0 && entries[i - 1]!.run !== e.run && (
                          <div className="my-1 flex items-center gap-3 px-3 text-muted-foreground"><span className="h-px flex-1 bg-border" />Agent started {runStart(e.run).toLocaleString()}<span className="h-px flex-1 bg-border" /></div>
                        )}
                        <Row entry={e} timeFormat={timeFormat} now={timeFormat === "relative" ? now : 0} wrap={wrap} search={searchShown} expanded={expanded.has(e.id)} onToggle={toggleRow} />
                      </Fragment>
                    ))}
                  </div>}
        </div>
        {!following && entries.length > 0 && (
          <Button size="sm" variant="secondary" className="absolute bottom-3 right-4 shadow-md" onClick={() => setFollowing(true)}><ArrowDown /> Jump to the newest line</Button>
        )}
      </div>
    </div>
  );
}
