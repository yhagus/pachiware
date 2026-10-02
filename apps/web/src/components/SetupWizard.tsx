import React, { useState } from "react";
import {
  Database,
  CheckCircle2,
  AlertCircle,
  Zap,
  Loader2,
  HardDrive,
  Terminal,
  ArrowRight,
  ShieldCheck,
  Cpu,
} from "lucide-react";
import { api } from "../lib/api.js";

interface SetupWizardProps {
  onConnected: () => void;
}

export const SetupWizard: React.FC<SetupWizardProps> = ({ onConnected }) => {
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latencyMs?: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setErrorMsg(null);
    try {
      const res = await api.testPostgres({ databaseUrl: databaseUrl.trim() || undefined });
      setTestResult(res);
      if (!res.success) {
        setErrorMsg(res.message);
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || "Failed to reach PostgreSQL server.",
      });
      setErrorMsg(err.message || "Failed to reach PostgreSQL server.");
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveAndInitialize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!databaseUrl.trim()) {
      setErrorMsg("Please provide a valid PostgreSQL connection string.");
      return;
    }

    setIsConnecting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await api.updateInfrastructure({
        databaseUrl: databaseUrl.trim(),
      });

      if (res.success) {
        setSuccessMsg("PostgreSQL connected successfully! Database schema migrated & seeded.");
        setTimeout(() => {
          onConnected();
        }, 1500);
      } else {
        setErrorMsg(res.message || "Failed to initialize database.");
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to connect and migrate database.");
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F19] text-slate-100 flex flex-col justify-center items-center p-6">
      {/* Background Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-2xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold tracking-wide">
            <Database className="w-3.5 h-3.5" />
            <span>INITIAL SETUP REQUIRED</span>
          </div>

          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Connect PostgreSQL Database
          </h1>

          <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
            Pachiware Agent is live in <span className="text-indigo-300 font-medium">Setup Mode</span>.
            Connect your PostgreSQL database to unlock the ReAct engine, skills, tasks, and full management dashboard.
          </p>
        </div>

        {/* Redis Fallback Info Banner */}
        <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
            <Cpu className="w-4 h-4" />
          </div>
          <div className="text-xs space-y-1">
            <div className="font-semibold text-white flex items-center gap-2">
              <span>Cache Engine: Native In-Memory Fallback Active</span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
                Zero-Dependency
              </span>
            </div>
            <p className="text-slate-400 leading-relaxed">
              External Redis is <strong className="text-slate-300">not required</strong>. Rate-limiting and session caching run automatically on built-in native memory. Only PostgreSQL is needed to store agent prompts, tasks, and history.
            </p>
          </div>
        </div>

        {/* Error / Success Notifications */}
        {errorMsg && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-3">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Main Database Setup Card */}
        <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 shadow-xl space-y-5">
          <form onSubmit={handleSaveAndInitialize} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-300">
                PostgreSQL Connection URL <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                placeholder="postgresql://user:password@localhost:5432/pachiware_agent"
                value={databaseUrl}
                onChange={(e) => {
                  setDatabaseUrl(e.target.value);
                  setTestResult(null);
                  setErrorMsg(null);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors font-mono"
              />
              <p className="text-[11px] text-slate-400">
                Works with local PostgreSQL, Docker, or Cloud databases (Neon, Supabase, Railway, RDS, Aiven).
              </p>
            </div>

            {/* Test Connection Feedback */}
            {testResult && (
              <div
                className={`p-3 rounded-lg text-xs flex items-center gap-2.5 ${
                  testResult.success
                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                    : "bg-red-500/10 text-red-300 border border-red-500/20"
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                )}
                <span className="flex-1">{testResult.message}</span>
                {testResult.latencyMs !== undefined && (
                  <span className="font-mono text-[10px] opacity-75">{testResult.latencyMs}ms</span>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || !databaseUrl.trim()}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all flex items-center gap-2 border border-slate-700 disabled:opacity-50"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Testing...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Test Ping</span>
                  </>
                )}
              </button>

              <button
                type="submit"
                disabled={isConnecting || !databaseUrl.trim()}
                className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Connecting & Migrating...</span>
                  </>
                ) : (
                  <>
                    <span>Save & Initialize Database</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Safe Non-Mutating .env Guarantee */}
          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Persisted to <code className="font-mono text-indigo-300">runtime-config.json</code> (.env stays untouched)</span>
            </span>
          </div>
        </div>

        {/* Terminal Quick Start Tip */}
        <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-xs text-slate-400 flex items-center gap-3">
          <Terminal className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <div className="leading-relaxed">
            <span>Want bundled local containers? Run </span>
            <code className="px-1.5 py-0.5 rounded bg-slate-800 font-mono text-indigo-300 text-[11px]">
              pachiware start --docker
            </code>
            <span> in your server terminal to spin up PostgreSQL & Redis automatically.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
