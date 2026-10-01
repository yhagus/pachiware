import React, { useState, useEffect } from "react";
import { Brain, Save, CheckCircle2, RotateCcw, Sparkles } from "lucide-react";
import { api, type AgentConfigData } from "../lib/api.js";

interface AgentPersonalityProps {
  initialConfig: AgentConfigData | null;
  onConfigSaved: (newConfig: AgentConfigData) => void;
}

export const AgentPersonality: React.FC<AgentPersonalityProps> = ({
  initialConfig,
  onConfigSaved,
}) => {
  const [name, setName] = useState(initialConfig?.name || "Pachiware Agent");
  const [systemPrompt, setSystemPrompt] = useState(
    initialConfig?.systemPrompt || ""
  );
  const [temperature, setTemperature] = useState(
    initialConfig?.temperature ?? 0.7
  );
  const [maxTokens, setMaxTokens] = useState(initialConfig?.maxTokens ?? 4096);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialConfig) {
      setName(initialConfig.name);
      setSystemPrompt(initialConfig.systemPrompt);
      setTemperature(initialConfig.temperature);
      setMaxTokens(initialConfig.maxTokens);
    }
  }, [initialConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMsg(null);
    setSavedSuccess(false);

    try {
      const res = await api.updateAgentConfig({
        name,
        systemPrompt,
        temperature,
        maxTokens,
      });

      onConfigSaved(res.config);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to update configuration.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (initialConfig) {
      setName(initialConfig.name);
      setSystemPrompt(initialConfig.systemPrompt);
      setTemperature(initialConfig.temperature);
      setMaxTokens(initialConfig.maxTokens);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-400" />
            Agent Personality & System Prompts
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Tune how the autonomous agent behaves, reason through tasks, and responds in Discord channels.
          </p>
        </div>

        {savedSuccess && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-medium animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Saved & Cache Cleared!</span>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Agent Identity */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            Agent Identity
          </h3>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-2">
              Agent Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700/80 text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="e.g. Pachiware Agent"
              required
            />
          </div>
        </div>

        {/* System Prompt Editor */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <span>Core System Instructions</span>
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            </h3>
            <span className="text-[11px] font-mono text-slate-400">
              {systemPrompt.length} characters
            </span>
          </div>
          <p className="text-xs text-slate-400">
            This prompt is dynamically combined with active tools, contextual server metadata, and task history during each ReAct loop iteration.
          </p>
          <textarea
            rows={8}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-800/80 border border-slate-700/80 text-white font-mono text-xs leading-relaxed focus:outline-none focus:border-indigo-500 transition-colors"
            placeholder="Enter the agent's core instructions and guidelines..."
            required
          />
        </div>

        {/* Inference Tuning */}
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-6">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            Model Hyperparameters
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Temperature */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-slate-300">Temperature</span>
                <span className="font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                  {temperature}
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="1.2"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>0.0 (Deterministic / Coding)</span>
                <span>1.0 (Creative / Conversational)</span>
              </div>
            </div>

            {/* Max Output Tokens */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-slate-300">Max Tokens</span>
                <span className="font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                  {maxTokens}
                </span>
              </div>
              <input
                type="number"
                min="256"
                max="16384"
                step="256"
                value={maxTokens}
                onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                className="w-full px-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700/80 text-white text-sm focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[10px] text-slate-400">
                Maximum token limit for single-turn completions.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-2">
          <button
            type="button"
            onClick={handleReset}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium transition-colors flex items-center gap-1.5"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Reset</span>
          </button>

          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? "Saving changes..." : "Save Personality"}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
