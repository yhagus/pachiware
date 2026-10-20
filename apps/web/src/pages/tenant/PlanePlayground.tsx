import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type PlaneAccount, type PlaneCheck, type PlaneChecks, type PlaneProject } from "@/lib/api";
import { planeHost } from "@/lib/plane";
import { STATUS } from "./ProfilePlayground";

const STEPS = [["url", "Base URL"], ["version", "Plane version"], ["key", "API key"]] as const;

function Step({ label, check }: { label: string; check: PlaneCheck }) {
  const { Icon, tone, word } = STATUS[check.status];
  return (
    <li className="flex gap-2.5 px-3 py-2">
      <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${tone}`} />
      <p className="min-w-0 flex-1 break-words"><span className="font-medium">{label}</span><span className="sr-only"> {word}:</span> <span className={check.status === "failed" ? "text-destructive" : check.status === "skipped" ? "text-muted-foreground" : ""}>{check.message}</span></p>
    </li>
  );
}

/** The Test steps in order; `workspaces` adds a step per listed Plane workspace, which the account form shows in its own rows instead. */
export function PlaneChecklist({ checks, workspaces = true }: { checks: PlaneChecks; workspaces?: boolean }) {
  return (
    <ol role="status" aria-label="Test results" className="divide-y rounded-md border text-sm">
      {STEPS.map(([key, label]) => <Step key={key} label={label} check={checks[key]} />)}
      {workspaces && checks.workspaces.map((w) => <Step key={w.slug} label={`Plane workspace ${w.slug}${w.enabled ? "" : " (off)"}`} check={w} />)}
    </ol>
  );
}

/** A listed Plane workspace's last Test result, under its slug in the account form. */
export function WorkspaceResult({ check }: { check: PlaneCheck }) {
  const { Icon, tone, word } = STATUS[check.status];
  return (
    <p className={`flex items-start gap-1.5 text-xs ${check.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
      <Icon aria-hidden className={`mt-px size-3.5 shrink-0 ${tone}`} /><span className="min-w-0 break-words"><span className="sr-only">Test {word}: </span>{check.message}</span>
    </p>
  );
}

/** Runs the Test checks on a saved Plane account and lists the Plane projects of one of its Plane workspaces, without opening its form. */
export function PlanePlayground({ account, onClose }: { account: PlaneAccount | null; onClose: () => void }) {
  const [checks, setChecks] = useState<PlaneChecks | null>(null);
  const [checking, setChecking] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [projects, setProjects] = useState<PlaneProject[] | { error: string } | null>(null);
  // A later choice's answer replaces an earlier one's only if it was asked later.
  const asked = useRef(0);
  useEffect(() => { setChecks(null); setWorkspace(""); setProjects(null); }, [account?.id]);
  if (!account) return null;

  const runChecks = async () => {
    setChecking(true);
    try { setChecks((await api.testPlaneAccount({ accountId: account.id, baseUrl: account.baseUrl, planeVersion: account.planeVersion, workspaces: account.workspaces })).checks); }
    catch (e: any) { toast.error(e.message); } finally { setChecking(false); }
  };
  const listProjects = (slug: string) => {
    const n = ++asked.current;
    setWorkspace(slug); setProjects(null);
    api.listPlaneProjects(account.id, slug).then((r) => { if (n === asked.current) setProjects(r.projects); }).catch((e) => { if (n === asked.current) setProjects({ error: e.message }); });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Playground: {account.name}</DialogTitle>
          <DialogDescription>{planeHost(account.baseUrl)}, as {account.planeUserName}. Runs on the saved settings, so save the account first to try a change.</DialogDescription>
        </DialogHeader>

        <section aria-labelledby="ppg-connection" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 id="ppg-connection" className="text-sm font-medium">Connection</h3>
            <Button type="button" variant="outline" disabled={checking} onClick={runChecks}>{checking ? "Checking…" : checks ? "Check again" : "Run checks"}</Button>
          </div>
          {checks
            ? <PlaneChecklist checks={checks} />
            : <p className="text-sm text-muted-foreground">Checks the base URL, the Plane version against the release Plane reports, the API key, and each listed Plane workspace, in that order.</p>}
        </section>

        <section aria-labelledby="ppg-projects" className="space-y-3 border-t pt-5">
          <h3 id="ppg-projects" className="text-sm font-medium">Plane projects</h3>
          <div className="space-y-2"><Label htmlFor="ppg-workspace">Plane workspace</Label>
            <Select value={workspace} onValueChange={listProjects}>
              <SelectTrigger id="ppg-workspace" className="w-full"><SelectValue placeholder="Choose a Plane workspace" /></SelectTrigger>
              <SelectContent>{account.workspaces.map((w) => <SelectItem key={w.slug} value={w.slug}><span className="font-mono">{w.slug}</span>{!w.enabled && <span className="text-xs text-muted-foreground">switched off</span>}</SelectItem>)}</SelectContent>
            </Select></div>
          {!workspace ? <p className="text-sm text-muted-foreground">Lists the Plane projects the account's Plane user can see in the chosen workspace, as integrations would.</p>
            : projects === null ? <p role="status" className="text-sm text-muted-foreground">Loading Plane projects</p>
            : "error" in projects ? <p role="alert" className="text-sm text-destructive">Could not list Plane projects: {projects.error}</p>
            : projects.length === 0 ? <p className="text-sm text-muted-foreground">This account's Plane user sees no Plane projects in {workspace}. Add the user to a Plane project there first.</p>
            : <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
                {projects.map((p) => <li key={p.id} className="flex gap-3 px-3 py-2"><span className="w-16 shrink-0 font-mono text-xs leading-5 text-muted-foreground">{p.identifier}</span><span className="min-w-0 break-words">{p.name}</span></li>)}
              </ul>}
        </section>
      </DialogContent>
    </Dialog>
  );
}
