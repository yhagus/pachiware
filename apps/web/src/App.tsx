import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { KeyGate } from "@/components/KeyGate";
import { SetupWizard } from "@/components/SetupWizard";
import { Overview } from "@/pages/Overview";
import { Tenants } from "@/pages/Tenants";
import { TenantDetail } from "@/pages/TenantDetail";
import { TenantBots } from "@/pages/tenant/TenantBots";
import { IntegrationDetail } from "@/pages/tenant/IntegrationDetail";
import { IntegrationServers } from "@/pages/tenant/IntegrationServers";
import { TenantSkills } from "@/pages/tenant/TenantSkills";
import { TenantWorkspace } from "@/pages/tenant/TenantWorkspace";
import { TenantSettings } from "@/pages/tenant/TenantSettings";
import { IntegrationGitAccess } from "@/pages/tenant/IntegrationGitAccess";
import { IntegrationAvailability } from "./pages/tenant/IntegrationAvailability";
import { IntegrationReminders } from "@/pages/tenant/IntegrationReminders";
import { TenantProfiles } from "@/pages/tenant/TenantProfiles";
import { TenantGitAccounts } from "@/pages/tenant/TenantGitAccounts";
import { TenantPlaneAccounts } from "@/pages/tenant/TenantPlaneAccounts";
import { IntegrationPlaneAccess } from "@/pages/tenant/IntegrationPlaneAccess";
// Its own chunk: AI Elements' Markdown, highlighting and animation load when the Playground is opened.
const IntegrationPlayground = lazy(() => import("@/pages/tenant/IntegrationPlayground").then((m) => ({ default: m.IntegrationPlayground })));
import { GitRepos, GitRepoDetail } from "@/pages/tenant/GitBrowse";
import { ApiKeys } from "@/pages/ApiKeys";
import { Settings } from "@/pages/Settings";
import { Console } from "@/pages/Console";
import { Toaster } from "@/components/ui/sonner";
import { api, connectLocalConsole, getPlatformKey, type HealthResponse } from "@/lib/api";

export default function App() {
  const [ready, setReady] = useState(false);
  const [hasKey, setHasKey] = useState(!!getPlatformKey());
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const refresh = () => api.getHealth().then(setHealth).catch(() => setHealth(null));

  useEffect(() => {
    const sync = () => setHasKey(!!getPlatformKey());
    window.addEventListener("pachiware:credentials", sync);
    void connectLocalConsole().then(() => { sync(); setReady(true); });
    return () => window.removeEventListener("pachiware:credentials", sync);
  }, []);
  useEffect(() => { void refresh(); }, [hasKey]);

  if (!ready) return <div className="grid min-h-screen place-items-center text-muted-foreground">Connecting…</div>;
  if (!hasKey) return <KeyGate />;
  if (health?.setupRequired) return <SetupWizard onDone={refresh} />;

  return (
    <>
      <Routes>
        <Route element={<AppShell health={health} />}>
          <Route index element={<Overview />} />
          <Route path="tenants" element={<Tenants />} />
          <Route path="tenants/:id" element={<TenantDetail />}>
            <Route index element={<Navigate to="integrations" replace />} />
            <Route path="integrations" element={<TenantBots />} />
            <Route path="profiles" element={<TenantProfiles />} />
            <Route path="git-accounts" element={<TenantGitAccounts />} />
            <Route path="plane-accounts" element={<TenantPlaneAccounts />} />
            <Route path="skills" element={<TenantSkills />} />
            <Route path="workspace" element={<TenantWorkspace />} />
            <Route path="settings" element={<TenantSettings />} />
            <Route path="git-accounts/:accountId" element={<GitRepos />} />
            <Route path="git-accounts/:accountId/repo" element={<GitRepoDetail />} />
            <Route path="integrations/:botId" element={<IntegrationDetail />}>
              <Route index element={<Navigate to="servers" replace />} />
              <Route path="servers" element={<IntegrationServers />} />
              <Route path="git-access" element={<IntegrationGitAccess />} />
              <Route path="plane-access" element={<IntegrationPlaneAccess />} />
              <Route path="availability" element={<IntegrationAvailability />} />
              <Route path="reminders" element={<IntegrationReminders />} />
              <Route path="playground" element={<Suspense fallback={<Skeleton className="h-96" />}><IntegrationPlayground /></Suspense>} />
            </Route>
          </Route>
          <Route path="api-keys" element={<ApiKeys />} />
          <Route path="console" element={<Console />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}
