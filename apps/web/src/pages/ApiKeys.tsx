import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ConfirmAction";
import { IconButton } from "@/components/IconButton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type ApiKey } from "@/lib/api";

const date = (s: string | null) => (s ? new Date(s).toLocaleString() : "Never");

export function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState("");
  const [copied, setCopied] = useState(false);
  const load = useCallback(() => api.listApiKeys().then((r) => setKeys(r.apiKeys.sort((a, b) => b.createdAt.localeCompare(a.createdAt)))).catch((e) => toast.error(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try { setCreated((await api.createApiKey(name.trim() || "API Key")).raw); setCreating(false); setName(""); await load(); }
    catch (err: any) { toast.error(err.message); }
  };
  const revoke = async (k: ApiKey) => {
    try { await api.revokeApiKey(k.id); toast.success("Key revoked"); await load(); } catch (e: any) { toast.error(e.message); }
  };
  const copy = () => navigator.clipboard.writeText(created).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => toast.error("Copy failed"));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">API Keys</h1>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Keys authenticate against <code className="font-mono text-xs">/api/v1</code> and have full access. A key reaches only the tenants created under it; pick the tenant with the <code className="font-mono text-xs">X-Tenant-Id</code> header.</p>
        <Button onClick={() => setCreating(true)}><Plus /> New key</Button>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Key</TableHead><TableHead>Status</TableHead><TableHead>Tenants</TableHead><TableHead>Last used</TableHead><TableHead>Created</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
          <TableBody>
            {keys?.map((k) => (
              <TableRow key={k.id} className={k.revokedAt ? "opacity-60" : ""}>
                <TableCell className="font-medium">{k.name}</TableCell>
                <TableCell className="font-mono text-xs">{k.keyPrefix}…</TableCell>
                <TableCell><Badge variant={k.revokedAt ? "destructive" : "secondary"}>{k.revokedAt ? "Revoked" : "Active"}</Badge></TableCell>
                <TableCell className="text-xs">{k.tenantCount}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{date(k.lastUsedAt)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{date(k.createdAt)}</TableCell>
                <TableCell className="text-right">
                  {!k.revokedAt && <ConfirmAction trigger={<IconButton label="Revoke" className="text-destructive hover:text-destructive"><Trash2 /></IconButton>}
                    title={`Revoke ${k.name}?`} description="Anything using this key stops working immediately. Its tenants stay, but nothing can reach them through it. This can't be undone." confirmLabel="Revoke" danger onConfirm={() => revoke(k)} />}
                </TableCell>
              </TableRow>
            ))}
            {keys?.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No API keys yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <form onSubmit={create} className="space-y-5">
            <DialogHeader><DialogTitle>New API key</DialogTitle><DialogDescription className="sr-only">Create an API key</DialogDescription></DialogHeader>
            <div className="space-y-2"><Label htmlFor="kn">Name</Label><Input id="kn" placeholder="e.g. Production" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <DialogFooter><Button>Create</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated("")}>
        <DialogContent>
          <DialogHeader><DialogTitle>Copy your key now</DialogTitle><DialogDescription>It is shown only once. Store it somewhere safe.</DialogDescription></DialogHeader>
          <div className="flex items-center gap-1 rounded-md border p-2">
            <code className="min-w-0 flex-1 break-all font-mono text-xs">{created}</code>
            <IconButton label={copied ? "Copied" : "Copy"} onClick={copy}>{copied ? <Check /> : <Copy />}</IconButton>
          </div>
          <DialogFooter><Button onClick={() => setCreated("")}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
