import { Link, NavLink, Outlet, useLocation } from "react-router";
import { Bot, KeyRound, LayoutDashboard, LogOut, Settings, SquareTerminal, Users } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { clearPlatformKey, type HealthResponse } from "@/lib/api";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/tenants", label: "Tenants", icon: Users, end: false },
  { to: "/api-keys", label: "API Keys", icon: KeyRound, end: false },
  { to: "/console", label: "Console", icon: SquareTerminal, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];

export function AppShell({ health }: { health: HealthResponse | null }) {
  const { pathname } = useLocation();
  const title = NAV.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)))?.label ?? "";
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <Link to="/" className="flex items-center gap-2.5 px-2 py-2 font-semibold">
            <Bot className="size-5" /> Pachiware <Badge variant="secondary">Console</Badge>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup><SidebarGroupContent><SidebarMenu>
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <SidebarMenuItem key={to}>
                <NavLink to={to} end={end}>
                  {({ isActive }) => (
                    <SidebarMenuButton asChild isActive={isActive}><span><Icon /> {label}</span></SidebarMenuButton>
                  )}
                </NavLink>
              </SidebarMenuItem>
            ))}
          </SidebarMenu></SidebarGroupContent></SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <div className="flex items-center justify-between px-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${health?.status === "ok" ? "bg-emerald-500" : "bg-amber-500"}`} />
              {health?.status === "ok" ? "Operational" : "Degraded"}
            </span>
            <button onClick={clearPlatformKey} title="Forget platform key" className="hover:text-foreground"><LogOut className="size-4" /></button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex h-14 items-center gap-2 border-b px-5">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">{title}</span>
        </header>
        <main className="flex-1 p-5 sm:p-7.5"><div key={pathname.split("/").slice(0, 3).join("/")} className="animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none"><Outlet /></div></main>
      </SidebarInset>
    </SidebarProvider>
  );
}
