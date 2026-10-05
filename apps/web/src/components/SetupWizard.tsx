import React, { useState } from "react";
import { Database, AlertCircle, ArrowRight } from "lucide-react";
import { api, getApiKey, getPlatformKey, setCredentials } from "../lib/api.js";
import { OperatorCredentials } from "./OperatorCredentials.js";

export function SetupWizard({ onConnected }: { onConnected: () => void }) {
  const [databaseKind, setDatabaseKind] = useState<"sqlite" | "postgres" | "docker">("sqlite");
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [name, setName] = useState("Default Tenant");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const run = async (operation: () => Promise<void>) => { setBusy(true); setNotice(""); try { await operation(); } catch (err: any) { setNotice(err.message); } finally { setBusy(false); } };
  const setup = async (event: React.FormEvent) => {
    event.preventDefault();
    await run(async () => {
      if (!getPlatformKey()) throw new Error("Enter your platform admin key and select Connect first.");
      const selectedUrl = databaseKind === "sqlite"
        ? "sqlite:./data/pachiware.db"
        : databaseKind === "docker"
          ? "postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent"
          : databaseUrl.trim();
      if (!selectedUrl) throw new Error("Enter a PostgreSQL URL or choose SQLite.");
      if (databaseKind !== "sqlite") {
        if (databaseKind === "docker") setNotice("PostgreSQL 18 Docker mode selected. Start `pachiware start --docker` before reconnecting.");
        await api.updateInfrastructure({ databaseUrl: selectedUrl });
      } else if (databaseUrl.trim()) {
        await api.updateInfrastructure({ databaseUrl: selectedUrl });
      }
      let { tenants } = await api.listTenants();
      let tenantId = tenants[0]?.id;
      if (!tenantId) tenantId = (await api.createTenant(name, "default")).tenant.id;
      const key = await api.issueApiKey(tenantId);
      setCredentials(key.raw, getPlatformKey());
      onConnected();
    });
  };
  return <div className="min-h-screen bg-[#0B0F19] text-slate-100 flex justify-center items-center p-4">
    <div className="w-full max-w-2xl space-y-6">
      <div className="text-center"><Database className="mx-auto text-indigo-400 mb-4" size={32} /><h1 className="text-3xl font-bold">Set up your operator console</h1><p className="text-sm text-slate-400 mt-3">Connect a data store and initialize your first tenant. SQLite is ready by default; PostgreSQL is optional.</p></div>
      <OperatorCredentials />
      {notice && <p role="status" className="p-4 rounded-xl border border-amber-500/30 text-amber-200 text-sm flex gap-2"><AlertCircle size={18} />{notice}</p>}
      <form onSubmit={setup} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-5">
        <fieldset className="space-y-3"><legend className="text-sm font-semibold">Choose your database</legend><div className="grid gap-3 sm:grid-cols-3">
          <label className={`cursor-pointer rounded-xl border p-4 ${databaseKind === "sqlite" ? "border-indigo-400 bg-indigo-500/10" : "border-slate-700 bg-slate-950"}`}><input className="sr-only" type="radio" name="database" checked={databaseKind === "sqlite"} onChange={() => setDatabaseKind("sqlite")} /><strong className="block">SQLite</strong><span className="mt-1 block text-xs text-slate-400">Recommended for one server. No Docker or database setup.</span></label>
          <label className={`cursor-pointer rounded-xl border p-4 ${databaseKind === "postgres" ? "border-indigo-400 bg-indigo-500/10" : "border-slate-700 bg-slate-950"}`}><input className="sr-only" type="radio" name="database" checked={databaseKind === "postgres"} onChange={() => setDatabaseKind("postgres")} /><strong className="block">PostgreSQL</strong><span className="mt-1 block text-xs text-slate-400">Use an existing local or cloud PostgreSQL 18 server.</span></label>
          <label className={`cursor-pointer rounded-xl border p-4 ${databaseKind === "docker" ? "border-indigo-400 bg-indigo-500/10" : "border-slate-700 bg-slate-950"}`}><input className="sr-only" type="radio" name="database" checked={databaseKind === "docker"} onChange={() => setDatabaseKind("docker")} /><strong className="block">Docker</strong><span className="mt-1 block text-xs text-slate-400">PostgreSQL 18 + Redis via `pachiware start --docker`.</span></label>
        </div></fieldset>
        {databaseKind === "postgres" && <label className="block text-sm">PostgreSQL URL<input required type="text" value={databaseUrl} onChange={(event) => setDatabaseUrl(event.target.value)} placeholder="postgresql://user:password@host:5432/database" className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm" /></label>}
        {databaseKind === "docker" && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">The browser cannot start Docker. Run <code>pachiware start --docker</code> in the server terminal, then return here and initialize.</p>}
        <label className="block text-sm">Tenant name<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm" /></label>
        <p className="text-xs text-slate-400">Use PLATFORM_ADMIN_KEY, or AGENT_SECRET_KEY when the platform key is unset. The issued tenant API key is saved in this browser. Platform credentials last for this browser session.</p>
        <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || databaseKind === "sqlite"} onClick={() => run(async () => { const result = await api.testPostgres({ databaseUrl: databaseKind === "docker" ? "postgresql://pachiware:pachiware_secret@localhost:5432/pachiware_agent" : databaseUrl.trim() }); setNotice(result.message); })} className="rounded-xl border border-slate-700 px-4 py-3 text-sm">Test PostgreSQL</button><button disabled={busy} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm flex items-center gap-2">{busy ? "Initializing..." : "Initialize tenant & connect"}<ArrowRight size={16} /></button></div>
      </form>
    </div>
  </div>;
}
