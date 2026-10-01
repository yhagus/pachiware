import React, { useState, useEffect } from "react";
import { Database, Server, CheckCircle2, AlertCircle, Save, Zap, Loader2, Shield, HardDrive } from "lucide-react";
import { api, type InfrastructureData, type HealthResponse } from "../lib/api.js";

interface InfrastructureConfigProps {
  health: HealthResponse | null;
  onRefreshHealth: () => void;
}

export const InfrastructureConfig: React.FC<InfrastructureConfigProps> = ({
  health,
  onRefreshHealth,
}) => {
  const [infra, setInfra] = useState<InfrastructureData | null>(null);
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [redisUrl, setRedisUrl] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingDb, setIsTestingDb] = useState(false);
  const [isTestingRedis, setIsTestingRedis] = useState(false);

  const [dbTestResult, setDbTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [redisTestResult, setRedisTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [successMsg, setSuccessMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchInfra = async () => {
    setIsLoading(true);
    try {
      const res = await api.getInfrastructure();
      if (res.infrastructure) {
        setInfra(res.infrastructure);
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to load infrastructure settings.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInfra();
  }, []);

  const handleTestDb = async () => {
    setIsTestingDb(true);
    setDbTestResult(null);
    try {
      const res = await api.testPostgres({ databaseUrl: databaseUrl.trim() || undefined });
      setDbTestResult({
        success: res.success,
        message: res.message,
      });
    } catch (err: any) {
      setDbTestResult({
        success: false,
        message: err.message || "Failed to ping PostgreSQL database.",
      });
    } finally {
      setIsTestingDb(false);
    }
  };

  const handleTestRedis = async () => {
    setIsTestingRedis(true);
    setRedisTestResult(null);
    try {
      const res = await api.testRedis();
      setRedisTestResult({
        success: res.success,
        message: res.message,
      });
    } catch (err: any) {
      setRedisTestResult({
        success: false,
        message: err.message || "Failed to ping Redis cache.",
      });
    } finally {
      setIsTestingRedis(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMsg(null);
    setSuccessMsg(false);

    try {
      const updates: { databaseUrl?: string; redisUrl?: string } = {};
      if (databaseUrl.trim()) updates.databaseUrl = databaseUrl.trim();
      if (redisUrl.trim()) updates.redisUrl = redisUrl.trim();

      const res = await api.updateInfrastructure(updates);
      setInfra(res.infrastructure);
      setSuccessMsg(true);
      setDatabaseUrl("");
      setRedisUrl("");
      onRefreshHealth();
      setTimeout(() => setSuccessMsg(false), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save infrastructure configuration.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-400" />
            Infrastructure & Data Stores (PostgreSQL & Redis)
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Manage database connections, Redis caching endpoints, and runtime store persistence.
          </p>
        </div>

        {successMsg && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Saved to runtime-config.json!</span>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          {errorMsg}
        </div>
      )}

      {/* Read-Only .env Protection Banner */}
      <div className="p-4 rounded-2xl bg-indigo-950/40 border border-indigo-500/30 text-xs text-slate-300 flex items-start gap-3.5">
        <Shield className="w-5 h-5 text-indigo-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-white flex items-center gap-2">
            <span>Non-Mutating Environment Policy</span>
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              Active Protection
            </span>
          </div>
          <p className="text-slate-300 leading-relaxed">
            As requested, your <code className="text-indigo-300 font-mono">.env</code> file is strictly read-only and used solely as an initial fallback when bootstrapping. Any configuration modifications made through this Web Management interface are stored in a dedicated, persistent <code className="text-indigo-300 font-mono">runtime-config.json</code> file on the server.
          </p>
        </div>
      </div>

      {/* Live Services Status */}
      <div className="grid grid-cols-2 gap-4">
        {/* PostgreSQL Card */}
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <Database className="w-4 h-4 text-indigo-400" />
              <span className="text-sm font-bold text-white">PostgreSQL 18</span>
            </div>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                health?.services?.database === "connected"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              }`}
            >
              {health?.services?.database || "Unknown"}
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 truncate">
            {infra?.databaseUrl || "postgresql://..."}
          </div>
          <button
            type="button"
            onClick={handleTestDb}
            disabled={isTestingDb}
            className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition-all flex items-center justify-center gap-1.5"
          >
            {isTestingDb ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
            <span>{isTestingDb ? "Pinging DB..." : "Test PostgreSQL Ping"}</span>
          </button>
          {dbTestResult && (
            <div
              className={`p-2.5 rounded-lg border text-[11px] flex items-center gap-2 ${
                dbTestResult.success
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-red-500/10 border-red-500/30 text-red-300"
              }`}
            >
              {dbTestResult.success ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
              <span className="truncate">{dbTestResult.message}</span>
            </div>
          )}
        </div>

        {/* Redis Card */}
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <Server className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-bold text-white">Redis Cache</span>
            </div>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                health?.services?.redis === "connected"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              }`}
            >
              {health?.services?.redis || "Unknown"}
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 truncate">
            {infra?.redisUrl || "redis://..."}
          </div>
          <button
            type="button"
            onClick={handleTestRedis}
            disabled={isTestingRedis}
            className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition-all flex items-center justify-center gap-1.5"
          >
            {isTestingRedis ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
            <span>{isTestingRedis ? "Pinging Redis..." : "Test Redis Ping"}</span>
          </button>
          {redisTestResult && (
            <div
              className={`p-2.5 rounded-lg border text-[11px] flex items-center gap-2 ${
                redisTestResult.success
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-red-500/10 border-red-500/30 text-red-300"
              }`}
            >
              {redisTestResult.success ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
              <span className="truncate">{redisTestResult.message}</span>
            </div>
          )}
        </div>
      </div>

      {/* Edit Form */}
      <form onSubmit={handleSave} className="space-y-6">
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
              Update Connection Strings
            </h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-mono flex items-center gap-1">
              <HardDrive className="w-3 h-3 text-indigo-400" />
              {infra?.isFromRuntimeStore ? "Runtime Store Active" : "Default .env Fallback Active"}
            </span>
          </div>

          {/* Database URL */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-indigo-400" />
              <span>PostgreSQL 18 Connection URL</span>
            </label>
            <input
              type="text"
              value={databaseUrl}
              onChange={(e) => setDatabaseUrl(e.target.value)}
              placeholder={
                infra?.databaseUrl
                  ? `Current: ${infra.databaseUrl} - Leave blank to keep unchanged`
                  : "postgresql://user:password@localhost:5432/pachiware_agent"
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Format: <code className="text-indigo-400 font-mono">postgresql://[user]:[password]@[host]:[port]/[database]</code>
            </p>
          </div>

          {/* Redis URL */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-purple-400" />
              <span>Redis Connection URL</span>
            </label>
            <input
              type="text"
              value={redisUrl}
              onChange={(e) => setRedisUrl(e.target.value)}
              placeholder={
                infra?.redisUrl
                  ? `Current: ${infra.redisUrl} - Leave blank to keep unchanged`
                  : "redis://localhost:6380"
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Format: <code className="text-indigo-400 font-mono">redis://[host]:[port]</code>
            </p>
          </div>
        </div>

        {/* Submit */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? "Saving to Runtime Store..." : "Save to Runtime Store"}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
