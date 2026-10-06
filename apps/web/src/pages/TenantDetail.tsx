import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams, useLocation } from "react-router";
import { Brain, ChevronLeft, Pause, Play, Plug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/ConfirmAction";
import { label } from "@/lib/utils";
import { IconButton } from "@/components/IconButton";
import { api, type Tenant } from "@/lib/api";

// Add future tenant sections (skills, tasks, …) here.
const SECTIONS = [{ path: "integrations", label: "Integrations", icon: Plug }, { path: "profiles", label: "Profiles", icon: Brain }];

export function TenantDetail() {
  const { id = "" } = useParams();
  const { pathname } = useLocation();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api.getTenant(id).then((r) => setTenant(r.tenant)).catch((e) => setError(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async () => {
    if (!tenant) return;
    try {
      const next = tenant.status === "active" ? "suspended" : "active";
      setTenant((await api.updateTenant(id, { status: next })).tenant);
      toast.success(`Tenant ${next}`);
    } catch (e: any) { toast.error(e.message); }
  };

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!tenant) return null;
  return (
    <div className="space-y-7.5">
      <Link to="/tenants" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" /> Tenants</Link>
      <div className="flex flex-wrap items-center justify-between gap-3.75">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">{tenant.name} <Badge variant={tenant.status === "active" ? "secondary" : "destructive"}>{label(tenant.status)}</Badge></h1>
          <p className="font-mono text-xs text-muted-foreground">{tenant.slug} · {tenant.id}</p>
        </div>
        <ConfirmAction
          trigger={<IconButton label={tenant.status === "active" ? "Suspend" : "Activate"} variant="outline" className={tenant.status === "active" ? "text-destructive hover:text-destructive" : ""}>{tenant.status === "active" ? <Pause /> : <Play />}</IconButton>}
          title={tenant.status === "active" ? `Suspend ${tenant.name}?` : `Activate ${tenant.name}?`}
          description={tenant.status === "active" ? "Its integrations stop responding until it is activated again." : "Its integrations resume."}
          confirmLabel={tenant.status === "active" ? "Suspend" : "Activate"} danger={tenant.status === "active"} onConfirm={toggle} />
      </div>
      <nav className="flex gap-1 border-b">
        {SECTIONS.map(({ path, label, icon: Icon }) => (
          <NavLink key={path} to={path} className={({ isActive }) => `-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${isActive ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            <Icon className="size-4" /> {label}
          </NavLink>
        ))}
      </nav>
      <div key={pathname.split("/").slice(0, 4).join("/")} className="animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none"><Outlet context={tenant} /></div>
    </div>
  );
}
