import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ChevronLeft, ExternalLink, GitBranch, GitMerge, GitPullRequest, Lock, Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type GitPage, type GitRepoItem, type GitTab } from "@/lib/api";

const ago = (iso: string | null) => {
  if (!iso) return "";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d < 1 ? "today" : d < 31 ? `${d}d ago` : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

// Pages are fetched on demand; "Load more" appends the next one.
function usePages<T>(fetchPage: (page: number) => Promise<GitPage<T>>, deps: unknown[]) {
  const [items, setItems] = useState<T[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [contributorsOnly, setContributorsOnly] = useState(false);
  const latest = useRef(0);
  const run = useCallback(async (p: number) => {
    const mine = ++latest.current; // a newer request (tab or filter changed) makes this one stale
    setBusy(true);
    try {
      const r = await fetchPage(p);
      if (mine !== latest.current) return;
      setItems((cur) => (p === 1 ? r.items : [...(cur ?? []), ...r.items])); setHasMore(r.hasMore); setContributorsOnly(!!r.contributorsOnly); setPage(p); setError("");
    } catch (e: any) { if (mine === latest.current) setError(e.message); }
    finally { if (mine === latest.current) setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { setItems(null); setError(""); void run(1); }, [run]);
  // A failed "Load more" retries the next page, not the last one already shown.
  return { items, error, busy, hasMore, contributorsOnly, more: () => run(page + 1), retry: () => run(items ? page + 1 : 1) };
}

function ListState({ error, items, retry, empty }: { error: string; items: unknown[] | null; retry: () => void; empty: string }) {
  if (error) return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/50 p-4 text-sm">
      <span className="text-destructive">{error}</span><Button variant="outline" size="sm" onClick={retry}>Retry</Button>
    </div>);
  if (!items) return <div role="status" className="space-y-2"><span className="sr-only">Loading</span>{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>;
  if (items.length === 0) return <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">{empty}</p>;
  return null;
}
function LoadMore({ count, hasMore, busy, onClick }: { count: number; hasMore: boolean; busy: boolean; onClick: () => void }) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
      <span aria-live="polite" className="text-xs text-muted-foreground">{count} loaded{hasMore ? "" : " · all shown"}</span>
      {hasMore && <Button variant="outline" disabled={busy} onClick={onClick}>{busy ? "Loading" : "Load more"}</Button>}
    </div>
  );
}

export function GitRepos() {
  const { accountId = "" } = useParams();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState(""); // debounced q: the server search runs on this
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 400); return () => clearTimeout(t); }, [q]);
  const { items, error, busy, hasMore, more, retry } = usePages<GitRepoItem>((p) => api.listGitRepos(accountId, p, term), [accountId, term]);
  // Group by owner/namespace, matching how both providers organise repositories.
  const groups = useMemo(() => {
    const map = new Map<string, GitRepoItem[]>();
    for (const r of items ?? []) map.set(r.owner, [...(map.get(r.owner) ?? []), r]);
    return [...map.entries()];
  }, [items]);
  return (
    <div className="space-y-5">
      <Link to=".." relative="path" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Git accounts</Link>
      <div className="relative max-w-sm"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input className="pl-9" placeholder="Search repositories" aria-label="Search repositories" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ListState error={error} items={items} retry={retry} empty={term ? `No repository matches "${term}".` : "This account has no repositories."} />
      {hasMore && items && items.length > 0 && <p className="text-xs text-muted-foreground">Groups list only the repositories loaded so far; load more to complete them.</p>}
      {groups.map(([owner, repos]) => (
        <section key={owner} aria-label={owner} className="space-y-2">
          <h2 className="text-sm font-medium">{owner} <span className="font-normal text-muted-foreground">{repos.length}</span></h2>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {repos.map((r) => (
              <li key={r.repo} className="relative rounded-lg border p-3.75 hover:bg-muted/40">
                <Link to={`repo?${new URLSearchParams({ repo: r.repo })}`} className="flex items-center gap-1.5 truncate font-medium after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
                  {r.private && <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Private" />}<span className="truncate">{r.repo.slice(owner.length + 1)}</span>
                </Link>
                {r.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.description}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {r.archived && <Badge variant="outline">Archived</Badge>}{r.fork && <Badge variant="outline">Fork</Badge>}
                  <span>{ago(r.updatedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <LoadMore count={items?.length ?? 0} hasMore={hasMore} busy={busy} onClick={more} />
    </div>
  );
}

const TABS: { id: GitTab; label: string; icon: typeof Users }[] = [
  { id: "members", label: "Members", icon: Users }, { id: "issues", label: "Issues", icon: GitPullRequest },
  { id: "merge-requests", label: "Merge requests", icon: GitMerge }, { id: "branches", label: "Branches", icon: GitBranch },
];
const STATEFUL: GitTab[] = ["issues", "merge-requests"];

function Row({ children, href }: { children: React.ReactNode; href?: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <div className="min-w-0 flex-1 space-y-1">{children}</div>
      {href && <a href={href} target="_blank" rel="noreferrer" aria-label="Open on provider" className="-my-2.5 -mr-2 grid size-11 shrink-0 place-items-center text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><ExternalLink className="size-4" /></a>}
    </li>
  );
}
const Labels = ({ labels }: { labels?: string[] }) => <>{labels?.map((l) => <Badge key={l} variant="outline">{l}</Badge>)}</>;

function TabBody({ accountId, repo, tab, state }: { accountId: string; repo: string; tab: GitTab; state: string }) {
  const { items, error, busy, hasMore, contributorsOnly, more, retry } = usePages<any>((p) => api.getGitRepoTab(accountId, tab, repo, p, state), [accountId, repo, tab, state]);
  const empty = { members: "No members visible to this account.", issues: "No issues.", "merge-requests": "Nothing here.", branches: "No branches." }[tab];
  return (
    <div className="space-y-2">
      {tab === "members" && contributorsOnly && <p className="rounded-md border p-3 text-xs text-muted-foreground">This token cannot list collaborators (that needs push access), so these are the repository's contributors, not necessarily everyone with access.</p>}
      <ListState error={error} items={items} retry={retry} empty={empty} />
      {items && items.length > 0 && <ul className="space-y-2">
        {items.map((it, i) => tab === "members" ? (
          <Row key={it.username + i} href={it.url}><div className="flex items-center gap-2.5">
            {it.avatarUrl && <img src={it.avatarUrl} alt="" className="size-6 rounded-full" loading="lazy" />}
            <span className="break-all font-medium">{it.username}</span>{it.name && <span className="text-muted-foreground">{it.name}</span>}<Badge variant="secondary">{it.role}</Badge></div></Row>
        ) : tab === "branches" ? (
          <Row key={it.name}><div className="flex flex-wrap items-center gap-2"><code className="break-all font-mono text-xs">{it.name}</code>
            {it.default && <Badge variant="secondary">Default</Badge>}{it.protected && <Badge variant="outline">Protected</Badge>}</div></Row>
        ) : (
          <Row key={it.number} href={it.url}>
            <div className="flex flex-wrap items-center gap-2"><span className="break-words font-medium">{it.title}</span>
              {it.draft && <Badge variant="outline">Draft</Badge>}
              {tab === "merge-requests" && <Badge variant={it.merged ? "secondary" : "outline"}>{it.merged ? "Merged" : it.state === "closed" ? "Closed" : "Open"}</Badge>}
              {tab === "issues" && it.state === "closed" && <Badge variant="outline">Closed</Badge>}<Labels labels={it.labels} /></div>
            <p className="break-words text-xs text-muted-foreground">#{it.number}{it.author ? ` by ${it.author}` : ""} · {ago(it.createdAt)}{it.source ? ` · ${it.source} → ${it.target}` : ""}</p>
          </Row>
        ))}
      </ul>}
      <LoadMore count={items?.length ?? 0} hasMore={hasMore} busy={busy} onClick={more} />
    </div>
  );
}

export function GitRepoDetail() {
  const { accountId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const repo = params.get("repo") ?? "";
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "members") as GitTab;
  const state = params.get("state") ?? "open";
  const set = (patch: Record<string, string>) => setParams({ repo, tab, state, ...patch }, { replace: true });
  return (
    <div className="space-y-5">
      <Link to=".." relative="path" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Repositories</Link>
      <h2 className="break-all text-lg font-semibold">{repo}</h2>
      <Tabs value={tab} onValueChange={(v) => set({ tab: v })} className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList variant="line" aria-label="Repository sections" className="max-w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto">
            {TABS.map(({ id, label, icon: Icon }) => (
              <TabsTrigger key={id} value={id} className="min-h-11 flex-none px-3 sm:min-h-9"><Icon /> {label}</TabsTrigger>
            ))}
          </TabsList>
          {STATEFUL.includes(tab) && (
            <Select value={state} onValueChange={(v) => set({ state: v })}>
              <SelectTrigger aria-label="State" className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="closed">Closed</SelectItem><SelectItem value="all">All</SelectItem></SelectContent>
            </Select>)}
        </div>
        <TabsContent value={tab}>
          {repo ? <TabBody accountId={accountId} repo={repo} tab={tab} state={state} /> : <p className="text-sm text-muted-foreground">No repository selected.</p>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
