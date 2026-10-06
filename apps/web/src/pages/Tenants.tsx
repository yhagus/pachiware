import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Pause, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/ConfirmAction";
import { label } from "@/lib/utils";
import { IconButton } from "@/components/IconButton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type ApiKey, type Tenant } from "@/lib/api";

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function Tenants() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [keyId, setKeyId] = useState("none");
  const keyName = (id: string | null) => keys.find((k) => k.id === id)?.name;
  const taken = !!slug && !!tenants?.some((t) => t.slug === slug);
  const load = useCallback(() => api.listTenants().then((r) => setTenants(r.tenants)).catch((e) => toast.error(e.message)), []);
  useEffect(() => { void load(); api.listApiKeys().then((r) => setKeys(r.apiKeys.filter((k) => !k.revokedAt))).catch(() => {}); }, [load]);

  const toggle = async (t: Tenant) => {
    try { await api.updateTenant(t.id, { status: t.status === "active" ? "suspended" : "active" }); await load(); }
    catch (e: any) { toast.error(e.message); }
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { tenant } = await api.createTenant(name, slug, keyId === "none" ? undefined : keyId);
      toast.success(`Created ${tenant.name}`); setOpen(false); setName(""); setSlug(""); setSlugEdited(false); setKeyId("none"); await load();
    } catch (err: any) { toast.error(err.message); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-semibold">Tenants</h1></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><IconButton label="New tenant" variant="default"><Plus /></IconButton></DialogTrigger>
          <DialogContent>
            <form onSubmit={create} className="space-y-5">
              <DialogHeader><DialogTitle>New tenant</DialogTitle><DialogDescription className="sr-only">Create a tenant</DialogDescription></DialogHeader>
              <div className="space-y-2"><Label htmlFor="n">Name</Label><Input id="n" required value={name} onChange={(e) => { setName(e.target.value); if (!slugEdited) setSlug(slugify(e.target.value)); }} /></div>
              <div className="space-y-2"><Label htmlFor="s">Slug</Label><Input id="s" value={slug} onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-")); }} pattern="[a-z0-9][a-z0-9_\-]*" aria-invalid={taken} />
                {taken && <p role="alert" className="text-xs text-destructive">This slug is already taken.</p>}</div>
              <div className="space-y-2"><Label htmlFor="k">API key</Label>
                <Select value={keyId} onValueChange={setKeyId}>
                  <SelectTrigger id="k" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">None</SelectItem>{keys.map((k) => <SelectItem key={k.id} value={k.id}>{k.name} · {k.keyPrefix}…</SelectItem>)}</SelectContent>
                </Select></div>
              <DialogFooter><Button disabled={taken}>Create</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid gap-3.75 md:grid-cols-2 xl:grid-cols-3">
        {tenants?.map((t) => (
          <Card key={t.id} className="py-5">
            <CardContent className="flex items-center gap-5">
              <Link to={`/tenants/${t.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="truncate font-medium">{t.name}</span>
                  <Badge variant={t.status === "active" ? "secondary" : "destructive"}>{label(t.status)}</Badge></div>
                <div className="truncate font-mono text-xs text-muted-foreground">{t.slug}{keyName(t.apiKeyId) && ` · ${keyName(t.apiKeyId)}`}</div>
              </Link>
              <div className="flex shrink-0 gap-1">
                <IconButton label="Manage" asChild><Link to={`/tenants/${t.id}`}><ArrowRight /></Link></IconButton>
                <ConfirmAction
                  trigger={<IconButton label={t.status === "active" ? "Suspend" : "Activate"} className={t.status === "active" ? "text-destructive hover:text-destructive" : ""}>{t.status === "active" ? <Pause /> : <Play />}</IconButton>}
                  title={t.status === "active" ? `Suspend ${t.name}?` : `Activate ${t.name}?`}
                  description={t.status === "active" ? "Its integrations stop responding until it is activated again." : "Its integrations resume."}
                  confirmLabel={t.status === "active" ? "Suspend" : "Activate"} danger={t.status === "active"} onConfirm={() => toggle(t)} />
              </div>
            </CardContent>
          </Card>
        ))}
        {tenants?.length === 0 && <p className="text-sm text-muted-foreground">No tenants yet.</p>}
      </div>
    </div>
  );
}
