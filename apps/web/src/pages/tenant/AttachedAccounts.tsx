import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type GitAccount, type PlaneAccount } from "@/lib/api";
import { useIntegration } from "./IntegrationDetail";

export type AccountOption = { id: string; name: string; detail: string };
export const gitOption = (a: GitAccount): AccountOption => ({ id: a.id, name: a.name, detail: a.username });
export const planeOption = (a: PlaneAccount): AccountOption =>
  ({ id: a.id, name: a.name, detail: a.workspaces.filter((w) => w.enabled).map((w) => w.slug).join(", ") || "every Plane workspace off" });

/** Checkboxes for the accounts an integration holds, as its form and its access pages show them. */
export function AccountChecklist({ options, value, onChange }: { options: AccountOption[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
      {options.map((o) => (
        <li key={o.id}><label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
          <input type="checkbox" className="size-4 cursor-pointer rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" checked={value.includes(o.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />{o.name} · {o.detail}
        </label></li>
      ))}
    </ul>
  );
}

/** The accounts of one kind this integration holds, changed in place. Detaching one also removes its server and channel rules. */
export function AttachedAccounts({ field, title, noun, page, help, options }: {
  field: "gitAccountIds" | "planeAccountIds"; title: string; noun: string; page: string; help: string; options: AccountOption[] | null;
}) {
  const { bot, tenant, setBot } = useIntegration();
  const saved = bot[field];
  const [ids, setIds] = useState(saved);
  const [busy, setBusy] = useState(false);
  // The integration is polled, so the draft follows the saved list only when that list changes.
  useEffect(() => { setIds(saved); }, [saved.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = ids.length !== saved.length || ids.some((id) => !saved.includes(id));
  const removed = (options ?? []).filter((o) => saved.includes(o.id) && !ids.includes(o.id)).map((o) => o.name);
  const save = async () => {
    setBusy(true);
    try { setBot((await api.updateBot(bot.id, { [field]: ids })).bot); toast.success(`${title} saved`); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Card className="py-5">
      <CardContent className="space-y-3">
        <div className="space-y-1"><h3 className="font-medium">{title}</h3><p className="text-xs text-muted-foreground">{help}</p></div>
        {!options ? <Skeleton className="h-16" />
          : !options.length ? <p className="text-sm text-muted-foreground">No {noun} yet. Add one under <Link to={`/tenants/${tenant.id}/${page}`} className="underline underline-offset-2">{title}</Link>.</p>
          : <AccountChecklist options={options} value={ids} onChange={setIds} />}
        {removed.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">Saving detaches {removed.join(", ")} and removes {removed.length > 1 ? "their" : "its"} server and channel rules.</p>}
        {!!options?.length && <div className="flex justify-end"><Button size="sm" disabled={!changed || busy} onClick={save}>{busy ? "Saving" : "Save"}</Button></div>}
      </CardContent>
    </Card>
  );
}
