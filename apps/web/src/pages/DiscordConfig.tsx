import React, { useState, useEffect } from "react";
import { Bot, Key, Hash, Shield, CheckCircle2, AlertCircle, Save, Zap, Loader2, RefreshCw } from "lucide-react";
import { api, type AgentConfigData, type HealthResponse } from "../lib/api.js";

interface DiscordConfigProps {
  initialConfig: AgentConfigData | null;
  health: HealthResponse | null;
  onConfigSaved: (config: AgentConfigData) => void;
  onRefreshHealth: () => void;
}

export const DiscordConfig: React.FC<DiscordConfigProps> = ({
  initialConfig,
  health,
  onConfigSaved,
  onRefreshHealth,
}) => {
  const [botToken, setBotToken] = useState("");
  const [clientId, setClientId] = useState(initialConfig?.discordClientId || "");
  const [guildId, setGuildId] = useState(initialConfig?.discordGuildId || "");

  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [successMsg, setSuccessMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialConfig) {
      setClientId(initialConfig.discordClientId || "");
      setGuildId(initialConfig.discordGuildId || "");
    }
  }, [initialConfig]);

  const discordHealth = health?.services?.discord;
  const isConnected = discordHealth?.connected ?? false;

  const handleTestToken = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.testDiscord({ token: botToken.trim() || undefined });
      if (res.success) {
        setTestResult({
          success: true,
          message: `Valid Discord Bot Token! Authenticated as ${res.botTag} (ID: ${res.botId})`,
        });
      } else {
        setTestResult({
          success: false,
          message: res.error || "Invalid Discord Bot token.",
        });
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || "Failed to reach Discord Gateway.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleRestart = async () => {
    setIsRestarting(true);
    setErrorMsg(null);
    try {
      const res = await api.restartDiscord();
      setSuccessMsg(true);
      onRefreshHealth();
      setTimeout(() => setSuccessMsg(false), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to restart Discord bot.");
    } finally {
      setIsRestarting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMsg(null);
    setSuccessMsg(false);

    try {
      const payload: Partial<AgentConfigData> = {
        discordClientId: clientId.trim() || null,
        discordGuildId: guildId.trim() || null,
      };

      if (botToken.trim()) {
        payload.discordBotToken = botToken.trim();
      }

      const res = await api.updateAgentConfig(payload);
      onConfigSaved(res.config);
      setSuccessMsg(true);
      setBotToken("");
      onRefreshHealth();
      setTimeout(() => setSuccessMsg(false), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update Discord configuration.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Bot className="w-5 h-5 text-indigo-400" />
            Discord Bot & Gateway Management
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Configure bot credentials, default guild synchronization, and hot-reload the Discord Gateway connection.
          </p>
        </div>

        {successMsg && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Discord Config Updated & Reconnected!</span>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          {errorMsg}
        </div>
      )}

      {/* Live Status Card */}
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isConnected
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
            }`}
          >
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white">
                {discordHealth?.botTag || "Discord Bot Gateway"}
              </h3>
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  isConnected
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                }`}
              >
                {isConnected ? "Connected & Active" : "Standby / Simulation"}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {isConnected
                ? `Listening for mentions and DMs across ${discordHealth?.guildCount || 0} guild(s)`
                : "Configure bot token to establish live WebSocket gateway connection"}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRestart}
          disabled={isRestarting}
          className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition-all flex items-center gap-2"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRestarting ? "animate-spin" : ""}`} />
          <span>{isRestarting ? "Reconnecting..." : "Reconnect Gateway"}</span>
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            Bot Credentials
          </h3>

          {/* Bot Token */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-indigo-400" />
              <span>Discord Bot Token</span>
            </label>
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={
                initialConfig?.discordBotToken
                  ? `Configured (${initialConfig.discordBotToken}) - Leave empty to keep`
                  : "MTAx... (Discord Developer Portal Bot Token)"
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Obtained from <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">Discord Developer Portal</a> under Bot &gt; Reset Token.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Client ID */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-indigo-400" />
                <span>Discord Client / Application ID</span>
              </label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="123456789012345678"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            {/* Default Guild ID */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-indigo-400" />
                <span>Target Guild / Server ID (Optional)</span>
              </label>
              <input
                type="text"
                value={guildId}
                onChange={(e) => setGuildId(e.target.value)}
                placeholder="Optional Server ID for scoped channels"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>

          {/* Test Result Callout */}
          {testResult && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-center gap-2.5 ${
                testResult.success
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-red-500/10 border-red-500/30 text-red-300"
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              )}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>

        {/* Security Notice */}
        <div className="p-4 rounded-xl bg-slate-900/40 border border-indigo-500/20 flex items-start gap-3 text-xs text-slate-300">
          <Shield className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-white">Non-Mutating Security Guarantee:</span>{" "}
            Saving credentials here stores them safely in PostgreSQL and triggers a hot reconnection of the Discord WebSocket client. The <code className="text-indigo-400 font-mono">.env</code> file is never modified or exposed.
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={handleTestToken}
            disabled={isTesting}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-medium text-xs border border-slate-700 transition-all flex items-center gap-2"
          >
            {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
            <span>{isTesting ? "Validating with Discord..." : "Test Bot Token"}</span>
          </button>

          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-xs transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? "Saving & Reconnecting..." : "Save Discord Settings"}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
