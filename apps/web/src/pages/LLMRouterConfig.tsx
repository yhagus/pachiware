import React, { useState, useEffect } from "react";
import { Cpu, Key, Globe, CheckCircle2, Shield, AlertCircle, Save } from "lucide-react";
import { api, type AgentConfigData } from "../lib/api.js";

interface LLMRouterConfigProps {
  initialConfig: AgentConfigData | null;
  onConfigSaved: (config: AgentConfigData) => void;
}

export const LLMRouterConfig: React.FC<LLMRouterConfigProps> = ({
  initialConfig,
  onConfigSaved,
}) => {
  const [provider, setProvider] = useState<"openai" | "anthropic" | "custom">(
    initialConfig?.defaultProvider || "openai"
  );
  const [model, setModel] = useState(initialConfig?.defaultModel || "gpt-4o");
  const [baseUrl, setBaseUrl] = useState(
    initialConfig?.customBaseUrl || "https://api.9router.com/v1"
  );
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialConfig) {
      setProvider(initialConfig.defaultProvider);
      setModel(initialConfig.defaultModel);
      setBaseUrl(initialConfig.customBaseUrl || "https://api.9router.com/v1");
    }
  }, [initialConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMsg(null);
    setSuccessMsg(false);

    try {
      const payload: Partial<AgentConfigData> = {
        defaultProvider: provider,
        defaultModel: model,
        customBaseUrl: baseUrl,
      };

      if (apiKey.trim()) {
        payload.customApiKey = apiKey.trim();
      }

      const res = await api.updateAgentConfig(payload);
      onConfigSaved(res.config);
      setSuccessMsg(true);
      setApiKey("");
      setTimeout(() => setSuccessMsg(false), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update LLM configuration.");
    } finally {
      setIsSaving(false);
    }
  };

  const getProviderPresetModels = () => {
    if (provider === "anthropic") {
      return ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"];
    }
    if (provider === "custom") {
      return ["gpt-4o", "claude-3-5-sonnet", "deepseek-chat", "meta-llama/llama-3.1-70b-instruct"];
    }
    return ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"];
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Cpu className="w-5 h-5 text-indigo-400" />
            LLM Router & Provider Settings
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Configure direct LLM credentials, custom proxy endpoints (such as 9router), and fallback models.
          </p>
        </div>

        {successMsg && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>LLM Router Updated!</span>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          {errorMsg}
        </div>
      )}

      {/* Provider Selection Tabs */}
      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => {
            setProvider("openai");
            setModel("gpt-4o");
          }}
          className={`p-4 rounded-xl border text-left transition-all ${
            provider === "openai"
              ? "bg-indigo-600/20 border-indigo-500 text-white shadow-lg shadow-indigo-600/10"
              : "bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700"
          }`}
        >
          <div className="text-xs font-bold">OpenAI Direct</div>
          <div className="text-[11px] text-slate-400 mt-1">
            Official GPT-4o & o-series models via OpenAI API
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setProvider("anthropic");
            setModel("claude-3-5-sonnet-20241022");
          }}
          className={`p-4 rounded-xl border text-left transition-all ${
            provider === "anthropic"
              ? "bg-indigo-600/20 border-indigo-500 text-white shadow-lg shadow-indigo-600/10"
              : "bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700"
          }`}
        >
          <div className="text-xs font-bold">Anthropic Messages</div>
          <div className="text-[11px] text-slate-400 mt-1">
            Claude 3.5 Sonnet & Haiku with native tool use
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setProvider("custom");
            setModel("gpt-4o");
            setBaseUrl("https://api.9router.com/v1");
          }}
          className={`p-4 rounded-xl border text-left transition-all ${
            provider === "custom"
              ? "bg-indigo-600/20 border-indigo-500 text-white shadow-lg shadow-indigo-600/10"
              : "bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700"
          }`}
        >
          <div className="text-xs font-bold flex items-center gap-1.5">
            <span>Custom Proxy / 9router</span>
            <span className="text-[9px] px-1 rounded bg-indigo-500/30 text-indigo-300 font-mono">
              OpenAI Wire
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Custom OpenAI-compatible reverse proxy endpoints
          </div>
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-5">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            Endpoint & Authentication
          </h3>

          {/* Model Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Active Model
            </label>
            <div className="flex gap-2">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
              >
                {getProviderPresetModels().map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Or custom model name..."
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-1/2 px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>

          {/* Base URL (shown for Custom / 9router or editable) */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-indigo-400" />
              <span>Base API URL</span>
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.9router.com/v1"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
              required={provider === "custom"}
            />
            <p className="text-[10px] text-slate-500 mt-1">
              For 9router, use <code className="text-indigo-400 font-mono">https://api.9router.com/v1</code>.
            </p>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-indigo-400" />
              <span>Provider API Key</span>
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                initialConfig?.customApiKey
                  ? `Configured (${initialConfig.customApiKey}) - Leave empty to keep`
                  : "Enter API Key (sk-...)"
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              Keys can also be configured directly via environment variables (<code className="text-indigo-400 font-mono">.env</code>).
            </p>
          </div>
        </div>

        {/* Informational Callout */}
        <div className="p-4 rounded-xl bg-slate-900/40 border border-indigo-500/20 flex items-start gap-3 text-xs text-slate-300">
          <Shield className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-white">Lightweight Architecture:</span>{" "}
            Pachiware Agent uses an explicit, native tool-calling ReAct engine without bulky wrapper frameworks (such as LangChain or Hermes). Tool definitions are converted on-the-fly to each provider's native format.
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
            <span>{isSaving ? "Saving Configuration..." : "Save Router Settings"}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
